import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { formatError, matchSizeLabel } from '../lib/format'
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
  ThemeMatch,
  ThemeMatchPlayer,
  ThemeMatchesResponse,
} from '../lib/types'

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

export function MatchesPage() {
  const { roomId } = useParams<{ roomId: string }>()
  const [data, setData] = useState<ThemeMatchesResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!roomId) return
    setLoading(true)
    setError(null)
    try {
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
    } catch (err) {
      setError(formatError(err))
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [roomId])

  useEffect(() => {
    void load()
  }, [load])

  if (loading) {
    return <p className="text-[var(--text-muted)]">Analisando coleções…</p>
  }

  if (error) {
    return (
      <div className="rounded-[var(--radius)] border border-[var(--line)] bg-[var(--panel)] p-6">
        <h1 className="font-display text-2xl">Não foi possível analisar</h1>
        <p className="mt-2 text-sm text-[var(--danger)]">{error}</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-md bg-[var(--gold)] px-4 py-2 text-sm font-semibold text-[var(--ink)]"
          >
            Tentar de novo
          </button>
          <Link to={`/room/${roomId}`} className="text-sm text-[var(--teal-soft)]">
            Voltar ao lobby
          </Link>
        </div>
      </div>
    )
  }

  const matches = data?.matches ?? []
  const total = data?.participant_total ?? 0
  const filterAram =
    Boolean(data?.filter_aram) ||
    ((data?.aram_pool?.length ?? 0) > 0 && data?.queue_kind !== 'sr')
  const queueKind =
    data?.queue_kind === 'unknown' && filterAram
      ? 'aram'
      : (data?.queue_kind ?? 'unknown')

  return (
    <div className="animate-fade-up">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--teal-soft)]">
            {queueLabel(queueKind)}
            {filterAram ? ' · campeões do ARAM' : ''}
          </p>
          <h1 className="font-display text-3xl sm:text-4xl">Combinações temáticas</h1>
          <p className="mt-1 max-w-2xl text-[var(--text-muted)]">
            Temas em comum nas coleções do party.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-md border border-[var(--line-strong)] px-4 py-2 text-sm"
          >
            Atualizar
          </button>
          <Link
            to={`/room/${roomId}`}
            className="rounded-md border border-[var(--line)] px-4 py-2 text-sm text-[var(--text-muted)]"
          >
            Lobby
          </Link>
        </div>
      </div>

      {matches.length === 0 ? (
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
            />
          ))}
        </div>
      )}
    </div>
  )
}

function MatchCard({
  match,
  total,
  rank,
  showRoles,
}: {
  match: ThemeMatch
  total: number
  rank: number
  showRoles: boolean
}) {
  const players = match.players ?? []
  const missing = total - match.match_count
  const uniqueOk = canAssignUniqueChampions(players)
  // SR: escassez + rotas. ARAM: só escassez (campeões únicos no tema).
  const assignment = showRoles
    ? suggestRoleAwareAssignment(players)
    : suggestUniqueChampionAssignment(players)
  const openRoles = showRoles ? openLaneRoles(players) : new Set<LaneRole>()
  const optionCount =
    match.option_count ??
    players.reduce((n, p) => n + (p.skin_count ?? 0), 0)

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
            showRoles={showRoles}
            openRoles={openRoles}
            suggestedChampionId={assignment?.[player.player_id] ?? null}
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
  showRoles,
  openRoles,
  suggestedChampionId,
}: {
  player: ThemeMatchPlayer
  showRoles: boolean
  openRoles: Set<LaneRole>
  suggestedChampionId: string | null
}) {
  const primary = roleLabel(player.primary_role)
  const secondary = roleLabel(player.secondary_role)
  const flexible = isFlexibleRole(player.primary_role, player.secondary_role)
  const skins = flattenPlayerSkins(player, showRoles, openRoles)

  return (
    <section className="rounded-md border border-[var(--line)] bg-[var(--ink-soft)]/80">
      <header className="flex flex-wrap items-center gap-2 border-b border-[var(--line)] px-3 py-2">
        <p className="font-medium text-[var(--text-strong)]">{player.display_name}</p>
        {showRoles && (primary || secondary) ? (
          <span className="text-xs text-[var(--text-muted)]">
            {primary ?? '—'}
            {secondary && secondary !== primary ? ` / ${secondary}` : ''}
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
          // Esmaecer por rota (sempre). Exceção: o champ recomendado fica
          // aceso mesmo fora da rota (ex.: escassez — Sivir pro SUPP).
          const dimOffRole = !showRoles
            ? false
            : suggested
              ? false
              : flexible
                ? !onOpenRole && openRoles.size > 0
                : !onPlayerRole && Boolean(primary)
          return (
            <li
              key={skin.skin_id}
              className={[
                'group relative overflow-hidden rounded border bg-[var(--panel)]',
                suggested
                  ? 'border-[var(--gold)] ring-1 ring-[var(--gold)]/60'
                  : highlighted
                    ? 'border-[var(--teal)]/50'
                    : 'border-[var(--line)]',
                dimOffRole ? 'opacity-45' : '',
              ].join(' ')}
              title={`${skin.skin_name} · ${skin.champion_name}${
                roleTag ? ` · ${roleTag}` : ''
              }${suggested ? ' · recomendado' : ''}`}
            >
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
                    suggested || highlighted
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
                {suggested ? (
                  <p className="truncate text-[8px] font-bold uppercase tracking-wide text-[var(--gold-soft)]">
                    recomendado
                  </p>
                ) : null}
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
