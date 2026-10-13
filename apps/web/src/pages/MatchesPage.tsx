import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AramPool } from '../components/AramPool'
import { usePlayer } from '../contexts/PlayerContext'
import type { ChampSelectMember } from '../lib/desktop'
import { collectionSyncLabel, formatError, matchSizeLabel } from '../lib/format'
import {
  canAssignUniqueChampions,
  championRoleLabels,
  coversOpenRole,
  isFlexibleRole,
  matchedPlayerRole,
  openLaneRoles,
  queueLabel,
  roleFitScore,
  roleLabel,
  sortChampionsByRole,
  suggestRoleAwareAssignment,
  suggestUniqueChampionAssignment,
  type LaneRole,
} from '../lib/matchFeasibility'
import { supabase } from '../lib/supabase'
import type {
  Champion,
  DraftParticipant,
  DraftRoom,
  Player,
  ThemeMatch,
  ThemeMatchPlayer,
  ThemeMatchesResponse,
} from '../lib/types'

/** Espelho da select do client (não é pick persistido no Skin Draft). */
type LivePick = {
  player_id: string
  skin_id: string | null
  skin_name: string
  champion_id: string
  champion_name: string
  champion_image_url?: string | null
  splash_url?: string | null
  tile_url?: string | null
  lcu_champion_id: number
  lcu_skin_id: number
  is_intent: boolean
}

type LobbyParticipant = DraftParticipant & {
  player?: Player & { skin_count?: number }
}

function normalizeMatch(match: ThemeMatch): ThemeMatch {
  const rawPlayers =
    match.players ??
    (Array.isArray(match.members) &&
    match.members[0] &&
    'champions' in match.members[0]
      ? (match.members as ThemeMatchPlayer[])
      : [])
  const players = (rawPlayers ?? []).map((p) => ({
    ...p,
    champions: (Array.isArray(p.champions) ? p.champions : []).map((c) => ({
      ...c,
      skins: Array.isArray(c?.skins) ? c.skins : [],
      roles: Array.isArray(c?.roles) ? c.roles : [],
    })),
  }))
  return { ...match, players }
}

/** Só temas com combinação real (campeões únicos possíveis), melhores primeiro. */
function feasibleMatches(matches: ThemeMatch[]): ThemeMatch[] {
  try {
    return matches
      .filter((m) => {
        try {
          return canAssignUniqueChampions(m.players ?? [])
        } catch {
          return false
        }
      })
      .sort((a, b) => {
        const byCount = (b.match_count ?? 0) - (a.match_count ?? 0)
        if (byCount !== 0) return byCount
        const byOptions = (b.option_count ?? 0) - (a.option_count ?? 0)
        if (byOptions !== 0) return byOptions
        return (a.theme_name ?? '').localeCompare(b.theme_name ?? '', 'pt-BR')
      })
  } catch {
    return []
  }
}

function syncBadge(p: LobbyParticipant) {
  const count = p.player?.skin_count ?? 0
  if (!count) return 'Coleção ainda não salva'
  return collectionSyncLabel(p.player?.last_inventory_sync_at, count)
}

function matchMemberToParticipant(
  member: ChampSelectMember,
  participants: LobbyParticipant[],
  mePuuid?: string | null,
): string | null {
  if (member.isLocal && mePuuid) {
    const self = participants.find((p) => p.player?.puuid === mePuuid)
    if (self) return self.player_id
  }
  if (member.puuid) {
    const byPuuid = participants.find((p) => p.player?.puuid === member.puuid)
    if (byPuuid) return byPuuid.player_id
  }
  const gameName = member.gameName?.trim().toLowerCase()
  const tag = member.tagLine?.trim().toLowerCase()
  if (gameName) {
    const byName = participants.find((p) => {
      const gn = p.player?.game_name?.trim().toLowerCase()
      const tl = p.player?.tag_line?.trim().toLowerCase()
      if (!gn || gn !== gameName) return false
      if (tag && tl && tl !== tag) return false
      return true
    })
    if (byName) return byName.player_id
  }
  return null
}

export function MatchesPage() {
  const { roomId } = useParams<{ roomId: string }>()
  const { me, lcu, isDesktop, pickInClient } = usePlayer()
  const champSelect = lcu?.champSelect ?? null
  const inChampSelect = Boolean(champSelect) || Boolean(lcu?.party?.inChampSelect)
  const canPick = isDesktop && inChampSelect

  const [room, setRoom] = useState<DraftRoom | null>(null)
  const [participants, setParticipants] = useState<LobbyParticipant[]>([])
  const [aramChampions, setAramChampions] = useState<Champion[]>([])
  const [championsByKey, setChampionsByKey] = useState<Map<number, Champion>>(
    () => new Map(),
  )
  const [skinMetaByLcuId, setSkinMetaByLcuId] = useState<
    Map<number, { id: string; name: string; splash_url: string | null; tile_url: string | null }>
  >(() => new Map())
  const [data, setData] = useState<ThemeMatchesResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [picking, setPicking] = useState(false)

  const isHost = Boolean(room?.host_id && room.host_id === me?.id)
  const aramPool = room?.settings?.aram_pool ?? []

  const loadLobby = useCallback(async () => {
    if (!roomId) return
    const { data: raw, error: rpcError } = await supabase.rpc('get_room_lobby', {
      p_room_id: roomId,
    })
    if (rpcError) throw rpcError
    const payload = raw as {
      room: DraftRoom
      participants: LobbyParticipant[]
    }
    if (!payload?.room) throw new Error('Sala não encontrada')
    setRoom(payload.room)
    setParticipants(payload.participants ?? [])
  }, [roomId])

  const loadMatches = useCallback(async () => {
    if (!roomId) return
    const { data: raw, error: rpcError } = await supabase.rpc(
      'analyze_theme_matches',
      { p_room_id: roomId },
    )
    if (rpcError) throw rpcError
    const parsed = raw as ThemeMatchesResponse
    setData({
      ...parsed,
      matches: feasibleMatches((parsed.matches ?? []).map(normalizeMatch)),
    })
  }, [roomId])

  const loadAll = useCallback(async () => {
    if (!roomId) return
    setLoading(true)
    setError(null)
    try {
      await loadLobby()
      try {
        await loadMatches()
      } catch (matchErr) {
        // Lobby ok — mostra sala mesmo se a análise falhar
        setData(null)
        setError(formatError(matchErr))
      }
    } catch (err) {
      setError(formatError(err))
      setRoom(null)
      setParticipants([])
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [roomId, loadLobby, loadMatches])

  useEffect(() => {
    if (!roomId) return
    let cancelled = false
    setRoom(null)
    setParticipants([])
    setData(null)
    setError(null)
    setLoading(true)

    void (async () => {
      try {
        const { data: raw, error: rpcError } = await supabase.rpc(
          'get_room_lobby',
          { p_room_id: roomId },
        )
        if (cancelled) return
        if (rpcError) throw rpcError
        const payload = raw as {
          room: DraftRoom
          participants: LobbyParticipant[]
        }
        if (!payload?.room) throw new Error('Sala não encontrada')
        setRoom(payload.room)
        setParticipants(payload.participants ?? [])

        try {
          const { data: matchRaw, error: matchError } = await supabase.rpc(
            'analyze_theme_matches',
            { p_room_id: roomId },
          )
          if (cancelled) return
          if (matchError) throw matchError
          const parsed = matchRaw as ThemeMatchesResponse
          setData({
            ...parsed,
            matches: feasibleMatches(
              (parsed.matches ?? []).map(normalizeMatch),
            ),
          })
        } catch (matchErr) {
          if (!cancelled) {
            setData(null)
            setError(formatError(matchErr))
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(formatError(err))
          setRoom(null)
          setParticipants([])
          setData(null)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [roomId])

  useEffect(() => {
    let cancelled = false
    void supabase
      .from('champions')
      .select('id, name, key, image_url')
      .then(({ data: champs, error: champError }) => {
        if (cancelled) return
        if (champError) {
          setError(formatError(champError))
          return
        }
        const byKey = new Map<number, Champion>()
        const poolSet = new Set(aramPool)
        const aramList: Champion[] = []
        for (const raw of champs ?? []) {
          const c = raw as Champion
          const key = Number(c.key)
          if (Number.isFinite(key) && key > 0) byKey.set(key, c)
          if (poolSet.has(c.id)) aramList.push(c)
        }
        aramList.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
        setChampionsByKey(byKey)
        setAramChampions(aramPool.length ? aramList : [])
      })
    return () => {
      cancelled = true
    }
  }, [JSON.stringify(aramPool)])

  useEffect(() => {
    const team = champSelect?.myTeam ?? []
    const lcuSkinIds = [
      ...new Set(
        team
          .map((m) => m.selectedSkinId)
          .filter((id) => Number.isFinite(id) && id > 0),
      ),
    ]
    if (lcuSkinIds.length === 0) {
      setSkinMetaByLcuId(new Map())
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const { data: mapped, error: mapError } = await supabase.rpc(
          'map_lcu_skin_ids',
          { p_item_ids: lcuSkinIds },
        )
        if (cancelled) return
        if (mapError) throw mapError
        const skinIds = (mapped as string[] | null) ?? []
        if (skinIds.length === 0) {
          setSkinMetaByLcuId(new Map())
          return
        }
        const { data: skins, error: skinError } = await supabase
          .from('skins')
          .select('id, name, num, splash_url, tile_url, champion_id, champions(key)')
          .in('id', skinIds)
        if (cancelled) return
        if (skinError) throw skinError
        const next = new Map<
          number,
          { id: string; name: string; splash_url: string | null; tile_url: string | null }
        >()
        for (const row of skins ?? []) {
          const champ = row.champions as { key?: string | null } | null
          const key = Number(champ?.key)
          const num = Number(row.num ?? 0)
          if (!Number.isFinite(key) || key <= 0) continue
          const lcuId = key * 1000 + num
          next.set(lcuId, {
            id: row.id as string,
            name: row.name as string,
            splash_url: (row.splash_url as string | null) ?? null,
            tile_url: (row.tile_url as string | null) ?? null,
          })
        }
        setSkinMetaByLcuId(next)
      } catch {
        if (!cancelled) setSkinMetaByLcuId(new Map())
      }
    })()
    return () => {
      cancelled = true
    }
  }, [champSelect])

  useEffect(() => {
    if (!roomId) return
    const channel = supabase
      .channel(`room:${roomId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'draft_rooms', filter: `id=eq.${roomId}` },
        () => {
          void loadLobby()
            .then(() => loadMatches())
            .catch((err) => setError(formatError(err)))
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'draft_participants',
          filter: `room_id=eq.${roomId}`,
        },
        () => {
          void loadLobby()
            .then(() => loadMatches())
            .catch((err) => setError(formatError(err)))
        },
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [roomId, loadLobby, loadMatches])

  async function clearAramPool() {
    if (!room) return
    setBusy(true)
    setError(null)
    try {
      const { error: rpcError } = await supabase.rpc('update_aram_pool', {
        p_code: room.code,
        p_champion_ids: [],
      })
      if (rpcError) throw rpcError
      await loadLobby()
      await loadMatches()
    } catch (err) {
      setError(formatError(err))
    } finally {
      setBusy(false)
    }
  }

  async function pickSkin(skinId: string) {
    if (!canPick || picking) return
    setPicking(true)
    setError(null)
    try {
      const { data: skin, error: skinError } = await supabase
        .from('skins')
        .select('id, num, champions(key)')
        .eq('id', skinId)
        .single()
      if (skinError) throw skinError
      const champ = skin.champions as { key?: string | null } | null
      const championKey = Number(champ?.key)
      const skinNum = Number(skin.num ?? 0)
      if (!Number.isFinite(championKey) || championKey <= 0) {
        throw new Error('Campeão sem key Riot — sincronize o catálogo')
      }
      const lcuSkinId = championKey * 1000 + (Number.isFinite(skinNum) ? skinNum : 0)
      await pickInClient(championKey, lcuSkinId)
    } catch (err) {
      setError(formatError(err))
    } finally {
      setPicking(false)
    }
  }

  const livePicksByPlayer = useMemo(() => {
    const out: Record<string, LivePick> = {}
    const team = champSelect?.myTeam ?? []
    if (team.length === 0) return out

    for (const member of team) {
      const effectiveChamp =
        member.championId > 0
          ? member.championId
          : member.championPickIntent > 0
            ? member.championPickIntent
            : 0
      if (effectiveChamp <= 0) continue

      const playerId = matchMemberToParticipant(member, participants, me?.puuid)
      if (!playerId) continue

      const champ = championsByKey.get(effectiveChamp)
      const skinMeta =
        member.selectedSkinId > 0
          ? skinMetaByLcuId.get(member.selectedSkinId)
          : undefined

      out[playerId] = {
        player_id: playerId,
        skin_id: skinMeta?.id ?? null,
        skin_name: skinMeta?.name ?? (member.selectedSkinId > 0 ? 'Skin' : 'Padrão'),
        champion_id: champ?.id ?? String(effectiveChamp),
        champion_name: champ?.name ?? `Campeão ${effectiveChamp}`,
        champion_image_url: champ?.image_url ?? null,
        splash_url: skinMeta?.splash_url ?? null,
        tile_url: skinMeta?.tile_url ?? champ?.image_url ?? null,
        lcu_champion_id: effectiveChamp,
        lcu_skin_id: member.selectedSkinId > 0 ? member.selectedSkinId : 0,
        is_intent: member.championId <= 0 && member.championPickIntent > 0,
      }
    }
    return out
  }, [
    champSelect,
    participants,
    me?.puuid,
    championsByKey,
    skinMetaByLcuId,
  ])

  const activePicks = useMemo(
    () => Object.values(livePicksByPlayer),
    [livePicksByPlayer],
  )

  const takenChampions = useMemo(() => {
    const map = new Map<string, string>()
    for (const pick of activePicks) {
      if (pick.champion_id) map.set(pick.champion_id, pick.player_id)
    }
    return map
  }, [activePicks])

  const localLivePick = me?.id ? livePicksByPlayer[me.id] ?? null : null
  const teamReady =
    inChampSelect &&
    participants.length >= 2 &&
    participants.every((p) => {
      const pick = livePicksByPlayer[p.player_id]
      return Boolean(pick && !pick.is_intent && pick.lcu_champion_id > 0)
    })

  if (loading && !room) {
    return <p className="text-[var(--text-muted)]">Montando o party…</p>
  }

  if (error && !room) {
    return (
      <div className="rounded-[var(--radius)] border border-[var(--line)] bg-[var(--panel)] p-6">
        <h1 className="font-display text-2xl">Não foi possível abrir a sala</h1>
        <p className="mt-2 text-sm text-[var(--danger)]">{error}</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void loadAll()}
            className="rounded-md bg-[var(--gold)] px-4 py-2 text-sm font-semibold text-[var(--ink)]"
          >
            Tentar de novo
          </button>
          <Link to="/" className="text-sm text-[var(--teal-soft)]">
            Voltar ao início
          </Link>
        </div>
      </div>
    )
  }

  const matches = data?.matches ?? []
  const total = data?.participant_total ?? participants.length
  const filterAram =
    Boolean(data?.filter_aram) ||
    ((data?.aram_pool?.length ?? aramPool.length) > 0 &&
      data?.queue_kind !== 'sr' &&
      room?.settings?.queue_kind !== 'sr')
  const queueKind =
    data?.queue_kind === 'unknown' && filterAram
      ? 'aram'
      : (data?.queue_kind ??
        room?.settings?.queue_kind ??
        (filterAram ? 'aram' : 'unknown'))
  const showAramPool =
    filterAram ||
    queueKind === 'aram' ||
    aramPool.length > 0 ||
    Boolean(champSelect?.benchEnabled)
  /** Roles só fazem sentido no SR — nunca no ARAM. */
  const showRoles =
    queueKind === 'sr' && !showAramPool && !champSelect?.benchEnabled

  return (
    <div className="animate-fade-up">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--teal-soft)]">
            {queueLabel(queueKind)}
            {filterAram ? ' · filtrado pelo pool' : ''}
          </p>
          <h1 className="font-display text-3xl sm:text-4xl">Combinações</h1>
          <p className="mt-1 max-w-2xl text-[var(--text-muted)]">
            {canPick
              ? 'Clique na skin — o pick vai para o League Client. Aqui só espelhamos a select ao vivo.'
              : inChampSelect
                ? 'Select aberta no client — espelhando escolhas do time.'
                : 'Só combinações possíveis. Entre na select do LoL para pickar pelo Skin Draft.'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadAll()}
          disabled={loading || busy || picking}
          className="rounded-md border border-[var(--line-strong)] px-4 py-2 text-sm disabled:opacity-50"
        >
          {loading ? 'Atualizando…' : 'Atualizar'}
        </button>
      </div>

      <PartyStrip
        participants={participants}
        hostId={room?.host_id ?? null}
        meId={me?.id ?? null}
        picks={livePicksByPlayer}
        inChampSelect={inChampSelect}
      />

      {activePicks.length > 0 ? (
        <PicksBar picks={activePicks} meId={me?.id ?? null} />
      ) : null}

      {teamReady ? (
        <div className="animate-fade-up-delay mt-4 rounded-[var(--radius)] border border-[var(--gold)]/40 bg-[var(--gold)]/10 px-4 py-3">
          <p className="font-display text-lg text-[var(--gold-soft)]">
            Time com campeões na select
          </p>
          <p className="mt-0.5 text-sm text-[var(--text-muted)]">
            Espelho do client — confirme o lock no League of Legends.
          </p>
        </div>
      ) : null}

      {showAramPool ? (
        <div className="mt-5">
          <AramPool
            champions={aramChampions}
            syncedAt={room?.settings?.aram_synced_at}
            isHost={isHost}
            busy={busy}
            onClear={() => void clearAramPool()}
          />
        </div>
      ) : null}

      {error ? (
        <p className="mt-4 text-sm text-[var(--danger)]">{error}</p>
      ) : null}

      <div className="mt-6">
        {loading && !data ? (
          <p className="text-[var(--text-muted)]">Analisando coleções…</p>
        ) : participants.length < 2 ? (
          <div className="rounded-[var(--radius)] border border-dashed border-[var(--line)] bg-[var(--panel)]/50 px-6 py-10 text-center">
            <p className="text-[var(--text-muted)]">
              Aguarde o party — precisa de pelo menos 2 pessoas.
            </p>
          </div>
        ) : matches.length === 0 ? (
          <div className="rounded-[var(--radius)] border border-[var(--line)] bg-[var(--panel)] p-8 text-center">
            <p className="text-[var(--text-muted)]">
              Nenhuma combinação possível sem conflito de campeão.
              {filterAram
                ? ' Ajuste o party ou sincronize as coleções.'
                : ' Sincronize as coleções do party.'}
            </p>
            <Link
              to="/collection"
              className="mt-4 inline-block text-[var(--teal-soft)]"
            >
              Ir à coleção
            </Link>
          </div>
        ) : (
          <div className="space-y-5">
            {matches.map((match, index) => (
              <MatchCard
                key={match.theme_id}
                match={match}
                total={total}
                rank={index + 1}
                showRoles={showRoles}
                canPick={canPick}
                meId={me?.id ?? null}
                picks={livePicksByPlayer}
                localPick={localLivePick}
                takenChampions={takenChampions}
                picking={picking}
                onPick={(skinId) => void pickSkin(skinId)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function PartyStrip({
  participants,
  hostId,
  meId,
  picks,
  inChampSelect,
}: {
  participants: LobbyParticipant[]
  hostId: string | null
  meId: string | null
  picks: Record<string, LivePick>
  inChampSelect: boolean
}) {
  if (participants.length === 0) {
    return (
      <p className="text-sm text-[var(--text-muted)]">Ninguém na sala ainda.</p>
    )
  }

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
          {inChampSelect ? 'Select ao vivo' : 'No party'}
        </p>
        <p className="text-xs text-[var(--text-muted)]">
          {participants.length}{' '}
          {participants.length === 1 ? 'jogador' : 'jogadores'}
        </p>
      </div>
      <ul className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:thin]">
        {participants.map((p, index) => {
          const pid = p.player_id
          const name = p.player?.display_name ?? 'Jogador'
          const initial = name.trim().charAt(0).toUpperCase() || '?'
          const pick = picks[pid]
          return (
            <li
              key={pid}
              className="animate-fade-up flex min-w-[9.5rem] max-w-[12rem] shrink-0 items-center gap-2.5 rounded-md border border-[var(--line)] bg-[var(--ink-soft)]/90 px-2.5 py-2"
              style={{ animationDelay: `${index * 0.05}s` }}
            >
              <span
                className={[
                  'relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-display text-sm font-bold',
                  pid === meId
                    ? 'bg-[var(--teal)]/25 text-[var(--teal-soft)] ring-1 ring-[var(--teal)]/50'
                    : 'bg-[var(--panel-elevated)] text-[var(--gold-soft)]',
                ].join(' ')}
              >
                {pick?.tile_url || pick?.splash_url || pick?.champion_image_url ? (
                  <img
                    src={
                      pick.tile_url ||
                      pick.splash_url ||
                      pick.champion_image_url ||
                      ''
                    }
                    alt=""
                    className="h-full w-full rounded-full object-cover object-top"
                  />
                ) : (
                  initial
                )}
                {pick ? (
                  <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-[var(--teal)] ring-2 ring-[var(--ink-soft)]" />
                ) : null}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 truncate text-sm font-medium text-[var(--text-strong)]">
                  <span className="truncate">{name}</span>
                  {pid === hostId ? (
                    <span className="shrink-0 text-[9px] uppercase tracking-wide text-[var(--gold-soft)]">
                      host
                    </span>
                  ) : null}
                </span>
                <span className="block truncate text-[10px] text-[var(--text-muted)]">
                  {pick
                    ? `${pick.champion_name}${pick.is_intent ? ' (hover)' : ''}${
                        pick.skin_id ? ` · ${pick.skin_name}` : ''
                      }`
                    : inChampSelect
                      ? 'sem campeão ainda'
                      : syncBadge(p)}
                </span>
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function PicksBar({
  picks,
  meId,
}: {
  picks: LivePick[]
  meId: string | null
}) {
  return (
    <div className="mt-4">
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
        No client
      </p>
      <ul className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:thin]">
        {picks.map((pick) => (
          <li
            key={pick.player_id}
            className={[
              'flex shrink-0 items-center gap-2 rounded-md border px-2 py-1.5',
              pick.player_id === meId
                ? 'border-[var(--gold)]/50 bg-[var(--gold)]/10'
                : 'border-[var(--line)] bg-[var(--panel)]/70',
            ].join(' ')}
          >
            {(pick.tile_url || pick.splash_url || pick.champion_image_url) && (
              <img
                src={
                  pick.tile_url ||
                  pick.splash_url ||
                  pick.champion_image_url ||
                  ''
                }
                alt=""
                className="h-10 w-10 rounded object-cover object-top"
              />
            )}
            <span className="pr-1">
              <span className="block text-sm font-medium text-[var(--text-strong)]">
                {pick.champion_name}
                {pick.is_intent ? ' · hover' : ''}
              </span>
              <span className="block max-w-[9rem] truncate text-[10px] text-[var(--text-muted)]">
                {pick.skin_id ? pick.skin_name : 'skin padrão / pendente'}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function MatchCard({
  match,
  total,
  rank,
  showRoles,
  canPick,
  meId,
  picks,
  localPick,
  takenChampions,
  picking,
  onPick,
}: {
  match: ThemeMatch
  total: number
  rank: number
  showRoles: boolean
  canPick: boolean
  meId: string | null
  picks: Record<string, LivePick>
  localPick: LivePick | null
  takenChampions: Map<string, string>
  picking: boolean
  onPick: (skinId: string) => void
}) {
  const players = match.players ?? []
  const missing = total - match.match_count
  let assignment: Record<string, string> | null = null
  try {
    assignment = showRoles
      ? suggestRoleAwareAssignment(players)
      : suggestUniqueChampionAssignment(players)
  } catch {
    assignment = null
  }
  const openRoles = showRoles ? openLaneRoles(players) : new Set<LaneRole>()
  const optionCount =
    match.option_count ??
    players.reduce((n, p) => n + (p.skin_count ?? 0), 0)
  const liveOnTheme = players.filter((p) => {
    const pick = picks[p.player_id]
    if (!pick) return false
    return p.champions?.some((c) => c.champion_id === pick.champion_id)
  }).length

  return (
    <article className="overflow-hidden rounded-[var(--radius)] border border-[var(--line)] bg-[var(--panel)]/90">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] px-4 py-3">
        <div className="flex flex-wrap items-baseline gap-3">
          <span className="font-mono text-sm text-[var(--text-muted)]">#{rank}</span>
          <h2 className="font-display text-xl text-[var(--gold-soft)]">
            {match.theme_name}
          </h2>
          <span className="text-xs text-[var(--text-muted)]">
            {optionCount} {optionCount === 1 ? 'opção' : 'opções'}
          </span>
          {liveOnTheme > 0 ? (
            <span className="text-xs text-[var(--teal-soft)]">
              {liveOnTheme} na select neste tema
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="rounded-md bg-[var(--teal)]/20 px-2.5 py-1 font-medium text-[var(--teal-soft)]">
            {matchSizeLabel(match.match_count, total)}
          </span>
          {missing > 0 ? (
            <span className="text-[var(--text-muted)]">
              {missing} fora desta linha
            </span>
          ) : null}
        </div>
      </header>

      <div className="grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {players.map((player) => (
          <PlayerThemeColumn
            key={player.player_id}
            player={player}
            showRoles={showRoles}
            openRoles={openRoles}
            suggestedChampionId={assignment?.[player.player_id] ?? null}
            canPick={canPick}
            meId={meId}
            pick={picks[player.player_id] ?? null}
            localPick={localPick}
            takenChampions={takenChampions}
            picking={picking}
            onPick={onPick}
          />
        ))}
      </div>
    </article>
  )
}

const VISIBLE_SKINS = 3

type FlatSkin = {
  skin_id: string
  skin_name: string
  splash_url: string | null
  tile_url: string | null
  champion_id: string
  champion_name: string
  champion_image_url: string | null
  roles: string[]
  fit: number
  mastery_points: number
  mastery_level: number
}

function flattenPlayerSkins(
  player: ThemeMatchPlayer,
  prioritizeRoles: boolean,
  openRoles: Set<LaneRole>,
): FlatSkin[] {
  const source = player.champions ?? []
  const champs = prioritizeRoles
    ? sortChampionsByRole(
        source,
        player.primary_role,
        player.secondary_role,
        openRoles,
      )
    : [...source].sort((a, b) =>
        (a.champion_name ?? '').localeCompare(b.champion_name ?? '', 'pt-BR'),
      )

  const flexible = isFlexibleRole(player.primary_role, player.secondary_role)
  const rows: FlatSkin[] = []
  for (const champ of champs) {
    if (!champ?.champion_id) continue
    const fit = prioritizeRoles
      ? flexible
        ? coversOpenRole(champ.roles, openRoles)
          ? 2
          : 0
        : roleFitScore(champ.roles, player.primary_role, player.secondary_role)
      : 0
    for (const skin of champ.skins ?? []) {
      if (!skin?.skin_id) continue
      rows.push({
        ...skin,
        champion_id: champ.champion_id,
        champion_name: champ.champion_name ?? 'Campeão',
        champion_image_url: champ.champion_image_url ?? null,
        roles: champ.roles ?? [],
        fit,
        mastery_points: champ.mastery_points ?? 0,
        mastery_level: champ.mastery_level ?? 0,
      })
    }
  }
  return rows
}

function rankSkins(
  skins: FlatSkin[],
  opts: {
    suggestedChampionId: string | null
    selectedSkinId: string | null
    selectedChampionId: string | null
    takenChampions: Map<string, string>
    playerId: string
  },
): FlatSkin[] {
  const {
    suggestedChampionId,
    selectedSkinId,
    selectedChampionId,
    takenChampions,
    playerId,
  } = opts
  return [...skins].sort((a, b) => {
    const aSelected =
      a.skin_id === selectedSkinId ||
      (!selectedSkinId && a.champion_id === selectedChampionId)
    const bSelected =
      b.skin_id === selectedSkinId ||
      (!selectedSkinId && b.champion_id === selectedChampionId)
    if (aSelected !== bSelected) return aSelected ? -1 : 1

    const aSuggested = suggestedChampionId === a.champion_id
    const bSuggested = suggestedChampionId === b.champion_id
    if (aSuggested !== bSuggested) return aSuggested ? -1 : 1

    if (b.fit !== a.fit) return b.fit - a.fit
    if (b.mastery_points !== a.mastery_points) {
      return b.mastery_points - a.mastery_points
    }
    if (b.mastery_level !== a.mastery_level) {
      return b.mastery_level - a.mastery_level
    }

    const aTaken =
      takenChampions.has(a.champion_id) &&
      takenChampions.get(a.champion_id) !== playerId
    const bTaken =
      takenChampions.has(b.champion_id) &&
      takenChampions.get(b.champion_id) !== playerId
    if (aTaken !== bTaken) return aTaken ? 1 : -1

    return (a.skin_name ?? '').localeCompare(b.skin_name ?? '', 'pt-BR')
  })
}

function PlayerThemeColumn({
  player,
  showRoles,
  openRoles,
  suggestedChampionId,
  canPick,
  meId,
  pick,
  localPick,
  takenChampions,
  picking,
  onPick,
}: {
  player: ThemeMatchPlayer
  showRoles: boolean
  openRoles: Set<LaneRole>
  suggestedChampionId: string | null
  canPick: boolean
  meId: string | null
  pick: LivePick | null
  localPick: LivePick | null
  takenChampions: Map<string, string>
  picking: boolean
  onPick: (skinId: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const primary = roleLabel(player.primary_role)
  const secondary = roleLabel(player.secondary_role)
  const flexible = isFlexibleRole(player.primary_role, player.secondary_role)
  const isMine = Boolean(meId && player.player_id === meId)

  const selectedSkinId =
    isMine && localPick?.skin_id ? localPick.skin_id : null
  const selectedChampionId =
    isMine && localPick?.champion_id ? localPick.champion_id : null

  const skins = useMemo(
    () =>
      rankSkins(flattenPlayerSkins(player, showRoles, openRoles), {
        suggestedChampionId,
        selectedSkinId,
        selectedChampionId,
        takenChampions,
        playerId: player.player_id,
      }),
    [
      player,
      showRoles,
      openRoles,
      suggestedChampionId,
      selectedSkinId,
      selectedChampionId,
      takenChampions,
    ],
  )

  const visible = skins.slice(0, VISIBLE_SKINS)
  const hidden = skins.slice(VISIBLE_SKINS)
  const shown = expanded ? skins : visible
  const liveOnColumn =
    pick && player.champions?.some((c) => c.champion_id === pick.champion_id)
      ? pick
      : null

  return (
    <section
      className={[
        'rounded-md border bg-[var(--ink-soft)]/80',
        isMine && canPick
          ? 'border-[var(--teal)]/35'
          : 'border-[var(--line)]',
      ].join(' ')}
    >
      <header className="flex items-center gap-1.5 px-2 pt-1.5 pb-1">
        <p className="min-w-0 truncate text-sm font-medium text-[var(--text-strong)]">
          {player.display_name}
        </p>
        {isMine && canPick ? (
          <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wide text-[var(--teal-soft)]">
            você
          </span>
        ) : null}
        {showRoles && (primary || secondary) ? (
          <span className="shrink-0 text-[10px] text-[var(--text-muted)]">
            {primary ?? '—'}
            {secondary && secondary !== primary ? `/${secondary}` : ''}
          </span>
        ) : null}
        {liveOnColumn ? (
          <span className="ml-auto min-w-0 truncate text-[10px] text-[var(--gold-soft)]">
            {liveOnColumn.champion_name}
            {liveOnColumn.is_intent ? ' ·' : ''}
          </span>
        ) : (
          <span className="ml-auto shrink-0 text-[10px] text-[var(--text-muted)]">
            {skins.length}
          </span>
        )}
      </header>

      <ul className="grid grid-cols-3 gap-1 px-1.5 pb-1.5">
        {shown.map((skin) => (
          <SkinTile
            key={skin.skin_id}
            skin={skin}
            player={player}
            showRoles={showRoles}
            openRoles={openRoles}
            flexible={flexible}
            primary={primary}
            suggestedChampionId={suggestedChampionId}
            canPick={canPick}
            isMine={isMine}
            localPick={localPick}
            takenChampions={takenChampions}
            picking={picking}
            onPick={onPick}
          />
        ))}
      </ul>

      {hidden.length > 0 ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-center justify-center gap-1 border-t border-[var(--line)] px-2 py-1 text-[10px] text-[var(--text-muted)] transition hover:bg-[var(--panel)]/40 hover:text-[var(--text-strong)]"
        >
          {expanded
            ? 'Mostrar menos'
            : `+${hidden.length} skin${hidden.length === 1 ? '' : 's'}`}
        </button>
      ) : null}
    </section>
  )
}

function SkinTile({
  skin,
  player,
  showRoles,
  openRoles,
  flexible,
  primary,
  suggestedChampionId,
  canPick,
  isMine,
  localPick,
  takenChampions,
  picking,
  onPick,
}: {
  skin: FlatSkin
  player: ThemeMatchPlayer
  showRoles: boolean
  openRoles: Set<LaneRole>
  flexible: boolean
  primary: string | null
  suggestedChampionId: string | null
  canPick: boolean
  isMine: boolean
  localPick: LivePick | null
  takenChampions: Map<string, string>
  picking: boolean
  onPick: (skinId: string) => void
}) {
  const suggested = suggestedChampionId === skin.champion_id
  const champRoles = showRoles ? championRoleLabels(skin.roles) : []
  const roleTag = champRoles.slice(0, 2).join('/')
  const laneMatch = showRoles
    ? matchedPlayerRole(
        skin.roles,
        player.primary_role,
        player.secondary_role,
      )
    : null
  const onPlayerRole = Boolean(laneMatch)
  const onOpenRole =
    showRoles && flexible && coversOpenRole(skin.roles, openRoles)
  const highlighted = onPlayerRole || onOpenRole
  const dimOffRole = !showRoles
    ? false
    : suggested
      ? false
      : flexible
        ? !onOpenRole && openRoles.size > 0
        : !onPlayerRole && Boolean(primary)

  const selectedBySkin =
    isMine &&
    Boolean(localPick?.skin_id) &&
    localPick?.skin_id === skin.skin_id
  const selectedByChamp =
    isMine &&
    !localPick?.skin_id &&
    localPick?.champion_id === skin.champion_id
  const selected = selectedBySkin || selectedByChamp
  const dimNotSuggested =
    Boolean(suggestedChampionId) && !suggested && !selected
  const takenBy = takenChampions.get(skin.champion_id)
  const takenByOther = Boolean(takenBy) && takenBy !== player.player_id
  const canClick = canPick && isMine && !picking && (!takenByOther || selected)
  const showSuggestion = Boolean(suggestedChampionId) && suggested

  const tileClass = [
    'group relative overflow-hidden rounded border bg-[var(--panel)] text-left transition',
    selected
      ? 'border-[var(--gold)] ring-1 ring-[var(--gold)]/70'
      : showSuggestion
        ? 'border-[var(--gold)] ring-1 ring-[var(--gold)]/50'
        : highlighted && !dimNotSuggested
          ? 'border-[var(--teal)]/50'
          : 'border-[var(--line)]',
    dimNotSuggested || (dimOffRole && !selected) ? 'opacity-35' : '',
    takenByOther && !selected ? 'opacity-35' : '',
    canClick ? 'cursor-pointer hover:border-[var(--gold-soft)]' : '',
    isMine && canPick && !canClick && !selected ? 'cursor-not-allowed' : '',
    isMine && !canPick ? 'cursor-default' : '',
  ].join(' ')

  const title = `${skin.skin_name} · ${skin.champion_name}${
    roleTag ? ` · ${roleTag}` : ''
  }${selected ? ' · no client' : ''}${takenByOther ? ' · já pegaram' : ''}${
    showSuggestion && !selected ? ' · recomendado' : ''
  }${isMine && canClick ? ' · clique para pickar no LoL' : ''}${
    isMine && !canPick ? ' · disponível na select' : ''
  }`

  const inner = (
    <>
      <div className="aspect-[4/5] bg-[var(--ink)]">
        {skin.tile_url || skin.splash_url ? (
          <img
            src={skin.tile_url || skin.splash_url || ''}
            alt={skin.skin_name}
            className="h-full w-full object-cover object-top"
            loading="lazy"
          />
        ) : null}
      </div>
      {skin.champion_image_url ? (
        <img
          src={skin.champion_image_url}
          alt=""
          className="absolute left-0.5 top-0.5 h-4 w-4 rounded-sm border border-black/40 object-cover shadow"
          loading="lazy"
        />
      ) : null}
      {roleTag ? (
        <span
          className={[
            'absolute right-0.5 top-0.5 rounded bg-black/70 px-0.5 py-px text-[8px] font-semibold',
            selected || showSuggestion || highlighted
              ? 'text-[var(--teal-soft)]'
              : 'text-[var(--text)]',
          ].join(' ')}
        >
          {roleTag}
        </span>
      ) : null}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent px-1 pb-0.5 pt-4">
        <p className="truncate text-[9px] font-medium leading-tight text-[var(--text-strong)]">
          {skin.champion_name}
        </p>
        {selected ? (
          <p className="truncate text-[7px] font-bold uppercase tracking-wide text-[var(--gold-soft)]">
            no client
          </p>
        ) : takenByOther && canPick ? (
          <p className="truncate text-[7px] font-bold uppercase tracking-wide text-[var(--danger)]">
            ocupado
          </p>
        ) : showSuggestion ? (
          <p className="truncate text-[7px] font-bold uppercase tracking-wide text-[var(--gold-soft)]">
            recomendado
          </p>
        ) : null}
      </div>
    </>
  )

  return (
    <li>
      {isMine && canPick ? (
        <button
          type="button"
          disabled={!canClick}
          onClick={() => onPick(skin.skin_id)}
          className={tileClass}
          title={title}
        >
          {inner}
        </button>
      ) : (
        <div className={tileClass} title={title}>
          {inner}
        </div>
      )}
    </li>
  )
}
