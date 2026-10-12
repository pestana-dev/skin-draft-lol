import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AramPool } from '../components/AramPool'
import { RequireAuth } from '../components/RequireAuth'
import { useAuth } from '../contexts/AuthContext'
import { formatError } from '../lib/format'
import { supabase } from '../lib/supabase'
import type { Champion, DraftParticipant, DraftRoom } from '../lib/types'

function LobbyInner() {
  const { roomId } = useParams<{ roomId: string }>()
  const { user } = useAuth()
  const navigate = useNavigate()

  const [room, setRoom] = useState<DraftRoom | null>(null)
  const [participants, setParticipants] = useState<DraftParticipant[]>([])
  const [aramChampions, setAramChampions] = useState<Champion[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  const isHost = room?.host_id === user?.id
  const me = useMemo(
    () => participants.find((p) => p.user_id === user?.id),
    [participants, user?.id],
  )

  const aramPool = room?.settings?.aram_pool ?? []
  const syncCommand = room ? `npm run sync:aram -- --room=${room.code}` : ''

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

  async function copyCode() {
    if (!room?.code) return
    await navigator.clipboard.writeText(room.code)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  async function copySyncCommand() {
    if (!syncCommand) return
    await navigator.clipboard.writeText(syncCommand)
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
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--teal-soft)]">
            Lobby
          </p>
          <h1 className="font-display text-3xl sm:text-4xl">Sala {room.code}</h1>
          <p className="mt-1 text-[var(--text-muted)]">
            {participants.length} participante
            {participants.length === 1 ? '' : 's'} · combinações por tema
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

      <div className="mb-4">
        <AramPool
          champions={aramChampions}
          syncedAt={room.settings?.aram_synced_at}
          roomCode={room.code}
          isHost={Boolean(isHost)}
          busy={busy}
          onClear={() => void clearAramPool()}
          onCopyCommand={() => void copySyncCommand()}
        />
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
          <h2 className="font-display text-lg">Combinações</h2>
          <p className="mt-2 text-sm text-[var(--text-muted)]">
            O sistema lista temas em comum do maior grupo até as duplas, com uma
            skin sugerida por pessoa.
          </p>

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

            <button
              type="button"
              disabled={busy || participants.length < 2}
              onClick={() => navigate(`/room/${roomId}/matches`)}
              className="rounded-md bg-[var(--gold)] px-4 py-2.5 font-semibold text-[var(--ink)] transition hover:bg-[var(--gold-soft)] disabled:opacity-50"
            >
              Ver combinações
            </button>

            {participants.length < 2 ? (
              <p className="text-xs text-[var(--text-muted)]">
                Espere pelo menos 2 pessoas na sala.
              </p>
            ) : (
              <p className="text-xs text-[var(--text-muted)]">
                Qualquer participante pode abrir a lista. Com pool ARAM ativo, só
                entram skins desses campeões.
              </p>
            )}
          </div>
        </section>
      </div>

      {error ? <p className="mt-4 text-sm text-[var(--danger)]">{error}</p> : null}

      <p className="mt-6 text-sm text-[var(--text-muted)]">
        <Link to="/collection" className="text-[var(--teal-soft)]">
          Atualize sua coleção
        </Link>{' '}
        para aparecer em mais combinações.
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
