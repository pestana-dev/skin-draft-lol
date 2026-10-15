import {
  countAramPlayerPickHits,
  scoreAramPickOverlap,
  suggestAramAssignment,
  suggestAssignmentAroundChampion,
  suggestRoleAwareAssignment,
} from './matchFeasibility'
import type { ThemeMatch, ThemeMatchPlayer } from './types'

export type LineupSlot = {
  player_id: string
  display_name: string
  champion_id: string
  champion_name: string
  champion_image_url: string | null
  isAnchor: boolean
}

export type MatchGroup = {
  key: string
  lineup: LineupSlot[] | null
  items: Array<{
    match: ThemeMatch
    assignment: Record<string, string> | null
    lockHits?: number
  }>
  lockHits?: number
}

export type AnchorOption = {
  key: string
  player_id: string
  display_name: string
  champion_id: string
  champion_name: string
  champion_image_url: string | null
  theme_count: number
}

export function collectAnchorOptions(matches: ThemeMatch[]): AnchorOption[] {
  const map = new Map<string, AnchorOption>()
  for (const match of matches) {
    for (const p of match.players ?? []) {
      for (const c of p.champions ?? []) {
        if (!c?.champion_id) continue
        const key = `${p.player_id}::${c.champion_id}`
        const existing = map.get(key)
        if (existing) {
          existing.theme_count += 1
          continue
        }
        map.set(key, {
          key,
          player_id: p.player_id,
          display_name: p.display_name ?? 'Jogador',
          champion_id: c.champion_id,
          champion_name: c.champion_name ?? c.champion_id,
          champion_image_url: c.champion_image_url ?? null,
          theme_count: 1,
        })
      }
    }
  }
  return [...map.values()].sort((a, b) => {
    const byCount = b.theme_count - a.theme_count
    if (byCount !== 0) return byCount
    const byChamp = a.champion_name.localeCompare(b.champion_name, 'pt-BR')
    if (byChamp !== 0) return byChamp
    return a.display_name.localeCompare(b.display_name, 'pt-BR')
  })
}

export function buildLineup(
  players: ThemeMatchPlayer[],
  assignment: Record<string, string>,
  anchorPlayerId: string | null,
): LineupSlot[] {
  const ordered = [...players].sort((a, b) => {
    if (anchorPlayerId) {
      if (a.player_id === anchorPlayerId) return -1
      if (b.player_id === anchorPlayerId) return 1
    }
    return (a.display_name ?? '').localeCompare(b.display_name ?? '', 'pt-BR')
  })
  return ordered.map((p) => {
    const cid = assignment[p.player_id] ?? ''
    const champ = (p.champions ?? []).find((c) => c.champion_id === cid)
    return {
      player_id: p.player_id,
      display_name: p.display_name ?? 'Jogador',
      champion_id: cid,
      champion_name: champ?.champion_name ?? '—',
      champion_image_url: champ?.champion_image_url ?? null,
      isAnchor: Boolean(anchorPlayerId && p.player_id === anchorPlayerId),
    }
  })
}

export function lineupKey(lineup: LineupSlot[]): string {
  return lineup
    .map((s) => `${s.player_id}:${s.champion_id}`)
    .sort()
    .join('|')
}

function sortGrouped(
  groups: Map<string, MatchGroup>,
  byLockHits = false,
): MatchGroup[] {
  return [...groups.values()]
    .map((g) => ({
      ...g,
      items: [...g.items].sort(
        (a, b) =>
          (byLockHits ? (b.lockHits ?? 0) - (a.lockHits ?? 0) : 0) ||
          (b.match.match_count ?? 0) - (a.match.match_count ?? 0) ||
          (b.match.option_count ?? 0) - (a.match.option_count ?? 0),
      ),
    }))
    .sort(
      (a, b) =>
        (byLockHits ? (b.lockHits ?? 0) - (a.lockHits ?? 0) : 0) ||
        b.items.length - a.items.length ||
        (b.items[0]?.match.match_count ?? 0) -
          (a.items[0]?.match.match_count ?? 0),
    )
}

/**
 * Agrupa/ordena temas. `assignmentCache` evita recompute ARAM no mesmo
 * conjunto de picks (theme_id → assignment).
 */
export function buildMatchGroups(input: {
  matches: ThemeMatch[]
  showRoles: boolean
  isAram: boolean
  anchorChampionId: string | null
  anchorPlayerId: string | null
  lockedAramPicks: Record<string, string>
  lockedAramPicksKey: string
  assignmentCache?: Map<string, Record<string, string> | null>
}): MatchGroup[] {
  const {
    matches,
    showRoles,
    isAram,
    anchorChampionId,
    anchorPlayerId,
    lockedAramPicks,
    lockedAramPicksKey,
    assignmentCache,
  } = input

  if (showRoles && anchorChampionId && anchorPlayerId) {
    const groups = new Map<string, MatchGroup>()
    for (const match of matches) {
      const players = match.players ?? []
      const assignment = suggestAssignmentAroundChampion(
        players,
        anchorChampionId,
        anchorPlayerId,
        true,
      )
      if (!assignment) continue
      const lineup = buildLineup(players, assignment, anchorPlayerId)
      const key = lineupKey(lineup)
      const existing = groups.get(key)
      if (existing) {
        existing.items.push({ match, assignment })
      } else {
        groups.set(key, {
          key,
          lineup,
          items: [{ match, assignment }],
        })
      }
    }
    return sortGrouped(groups)
  }

  if (isAram) {
    const picks =
      lockedAramPicksKey.length > 0 ? lockedAramPicks : null
    const cacheKeyPrefix = lockedAramPicksKey || 'nopicks'
    const scored = matches.map((match) => {
      const players = match.players ?? []
      const pickScore = scoreAramPickOverlap(players, picks)
      const playerHits = countAramPlayerPickHits(players, picks)
      const cacheKey = `${cacheKeyPrefix}::${match.theme_id}`
      let assignment: Record<string, string> | null
      if (assignmentCache?.has(cacheKey)) {
        assignment = assignmentCache.get(cacheKey) ?? null
      } else {
        assignment = suggestAramAssignment(players, picks)
        assignmentCache?.set(cacheKey, assignment)
      }
      return { match, pickScore, playerHits, assignment }
    })

    scored.sort(
      (a, b) =>
        b.pickScore - a.pickScore ||
        (b.match.match_count ?? 0) - (a.match.match_count ?? 0) ||
        (b.match.option_count ?? 0) - (a.match.option_count ?? 0) ||
        (a.match.theme_name ?? '').localeCompare(
          b.match.theme_name ?? '',
          'pt-BR',
        ),
    )

    return scored.map(({ match, assignment, playerHits }) => ({
      key: match.theme_id,
      lineup: null,
      lockHits: playerHits,
      items: [{ match, assignment, lockHits: playerHits }],
    }))
  }

  // SR sem âncora: pré-calcula assignment uma vez por tema
  return matches.map((match) => {
    const players = match.players ?? []
    let assignment: Record<string, string> | null = null
    try {
      assignment = showRoles
        ? suggestRoleAwareAssignment(players)
        : suggestAramAssignment(players, null)
    } catch {
      assignment = null
    }
    return {
      key: match.theme_id,
      lineup: null,
      items: [{ match, assignment }],
    }
  })
}
