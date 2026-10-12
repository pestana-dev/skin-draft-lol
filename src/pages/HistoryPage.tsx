import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { RequireAuth } from '../components/RequireAuth'
import { useAuth } from '../contexts/AuthContext'
import { formatError, modeLabel } from '../lib/format'
import { supabase } from '../lib/supabase'
import type { DraftRoom } from '../lib/types'

type HistoryRow = DraftRoom & { latest_round?: number }

function HistoryInner() {
  const { user } = useAuth()
  const [rooms, setRooms] = useState<HistoryRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return

    async function load() {
      setLoading(true)
      setError(null)
      try {
        const { data: parts, error: partError } = await supabase
          .from('draft_participants')
          .select('room_id')
          .eq('user_id', user!.id)

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
  }, [user])

  return (
    <div className="animate-fade-up">
      <h1 className="font-display text-3xl sm:text-4xl">Drafts anteriores</h1>
      <p className="mt-1 text-[var(--text-muted)]">
        Salas em que você participou. O histórico de rodadas fica na tela de resultado.
      </p>

      {error ? <p className="mt-4 text-sm text-[var(--danger)]">{error}</p> : null}

      {loading ? (
        <p className="mt-6 text-[var(--text-muted)]">Carregando…</p>
      ) : rooms.length === 0 ? (
        <p className="mt-6 text-[var(--text-muted)]">Nenhuma sala ainda.</p>
      ) : (
        <ul className="mt-6 space-y-3">
          {rooms.map((room) => (
            <li
              key={room.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border border-[var(--line)] bg-[var(--panel)]/80 px-4 py-3"
            >
              <div>
                <p className="font-mono text-lg tracking-widest text-[var(--gold-soft)]">
                  {room.code}
                </p>
                <p className="text-sm text-[var(--text-muted)]">
                  {modeLabel(room.mode)} · {room.status} ·{' '}
                  {new Date(room.created_at).toLocaleString('pt-BR')}
                </p>
              </div>
              <div className="flex gap-2">
                <Link
                  to={`/room/${room.id}`}
                  className="rounded-md border border-[var(--line)] px-3 py-1.5 text-sm"
                >
                  Lobby
                </Link>
                <Link
                  to={`/room/${room.id}/matches`}
                  className="rounded-md bg-[var(--teal)] px-3 py-1.5 text-sm font-medium text-[var(--ink)]"
                >
                  Combinações
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function HistoryPage() {
  return (
    <RequireAuth>
      <HistoryInner />
    </RequireAuth>
  )
}
