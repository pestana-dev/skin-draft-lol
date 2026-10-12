import type { ThemeMatchChampion, ThemeMatchPlayer } from './types'

export type LaneRole = 'TOP' | 'JUNGLE' | 'MID' | 'ADC' | 'SUPPORT'

const ROLE_ALIASES: Record<string, LaneRole> = {
  TOP: 'TOP',
  JUNGLE: 'JUNGLE',
  MID: 'MID',
  MIDDLE: 'MID',
  ADC: 'ADC',
  BOTTOM: 'ADC',
  SUPPORT: 'SUPPORT',
  UTILITY: 'SUPPORT',
  SUPP: 'SUPPORT',
  JG: 'JUNGLE',
}

export function normalizeLaneRole(
  role: string | null | undefined,
): LaneRole | null {
  if (!role) return null
  return ROLE_ALIASES[role.toUpperCase()] ?? null
}

/** 2 = rota primária, 1 = secundária, 0 = off-role */
export function roleFitScore(
  championRoles: string[] | null | undefined,
  primary: string | null | undefined,
  secondary: string | null | undefined,
): number {
  const roles = new Set(
    (championRoles ?? [])
      .map((r) => normalizeLaneRole(r))
      .filter(Boolean) as LaneRole[],
  )
  const p = normalizeLaneRole(primary)
  const s = normalizeLaneRole(secondary)
  if (p && roles.has(p)) return 2
  if (s && roles.has(s)) return 1
  return 0
}

/** Rota do jogador que casa com o campeão (prioriza a primária). */
export function matchedPlayerRole(
  championRoles: string[] | null | undefined,
  primary: string | null | undefined,
  secondary: string | null | undefined,
): LaneRole | null {
  const roles = new Set(
    (championRoles ?? [])
      .map((r) => normalizeLaneRole(r))
      .filter(Boolean) as LaneRole[],
  )
  const p = normalizeLaneRole(primary)
  const s = normalizeLaneRole(secondary)
  if (p && roles.has(p)) return p
  if (s && roles.has(s)) return s
  return null
}

/** Verifica se dá pra atribuir um campeão distinto a cada jogador do match. */
export function canAssignUniqueChampions(players: ThemeMatchPlayer[]): boolean {
  if (players.length === 0) return false
  const lists = players.map((p) => {
    const ranked = [...p.champions].sort(
      (a, b) =>
        roleFitScore(b.roles, p.primary_role, p.secondary_role) -
        roleFitScore(a.roles, p.primary_role, p.secondary_role),
    )
    return ranked.map((c) => c.champion_id)
  })
  return dfs(lists, 0, new Set())
}

/**
 * Atribuição gulosa priorizando rota: devolve mapa player_id → champion_id
 * (melhor esforço; null se impossível).
 */
export function suggestRoleAwareAssignment(
  players: ThemeMatchPlayer[],
): Record<string, string> | null {
  if (!canAssignUniqueChampions(players)) return null

  const order = [...players].sort((a, b) => {
    const aOn = a.champions.filter(
      (c) => roleFitScore(c.roles, a.primary_role, a.secondary_role) > 0,
    ).length
    const bOn = b.champions.filter(
      (c) => roleFitScore(c.roles, b.primary_role, b.secondary_role) > 0,
    ).length
    return aOn - bOn
  })

  const used = new Set<string>()
  const assignment: Record<string, string> = {}

  function tryAssign(idx: number): boolean {
    if (idx >= order.length) return true
    const player = order[idx]
    const champs = [...player.champions].sort(
      (a, b) =>
        roleFitScore(b.roles, player.primary_role, player.secondary_role) -
        roleFitScore(a.roles, player.primary_role, player.secondary_role),
    )
    for (const c of champs) {
      if (used.has(c.champion_id)) continue
      used.add(c.champion_id)
      assignment[player.player_id] = c.champion_id
      if (tryAssign(idx + 1)) return true
      used.delete(c.champion_id)
      delete assignment[player.player_id]
    }
    return false
  }

  return tryAssign(0) ? assignment : null
}

function dfs(lists: string[][], idx: number, used: Set<string>): boolean {
  if (idx >= lists.length) return true
  for (const champ of lists[idx]) {
    if (used.has(champ)) continue
    used.add(champ)
    if (dfs(lists, idx + 1, used)) return true
    used.delete(champ)
  }
  return false
}

export function sortChampionsByRole(
  champions: ThemeMatchChampion[],
  primary: string | null | undefined,
  secondary: string | null | undefined,
): ThemeMatchChampion[] {
  return [...champions].sort((a, b) => {
    const fit =
      roleFitScore(b.roles, primary, secondary) -
      roleFitScore(a.roles, primary, secondary)
    if (fit !== 0) return fit
    return a.champion_name.localeCompare(b.champion_name, 'pt-BR')
  })
}

export function roleLabel(role: string | null | undefined): string | null {
  const n = normalizeLaneRole(role)
  if (!n && role?.toUpperCase() === 'FILL') return 'Fill'
  if (!n) return null
  const map: Record<LaneRole, string> = {
    TOP: 'Top',
    JUNGLE: 'Jungle',
    MID: 'Mid',
    ADC: 'ADC',
    SUPPORT: 'Suporte',
  }
  return map[n]
}

export function queueLabel(kind: string | null | undefined): string {
  switch (kind) {
    case 'aram':
      return 'ARAM'
    case 'sr':
      return "Summoner's Rift"
    default:
      return 'Fila'
  }
}
