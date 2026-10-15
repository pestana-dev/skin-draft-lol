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

function championIdsOf(player: ThemeMatchPlayer): string[] {
  return playerChampions(player).map((c) => c.champion_id)
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
 * Score de ranking ARAM (barato, sem DFS):
 * - +10 por pick do jogador que existe no tema dele
 * - +1 por campeão da select que aparece no tema (qualquer um)
 */
export function scoreAramPickOverlap(
  players: ThemeMatchPlayer[],
  picksByPlayer: Record<string, string> | null | undefined,
): number {
  if (!picksByPlayer || Object.keys(picksByPlayer).length === 0) return 0

  let score = 0
  const themeChamps = new Set<string>()
  for (const p of players) {
    for (const c of playerChampions(p)) themeChamps.add(c.champion_id)
    const pick = picksByPlayer[p.player_id]
    if (pick && playerChampions(p).some((c) => c.champion_id === pick)) {
      score += 10
    }
  }
  const seen = new Set<string>()
  for (const pick of Object.values(picksByPlayer)) {
    if (seen.has(pick)) continue
    seen.add(pick)
    if (themeChamps.has(pick)) score += 1
  }
  return score
}

/**
 * Reserva picks da select que cabem no tema. Se um lock deixar alguém
 * sem opções, descarta esse lock (soft) em vez de falhar o tema inteiro.
 */
function reserveAramPicks(
  players: ThemeMatchPlayer[],
  lockedPicks: Record<string, string> | null | undefined,
): {
  assignment: Record<string, string>
  used: Set<string>
  remaining: ThemeMatchPlayer[]
} {
  const assignment: Record<string, string> = {}
  const used = new Set<string>()
  if (!lockedPicks || Object.keys(lockedPicks).length === 0) {
    return { assignment, used, remaining: players }
  }

  const candidates = players
    .filter((p) => {
      const pick = lockedPicks[p.player_id]
      return Boolean(
        pick && playerChampions(p).some((c) => c.champion_id === pick),
      )
    })
    .sort((a, b) => championIdsOf(a).length - championIdsOf(b).length)

  for (const player of candidates) {
    const pick = lockedPicks[player.player_id]!
    if (used.has(pick)) continue
    used.add(pick)
    assignment[player.player_id] = pick

    const breaksSomeone = players.some((other) => {
      if (assignment[other.player_id]) return false
      return championIdsOf(other).every((id) => used.has(id))
    })
    if (breaksSomeone) {
      used.delete(pick)
      delete assignment[player.player_id]
    }
  }

  const remaining = players
    .filter((p) => !assignment[p.player_id])
    .map((p) => ({
      ...p,
      champions: playerChampions(p).filter((c) => !used.has(c.champion_id)),
    }))

  return { assignment, used, remaining }
}

/** DFS leve: listas já de ids, MRV (menos opções primeiro). */
function canAssignIds(lists: string[][], used: Set<string>): boolean {
  if (lists.some((l) => l.length === 0)) return false
  const ordered = [...lists].sort((a, b) => a.length - b.length)
  return dfs(ordered, 0, used)
}

/** Verifica se dá pra atribuir um campeão distinto a cada jogador do match. */
export function canAssignUniqueChampions(
  players: ThemeMatchPlayer[],
  lockedPicks?: Record<string, string> | null,
): boolean {
  if (players.length === 0) return false
  const reserved = reserveAramPicks(players, lockedPicks)
  if (reserved.remaining.some((p) => championIdsOf(p).length === 0)) {
    return false
  }
  if (reserved.remaining.length === 0) return true
  const lists = reserved.remaining.map((p) => championIdsOf(p))
  return canAssignIds(lists, new Set(reserved.used))
}

/**
 * Atribuição ARAM rápida: reserva picks da select, completa com guloso
 * (escassez + maestria). DFS só se o guloso falhar.
 */
export function suggestAramAssignment(
  players: ThemeMatchPlayer[],
  lockedPicks?: Record<string, string> | null,
): Record<string, string> | null {
  if (players.length === 0) return null

  const attempt = (picks: Record<string, string> | null | undefined) => {
    const reserved = reserveAramPicks(players, picks)
    if (reserved.remaining.some((p) => championIdsOf(p).length === 0)) {
      return null
    }

    const assignment: Record<string, string> = { ...reserved.assignment }
    const used = new Set(reserved.used)
    const order = [...reserved.remaining].sort(
      (a, b) => championIdsOf(a).length - championIdsOf(b).length,
    )

    // Guloso
    let greedyOk = true
    for (const player of order) {
      const champs = [...playerChampions(player)].sort((a, b) => {
        const byPts = masteryPoints(b) - masteryPoints(a)
        if (byPts !== 0) return byPts
        const byLvl = masteryLevel(b) - masteryLevel(a)
        if (byLvl !== 0) return byLvl
        return (a.champion_name ?? '').localeCompare(
          b.champion_name ?? '',
          'pt-BR',
        )
      })
      const choice = champs.find((c) => !used.has(c.champion_id))
      if (!choice) {
        greedyOk = false
        break
      }
      used.add(choice.champion_id)
      assignment[player.player_id] = choice.champion_id
    }
    if (greedyOk) return assignment

    // DFS de fallback (sem heurísticas caras)
    const lists = order.map((p) => championIdsOf(p))
    const dfsAssign: Record<string, string> = { ...reserved.assignment }
    const dfsUsed = new Set(reserved.used)

    function search(idx: number): boolean {
      if (idx >= order.length) return true
      const player = order[idx]
      for (const cid of lists[idx]) {
        if (dfsUsed.has(cid)) continue
        dfsUsed.add(cid)
        dfsAssign[player.player_id] = cid
        if (search(idx + 1)) return true
        dfsUsed.delete(cid)
        delete dfsAssign[player.player_id]
      }
      return false
    }

    return search(0) ? dfsAssign : null
  }

  const withLocks = attempt(lockedPicks)
  if (withLocks) return withLocks
  if (lockedPicks && Object.keys(lockedPicks).length > 0) {
    return attempt(null)
  }
  return null
}

/** @deprecated use suggestAramAssignment — mantido p/ SR/legado */
export function suggestUniqueChampionAssignment(
  players: ThemeMatchPlayer[],
  lockedPicks?: Record<string, string> | null,
): Record<string, string> | null {
  return suggestAramAssignment(players, lockedPicks)
}

/** Compat: applyLocked antigo → reserveAramPicks */
export function applyLockedChampionPicks(
  players: ThemeMatchPlayer[],
  lockedPicks: Record<string, string> | null | undefined,
): {
  assignment: Record<string, string>
  used: Set<string>
  remaining: ThemeMatchPlayer[]
  lockHits: number
} | null {
  const reserved = reserveAramPicks(players, lockedPicks)
  if (reserved.remaining.some((p) => championIdsOf(p).length === 0)) {
    return null
  }
  return {
    ...reserved,
    lockHits: Object.keys(reserved.assignment).length,
  }
}

/** Quantos jogadores do tema têm o próprio pick da select neste tema. */
export function countAramPlayerPickHits(
  players: ThemeMatchPlayer[],
  picksByPlayer: Record<string, string> | null | undefined,
): number {
  if (!picksByPlayer) return 0
  let hits = 0
  for (const p of players) {
    const pick = picksByPlayer[p.player_id]
    if (!pick) continue
    if (playerChampions(p).some((c) => c.champion_id === pick)) hits += 1
  }
  return hits
}

/** @deprecated use countAramPlayerPickHits — não confundir com score ponderado */
export function countLockedPickHits(
  players: ThemeMatchPlayer[],
  lockedPicks: Record<string, string> | null | undefined,
): number {
  return countAramPlayerPickHits(players, lockedPicks)
}

/**
 * Atribuição com campeão âncora: reserva o champ para `ownerPlayerId`
 * (obrigatório se informado) e completa o resto sem conflito.
 */
export function suggestAssignmentAroundChampion(
  players: ThemeMatchPlayer[],
  championId: string,
  ownerPlayerId: string | null,
  roleAware: boolean,
): Record<string, string> | null {
  if (!championId || players.length === 0) return null

  let owners = players.filter((p) =>
    playerChampions(p).some((c) => c.champion_id === championId),
  )
  if (ownerPlayerId) {
    owners = owners.filter((p) => p.player_id === ownerPlayerId)
  }
  if (owners.length === 0) return null

  const open = openLaneRoles(players)
  const rankedOwners = [...owners].sort((a, b) => {
    if (roleAware) {
      const aChamp = playerChampions(a).find((c) => c.champion_id === championId)
      const bChamp = playerChampions(b).find((c) => c.champion_id === championId)
      const byFit =
        playerChampFitScore(b, bChamp?.roles, open) -
        playerChampFitScore(a, aChamp?.roles, open)
      if (byFit !== 0) return byFit
    }
    const aChamp = playerChampions(a).find((c) => c.champion_id === championId)
    const bChamp = playerChampions(b).find((c) => c.champion_id === championId)
    const byPts = masteryPoints(bChamp ?? {}) - masteryPoints(aChamp ?? {})
    if (byPts !== 0) return byPts
    return (a.display_name ?? '').localeCompare(b.display_name ?? '', 'pt-BR')
  })

  for (const owner of rankedOwners) {
    const rest = players.filter((p) => p.player_id !== owner.player_id)
    const restWithoutChamp = rest.map((p) => ({
      ...p,
      champions: playerChampions(p).filter((c) => c.champion_id !== championId),
    }))
    if (restWithoutChamp.some((p) => playerChampions(p).length === 0)) {
      continue
    }
    const restAssignment =
      restWithoutChamp.length === 0
        ? {}
        : roleAware
          ? suggestRoleAwareAssignment(restWithoutChamp)
          : suggestUniqueChampionAssignment(restWithoutChamp)
    if (restAssignment === null && restWithoutChamp.length > 0) continue
    return {
      ...(restAssignment ?? {}),
      [owner.player_id]: championId,
    }
  }
  return null
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
      // Rota escolhida manda: primária >> secundária >> off
      const byFit =
        playerChampFitScore(player, b.roles, rolesNow) -
        playerChampFitScore(player, a.roles, rolesNow)
      if (byFit !== 0) return byFit
      const aSole = soleOptionForLater(a.champion_id, laterStart) ? 1 : 0
      const bSole = soleOptionForLater(b.champion_id, laterStart) ? 1 : 0
      if (aSole !== bSole) return aSole - bSole
      const byPts = masteryPoints(b) - masteryPoints(a)
      if (byPts !== 0) return byPts
      const byLvl = masteryLevel(b) - masteryLevel(a)
      if (byLvl !== 0) return byLvl
      return a.champion_name.localeCompare(b.champion_name, 'pt-BR')
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
      // Nunca desça de rota (ex.: secundária/off) se ainda há opção melhor livre
      const hasBetterFit = champs.some(
        (other) =>
          other.champion_id !== c.champion_id &&
          !used.has(other.champion_id) &&
          playerChampFitScore(player, other.roles, rolesNow) > fit &&
          !soleOptionForLater(other.champion_id, laterStart),
      )
      if (hasBetterFit) continue

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
    const byPts = masteryPoints(b) - masteryPoints(a)
    if (byPts !== 0) return byPts
    const byLvl = masteryLevel(b) - masteryLevel(a)
    if (byLvl !== 0) return byLvl
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
