import { describe, expect, it } from 'vitest'
import {
  canAssignUniqueChampions,
  countAramPlayerPickHits,
  scoreAramPickOverlap,
  suggestAramAssignment,
  suggestAssignmentAroundChampion,
} from './matchFeasibility'
import type { ThemeMatchPlayer } from './types'

function player(
  id: string,
  name: string,
  champs: Array<{ id: string; name: string }>,
): ThemeMatchPlayer {
  return {
    player_id: id,
    display_name: name,
    skin_count: champs.length,
    champion_count: champs.length,
    champions: champs.map((c) => ({
      champion_id: c.id,
      champion_name: c.name,
      champion_image_url: null,
      roles: [],
      mastery_level: 0,
      mastery_points: 0,
      skin_count: 1,
      skins: [
        {
          skin_id: `${c.id}-skin`,
          skin_name: `${c.name} clássico`,
          splash_url: null,
          tile_url: null,
        },
      ],
    })),
  }
}

describe('scoreAramPickOverlap / countAramPlayerPickHits', () => {
  const party = [
    player('a', 'Alice', [
      { id: 'Ahri', name: 'Ahri' },
      { id: 'Yasuo', name: 'Yasuo' },
    ]),
    player('b', 'Bob', [
      { id: 'Yasuo', name: 'Yasuo' },
      { id: 'Zed', name: 'Zed' },
    ]),
  ]

  it('conta hits por jogador e score ponderado', () => {
    const picks = { a: 'Ahri', b: 'Zed' }
    expect(countAramPlayerPickHits(party, picks)).toBe(2)
    expect(scoreAramPickOverlap(party, picks)).toBeGreaterThanOrEqual(20)
  })

  it('retorna 0 sem picks', () => {
    expect(countAramPlayerPickHits(party, null)).toBe(0)
    expect(scoreAramPickOverlap(party, {})).toBe(0)
  })
})

describe('suggestAramAssignment', () => {
  it('reserva picks da select e completa o resto', () => {
    const party = [
      player('a', 'Alice', [
        { id: 'Ahri', name: 'Ahri' },
        { id: 'Lux', name: 'Lux' },
      ]),
      player('b', 'Bob', [
        { id: 'Ahri', name: 'Ahri' },
        { id: 'Zed', name: 'Zed' },
      ]),
    ]
    const assignment = suggestAramAssignment(party, { a: 'Ahri' })
    expect(assignment).not.toBeNull()
    expect(assignment!.a).toBe('Ahri')
    expect(assignment!.b).toBe('Zed')
  })

  it('sem locks ainda fecha combinação única', () => {
    const party = [
      player('a', 'Alice', [{ id: 'Ahri', name: 'Ahri' }]),
      player('b', 'Bob', [{ id: 'Zed', name: 'Zed' }]),
    ]
    expect(canAssignUniqueChampions(party)).toBe(true)
    const assignment = suggestAramAssignment(party, null)
    expect(assignment).toEqual({ a: 'Ahri', b: 'Zed' })
  })
})

describe('suggestAssignmentAroundChampion', () => {
  it('trava âncora no jogador informado', () => {
    const party = [
      player('a', 'Alice', [
        { id: 'Yasuo', name: 'Yasuo' },
        { id: 'Ahri', name: 'Ahri' },
      ]),
      player('b', 'Bob', [
        { id: 'Yasuo', name: 'Yasuo' },
        { id: 'Zed', name: 'Zed' },
      ]),
    ]
    const assignment = suggestAssignmentAroundChampion(
      party,
      'Yasuo',
      'b',
      false,
    )
    expect(assignment).not.toBeNull()
    expect(assignment!.b).toBe('Yasuo')
    expect(assignment!.a).not.toBe('Yasuo')
  })
})
