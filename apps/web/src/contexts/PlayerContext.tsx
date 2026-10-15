import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  desktopLcuStatus,
  desktopPickChampionSkin,
  desktopSyncMe,
  desktopSyncParty,
  isTauri,
  type ChampSelectSnapshot,
  type LcuStatus,
  type SyncPartyResult,
} from '../lib/desktop'
import { isSupabaseConfigured } from '../lib/supabase'
import type { Player } from '../lib/types'

type PlayerContextValue = {
  configured: boolean
  isDesktop: boolean
  loading: boolean
  syncing: boolean
  error: string | null
  lcu: LcuStatus | null
  me: Player | null
  roomId: string | null
  partyId: string | null
  partyMembers: SyncPartyResult['members']
  queueKind: string | null
  /** Epoch ms do último sync de inventário bem-sucedido (p/ recarregar matches). */
  lastInventorySyncAt: number | null
  refresh: () => Promise<void>
  syncInventory: () => Promise<void>
  syncParty: () => Promise<void>
  /** Pick no League Client; Skin Draft só espelha o resultado. */
  pickInClient: (championId: number, skinId: number) => Promise<ChampSelectSnapshot>
}

const PlayerContext = createContext<PlayerContextValue | null>(null)

const STATUS_POLL_MS = 5000
/** Espelho da select: 2s é suficiente e evita spam de invoke/LCU. */
const STATUS_POLL_CHAMP_SELECT_MS = 2000
/** Re-sync inventário no máximo a cada 10 min (além do boot / botão manual). */
const INVENTORY_RESYNC_MS = 10 * 60 * 1000

function partyFingerprint(status: LcuStatus): string | null {
  const party = status.party
  if (!party?.partyId) return null
  const members = [...party.members]
    .map(
      (m) =>
        `${m.puuid}:${m.gameName ?? ''}:${m.tagLine ?? ''}:${m.primaryRole ?? ''}:${m.secondaryRole ?? ''}`,
    )
    .sort()
    .join('|')
  // Pool ARAM só no ARAM — no SR os picks mudam a cada hover e disparavam sync_party
  const aram =
    party.queueKind === 'aram'
      ? [...(party.aramChampionIds ?? [])].sort().join(',')
      : ''
  return [
    party.partyId,
    party.queueId ?? '',
    party.queueKind ?? '',
    party.inChampSelect ? '1' : '0',
    members,
    aram,
  ].join('::')
}

function champSelectFingerprint(status: LcuStatus): string {
  const cs = status.champSelect
  if (!cs) return ''
  const team = (cs.myTeam ?? [])
    .map(
      (m) =>
        `${m.cellId}:${m.championId}:${m.championPickIntent}:${m.selectedSkinId}`,
    )
    .join('|')
  return `${cs.phase ?? ''}:${cs.benchEnabled ? 1 : 0}:${team}`
}

function lcuUiFingerprint(status: LcuStatus): string {
  return [
    status.connected ? '1' : '0',
    status.message,
    status.summoner?.puuid ?? '',
    status.party?.partyId ?? '',
    status.party?.queueKind ?? '',
    status.party?.inChampSelect ? '1' : '0',
    champSelectFingerprint(status),
  ].join('::')
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  const isDesktop = isTauri()
  const configured = isSupabaseConfigured

  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lcu, setLcu] = useState<LcuStatus | null>(null)
  const [me, setMe] = useState<Player | null>(null)
  const [roomId, setRoomId] = useState<string | null>(null)
  const [partyId, setPartyId] = useState<string | null>(null)
  const [partyMembers, setPartyMembers] = useState<SyncPartyResult['members']>([])
  const [queueKind, setQueueKind] = useState<string | null>(null)

  /** Só bloqueia sync_party/inventory concorrentes — status leve continua. */
  const syncBusyRef = useRef(false)
  const lastPartyFpRef = useRef<string | null>(null)
  const lastInventoryAtRef = useRef(0)
  const [lastInventorySyncAt, setLastInventorySyncAt] = useState<number | null>(
    null,
  )
  const wasConnectedRef = useRef(false)
  const lastUiFpRef = useRef<string | null>(null)
  const lcuRef = useRef<LcuStatus | null>(null)
  lcuRef.current = lcu

  const applyPartyResult = useCallback((result: SyncPartyResult) => {
    setRoomId(result.room_id)
    setPartyId(result.party_id)
    setPartyMembers(result.members ?? [])
    setQueueKind(result.queue_kind ?? null)
  }, [])

  const refresh = useCallback(async () => {
    if (!isDesktop) {
      setLcu(null)
      setLoading(false)
      return
    }

    try {
      const status = await desktopLcuStatus()
      setLcu(status)
      if (status.summoner) {
        setMe((prev) => ({
          id: prev?.id ?? '',
          puuid: status.summoner!.puuid,
          game_name: status.summoner!.gameName,
          tag_line: status.summoner!.tagLine,
          display_name: status.summoner!.displayName,
          last_inventory_sync_at: prev?.last_inventory_sync_at ?? null,
          skin_count: prev?.skin_count,
        }))
      }
      if (!status.party?.partyId) {
        setPartyId(null)
        setRoomId(null)
        setPartyMembers([])
        setQueueKind(null)
        lastPartyFpRef.current = null
      } else {
        setPartyId(status.party.partyId)
        setQueueKind(status.party.queueKind ?? null)
      }
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [isDesktop])

  const syncInventory = useCallback(async () => {
    if (!isDesktop) return
    setSyncing(true)
    setError(null)
    try {
      const result = await desktopSyncMe()
      const at = Date.now()
      lastInventoryAtRef.current = at
      setLastInventorySyncAt(at)
      setMe({
        id: result.player_id,
        puuid: result.puuid,
        game_name: lcu?.summoner?.gameName ?? null,
        tag_line: lcu?.summoner?.tagLine ?? null,
        display_name: result.display_name,
        last_inventory_sync_at: result.last_inventory_sync_at,
        skin_count: result.skin_count,
      })
      if (result.mastery_warning) {
        setError(String(result.mastery_warning))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      throw err
    } finally {
      setSyncing(false)
    }
  }, [isDesktop, lcu?.summoner?.gameName, lcu?.summoner?.tagLine])

  const syncParty = useCallback(async () => {
    if (!isDesktop) return
    setSyncing(true)
    setError(null)
    try {
      const result = await desktopSyncParty({ syncInventory: false })
      applyPartyResult(result)
      const self = (result.members ?? []).find((m) => m.puuid === me?.puuid)
      if (self) {
        setMe((prev) =>
          prev
            ? {
                ...prev,
                id: self.player_id,
                display_name: self.display_name,
                last_inventory_sync_at: self.last_inventory_sync_at,
                skin_count: self.skin_count,
              }
            : prev,
        )
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      throw err
    } finally {
      setSyncing(false)
    }
  }, [applyPartyResult, isDesktop, me?.puuid])

  const pickInClient = useCallback(
    async (championId: number, skinId: number) => {
      if (!isDesktop) {
        throw new Error('Pick no client só funciona no app desktop')
      }
      const snapshot = await desktopPickChampionSkin({ championId, skinId })
      setLcu((prev) =>
        prev
          ? {
              ...prev,
              champSelect: snapshot,
              party: prev.party
                ? { ...prev.party, inChampSelect: true }
                : prev.party,
            }
          : prev,
      )
      return snapshot
    },
    [isDesktop],
  )

  useEffect(() => {
    if (!isDesktop) {
      setLoading(false)
      return
    }

    let cancelled = false
    let timer: number | null = null

    async function tick(forceInventory: boolean): Promise<boolean> {
      if (cancelled) {
        return Boolean(
          lcuRef.current?.champSelect || lcuRef.current?.party?.inChampSelect,
        )
      }
      let selectActive = false
      try {
        // Status leve sempre — não espera sync pesado
        const status = await desktopLcuStatus()
        if (cancelled) return false

        const uiFp = lcuUiFingerprint(status)
        if (uiFp !== lastUiFpRef.current) {
          lastUiFpRef.current = uiFp
          setLcu(status)
          lcuRef.current = status
        } else {
          lcuRef.current = status
        }
        setLoading(false)
        selectActive = Boolean(
          status.champSelect || status.party?.inChampSelect,
        )

        if (!status.connected || !status.summoner) {
          wasConnectedRef.current = false
          setPartyId(null)
          setRoomId(null)
          setPartyMembers([])
          setQueueKind(null)
          lastPartyFpRef.current = null
          lastUiFpRef.current = null
          return false
        }

        const justConnected = !wasConnectedRef.current
        wasConnectedRef.current = true

        setMe((prev) => {
          if (
            prev &&
            prev.puuid === status.summoner!.puuid &&
            prev.game_name === status.summoner!.gameName &&
            prev.tag_line === status.summoner!.tagLine &&
            prev.display_name === status.summoner!.displayName
          ) {
            return prev
          }
          return {
            id: prev?.id ?? '',
            puuid: status.summoner!.puuid,
            game_name: status.summoner!.gameName,
            tag_line: status.summoner!.tagLine,
            display_name: status.summoner!.displayName,
            last_inventory_sync_at: prev?.last_inventory_sync_at ?? null,
            skin_count: prev?.skin_count,
          }
        })

        const needInventory =
          forceInventory ||
          justConnected ||
          Date.now() - lastInventoryAtRef.current > INVENTORY_RESYNC_MS

        let softWarning: string | null = null
        let hardError: string | null = null

        if (needInventory && !syncBusyRef.current) {
          syncBusyRef.current = true
          try {
            const inv = await desktopSyncMe()
            if (cancelled) return selectActive
            const at = Date.now()
            lastInventoryAtRef.current = at
            setLastInventorySyncAt(at)
            setMe({
              id: inv.player_id,
              puuid: inv.puuid,
              game_name: status.summoner.gameName,
              tag_line: status.summoner.tagLine,
              display_name: inv.display_name,
              last_inventory_sync_at: inv.last_inventory_sync_at,
              skin_count: inv.skin_count,
            })
            if (inv.mastery_warning) {
              softWarning = String(inv.mastery_warning)
            }
          } catch (err) {
            hardError = err instanceof Error ? err.message : String(err)
          } finally {
            syncBusyRef.current = false
          }
        }

        const fp = partyFingerprint(status)
        if (!fp) {
          setPartyId(null)
          setRoomId(null)
          setPartyMembers([])
          setQueueKind(null)
          lastPartyFpRef.current = null
          if (!cancelled) setError(hardError ?? softWarning)
          return selectActive
        }

        setPartyId(status.party!.partyId)
        setQueueKind(status.party!.queueKind ?? null)

        if (fp !== lastPartyFpRef.current && !syncBusyRef.current) {
          syncBusyRef.current = true
          try {
            const party = await desktopSyncParty({ syncInventory: false })
            if (cancelled) return selectActive
            lastPartyFpRef.current = fp
            applyPartyResult(party)
          } catch (err) {
            hardError = err instanceof Error ? err.message : String(err)
          } finally {
            syncBusyRef.current = false
          }
        }

        if (!cancelled) setError(hardError ?? softWarning)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
          setLoading(false)
        }
      }
      return selectActive
    }

    async function loop(forceInventory: boolean) {
      const selectActive = await tick(forceInventory)
      if (cancelled) return
      const ms = selectActive ? STATUS_POLL_CHAMP_SELECT_MS : STATUS_POLL_MS
      timer = window.setTimeout(() => void loop(false), ms)
    }

    void loop(true)

    return () => {
      cancelled = true
      if (timer != null) window.clearTimeout(timer)
    }
  }, [applyPartyResult, isDesktop])

  const value = useMemo<PlayerContextValue>(
    () => ({
      configured,
      isDesktop,
      loading,
      syncing,
      error,
      lcu,
      me,
      roomId,
      partyId,
      partyMembers,
      queueKind,
      lastInventorySyncAt,
      refresh,
      syncInventory,
      syncParty,
      pickInClient,
    }),
    [
      configured,
      isDesktop,
      loading,
      syncing,
      error,
      lcu,
      me,
      roomId,
      partyId,
      partyMembers,
      queueKind,
      lastInventorySyncAt,
      refresh,
      syncInventory,
      syncParty,
      pickInClient,
    ],
  )

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>
}

export function usePlayer() {
  const ctx = useContext(PlayerContext)
  if (!ctx) throw new Error('usePlayer deve estar dentro de PlayerProvider')
  return ctx
}
