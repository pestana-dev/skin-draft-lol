import { useEffect, useMemo, useState } from 'react'
import type { ChampSelectMember } from '../lib/desktop'
import { formatError } from '../lib/format'
import { supabase } from '../lib/supabase'
import type { Champion } from '../lib/types'
import type { LobbyParticipant } from './useRoomMatches'

export type LivePick = {
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

export function useLiveChampSelectPicks(input: {
  champSelect: { myTeam?: ChampSelectMember[] } | null
  participants: LobbyParticipant[]
  mePuuid?: string | null
  onError?: (message: string) => void
}) {
  const { champSelect, participants, mePuuid, onError } = input
  const [championsByKey, setChampionsByKey] = useState<Map<number, Champion>>(
    () => new Map(),
  )
  const [skinMetaByLcuId, setSkinMetaByLcuId] = useState<
    Map<
      number,
      {
        id: string
        name: string
        splash_url: string | null
        tile_url: string | null
      }
    >
  >(() => new Map())

  useEffect(() => {
    let cancelled = false
    void supabase
      .from('champions')
      .select('id, name, key, image_url')
      .then(({ data: champs, error: champError }) => {
        if (cancelled) return
        if (champError) {
          onError?.(formatError(champError))
          return
        }
        const byKey = new Map<number, Champion>()
        for (const raw of champs ?? []) {
          const c = raw as Champion
          const key = Number(c.key)
          if (Number.isFinite(key) && key > 0) byKey.set(key, c)
        }
        setChampionsByKey(byKey)
      })
    return () => {
      cancelled = true
    }
  }, [onError])

  const liveSkinIdsKey = useMemo(() => {
    const team = champSelect?.myTeam ?? []
    return [
      ...new Set(
        team
          .map((m) => m.selectedSkinId)
          .filter((id) => Number.isFinite(id) && id > 0),
      ),
    ]
      .sort((a, b) => a - b)
      .join(',')
  }, [champSelect?.myTeam])

  useEffect(() => {
    if (!liveSkinIdsKey) {
      setSkinMetaByLcuId(new Map())
      return
    }
    const lcuSkinIds = liveSkinIdsKey.split(',').map(Number)
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
          .select(
            'id, name, num, splash_url, tile_url, champion_id, champions(key)',
          )
          .in('id', skinIds)
        if (cancelled) return
        if (skinError) throw skinError
        const next = new Map<
          number,
          {
            id: string
            name: string
            splash_url: string | null
            tile_url: string | null
          }
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
  }, [liveSkinIdsKey])

  const livePicksByPlayer = useMemo(() => {
    const out: Record<string, LivePick> = {}
    const team = champSelect?.myTeam ?? []
    if (team.length === 0) return out

    type Pending = {
      member: ChampSelectMember
      effectiveChamp: number
    }
    const pending: Pending[] = []

    for (const member of team) {
      const effectiveChamp =
        member.championId > 0
          ? member.championId
          : member.championPickIntent > 0
            ? member.championPickIntent
            : 0
      if (effectiveChamp <= 0) continue

      const playerId = matchMemberToParticipant(member, participants, mePuuid)
      if (!playerId) {
        pending.push({ member, effectiveChamp })
        continue
      }

      const champ = championsByKey.get(effectiveChamp)
      if (!champ) continue
      const skinMeta =
        member.selectedSkinId > 0
          ? skinMetaByLcuId.get(member.selectedSkinId)
          : undefined

      out[playerId] = {
        player_id: playerId,
        skin_id: skinMeta?.id ?? null,
        skin_name:
          skinMeta?.name ?? (member.selectedSkinId > 0 ? 'Skin' : 'Padrão'),
        champion_id: champ.id,
        champion_name: champ.name,
        champion_image_url: champ.image_url ?? null,
        splash_url: skinMeta?.splash_url ?? null,
        tile_url: skinMeta?.tile_url ?? champ.image_url ?? null,
        lcu_champion_id: effectiveChamp,
        lcu_skin_id: member.selectedSkinId > 0 ? member.selectedSkinId : 0,
        is_intent: member.championId <= 0 && member.championPickIntent > 0,
      }
    }

    if (pending.length > 0) {
      const free = participants
        .filter((p) => !out[p.player_id])
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      const ordered = [...pending].sort(
        (a, b) => a.member.cellId - b.member.cellId,
      )
      for (let i = 0; i < ordered.length; i++) {
        const slot = free[i]
        if (!slot) break
        const { member, effectiveChamp } = ordered[i]
        const champ = championsByKey.get(effectiveChamp)
        if (!champ) continue
        const skinMeta =
          member.selectedSkinId > 0
            ? skinMetaByLcuId.get(member.selectedSkinId)
            : undefined
        out[slot.player_id] = {
          player_id: slot.player_id,
          skin_id: skinMeta?.id ?? null,
          skin_name:
            skinMeta?.name ?? (member.selectedSkinId > 0 ? 'Skin' : 'Padrão'),
          champion_id: champ.id,
          champion_name: champ.name,
          champion_image_url: champ.image_url ?? null,
          splash_url: skinMeta?.splash_url ?? null,
          tile_url: skinMeta?.tile_url ?? champ.image_url ?? null,
          lcu_champion_id: effectiveChamp,
          lcu_skin_id: member.selectedSkinId > 0 ? member.selectedSkinId : 0,
          is_intent: member.championId <= 0 && member.championPickIntent > 0,
        }
      }
    }

    return out
  }, [
    champSelect,
    participants,
    mePuuid,
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

  const lockedAramPicks = useMemo(() => {
    const out: Record<string, string> = {}
    const confirmed = activePicks.filter((p) => !p.is_intent)
    const intents = activePicks.filter((p) => p.is_intent)
    for (const pick of [...confirmed, ...intents]) {
      if (out[pick.player_id]) continue
      if (!pick.champion_id || pick.lcu_champion_id <= 0) continue
      if (!championsByKey.has(pick.lcu_champion_id)) continue
      out[pick.player_id] = pick.champion_id
    }
    return out
  }, [activePicks, championsByKey])

  const lockedAramPicksKey = useMemo(
    () =>
      Object.entries(lockedAramPicks)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([pid, cid]) => `${pid}:${cid}`)
        .join('|'),
    [lockedAramPicks],
  )

  return {
    championsByKey,
    skinMetaByLcuId,
    livePicksByPlayer,
    activePicks,
    takenChampions,
    lockedAramPicks,
    lockedAramPicksKey,
  }
}
