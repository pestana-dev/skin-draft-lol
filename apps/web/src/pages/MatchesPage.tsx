import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AramPool } from '../components/AramPool'
import { usePlayer } from '../contexts/PlayerContext'
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
  ThemePick,
} from '../lib/types'

type LobbyParticipant = DraftParticipant & {
  player?: Player & { skin_count?: number }
}

function normalizeMatch(match: ThemeMatch): ThemeMatch {
  const players =
    match.players ??
    (Array.isArray(match.members) &&
    match.members[0] &&
    'champions' in match.members[0]
      ? (match.members as ThemeMatchPlayer[])
      : [])
  return { ...match, players }
}

function syncBadge(p: LobbyParticipant) {
  const count = p.player?.skin_count ?? 0
  if (!count) return 'Coleção ainda não salva'
  return collectionSyncLabel(p.player?.last_inventory_sync_at, count)
}

function picksMap(room: DraftRoom | null): Record<string, ThemePick> {
  return room?.settings?.theme_picks ?? {}
}

export function MatchesPage() {
  const { roomId } = useParams<{ roomId: string }>()
  const { me, lcu } = usePlayer()
  const inChampSelect = Boolean(lcu?.party?.inChampSelect)
  const canPick = inChampSelect && Boolean(me?.id)

  const [room, setRoom] = useState<DraftRoom | null>(null)
  const [participants, setParticipants] = useState<LobbyParticipant[]>([])
  const [aramChampions, setAramChampions] = useState<Champion[]>([])
  const [data, setData] = useState<ThemeMatchesResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [picking, setPicking] = useState(false)

  const isHost = Boolean(room?.host_id && room.host_id === me?.id)
  const aramPool = room?.settings?.aram_pool ?? []
  const themePicks = picksMap(room)

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
      matches: (parsed.matches ?? []).map(normalizeMatch),
    })
  }, [roomId])

  const loadAll = useCallback(async () => {
    if (!roomId) return
    setLoading(true)
    setError(null)
    try {
      await loadLobby()
      await loadMatches()
    } catch (err) {
      setError(formatError(err))
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [roomId, loadLobby, loadMatches])

  useEffect(() => {
    void loadAll()
  }, [loadAll])

  useEffect(() => {
    if (!aramPool.length) {
      setAramChampions([])
      return
    }
    let cancelled = false
    void supabase
      .from('champions')
      .select('*')
      .in('id', aramPool)
      .order('name')
      .then(({ data: champs, error: champError }) => {
        if (cancelled) return
        if (champError) {
          setError(formatError(champError))
          return
        }
        setAramChampions((champs ?? []) as Champion[])
      })
    return () => {
      cancelled = true
    }
  }, [JSON.stringify(aramPool)])

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

  async function pickSkin(themeId: string, skinId: string) {
    if (!roomId || !me?.id || picking || !canPick) return
    setPicking(true)
    setError(null)
    try {
      const { data: raw, error: rpcError } = await supabase.rpc('set_theme_pick', {
        p_room_id: roomId,
        p_player_id: me.id,
        p_theme_id: themeId,
        p_skin_id: skinId,
      })
      if (rpcError) throw rpcError
      const payload = raw as { theme_picks?: Record<string, ThemePick> }
      setRoom((prev) =>
        prev
          ? {
              ...prev,
              settings: {
                ...prev.settings,
                theme_picks: payload.theme_picks ?? {},
              },
            }
          : prev,
      )
    } catch (err) {
      setError(formatError(err))
    } finally {
      setPicking(false)
    }
  }

  const participantIds = useMemo(
    () => participants.map((p) => p.player_id),
    [participants],
  )

  const activePicks = useMemo(() => {
    const out: ThemePick[] = []
    for (const id of participantIds) {
      const pick = themePicks[id]
      if (pick) out.push(pick)
    }
    return out
  }, [participantIds, themePicks])

  const takenChampions = useMemo(() => {
    const map = new Map<string, string>()
    for (const pick of activePicks) {
      map.set(pick.champion_id, pick.player_id)
    }
    return map
  }, [activePicks])

  const consensus = useMemo(() => {
    if (participants.length < 2) return null
    if (activePicks.length !== participants.length) return null
    const themeId = activePicks[0]?.theme_id
    if (!themeId) return null
    if (!activePicks.every((p) => p.theme_id === themeId)) return null
    return {
      themeId,
      themeName: activePicks[0].theme_name,
      picks: activePicks,
    }
  }, [participants.length, activePicks])

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
    filterAram || queueKind === 'aram' || aramPool.length > 0

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
              ? 'Clique na sua skin para escolher — um toque seleciona campeão e skin.'
              : 'Escolha liberada na seleção de campeões do client.'}
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
        picks={themePicks}
      />

      {activePicks.length > 0 ? (
        <PicksBar picks={activePicks} meId={me?.id ?? null} />
      ) : null}

      {consensus ? (
        <div className="animate-fade-up-delay mt-4 rounded-[var(--radius)] border border-[var(--gold)]/40 bg-[var(--gold)]/10 px-4 py-3">
          <p className="font-display text-lg text-[var(--gold-soft)]">
            Time fechado · {consensus.themeName}
          </p>
          <p className="mt-0.5 text-sm text-[var(--text-muted)]">
            Todo mundo escolheu no mesmo tema. Boa sorte no client!
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
              Nenhuma combinação com 2+ pessoas.
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
                showRoles={queueKind === 'sr'}
                showRecommended={inChampSelect}
                canPick={canPick}
                meId={me?.id ?? null}
                picks={themePicks}
                takenChampions={takenChampions}
                picking={picking}
                onPick={(skinId) => void pickSkin(match.theme_id, skinId)}
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
}: {
  participants: LobbyParticipant[]
  hostId: string | null
  meId: string | null
  picks: Record<string, ThemePick>
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
          No party
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
                {pick?.tile_url || pick?.splash_url ? (
                  <img
                    src={pick.tile_url || pick.splash_url || ''}
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
                    ? `${pick.champion_name} · ${pick.theme_name}`
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
  picks: ThemePick[]
  meId: string | null
}) {
  return (
    <div className="mt-4">
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
        Escolhas
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
            {(pick.tile_url || pick.splash_url) && (
              <img
                src={pick.tile_url || pick.splash_url || ''}
                alt=""
                className="h-10 w-10 rounded object-cover object-top"
              />
            )}
            <span className="pr-1">
              <span className="block text-sm font-medium text-[var(--text-strong)]">
                {pick.champion_name}
              </span>
              <span className="block max-w-[9rem] truncate text-[10px] text-[var(--text-muted)]">
                {pick.skin_name}
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
  showRecommended,
  canPick,
  meId,
  picks,
  takenChampions,
  picking,
  onPick,
}: {
  match: ThemeMatch
  total: number
  rank: number
  showRoles: boolean
  showRecommended: boolean
  canPick: boolean
  meId: string | null
  picks: Record<string, ThemePick>
  takenChampions: Map<string, string>
  picking: boolean
  onPick: (skinId: string) => void
}) {
  const players = match.players ?? []
  const missing = total - match.match_count
  const uniqueOk = canAssignUniqueChampions(players)
  const assignment = showRecommended
    ? showRoles
      ? suggestRoleAwareAssignment(players)
      : suggestUniqueChampionAssignment(players)
    : null
  const openRoles = showRoles ? openLaneRoles(players) : new Set<LaneRole>()
  const optionCount =
    match.option_count ??
    players.reduce((n, p) => n + (p.skin_count ?? 0), 0)
  const picksOnTheme = players.filter(
    (p) => picks[p.player_id]?.theme_id === match.theme_id,
  ).length

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
          {picksOnTheme > 0 ? (
            <span className="text-xs text-[var(--teal-soft)]">
              {picksOnTheme} escolhendo aqui
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
          {!uniqueOk ? (
            <span className="rounded-md bg-[var(--danger)]/10 px-2.5 py-1 text-xs text-[var(--danger)]">
              Conflito de campeão
            </span>
          ) : null}
        </div>
      </header>

      <div className="grid gap-4 p-4 lg:grid-cols-2">
        {players.map((player) => (
          <PlayerThemeColumn
            key={player.player_id}
            player={player}
            themeId={match.theme_id}
            showRoles={showRoles}
            openRoles={openRoles}
            suggestedChampionId={assignment?.[player.player_id] ?? null}
            canPick={canPick}
            meId={meId}
            pick={picks[player.player_id] ?? null}
            takenChampions={takenChampions}
            picking={picking}
            onPick={onPick}
          />
        ))}
      </div>
    </article>
  )
}

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
}

function flattenPlayerSkins(
  player: ThemeMatchPlayer,
  prioritizeRoles: boolean,
  openRoles: Set<LaneRole>,
): FlatSkin[] {
  const champs = prioritizeRoles
    ? sortChampionsByRole(
        player.champions,
        player.primary_role,
        player.secondary_role,
        openRoles,
      )
    : [...player.champions].sort((a, b) =>
        a.champion_name.localeCompare(b.champion_name, 'pt-BR'),
      )

  const flexible = isFlexibleRole(player.primary_role, player.secondary_role)
  const rows: FlatSkin[] = []
  for (const champ of champs) {
    const fit = prioritizeRoles
      ? flexible
        ? coversOpenRole(champ.roles, openRoles)
          ? 2
          : 0
        : roleFitScore(champ.roles, player.primary_role, player.secondary_role)
      : 0
    for (const skin of champ.skins) {
      rows.push({
        ...skin,
        champion_id: champ.champion_id,
        champion_name: champ.champion_name,
        champion_image_url: champ.champion_image_url,
        roles: champ.roles ?? [],
        fit,
      })
    }
  }
  return rows
}

function PlayerThemeColumn({
  player,
  themeId,
  showRoles,
  openRoles,
  suggestedChampionId,
  canPick,
  meId,
  pick,
  takenChampions,
  picking,
  onPick,
}: {
  player: ThemeMatchPlayer
  themeId: string
  showRoles: boolean
  openRoles: Set<LaneRole>
  suggestedChampionId: string | null
  canPick: boolean
  meId: string | null
  pick: ThemePick | null
  takenChampions: Map<string, string>
  picking: boolean
  onPick: (skinId: string) => void
}) {
  const primary = roleLabel(player.primary_role)
  const secondary = roleLabel(player.secondary_role)
  const flexible = isFlexibleRole(player.primary_role, player.secondary_role)
  const skins = flattenPlayerSkins(player, showRoles, openRoles)
  const isMine = Boolean(meId && player.player_id === meId)
  const pickOnThisTheme = pick?.theme_id === themeId ? pick : null

  return (
    <section
      className={[
        'rounded-md border bg-[var(--ink-soft)]/80',
        isMine && canPick
          ? 'border-[var(--teal)]/35'
          : 'border-[var(--line)]',
      ].join(' ')}
    >
      <header className="flex flex-wrap items-center gap-2 border-b border-[var(--line)] px-3 py-2">
        <p className="font-medium text-[var(--text-strong)]">{player.display_name}</p>
        {isMine && canPick ? (
          <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--teal-soft)]">
            sua escolha
          </span>
        ) : isMine && !canPick ? (
          <span className="text-[10px] text-[var(--text-muted)]">
            aguardando select
          </span>
        ) : null}
        {showRoles && (primary || secondary) ? (
          <span className="text-xs text-[var(--text-muted)]">
            {primary ?? '—'}
            {secondary && secondary !== primary ? ` / ${secondary}` : ''}
          </span>
        ) : null}
        {pickOnThisTheme ? (
          <span className="ml-auto truncate text-[10px] text-[var(--gold-soft)]">
            {pickOnThisTheme.champion_name}
          </span>
        ) : null}
      </header>

      <ul className="grid grid-cols-3 gap-1.5 p-2 sm:grid-cols-4 md:grid-cols-5">
        {skins.map((skin) => {
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

          const selected =
            pickOnThisTheme?.skin_id === skin.skin_id
          const takenBy = takenChampions.get(skin.champion_id)
          const takenByOther =
            Boolean(takenBy) && takenBy !== player.player_id
          const canClick =
            canPick && isMine && !picking && (!takenByOther || selected)
          const showSuggestion = Boolean(suggestedChampionId) && suggested

          const tileClass = [
            'group relative overflow-hidden rounded border bg-[var(--panel)] text-left transition',
            selected
              ? 'border-[var(--gold)] ring-2 ring-[var(--gold)]/70'
              : showSuggestion
                ? 'border-[var(--gold)]/70 ring-1 ring-[var(--gold)]/40'
                : highlighted
                  ? 'border-[var(--teal)]/50'
                  : 'border-[var(--line)]',
            dimOffRole && !selected ? 'opacity-45' : '',
            takenByOther && !selected ? 'opacity-35' : '',
            !canPick && isMine ? 'opacity-80' : '',
            canClick ? 'cursor-pointer hover:border-[var(--gold-soft)]' : '',
            isMine && canPick && !canClick && !selected
              ? 'cursor-not-allowed'
              : '',
            isMine && !canPick ? 'cursor-default' : '',
          ].join(' ')

          const title = `${skin.skin_name} · ${skin.champion_name}${
            roleTag ? ` · ${roleTag}` : ''
          }${selected ? ' · escolhida' : ''}${
            takenByOther ? ' · já pegaram' : ''
          }${showSuggestion && !selected ? ' · recomendado' : ''}${
            isMine && canClick ? ' · clique para escolher' : ''
          }${isMine && !canPick ? ' · disponível na select' : ''}`

          const inner = (
            <>
              <div className="aspect-square bg-[var(--ink)]">
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
                  className="absolute left-1 top-1 h-5 w-5 rounded-sm border border-black/40 object-cover shadow"
                  loading="lazy"
                />
              ) : null}
              {roleTag ? (
                <span
                  className={[
                    'absolute right-1 top-1 rounded bg-black/70 px-1 py-0.5 text-[9px] font-semibold',
                    selected || showSuggestion || highlighted
                      ? 'text-[var(--teal-soft)]'
                      : 'text-[var(--text)]',
                  ].join(' ')}
                >
                  {roleTag}
                </span>
              ) : null}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/55 to-transparent px-1 pb-1 pt-5">
                <p className="truncate text-[10px] font-medium leading-tight text-[var(--text-strong)]">
                  {skin.champion_name}
                </p>
                {selected ? (
                  <p className="truncate text-[8px] font-bold uppercase tracking-wide text-[var(--gold-soft)]">
                    escolhida
                  </p>
                ) : takenByOther && canPick ? (
                  <p className="truncate text-[8px] font-bold uppercase tracking-wide text-[var(--danger)]">
                    ocupado
                  </p>
                ) : showSuggestion ? (
                  <p className="truncate text-[8px] font-bold uppercase tracking-wide text-[var(--gold-soft)]">
                    recomendado
                  </p>
                ) : null}
              </div>
            </>
          )

          return (
            <li key={skin.skin_id}>
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
        })}
      </ul>
    </section>
  )
}
