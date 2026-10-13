import { Link } from 'react-router-dom'
import { usePlayer } from '../contexts/PlayerContext'
import { collectionSyncLabel } from '../lib/format'

export function HomePage() {
  const {
    isDesktop,
    configured,
    loading,
    syncing,
    error,
    lcu,
    me,
    roomId,
    partyId,
    partyMembers,
    queueKind,
    syncInventory,
    syncParty,
  } = usePlayer()

  if (!configured) {
    return (
      <section className="animate-fade-up rounded-[var(--radius)] border border-[var(--line)] bg-[var(--panel)] p-8">
        <h1 className="font-display text-3xl">Configuração incompleta</h1>
        <p className="mt-2 text-[var(--text-muted)]">
          Falta configurar o Supabase neste ambiente.
        </p>
      </section>
    )
  }

  if (!isDesktop) {
    return (
      <section className="animate-fade-up relative overflow-hidden">
        <div className="pointer-events-none absolute -left-24 top-10 h-64 w-64 rounded-full bg-[var(--teal)]/10 blur-3xl" />
        <p className="font-display text-5xl font-extrabold leading-[0.95] text-[var(--gold-soft)] sm:text-6xl">
          Skin Draft
          <span className="mt-1 block text-2xl font-semibold tracking-[0.18em] text-[var(--teal-soft)]">
            LOL
          </span>
        </p>
        <p className="mt-5 max-w-xl text-base text-[var(--text-muted)] sm:text-lg">
          Abra o Skin Draft no app de PC.
        </p>
      </section>
    )
  }

  return (
    <section className="relative overflow-hidden">
      <div className="pointer-events-none absolute -left-24 top-10 h-64 w-64 rounded-full bg-[var(--teal)]/10 blur-3xl" />
      <div className="pointer-events-none absolute -right-16 top-0 h-72 w-72 rounded-full bg-[var(--gold)]/10 blur-3xl" />

      <div className="relative grid gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-start">
        <div className="animate-fade-up">
          <p className="font-display text-5xl font-extrabold leading-[0.95] text-[var(--gold-soft)] sm:text-6xl lg:text-7xl">
            Skin Draft
            <span className="mt-1 block text-2xl font-semibold tracking-[0.18em] text-[var(--teal-soft)] sm:text-3xl">
              LOL
            </span>
          </p>
          <p className="mt-5 max-w-xl text-base text-[var(--text-muted)] sm:text-lg">
            Combine skins temáticas com o party do LoL.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              to="/collection"
              className="rounded-md border border-[var(--line-strong)] px-4 py-2.5 text-sm font-medium transition hover:border-[var(--gold)] hover:text-[var(--gold-soft)]"
            >
              Ver coleção
            </Link>
            {roomId ? (
              <Link
                to={`/room/${roomId}`}
                className="rounded-md bg-[var(--gold)] px-4 py-2.5 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--gold-soft)]"
              >
                Ver combinações
              </Link>
            ) : null}
          </div>
        </div>

        <div className="animate-fade-up space-y-4 rounded-[var(--radius)] border border-[var(--line)] bg-[var(--panel)]/80 p-5">
          <h2 className="font-display text-xl">Status</h2>

          {loading ? (
            <p className="text-sm text-[var(--text-muted)]">Conectando…</p>
          ) : !lcu?.connected ? (
            <div>
              <p className="text-[var(--gold-soft)]">Abra o League Client</p>
              <p className="mt-1 text-sm text-[var(--text-muted)]">
                {lcu?.message ?? 'Aguardando o League Client…'}
              </p>
            </div>
          ) : (
            <>
              <p className="text-sm">
                Olá,{' '}
                <span className="font-medium text-[var(--gold-soft)]">
                  {me?.display_name ?? lcu.summoner?.displayName}
                </span>
              </p>
              <p className="text-sm text-[var(--text-muted)]">
                Coleção:{' '}
                {collectionSyncLabel(me?.last_inventory_sync_at, me?.skin_count)}
              </p>
              <button
                type="button"
                disabled={syncing}
                onClick={() => void syncInventory().catch(() => undefined)}
                className="rounded-md border border-[var(--line-strong)] px-3 py-2 text-sm transition hover:border-[var(--teal)] disabled:opacity-50"
              >
                {syncing ? 'Sincronizando…' : 'Sincronizar skins agora'}
              </button>
            </>
          )}

          {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}

          <div className="border-t border-[var(--line)] pt-4">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-[var(--teal-soft)]">
              Party LoL
              {queueKind && queueKind !== 'unknown' ? (
                <span className="ml-2 font-normal normal-case tracking-normal text-[var(--text-muted)]">
                  · {queueKind === 'aram' ? 'ARAM' : 'SR'}
                </span>
              ) : null}
            </h3>
            {!partyId ? (
              <p className="mt-2 text-sm text-[var(--text-muted)]">
                Entre num party no LoL para começar.
              </p>
            ) : (
              <>
                <ul className="mt-3 space-y-2">
                  {partyMembers.map((m) => (
                    <li
                      key={m.puuid}
                      className="flex items-center justify-between rounded-md bg-[var(--ink-soft)] px-3 py-2 text-sm"
                    >
                      <span>
                        {m.display_name}
                        {m.puuid === me?.puuid ? (
                          <span className="ml-2 text-xs text-[var(--gold-soft)]">você</span>
                        ) : null}
                      </span>
                      <span className="text-xs text-[var(--text-muted)]">
                        {m.skin_count > 0
                          ? collectionSyncLabel(m.last_inventory_sync_at, m.skin_count)
                          : 'Coleção ainda não salva'}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={syncing}
                    onClick={() => void syncParty().catch(() => undefined)}
                    className="rounded-md border border-[var(--line-strong)] px-3 py-2 text-sm disabled:opacity-50"
                  >
                    Atualizar party
                  </button>
                  {roomId ? (
                    <Link
                      to={`/room/${roomId}`}
                      className="rounded-md bg-[var(--gold)] px-3 py-2 text-sm font-semibold text-[var(--ink)]"
                    >
                      Ver combinações
                    </Link>
                  ) : null}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
