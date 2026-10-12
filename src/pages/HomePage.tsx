import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { formatError, modeLabel } from '../lib/format'
import { supabase } from '../lib/supabase'
import type { DraftMode } from '../lib/types'

export function HomePage() {
  const { user, configured } = useAuth()
  const navigate = useNavigate()
  const [code, setCode] = useState('')
  const [mode, setMode] = useState<DraftMode>('free')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function createRoom() {
    if (!user) {
      navigate('/auth')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const { data, error: rpcError } = await supabase.rpc('create_draft_room', {
        p_mode: mode,
      })
      if (rpcError) throw rpcError
      navigate(`/room/${data.id}`)
    } catch (err) {
      setError(formatError(err))
    } finally {
      setBusy(false)
    }
  }

  async function joinRoom(e: FormEvent) {
    e.preventDefault()
    if (!user) {
      navigate('/auth')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const { data, error: rpcError } = await supabase.rpc('join_draft_room', {
        p_code: code.trim().toUpperCase(),
      })
      if (rpcError) throw rpcError
      navigate(`/room/${data.id}`)
    } catch (err) {
      setError(formatError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="relative overflow-hidden">
      <div className="pointer-events-none absolute -left-24 top-10 h-64 w-64 rounded-full bg-[var(--teal)]/10 blur-3xl" />
      <div className="pointer-events-none absolute -right-16 top-0 h-72 w-72 rounded-full bg-[var(--gold)]/10 blur-3xl" />

      <div className="relative grid gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
        <div className="animate-fade-up">
          <p className="font-display text-5xl font-extrabold leading-[0.95] text-[var(--gold-soft)] sm:text-6xl lg:text-7xl">
            Skin Draft
            <span className="mt-1 block text-2xl font-semibold tracking-[0.18em] text-[var(--teal-soft)] sm:text-3xl">
              LOL
            </span>
          </p>
          <p className="mt-5 max-w-xl text-base text-[var(--text-muted)] sm:text-lg">
            Cadastre sua coleção, entre numa sala com amigos e sorteie skins que
            combinam — por tema, por cor ou no modo livre.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              to="/collection"
              className="rounded-md border border-[var(--line-strong)] px-4 py-2.5 text-sm font-medium transition hover:border-[var(--gold)] hover:text-[var(--gold-soft)]"
            >
              Minha coleção
            </Link>
            <Link
              to="/history"
              className="rounded-md border border-transparent px-4 py-2.5 text-sm text-[var(--text-muted)] transition hover:text-[var(--text-strong)]"
            >
              Drafts anteriores
            </Link>
          </div>
        </div>

        <div className="animate-fade-up-delay space-y-4 rounded-[var(--radius)] border border-[var(--line)] bg-[var(--panel)]/80 p-5 backdrop-blur sm:p-6">
          <div>
            <h2 className="font-display text-xl">Criar sala</h2>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              O anfitrião define o modo e compartilha o código.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {(['free', 'theme', 'color'] as DraftMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  disabled={m === 'color'}
                  onClick={() => setMode(m)}
                  title={m === 'color' ? 'Disponível após enriquecimento de cores' : undefined}
                  className={[
                    'rounded-md px-3 py-1.5 text-sm transition',
                    mode === m
                      ? 'bg-[var(--teal)] text-[var(--ink)]'
                      : 'border border-[var(--line)] text-[var(--text-muted)] hover:text-[var(--text)]',
                    m === 'color' ? 'opacity-45' : '',
                  ].join(' ')}
                >
                  {modeLabel(m)}
                  {m === 'color' ? ' (em breve)' : ''}
                </button>
              ))}
            </div>
            <button
              type="button"
              disabled={busy || !configured}
              onClick={() => void createRoom()}
              className="mt-4 w-full rounded-md bg-[var(--gold)] px-4 py-2.5 font-semibold text-[var(--ink)] transition hover:bg-[var(--gold-soft)] disabled:opacity-50"
            >
              {user ? 'Criar sala' : 'Entrar para criar'}
            </button>
          </div>

          <div className="border-t border-[var(--line)] pt-4">
            <h2 className="font-display text-xl">Entrar com código</h2>
            <form onSubmit={joinRoom} className="mt-3 flex gap-2">
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="ABC123"
                maxLength={8}
                className="min-w-0 flex-1 rounded-md border border-[var(--line)] bg-[var(--ink-soft)] px-3 py-2 tracking-[0.2em] outline-none focus:border-[var(--teal)]"
              />
              <button
                type="submit"
                disabled={busy || !code.trim() || !configured}
                className="rounded-md border border-[var(--line-strong)] px-4 py-2 font-medium transition hover:border-[var(--teal)] hover:text-[var(--teal-soft)] disabled:opacity-50"
              >
                Entrar
              </button>
            </form>
          </div>

          {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
        </div>
      </div>
    </section>
  )
}
