import { Link, NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

const navClass = ({ isActive }: { isActive: boolean }) =>
  [
    'rounded-md px-3 py-2 text-sm transition-colors',
    isActive
      ? 'bg-[var(--panel-elevated)] text-[var(--gold-soft)]'
      : 'text-[var(--text-muted)] hover:text-[var(--text-strong)]',
  ].join(' ')

export function Layout() {
  const { configured, user, profile, signOut, loading } = useAuth()

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-6xl flex-col px-4 pb-10 pt-5 sm:px-6">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4 border-b border-[var(--line)] pb-4">
        <Link to="/" className="group flex items-baseline gap-2">
          <span className="font-display text-2xl font-extrabold tracking-tight text-[var(--gold-soft)] sm:text-3xl">
            Skin Draft
          </span>
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--teal-soft)]">
            LoL
          </span>
        </Link>

        <nav className="flex flex-wrap items-center gap-1">
          <NavLink to="/" end className={navClass}>
            Início
          </NavLink>
          <NavLink to="/collection" className={navClass}>
            Coleção
          </NavLink>
          <NavLink to="/history" className={navClass}>
            Histórico
          </NavLink>
        </nav>

        <div className="flex items-center gap-3 text-sm">
          {!configured ? (
            <span className="rounded-md border border-[var(--danger)]/40 bg-[var(--danger)]/10 px-3 py-1.5 text-[var(--danger)]">
              Configure o .env
            </span>
          ) : loading ? (
            <span className="text-[var(--text-muted)]">…</span>
          ) : user ? (
            <>
              <span className="hidden text-[var(--text-muted)] sm:inline">
                {profile?.display_name ?? user.email}
              </span>
              <button
                type="button"
                onClick={() => void signOut()}
                className="rounded-md border border-[var(--line-strong)] px-3 py-1.5 text-[var(--text)] transition hover:border-[var(--gold)] hover:text-[var(--gold-soft)]"
              >
                Sair
              </button>
            </>
          ) : (
            <Link
              to="/auth"
              className="rounded-md bg-[var(--gold)] px-3 py-1.5 font-medium text-[var(--ink)] transition hover:bg-[var(--gold-soft)]"
            >
              Entrar
            </Link>
          )}
        </div>
      </header>

      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  )
}
