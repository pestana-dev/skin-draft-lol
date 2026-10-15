import { useCallback, useEffect, useRef, useState } from 'react'
import { canAssignUniqueChampions } from '../lib/matchFeasibility'
import { formatError } from '../lib/format'
import { supabase } from '../lib/supabase'
import type {
  DraftParticipant,
  DraftRoom,
  Player,
  ThemeMatch,
  ThemeMatchesResponse,
} from '../lib/types'

export type LobbyParticipant = DraftParticipant & {
  player?: Player & { skin_count?: number }
}

function normalizeMatch(match: ThemeMatch): ThemeMatch {
  const rawPlayers =
    match.players ??
    (Array.isArray(match.members) &&
    match.members[0] &&
    'champions' in match.members[0]
      ? (match.members as ThemeMatch['players'])
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

/** Só checagem leve de factibilidade — sem assignment completo. */
export function feasibleMatches(matches: ThemeMatch[]): ThemeMatch[] {
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

const REALTIME_DEBOUNCE_MS = 400

export function useRoomMatches(roomId: string | undefined) {
  const [room, setRoom] = useState<DraftRoom | null>(null)
  const [participants, setParticipants] = useState<LobbyParticipant[]>([])
  const [data, setData] = useState<ThemeMatchesResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const debounceRef = useRef<number | null>(null)
  const cancelledRef = useRef(false)

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

  const refreshRoom = useCallback(
    async (opts?: { quiet?: boolean }) => {
      if (!roomId) return
      if (!opts?.quiet) {
        setLoading(true)
        setError(null)
      }
      try {
        await loadLobby()
        try {
          await loadMatches()
        } catch (matchErr) {
          setData(null)
          setError(formatError(matchErr))
        }
      } catch (err) {
        setError(formatError(err))
        setRoom(null)
        setParticipants([])
        setData(null)
      } finally {
        if (!opts?.quiet) setLoading(false)
      }
    },
    [roomId, loadLobby, loadMatches],
  )

  const scheduleRefresh = useCallback(() => {
    if (debounceRef.current != null) window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(() => {
      debounceRef.current = null
      void refreshRoom({ quiet: true }).catch((err) =>
        setError(formatError(err)),
      )
    }, REALTIME_DEBOUNCE_MS)
  }, [refreshRoom])

  useEffect(() => {
    cancelledRef.current = false
    if (!roomId) {
      setRoom(null)
      setParticipants([])
      setData(null)
      setLoading(false)
      return
    }
    setRoom(null)
    setParticipants([])
    setData(null)
    setError(null)
    void refreshRoom()
    return () => {
      cancelledRef.current = true
      if (debounceRef.current != null) window.clearTimeout(debounceRef.current)
    }
  }, [roomId, refreshRoom])

  useEffect(() => {
    if (!roomId) return
    const channel = supabase
      .channel(`room:${roomId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'draft_rooms',
          filter: `id=eq.${roomId}`,
        },
        () => scheduleRefresh(),
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'draft_participants',
          filter: `room_id=eq.${roomId}`,
        },
        () => scheduleRefresh(),
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [roomId, scheduleRefresh])

  return {
    room,
    participants,
    data,
    setData,
    error,
    setError,
    loading,
    loadLobby,
    loadMatches,
    refreshRoom,
  }
}
