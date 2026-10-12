import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePlayer } from '../contexts/PlayerContext'
import { formatError, modeLabel } from '../lib/format'
import { supabase } from '../lib/supabase'
import type { DraftRoom } from '../lib/types'

type HistoryRow = DraftRoom & { latest_round?: number }

export function HistoryPage() {
  const { me, isDesktop } = usePlayer()
  const [rooms, setRooms] = useState<HistoryRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!me?.id) {
      setRooms([])
      setLoading(false)
      return
    }

    async function load() {
      setLoading(true)
      setError(null)
      try {
        const { data: parts, error: partError } = await supabase
          .from('draft_participants')
          .select('room_id')
          .eq('player_id', me!.id)

        if (partError) throw partError
        const ids = [...new Set((parts ?? []).map((p) => p.room_id))]
        if (ids.length === 0) {
          setRooms([])
          return
        }

        const { data: roomData, error: roomError } = await supabase
          .from('draft_rooms')
          .select('*')
          .in('id', ids)
          .order('created_at', { ascending: false })

        if (roomError) throw roomError
        setRooms((roomData ?? []) as HistoryRow[])
      } catch (err) {
        setError(formatError(err))
      } finally {
        setLoading(false)
      }
    }

    void load()
  }, [me?.id])

  return (
    <div className="animate-fade-up">
      <h1 className="font-display text-3xl sm:text-4xl">Drafts anteriores</h1>
      <p className="mt-1 text-[var(--text-muted)]">
        Salas do party em que você entrou com este Riot ID.
      </p>

      {!isDesktop || !me?.id ? (
        <p className="mt-6 text-sm text-[var(--text-muted)]">
          Abra o app desktop com o LoL para ver o histórico.
        </p>
      ) : loading ? (
        <p className="mt-6 text-[var(--text-muted)]">Carregando…</p>
      ) : error ? (
        <p className="mt-6 text-sm text-[var(--danger)]">{error}</p>
      ) : rooms.length === 0 ? (
        <p className="mt-6 text-[var(--text-muted)]">Nenhuma sala ainda.</p>
      ) : (
        <ul className="mt-6 space-y-2">
          {rooms.map((room) => (
            <li key={room.id}>
              <Link
                to={`/room/${room.id}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius)] border border-[var(--line)] bg-[var(--panel)] px-4 py-3 transition hover:border-[var(--gold)]"
              >
                <span>
                  <span className="font-medium text-[var(--gold-soft)]">
                    {modeLabel(room.mode)}
                  </span>
                  <span className="ml-2 text-sm text-[var(--text-muted)]">
                    {new Date(room.created_at).toLocaleString('pt-BR')}
                  </span>
                </span>
                <span className="text-xs uppercase tracking-wide text-[var(--text-muted)]">
                  {room.status}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
