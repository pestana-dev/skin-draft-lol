import { Link, NavLink, Outlet } from 'react-router-dom'
import { usePlayer } from '../contexts/PlayerContext'
import { BrandMark } from './BrandMark'
import { UpdateBanner } from './UpdateBanner'

const navClass = ({ isActive }: { isActive: boolean }) =>
  [
    'rounded-md px-3 py-2 text-sm font-medium transition-colors',
    isActive
      ? 'bg-[var(--panel-elevated)] text-[var(--gold-soft)]'
      : 'text-[var(--text-muted)] hover:text-[var(--text-strong)]',
  ].join(' ')

export function Layout() {
  const { configured, me, lcu, loading, syncing, isDesktop } = usePlayer()

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-6xl flex-col px-4 pb-10 pt-5 sm:px-6">
      <header className="mb-8 flex flex-wrap items-center gap-4 border-b border-[var(--line)] pb-4">
        <div className="flex min-w-0 flex-wrap items-center gap-3 sm:gap-5">
          <Link
            to="/"
            className="group shrink-0 transition-opacity hover:opacity-95"
            aria-label="Skin Draft LoL — início"
          >
            <BrandMark size="md" bob={false} />
          </Link>

          <nav className="flex flex-wrap items-center gap-1">
            <NavLink to="/" end className={navClass}>
              Início
            </NavLink>
            <NavLink to="/collection" className={navClass}>
              Coleção
            </NavLink>
          </nav>
        </div>

        {/* Conta / login futuro */}
        <div className="ml-auto flex max-w-full items-center justify-end text-sm">
          {!configured ? (
            <span className="rounded-md border border-[var(--danger)]/40 bg-[var(--danger)]/10 px-3 py-1.5 text-[var(--danger)]">
              Configuração incompleta
            </span>
          ) : loading ? (
            <span className="text-[var(--text-muted)]">…</span>
          ) : me ? (
            <span className="truncate text-[var(--text-muted)]">
              {me.display_name}
              {syncing ? (
                <span className="ml-2 text-[var(--teal-soft)]">sincronizando…</span>
              ) : lcu?.connected ? (
                <span className="ml-2 text-[var(--teal-soft)]">LoL</span>
              ) : null}
            </span>
          ) : isDesktop ? (
            <span className="text-[var(--text-muted)]">Aguardando LoL…</span>
          ) : (
            <span className="rounded-md border border-[var(--line)] px-3 py-1.5 text-[var(--text-muted)]">
              Use o app de PC
            </span>
          )}
        </div>
      </header>

      <UpdateBanner />

      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  )
}
