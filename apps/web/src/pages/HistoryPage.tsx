import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePlayer } from '../contexts/PlayerContext'
import { formatError, modeLabel, statusLabel } from '../lib/format'
import { supabase } from '../lib/supabase'
import type { DraftRoom, QueueKind } from '../lib/types'

type HistoryRow = DraftRoom & {
  participant_count?: number
}

function roomQueueLabel(room: DraftRoom): string {
  const kind = (room.settings?.queue_kind ?? 'unknown') as QueueKind | string
  const pool = room.settings?.aram_pool?.length ?? 0
  if (kind === 'aram' || (pool > 0 && kind !== 'sr')) return 'ARAM'
  if (kind === 'sr') return "Summoner's Rift"
  return modeLabel(room.mode)
}

export function HistoryPage() {
  const { me, isDesktop, loading: playerLoading } = usePlayer()
  const [rooms, setRooms] = useState<HistoryRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (playerLoading) return

    if (!me?.id) {
      setRooms([])
      setLoading(false)
      setError(null)
      return
    }

    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)
      try {
        const { data: parts, error: partError } = await supabase
          .from('draft_participants')
          .select('room_id')
          .eq('player_id', me!.id)

        if (partError) throw partError
        const ids = [...new Set((parts ?? []).map((p) => p.room_id).filter(Boolean))]
        if (ids.length === 0) {
          if (!cancelled) setRooms([])
          return
        }

        // PostgREST .in() com muitos ids — carrega em lotes
        const batchSize = 80
        const allRooms: DraftRoom[] = []
        for (let i = 0; i < ids.length; i += batchSize) {
          const chunk = ids.slice(i, i + batchSize)
          const { data: roomData, error: roomError } = await supabase
            .from('draft_rooms')
            .select('*')
            .in('id', chunk)
            .order('created_at', { ascending: false })
          if (roomError) throw roomError
          allRooms.push(...((roomData ?? []) as DraftRoom[]))
        }

        allRooms.sort(
          (a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        )

        if (!cancelled) setRooms(allRooms)
      } catch (err) {
        if (!cancelled) setError(formatError(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [me?.id, playerLoading])

  const awaitingPlayer = isDesktop && (playerLoading || (!me?.id && loading))

  return (
    <div className="animate-fade-up">
      <h1 className="font-display text-3xl sm:text-4xl">Histórico</h1>
      <p className="mt-1 text-[var(--text-muted)]">
        Salas em que você entrou — abra para ver as combinações.
      </p>

      {!isDesktop ? (
        <p className="mt-6 text-sm text-[var(--text-muted)]">
          Abra o app de PC com o LoL.
        </p>
      ) : awaitingPlayer ? (
        <p className="mt-6 text-[var(--text-muted)]">Conectando ao LoL…</p>
      ) : !me?.id ? (
        <p className="mt-6 text-sm text-[var(--text-muted)]">
          Abra o League Client para carregar o histórico.
        </p>
      ) : loading && rooms.length === 0 ? (
        <p className="mt-6 text-[var(--text-muted)]">Carregando…</p>
      ) : error ? (
        <div className="mt-6">
          <p className="text-sm text-[var(--danger)]">{error}</p>
          <button
            type="button"
            className="mt-3 text-sm text-[var(--teal-soft)]"
            onClick={() => {
              setLoading(true)
              setError(null)
              // remount effect by toggling — simplest: reload page data via state
              void (async () => {
                try {
                  const { data: parts, error: partError } = await supabase
                    .from('draft_participants')
                    .select('room_id')
                    .eq('player_id', me.id)
                  if (partError) throw partError
                  const ids = [
                    ...new Set((parts ?? []).map((p) => p.room_id).filter(Boolean)),
                  ]
                  if (ids.length === 0) {
                    setRooms([])
                    return
                  }
                  const { data: roomData, error: roomError } = await supabase
                    .from('draft_rooms')
                    .select('*')
                    .in('id', ids.slice(0, 80))
                    .order('created_at', { ascending: false })
                  if (roomError) throw roomError
                  setRooms((roomData ?? []) as HistoryRow[])
                } catch (err) {
                  setError(formatError(err))
                } finally {
                  setLoading(false)
                }
              })()
            }}
          >
            Tentar de novo
          </button>
        </div>
      ) : rooms.length === 0 ? (
        <p className="mt-6 text-[var(--text-muted)]">Nenhuma sala ainda.</p>
      ) : (
        <ul className="mt-6 space-y-2">
          {loading ? (
            <li className="text-xs text-[var(--text-muted)]">Atualizando…</li>
          ) : null}
          {rooms.map((room) => (
            <li key={room.id}>
              <Link
                to={`/room/${room.id}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius)] border border-[var(--line)] bg-[var(--panel)] px-4 py-3 transition hover:border-[var(--gold)]"
              >
                <span>
                  <span className="font-medium text-[var(--gold-soft)]">
                    {roomQueueLabel(room)}
                  </span>
                  <span className="ml-2 text-sm text-[var(--text-muted)]">
                    {new Date(room.created_at).toLocaleString('pt-BR')}
                  </span>
                </span>
                <span className="text-xs uppercase tracking-wide text-[var(--text-muted)]">
                  {statusLabel(room.status)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
