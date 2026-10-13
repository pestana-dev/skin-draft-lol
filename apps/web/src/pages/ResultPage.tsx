import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { usePlayer } from '../contexts/PlayerContext'
import { formatError, modeLabel } from '../lib/format'
import { skinImageCandidates } from '../lib/skinImage'
import { supabase } from '../lib/supabase'
import type { DraftResult, DraftRoom, Skin } from '../lib/types'

function ResultSplash({ skin }: { skin: Skin }) {
  const candidates = skinImageCandidates(skin)
  const [index, setIndex] = useState(0)
  const src = candidates[index]

  if (!src) {
    return (
      <div className="flex h-full items-center justify-center bg-[var(--ink-soft)] text-[var(--text-muted)]">
        Sem imagem
      </div>
    )
  }

  return (
    <img
      src={src}
      alt={skin.name}
      className="h-full w-full object-cover"
      onError={() => setIndex((i) => (i + 1 < candidates.length ? i + 1 : i))}
    />
  )
}

export function ResultPage() {
  const { roomId } = useParams<{ roomId: string }>()
  const { me } = usePlayer()
  const navigate = useNavigate()

  const [room, setRoom] = useState<DraftRoom | null>(null)
  const [results, setResults] = useState<DraftResult[]>([])
  const [round, setRound] = useState(1)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const isHost = Boolean(room?.host_id && room.host_id === me?.id)

  const load = useCallback(async () => {
    if (!roomId) return

    const { data: roomData, error: roomError } = await supabase
      .from('draft_rooms')
      .select('*')
      .eq('id', roomId)
      .maybeSingle()

    if (roomError) throw roomError
    if (!roomData) throw new Error('Sala não encontrada')
    setRoom(roomData as DraftRoom)

    const { data: roundsData, error: roundsError } = await supabase
      .from('draft_results')
      .select('round')
      .eq('room_id', roomId)
      .order('round', { ascending: false })
      .limit(1)

    if (roundsError) throw roundsError
    const latestRound = roundsData?.[0]?.round ?? 1
    setRound(latestRound)

    const { data: resultData, error: resultError } = await supabase
      .from('draft_results')
      .select('*, skins(*, champions(*)), players:player_id(*)')
      .eq('room_id', roomId)
      .eq('round', latestRound)
      .order('slot')

    if (resultError) throw resultError
    setResults(
      ((resultData ?? []) as Array<DraftResult & { players?: DraftResult['player'] }>).map(
        (r) => ({
          ...r,
          player: r.players ?? r.player,
          profiles: r.players ?? r.profiles,
        }),
      ),
    )
  }, [roomId])

  useEffect(() => {
    void load().catch((err) => setError(formatError(err)))
  }, [load])

  useEffect(() => {
    if (!roomId) return
    const channel = supabase
      .channel(`result:${roomId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'draft_results',
          filter: `room_id=eq.${roomId}`,
        },
        () => void load(),
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [roomId, load])

  const themeName = useMemo(
    () => results[0]?.meta?.theme_name ?? null,
    [results],
  )

  async function redraw() {
    if (!roomId) return
    setBusy(true)
    setError(null)
    try {
      const { error: rpcError } = await supabase.rpc('run_draft', {
        p_room_id: roomId,
      })
      if (rpcError) throw rpcError
      await load()
    } catch (err) {
      setError(formatError(err))
    } finally {
      setBusy(false)
    }
  }

  async function share() {
    const lines = results.map((r) => {
      const name = r.player?.display_name ?? r.profiles?.display_name ?? 'Jogador'
      const skin = r.skins?.name ?? r.skin_id
      return `${name}: ${skin}`
    })
    const text = [
      `Skin Draft LoL · Rodada ${round}`,
      themeName ? `Tema: ${themeName}` : `Modo: ${modeLabel(room?.mode ?? 'theme')}`,
      ...lines,
    ].join('\n')

    if (navigator.share) {
      await navigator.share({ title: 'Skin Draft LoL', text })
    } else {
      await navigator.clipboard.writeText(text)
    }
  }

  if (!room && !error) {
    return <p className="text-[var(--text-muted)]">Carregando resultado…</p>
  }

  if (results.length === 0) {
    return (
      <div className="rounded-[var(--radius)] border border-[var(--line)] bg-[var(--panel)] p-6">
        <h1 className="font-display text-2xl">Sem resultado ainda</h1>
        <p className="mt-2 text-[var(--text-muted)]">
          {error ?? 'Ainda não há um sorteio nesta sala.'}
        </p>
        <Link to={`/room/${roomId}`} className="mt-4 inline-block text-[var(--teal-soft)]">
          Voltar às combinações
        </Link>
      </div>
    )
  }

  return (
    <div className="animate-fade-up">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--teal-soft)]">
            Resultado · Rodada {round}
          </p>
          <h1 className="font-display text-3xl sm:text-4xl">
            {themeName ? themeName : `Draft ${modeLabel(room?.mode ?? 'theme')}`}
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void share()}
            className="rounded-md border border-[var(--line-strong)] px-4 py-2 text-sm transition hover:border-[var(--gold)]"
          >
            Compartilhar
          </button>
          {isHost ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void redraw()}
              className="rounded-md bg-[var(--gold)] px-4 py-2 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--gold-soft)] disabled:opacity-50"
            >
              {busy ? 'Sorteando…' : 'Sortear novamente'}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => navigate(`/room/${roomId}`)}
            className="rounded-md border border-[var(--line)] px-4 py-2 text-sm text-[var(--text-muted)]"
          >
            Combinações
          </button>
        </div>
      </div>

      {error ? <p className="mb-4 text-sm text-[var(--danger)]">{error}</p> : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {results.map((r, index) => (
          <article
            key={r.id}
            className="animate-fade-up overflow-hidden rounded-[var(--radius)] border border-[var(--line)] bg-[var(--panel)]"
            style={{ animationDelay: `${index * 0.08}s` }}
          >
            <div className="aspect-[16/9] overflow-hidden">
              {r.skins ? (
                <ResultSplash skin={r.skins} />
              ) : (
                <div className="flex h-full items-center justify-center bg-[var(--ink-soft)] text-[var(--text-muted)]">
                  Sem imagem
                </div>
              )}
            </div>
            <div className="p-4">
              <p className="text-xs uppercase tracking-wide text-[var(--teal-soft)]">
                {r.player?.display_name ?? r.profiles?.display_name ?? 'Jogador'}
              </p>
              <h2 className="font-display mt-1 text-xl">{r.skins?.name}</h2>
              <p className="text-sm text-[var(--text-muted)]">
                {r.skins?.champions?.name}
              </p>
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}
