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
  desktopSyncMe,
  desktopSyncParty,
  isTauri,
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
  refresh: () => Promise<void>
  syncInventory: () => Promise<void>
  syncParty: () => Promise<void>
}

const PlayerContext = createContext<PlayerContextValue | null>(null)

const STATUS_POLL_MS = 5000
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
  const aram = [...(party.aramChampionIds ?? [])].sort().join(',')
  return [
    party.partyId,
    party.queueId ?? '',
    party.queueKind ?? '',
    members,
    aram,
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

  const busyRef = useRef(false)
  const lastPartyFpRef = useRef<string | null>(null)
  const lastInventoryAtRef = useRef(0)
  const wasConnectedRef = useRef(false)

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
      lastInventoryAtRef.current = Date.now()
      setMe({
        id: result.player_id,
        puuid: result.puuid,
        game_name: lcu?.summoner?.gameName ?? null,
        tag_line: lcu?.summoner?.tagLine ?? null,
        display_name: result.display_name,
        last_inventory_sync_at: result.last_inventory_sync_at,
        skin_count: result.skin_count,
      })
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

  useEffect(() => {
    if (!isDesktop) {
      setLoading(false)
      return
    }

    let cancelled = false

    async function tick(forceInventory: boolean) {
      if (cancelled || busyRef.current) return
      busyRef.current = true
      try {
        const status = await desktopLcuStatus()
        if (cancelled) return

        setLcu(status)
        setLoading(false)

        if (!status.connected || !status.summoner) {
          wasConnectedRef.current = false
          setPartyId(null)
          setRoomId(null)
          setPartyMembers([])
          setQueueKind(null)
          lastPartyFpRef.current = null
          return
        }

        const justConnected = !wasConnectedRef.current
        wasConnectedRef.current = true

        setMe((prev) => ({
          id: prev?.id ?? '',
          puuid: status.summoner!.puuid,
          game_name: status.summoner!.gameName,
          tag_line: status.summoner!.tagLine,
          display_name: status.summoner!.displayName,
          last_inventory_sync_at: prev?.last_inventory_sync_at ?? null,
          skin_count: prev?.skin_count,
        }))

        const needInventory =
          forceInventory ||
          justConnected ||
          Date.now() - lastInventoryAtRef.current > INVENTORY_RESYNC_MS

        if (needInventory) {
          try {
            const inv = await desktopSyncMe()
            if (cancelled) return
            lastInventoryAtRef.current = Date.now()
            setMe({
              id: inv.player_id,
              puuid: inv.puuid,
              game_name: status.summoner.gameName,
              tag_line: status.summoner.tagLine,
              display_name: inv.display_name,
              last_inventory_sync_at: inv.last_inventory_sync_at,
              skin_count: inv.skin_count,
            })
          } catch (err) {
            if (!cancelled) {
              setError(err instanceof Error ? err.message : String(err))
            }
          }
        }

        const fp = partyFingerprint(status)
        if (!fp) {
          setPartyId(null)
          setRoomId(null)
          setPartyMembers([])
          setQueueKind(null)
          lastPartyFpRef.current = null
          return
        }

        setPartyId(status.party!.partyId)
        setQueueKind(status.party!.queueKind ?? null)

        if (fp !== lastPartyFpRef.current) {
          try {
            const party = await desktopSyncParty({ syncInventory: false })
            if (cancelled) return
            lastPartyFpRef.current = fp
            applyPartyResult(party)
          } catch (err) {
            if (!cancelled) {
              setError(err instanceof Error ? err.message : String(err))
            }
          }
        }

        setError(null)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
          setLoading(false)
        }
      } finally {
        busyRef.current = false
      }
    }

    void tick(true)
    const id = window.setInterval(() => void tick(false), STATUS_POLL_MS)

    return () => {
      cancelled = true
      window.clearInterval(id)
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
      refresh,
      syncInventory,
      syncParty,
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
      refresh,
      syncInventory,
      syncParty,
    ],
  )

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>
}

export function usePlayer() {
  const ctx = useContext(PlayerContext)
  if (!ctx) throw new Error('usePlayer deve estar dentro de PlayerProvider')
  return ctx
}
