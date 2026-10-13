import type { ThemeMatchChampion, ThemeMatchPlayer } from './types'

export type LaneRole = 'TOP' | 'JUNGLE' | 'MID' | 'ADC' | 'SUPPORT'

export const ALL_LANE_ROLES: LaneRole[] = [
  'TOP',
  'JUNGLE',
  'MID',
  'ADC',
  'SUPPORT',
]

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

/** Rotas já pegadas como principal por alguém do party (ignora Fill). */
export function claimedPrimaryRoles(
  players: ThemeMatchPlayer[],
): Set<LaneRole> {
  const claimed = new Set<LaneRole>()
  for (const p of players) {
    if (isFlexibleRole(p.primary_role, p.secondary_role)) continue
    const primary = normalizeLaneRole(p.primary_role)
    if (primary) claimed.add(primary)
  }
  return claimed
}

/** Rotas ainda livres no party. */
export function openLaneRoles(players: ThemeMatchPlayer[]): Set<LaneRole> {
  const claimed = claimedPrimaryRoles(players)
  return new Set(ALL_LANE_ROLES.filter((r) => !claimed.has(r)))
}

/** Campeão cobre pelo menos uma rota ainda livre. */
export function coversOpenRole(
  championRoles: string[] | null | undefined,
  openRoles: Set<LaneRole>,
): boolean {
  if (openRoles.size === 0) return true
  for (const role of championRoles ?? []) {
    const n = normalizeLaneRole(role)
    if (n && openRoles.has(n)) return true
  }
  return false
}

/** Score de fit: rota do jogador, ou rotas livres se for Fill. */
export function playerChampFitScore(
  player: ThemeMatchPlayer,
  championRoles: string[] | null | undefined,
  openRoles: Set<LaneRole>,
): number {
  if (isFlexibleRole(player.primary_role, player.secondary_role)) {
    return coversOpenRole(championRoles, openRoles) ? 2 : 0
  }
  return roleFitScore(championRoles, player.primary_role, player.secondary_role)
}

function playerChampions(player: ThemeMatchPlayer): ThemeMatchChampion[] {
  return player.champions ?? []
}

/** Verifica se dá pra atribuir um campeão distinto a cada jogador do match. */
export function canAssignUniqueChampions(players: ThemeMatchPlayer[]): boolean {
  if (players.length === 0) return false
  const open = openLaneRoles(players)
  const lists = players.map((p) => {
    const ranked = [...playerChampions(p)].sort(
      (a, b) =>
        playerChampFitScore(p, b.roles, open) -
        playerChampFitScore(p, a.roles, open),
    )
    return ranked.map((c) => c.champion_id)
  })
  // Sem opções pra alguém → impossível
  if (lists.some((l) => l.length === 0)) return false
  return dfs(lists, 0, new Set())
}

function masteryPoints(c: {
  mastery_points?: number
  mastery_level?: number
}): number {
  return c.mastery_points ?? 0
}

function masteryLevel(c: {
  mastery_points?: number
  mastery_level?: number
}): number {
  return c.mastery_level ?? 0
}

/**
 * Atribuição ARAM: escassez primeiro; entre opções livres, prioriza maestria
 * (pontos → nível). Evita pegar o único campeão de outro.
 */
export function suggestUniqueChampionAssignment(
  players: ThemeMatchPlayer[],
): Record<string, string> | null {
  if (!canAssignUniqueChampions(players)) return null

  const order = [...players].sort(
    (a, b) => playerChampions(a).length - playerChampions(b).length,
  )

  const used = new Set<string>()
  const assignment: Record<string, string> = {}

  function soleOptionForLater(champId: string, fromIdx: number): boolean {
    for (let i = fromIdx; i < order.length; i++) {
      const p = order[i]
      if (assignment[p.player_id]) continue
      const champs = playerChampions(p)
      if (champs.length === 1 && champs[0]?.champion_id === champId) {
        return true
      }
    }
    return false
  }

  function tryAssign(idx: number): boolean {
    if (idx >= order.length) return true
    const player = order[idx]
    const laterStart = idx + 1
    const playerChamps = playerChampions(player)

    const champs = [...playerChamps].sort((a, b) => {
      const aSole = soleOptionForLater(a.champion_id, laterStart) ? 1 : 0
      const bSole = soleOptionForLater(b.champion_id, laterStart) ? 1 : 0
      if (aSole !== bSole) return aSole - bSole
      // Preferir maior maestria entre opções válidas
      const byPts = masteryPoints(b) - masteryPoints(a)
      if (byPts !== 0) return byPts
      const byLvl = masteryLevel(b) - masteryLevel(a)
      if (byLvl !== 0) return byLvl
      return a.champion_name.localeCompare(b.champion_name, 'pt-BR')
    })

    for (const c of champs) {
      if (used.has(c.champion_id)) continue

      if (
        playerChamps.length > 1 &&
        soleOptionForLater(c.champion_id, laterStart) &&
        champs.some(
          (other) =>
            other.champion_id !== c.champion_id &&
            !used.has(other.champion_id) &&
            !soleOptionForLater(other.champion_id, laterStart),
        )
      ) {
        continue
      }

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

/**
 * Atribuição SR: escassez primeiro; rota / Fill desempatam entre opções.
 * Evita “roubar” o único campeão de outro jogador ainda não atribuído.
 */
export function suggestRoleAwareAssignment(
  players: ThemeMatchPlayer[],
): Record<string, string> | null {
  if (!canAssignUniqueChampions(players)) return null

  const open = openLaneRoles(players)

  const order = [...players].sort((a, b) => {
    const byCount = playerChampions(a).length - playerChampions(b).length
    if (byCount !== 0) return byCount
    const aOn = playerChampions(a).filter(
      (c) => playerChampFitScore(a, c.roles, open) > 0,
    ).length
    const bOn = playerChampions(b).filter(
      (c) => playerChampFitScore(b, c.roles, open) > 0,
    ).length
    return aOn - bOn
  })

  const used = new Set<string>()
  const assignment: Record<string, string> = {}
  /** Rotas “consumidas” por recomendações de Fill neste match. */
  const filledLanes = new Set<LaneRole>()

  function openFor(player: ThemeMatchPlayer): Set<LaneRole> {
    if (!isFlexibleRole(player.primary_role, player.secondary_role)) {
      return open
    }
    const next = new Set(open)
    for (const r of filledLanes) next.delete(r)
    return next
  }

  /** Campeão é a única opção de alguém que ainda não recebeu recomendação. */
  function soleOptionForLater(champId: string, fromIdx: number): boolean {
    for (let i = fromIdx; i < order.length; i++) {
      const p = order[i]
      if (assignment[p.player_id]) continue
      const champs = playerChampions(p)
      if (champs.length === 1 && champs[0]?.champion_id === champId) {
        return true
      }
    }
    return false
  }

  function tryAssign(idx: number): boolean {
    if (idx >= order.length) return true
    const player = order[idx]
    const rolesNow = openFor(player)
    const laterStart = idx + 1
    const playerChamps = playerChampions(player)

    const champs = [...playerChamps].sort((a, b) => {
      const aSole = soleOptionForLater(a.champion_id, laterStart) ? 1 : 0
      const bSole = soleOptionForLater(b.champion_id, laterStart) ? 1 : 0
      if (aSole !== bSole) return aSole - bSole
      const byFit =
        playerChampFitScore(player, b.roles, rolesNow) -
        playerChampFitScore(player, a.roles, rolesNow)
      if (byFit !== 0) return byFit
      const byPts = masteryPoints(b) - masteryPoints(a)
      if (byPts !== 0) return byPts
      return masteryLevel(b) - masteryLevel(a)
    })

    for (const c of champs) {
      if (used.has(c.champion_id)) continue

      // Com outras opções, não pegue o único campeão de quem ainda falta
      if (
        playerChamps.length > 1 &&
        soleOptionForLater(c.champion_id, laterStart) &&
        champs.some(
          (other) =>
            other.champion_id !== c.champion_id &&
            !used.has(other.champion_id) &&
            !soleOptionForLater(other.champion_id, laterStart),
        )
      ) {
        continue
      }

      const fit = playerChampFitScore(player, c.roles, rolesNow)
      // Fill: evita rota já pegada se ainda houver opção em rota livre
      if (
        isFlexibleRole(player.primary_role, player.secondary_role) &&
        fit === 0 &&
        champs.some(
          (other) =>
            !used.has(other.champion_id) &&
            playerChampFitScore(player, other.roles, rolesNow) > 0 &&
            !soleOptionForLater(other.champion_id, laterStart),
        )
      ) {
        continue
      }

      used.add(c.champion_id)
      assignment[player.player_id] = c.champion_id

      let claimedLane: LaneRole | null = null
      if (isFlexibleRole(player.primary_role, player.secondary_role)) {
        for (const role of c.roles ?? []) {
          const n = normalizeLaneRole(role)
          if (n && rolesNow.has(n)) {
            claimedLane = n
            filledLanes.add(n)
            break
          }
        }
      }

      if (tryAssign(idx + 1)) return true

      if (claimedLane) filledLanes.delete(claimedLane)
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
  openRoles?: Set<LaneRole>,
): ThemeMatchChampion[] {
  const open = openRoles ?? new Set(ALL_LANE_ROLES)
  const flexible = isFlexibleRole(primary, secondary)
  return [...(champions ?? [])].sort((a, b) => {
    const fit = flexible
      ? (coversOpenRole(b.roles, open) ? 2 : 0) -
        (coversOpenRole(a.roles, open) ? 2 : 0)
      : roleFitScore(b.roles, primary, secondary) -
        roleFitScore(a.roles, primary, secondary)
    if (fit !== 0) return fit
    return (a.champion_name ?? '').localeCompare(b.champion_name ?? '', 'pt-BR')
  })
}

export function roleLabel(role: string | null | undefined): string | null {
  const n = normalizeLaneRole(role)
  if (!n && role?.toUpperCase() === 'FILL') return 'Fill'
  if (!n) return null
  const map: Record<LaneRole, string> = {
    TOP: 'TOP',
    JUNGLE: 'JG',
    MID: 'MID',
    ADC: 'ADC',
    SUPPORT: 'SUPP',
  }
  return map[n]
}

/** Rótulos das rotas do campeão (catálogo), para badge na skin. */
export function championRoleLabels(
  roles: string[] | null | undefined,
): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const role of roles ?? []) {
    const label = roleLabel(role)
    if (!label || seen.has(label)) continue
    seen.add(label)
    out.push(label)
  }
  return out
}

/** Fill / sem preferência de rota. */
export function isFlexibleRole(
  primary: string | null | undefined,
  secondary: string | null | undefined,
): boolean {
  const p = primary?.toUpperCase()
  const s = secondary?.toUpperCase()
  if (p === 'FILL' || s === 'FILL') return true
  return !normalizeLaneRole(primary) && !normalizeLaneRole(secondary)
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
