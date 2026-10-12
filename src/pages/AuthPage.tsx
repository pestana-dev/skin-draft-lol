import { useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { formatError } from '../lib/format'

export function AuthPage() {
  const { configured, user, signIn, signUp } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? '/'

  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [info, setInfo] = useState<string | null>(null)

  if (!configured) {
    return (
      <div className="mx-auto max-w-md rounded-[var(--radius)] border border-[var(--line)] bg-[var(--panel)] p-6">
        <h1 className="font-display text-2xl">Supabase não configurado</h1>
        <p className="mt-2 text-sm text-[var(--text-muted)]">
          Defina <code>VITE_SUPABASE_URL</code> e <code>VITE_SUPABASE_PUBLISHABLE_KEY</code>.
        </p>
        <Link to="/" className="mt-4 inline-block text-[var(--teal-soft)]">
          Voltar
        </Link>
      </div>
    )
  }

  if (user) {
    return <Navigate to={from} replace />
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setInfo(null)
    setBusy(true)
    try {
      if (mode === 'login') {
        await signIn(email, password)
        navigate(from, { replace: true })
      } else {
        await signUp(email, password, displayName.trim() || 'Jogador')
        setInfo('Conta criada. Se o e-mail de confirmação estiver ativo, verifique sua caixa de entrada.')
        setMode('login')
      }
    } catch (err) {
      setError(formatError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-md animate-fade-up rounded-[var(--radius)] border border-[var(--line)] bg-[var(--panel)]/90 p-6 backdrop-blur">
      <h1 className="font-display text-3xl">{mode === 'login' ? 'Entrar' : 'Criar conta'}</h1>
      <p className="mt-2 text-sm text-[var(--text-muted)]">
        Autenticação via Supabase Auth — sem Riot ID no MVP.
      </p>

      <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-3">
        {mode === 'signup' ? (
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[var(--text-muted)]">Nome de exibição</span>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="rounded-md border border-[var(--line)] bg-[var(--ink-soft)] px-3 py-2 outline-none focus:border-[var(--teal)]"
              placeholder="Seu nick"
            />
          </label>
        ) : null}

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-[var(--text-muted)]">E-mail</span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-md border border-[var(--line)] bg-[var(--ink-soft)] px-3 py-2 outline-none focus:border-[var(--teal)]"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-[var(--text-muted)]">Senha</span>
          <input
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded-md border border-[var(--line)] bg-[var(--ink-soft)] px-3 py-2 outline-none focus:border-[var(--teal)]"
          />
        </label>

        {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
        {info ? <p className="text-sm text-[var(--teal-soft)]">{info}</p> : null}

        <button
          type="submit"
          disabled={busy}
          className="mt-2 rounded-md bg-[var(--gold)] px-4 py-2.5 font-semibold text-[var(--ink)] transition hover:bg-[var(--gold-soft)] disabled:opacity-60"
        >
          {busy ? 'Aguarde…' : mode === 'login' ? 'Entrar' : 'Cadastrar'}
        </button>
      </form>

      <button
        type="button"
        className="mt-4 text-sm text-[var(--teal-soft)]"
        onClick={() => {
          setMode((m) => (m === 'login' ? 'signup' : 'login'))
          setError(null)
          setInfo(null)
        }}
      >
        {mode === 'login' ? 'Criar uma conta' : 'Já tenho conta'}
      </button>
    </div>
  )
}
