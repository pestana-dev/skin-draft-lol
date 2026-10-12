import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { RequireAuth } from '../components/RequireAuth'
import { formatError, matchSizeLabel } from '../lib/format'
import { supabase } from '../lib/supabase'
import type { ThemeMatch, ThemeMatchesResponse } from '../lib/types'

function MatchesInner() {
  const { roomId } = useParams<{ roomId: string }>()
  const [data, setData] = useState<ThemeMatchesResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!roomId) return
    setLoading(true)
    setError(null)
    try {
      const { data: raw, error: rpcError } = await supabase.rpc(
        'analyze_theme_matches',
        { p_room_id: roomId },
      )
      if (rpcError) throw rpcError
      setData(raw as ThemeMatchesResponse)
    } catch (err) {
      setError(formatError(err))
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [roomId])

  useEffect(() => {
    void load()
  }, [load])

  if (loading) {
    return <p className="text-[var(--text-muted)]">Analisando coleções…</p>
  }

  if (error) {
    return (
      <div className="rounded-[var(--radius)] border border-[var(--line)] bg-[var(--panel)] p-6">
        <h1 className="font-display text-2xl">Não foi possível analisar</h1>
        <p className="mt-2 text-sm text-[var(--danger)]">{error}</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-md bg-[var(--gold)] px-4 py-2 text-sm font-semibold text-[var(--ink)]"
          >
            Tentar de novo
          </button>
          <Link to={`/room/${roomId}`} className="text-sm text-[var(--teal-soft)]">
            Voltar ao lobby
          </Link>
        </div>
      </div>
    )
  }

  const matches = data?.matches ?? []
  const total = data?.participant_total ?? 0
  const hasAram = (data?.aram_pool?.length ?? 0) > 0

  return (
    <div className="animate-fade-up">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--teal-soft)]">
            Sala {data?.room_code}
          </p>
          <h1 className="font-display text-3xl sm:text-4xl">Combinações temáticas</h1>
          <p className="mt-1 max-w-2xl text-[var(--text-muted)]">
            Do maior grupo às duplas — quem tem skin do mesmo tema
            {hasAram ? ' (só campeões do pool ARAM)' : ''}. Não é sorteio: é o mapa
            do que dá pra combinar agora.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-md border border-[var(--line-strong)] px-4 py-2 text-sm"
          >
            Atualizar
          </button>
          <Link
            to={`/room/${roomId}`}
            className="rounded-md border border-[var(--line)] px-4 py-2 text-sm text-[var(--text-muted)]"
          >
            Lobby
          </Link>
        </div>
      </div>

      {matches.length === 0 ? (
        <div className="rounded-[var(--radius)] border border-[var(--line)] bg-[var(--panel)] p-8 text-center">
          <p className="text-[var(--text-muted)]">
            Nenhuma combinação com 2+ pessoas. Marquem mais skins na coleção
            {hasAram ? ' ou ampliem o pool ARAM' : ''}.
          </p>
          <Link
            to="/collection"
            className="mt-4 inline-block text-[var(--teal-soft)]"
          >
            Ir à coleção
          </Link>
        </div>
      ) : (
        <div className="space-y-5">
          {matches.map((match, index) => (
            <MatchCard
              key={match.theme_id}
              match={match}
              total={total}
              rank={index + 1}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function MatchCard({
  match,
  total,
  rank,
}: {
  match: ThemeMatch
  total: number
  rank: number
}) {
  const missing = total - match.match_count

  return (
    <article className="overflow-hidden rounded-[var(--radius)] border border-[var(--line)] bg-[var(--panel)]/90">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] px-4 py-3">
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-sm text-[var(--text-muted)]">#{rank}</span>
          <h2 className="font-display text-xl text-[var(--gold-soft)]">
            {match.theme_name}
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="rounded-md bg-[var(--teal)]/20 px-2.5 py-1 font-medium text-[var(--teal-soft)]">
            {matchSizeLabel(match.match_count, total)}
          </span>
          {missing > 0 ? (
            <span className="text-[var(--text-muted)]">
              {missing} fora desta linha
            </span>
          ) : (
            <span className="text-[var(--teal-soft)]">Todos combinam</span>
          )}
        </div>
      </header>

      <ul className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
        {match.members.map((m) => (
          <li
            key={`${match.theme_id}-${m.user_id}`}
            className="overflow-hidden rounded-md border border-[var(--line)] bg-[var(--ink-soft)]"
          >
            <div className="aspect-[16/9] overflow-hidden bg-[var(--panel)]">
              {m.splash_url || m.tile_url ? (
                <img
                  src={m.splash_url || m.tile_url || ''}
                  alt={m.skin_name}
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              ) : null}
            </div>
            <div className="p-3">
              <p className="text-xs uppercase tracking-wide text-[var(--teal-soft)]">
                {m.display_name}
              </p>
              <p className="mt-0.5 font-medium text-[var(--text-strong)]">
                {m.skin_name}
              </p>
              <p className="text-xs text-[var(--text-muted)]">{m.champion_name}</p>
            </div>
          </li>
        ))}
      </ul>
    </article>
  )
}

export function MatchesPage() {
  return (
    <RequireAuth>
      <MatchesInner />
    </RequireAuth>
  )
}
