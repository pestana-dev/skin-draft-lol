import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { RequireAuth } from '../components/RequireAuth'
import { useAuth } from '../contexts/AuthContext'
import { formatError, modeLabel } from '../lib/format'
import { supabase } from '../lib/supabase'
import type { DraftMode, DraftParticipant, DraftRoom } from '../lib/types'

function LobbyInner() {
  const { roomId } = useParams<{ roomId: string }>()
  const { user } = useAuth()
  const navigate = useNavigate()

  const [room, setRoom] = useState<DraftRoom | null>(null)
  const [participants, setParticipants] = useState<DraftParticipant[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  const isHost = room?.host_id === user?.id
  const me = useMemo(
    () => participants.find((p) => p.user_id === user?.id),
    [participants, user?.id],
  )

  const load = useCallback(async () => {
    if (!roomId) return
    const [{ data: roomData, error: roomError }, { data: parts, error: partError }] =
      await Promise.all([
        supabase.from('draft_rooms').select('*').eq('id', roomId).maybeSingle(),
        supabase
          .from('draft_participants')
          .select('*, profiles(*)')
          .eq('room_id', roomId)
          .order('position'),
      ])

    if (roomError) throw roomError
    if (partError) throw partError
    if (!roomData) throw new Error('Sala não encontrada')

    setRoom(roomData as DraftRoom)
    setParticipants((parts ?? []) as DraftParticipant[])
  }, [roomId])

  useEffect(() => {
    void load().catch((err) => setError(formatError(err)))
  }, [load])

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
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'draft_results',
          filter: `room_id=eq.${roomId}`,
        },
        () => navigate(`/room/${roomId}/result`),
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [roomId, load, navigate])

  useEffect(() => {
    if (room?.status === 'completed') {
      navigate(`/room/${roomId}/result`)
    }
  }, [room?.status, roomId, navigate])

  async function toggleReady() {
    if (!roomId || !user || !me) return
    setBusy(true)
    setError(null)
    try {
      const { error: updError } = await supabase
        .from('draft_participants')
        .update({ is_ready: !me.is_ready })
        .eq('room_id', roomId)
        .eq('user_id', user.id)
      if (updError) throw updError
      await load()
    } catch (err) {
      setError(formatError(err))
    } finally {
      setBusy(false)
    }
  }

  async function updateMode(mode: DraftMode) {
    if (!roomId || !isHost || mode === 'color') return
    setBusy(true)
    setError(null)
    try {
      const { error: updError } = await supabase
        .from('draft_rooms')
        .update({ mode })
        .eq('id', roomId)
      if (updError) throw updError
      await load()
    } catch (err) {
      setError(formatError(err))
    } finally {
      setBusy(false)
    }
  }

  async function toggleAvoidDup() {
    if (!room || !isHost) return
    setBusy(true)
    setError(null)
    try {
      const next = {
        ...room.settings,
        avoid_duplicate_skins: !room.settings?.avoid_duplicate_skins,
      }
      const { error: updError } = await supabase
        .from('draft_rooms')
        .update({ settings: next })
        .eq('id', room.id)
      if (updError) throw updError
      await load()
    } catch (err) {
      setError(formatError(err))
    } finally {
      setBusy(false)
    }
  }

  async function runDraft() {
    if (!roomId) return
    setBusy(true)
    setError(null)
    try {
      const { error: rpcError } = await supabase.rpc('run_draft', {
        p_room_id: roomId,
      })
      if (rpcError) throw rpcError
      navigate(`/room/${roomId}/result`)
    } catch (err) {
      setError(formatError(err))
    } finally {
      setBusy(false)
    }
  }

  async function copyCode() {
    if (!room?.code) return
    await navigator.clipboard.writeText(room.code)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  if (!room) {
    return (
      <p className="text-[var(--text-muted)]">
        {error ? error : 'Carregando lobby…'}
      </p>
    )
  }

  const allReady =
    participants.length > 0 &&
    participants.every((p) => p.is_ready || p.user_id === room.host_id)

  return (
    <div className="animate-fade-up mx-auto max-w-3xl">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--teal-soft)]">
            Lobby
          </p>
          <h1 className="font-display text-3xl sm:text-4xl">Sala {room.code}</h1>
          <p className="mt-1 text-[var(--text-muted)]">
            Modo {modeLabel(room.mode)} · {participants.length} participante
            {participants.length === 1 ? '' : 's'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void copyCode()}
          className="animate-pulse-ring rounded-md border border-[var(--gold)]/50 bg-[var(--panel)] px-4 py-2 font-mono text-lg tracking-[0.25em] text-[var(--gold-soft)]"
        >
          {copied ? 'Copiado!' : room.code}
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <section className="rounded-[var(--radius)] border border-[var(--line)] bg-[var(--panel)]/80 p-4">
          <h2 className="font-display text-lg">Participantes</h2>
          <ul className="mt-3 space-y-2">
            {participants.map((p) => (
              <li
                key={p.user_id}
                className="flex items-center justify-between rounded-md bg-[var(--ink-soft)] px-3 py-2 text-sm"
              >
                <span>
                  {p.profiles?.display_name ?? 'Jogador'}
                  {p.user_id === room.host_id ? (
                    <span className="ml-2 text-xs text-[var(--gold-soft)]">host</span>
                  ) : null}
                </span>
                <span
                  className={
                    p.is_ready || p.user_id === room.host_id
                      ? 'text-[var(--teal-soft)]'
                      : 'text-[var(--text-muted)]'
                  }
                >
                  {p.user_id === room.host_id
                    ? 'Anfitrião'
                    : p.is_ready
                      ? 'Pronto'
                      : 'Aguardando'}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-[var(--radius)] border border-[var(--line)] bg-[var(--panel)]/80 p-4">
          <h2 className="font-display text-lg">Regras</h2>
          {isHost ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {(['free', 'theme'] as DraftMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  disabled={busy}
                  onClick={() => void updateMode(m)}
                  className={[
                    'rounded-md px-3 py-1.5 text-sm',
                    room.mode === m
                      ? 'bg-[var(--teal)] text-[var(--ink)]'
                      : 'border border-[var(--line)] text-[var(--text-muted)]',
                  ].join(' ')}
                >
                  {modeLabel(m)}
                </button>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-sm text-[var(--text-muted)]">{modeLabel(room.mode)}</p>
          )}

          <label className="mt-4 flex items-center gap-2 text-sm text-[var(--text-muted)]">
            <input
              type="checkbox"
              checked={Boolean(room.settings?.avoid_duplicate_skins)}
              disabled={!isHost || busy}
              onChange={() => void toggleAvoidDup()}
            />
            Evitar skins repetidas
          </label>

          <div className="mt-5 flex flex-col gap-2">
            {!isHost ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void toggleReady()}
                className="rounded-md border border-[var(--line-strong)] px-4 py-2.5 font-medium transition hover:border-[var(--teal)]"
              >
                {me?.is_ready ? 'Cancelar prontidão' : 'Estou pronto'}
              </button>
            ) : null}

            {isHost ? (
              <button
                type="button"
                disabled={busy || participants.length < 1}
                onClick={() => void runDraft()}
                className="rounded-md bg-[var(--gold)] px-4 py-2.5 font-semibold text-[var(--ink)] transition hover:bg-[var(--gold-soft)] disabled:opacity-50"
              >
                {busy ? 'Sorteando…' : 'Iniciar sorteio'}
              </button>
            ) : null}

            {!allReady && isHost ? (
              <p className="text-xs text-[var(--text-muted)]">
                Dica: espere todos ficarem prontos — o host pode iniciar mesmo assim.
              </p>
            ) : null}
          </div>
        </section>
      </div>

      {error ? <p className="mt-4 text-sm text-[var(--danger)]">{error}</p> : null}

      <p className="mt-6 text-sm text-[var(--text-muted)]">
        <Link to="/collection" className="text-[var(--teal-soft)]">
          Atualize sua coleção
        </Link>{' '}
        antes do sorteio. O retrato usado é o do momento da execução no servidor.
      </p>
    </div>
  )
}

export function LobbyPage() {
  return (
    <RequireAuth>
      <LobbyInner />
    </RequireAuth>
  )
}
