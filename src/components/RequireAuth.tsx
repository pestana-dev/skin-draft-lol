import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { configured, loading, user } = useAuth()
  const location = useLocation()

  if (!configured) {
    return (
      <div className="rounded-[var(--radius)] border border-[var(--line)] bg-[var(--panel)] p-6">
        <h1 className="font-display text-2xl">Configure o Supabase</h1>
        <p className="mt-2 text-[var(--text-muted)]">
          Copie <code className="text-[var(--gold-soft)]">.env.example</code> para{' '}
          <code className="text-[var(--gold-soft)]">.env</code>, preencha as chaves e
          rode a migration em <code className="text-[var(--gold-soft)]">supabase/migrations</code>.
        </p>
      </div>
    )
  }

  if (loading) {
    return <p className="text-[var(--text-muted)]">Carregando sessão…</p>
  }

  if (!user) {
    return <Navigate to="/auth" replace state={{ from: location.pathname }} />
  }

  return children
}
