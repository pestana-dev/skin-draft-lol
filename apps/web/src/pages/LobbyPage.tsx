import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AramPool } from '../components/AramPool'
import { usePlayer } from '../contexts/PlayerContext'
import { collectionSyncLabel, formatError } from '../lib/format'
import { supabase } from '../lib/supabase'
import type { Champion, DraftParticipant, DraftRoom, Player } from '../lib/types'

type LobbyParticipant = DraftParticipant & {
  player?: Player & { skin_count?: number }
}

function syncBadge(p: LobbyParticipant) {
  const count = p.player?.skin_count ?? 0
  if (!count) return 'Coleção ainda não salva'
  return collectionSyncLabel(p.player?.last_inventory_sync_at, count)
}

export function LobbyPage() {
  const { roomId } = useParams<{ roomId: string }>()
  const { me } = usePlayer()
  const navigate = useNavigate()

  const [room, setRoom] = useState<DraftRoom | null>(null)
  const [participants, setParticipants] = useState<LobbyParticipant[]>([])
  const [aramChampions, setAramChampions] = useState<Champion[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const isHost = Boolean(room?.host_id && room.host_id === me?.id)
  const aramPool = room?.settings?.aram_pool ?? []

  const load = useCallback(async () => {
    if (!roomId) return
    const { data, error: rpcError } = await supabase.rpc('get_room_lobby', {
      p_room_id: roomId,
    })
    if (rpcError) throw rpcError
    const payload = data as {
      room: DraftRoom
      participants: LobbyParticipant[]
    }
    if (!payload?.room) throw new Error('Sala não encontrada')
    setRoom(payload.room)
    setParticipants(payload.participants ?? [])
  }, [roomId])

  useEffect(() => {
    void load().catch((err) => setError(formatError(err)))
  }, [load])

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
      .then(({ data, error: champError }) => {
        if (cancelled) return
        if (champError) {
          setError(formatError(champError))
          return
        }
        setAramChampions((data ?? []) as Champion[])
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
        () => void load(),
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'draft_participants',
          filter: `room_id=eq.${roomId}`,
        },
        () => void load(),
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [roomId, load])

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
      await load()
    } catch (err) {
      setError(formatError(err))
    } finally {
      setBusy(false)
    }
  }

  if (!room) {
    return (
      <p className="text-[var(--text-muted)]">
        {error ? error : 'Carregando lobby…'}
      </p>
    )
  }

  return (
    <div className="animate-fade-up mx-auto max-w-3xl">
      <div className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--teal-soft)]">
          Lobby do party
        </p>
        <h1 className="font-display text-3xl sm:text-4xl">
          {participants.length} no grupo
        </h1>
        <p className="mt-1 text-[var(--text-muted)]">
          Party do LoL
          {room.settings?.queue_kind === 'aram' ||
          ((room.settings?.aram_pool?.length ?? 0) > 0 &&
            room.settings?.queue_kind !== 'sr')
            ? ' · ARAM'
            : room.settings?.queue_kind === 'sr'
              ? ' · Summoner\'s Rift'
              : ''}
        </p>
      </div>

      <div className="mb-4">
        <AramPool
          champions={aramChampions}
          syncedAt={room.settings?.aram_synced_at}
          roomCode={room.code}
          isHost={isHost}
          busy={busy}
          onClear={() => void clearAramPool()}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <section className="rounded-[var(--radius)] border border-[var(--line)] bg-[var(--panel)]/80 p-4">
          <h2 className="font-display text-lg">No lobby</h2>
          <ul className="mt-3 space-y-2">
            {participants.map((p) => {
              const pid = p.player_id
              return (
                <li
                  key={pid}
                  className="flex flex-col gap-0.5 rounded-md bg-[var(--ink-soft)] px-3 py-2 text-sm"
                >
                  <span className="flex items-center justify-between">
                    <span>
                      {p.player?.display_name ?? 'Jogador'}
                      {pid === room.host_id ? (
                        <span className="ml-2 text-xs text-[var(--gold-soft)]">Anfitrião</span>
                      ) : null}
                      {pid === me?.id ? (
                        <span className="ml-2 text-xs text-[var(--teal-soft)]">você</span>
                      ) : null}
                    </span>
                  </span>
                  <span className="text-xs text-[var(--text-muted)]">{syncBadge(p)}</span>
                </li>
              )
            })}
          </ul>
        </section>

        <section className="rounded-[var(--radius)] border border-[var(--line)] bg-[var(--panel)]/80 p-4">
          <h2 className="font-display text-lg">Combinações</h2>
          <p className="mt-2 text-sm text-[var(--text-muted)]">
            Temas em comum no party.
          </p>
          <button
            type="button"
            disabled={busy || participants.length < 2}
            onClick={() => navigate(`/room/${roomId}/matches`)}
            className="mt-5 w-full rounded-md bg-[var(--gold)] px-4 py-2.5 font-semibold text-[var(--ink)] transition hover:bg-[var(--gold-soft)] disabled:opacity-50"
          >
            Ver combinações
          </button>
          {participants.length < 2 ? (
            <p className="mt-2 text-xs text-[var(--text-muted)]">
              Precisa de pelo menos 2 pessoas no party.
            </p>
          ) : null}
        </section>
      </div>

      {error ? <p className="mt-4 text-sm text-[var(--danger)]">{error}</p> : null}

      <p className="mt-6 text-sm text-[var(--text-muted)]">
        <Link to="/collection" className="text-[var(--teal-soft)]">
          Ver coleção
        </Link>
      </p>
    </div>
  )
}
