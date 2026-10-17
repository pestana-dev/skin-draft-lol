import { Link } from 'react-router-dom'
import { usePlayer } from '../contexts/PlayerContext'
import { collectionSyncLabel } from '../lib/format'

const HOW_IT_WORKS = [
  {
    step: '1',
    title: 'Sincronize sua coleção',
    body: 'O Skin Draft lê suas skins diretamente do League Client e mantém sua coleção atualizada, sem precisar marcar tudo manualmente.',
  },
  {
    step: '2',
    title: 'Reúna seu grupo de amigos',
    body: 'Entre no mesmo lobby, confira as coleções e descubra o que vocês têm em comum.',
  },
  {
    step: '3',
    title: 'Combine as skins',
    body: 'Explore as linhas temáticas, compare cores e monte combinações que deixem seu duo impecável em qualquer partida.',
  },
] as const

const COMING_SOON = [
  {
    title: 'Histórico do lobby',
    body: 'Relembre os temas, picks e combos das partidas anteriores. Porque tem GGWP que merece ser lembrado.',
  },
  {
    title: 'Temas favoritos do grupo',
    body: 'Descubra quais linhas temáticas vocês mais curtem combinar e voltem aos combos favoritos do time.',
  },
  {
    title: 'Conta Skin Draft',
    body: 'Salve sua coleção e suas preferências para levar seu estilo de um PC para outro, sem começar do zero.',
  },
] as const

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
      <section className="animate-fade-up relative pt-8 sm:pt-14">
        <div
          aria-hidden
          className="pointer-events-none absolute left-[22%] top-2 h-52 w-52 -translate-x-1/2 rounded-full bg-[var(--teal)]/22 blur-3xl"
        />
        <div className="relative flex flex-col items-start gap-5">
          <h1 className="font-display max-w-lg text-4xl font-bold leading-[1.05] text-[var(--text-strong)] sm:text-5xl">
            Combine com seu duo de verdade.
          </h1>
          <p className="max-w-md text-base text-[var(--text-muted)] sm:text-lg">
            Abra o Skin Draft no app de PC para sincronizar a coleção e combinar
            skins com seus amigos.
          </p>
        </div>
      </section>
    )
  }

  const queueHint =
    queueKind === 'aram' ? 'ARAM' : queueKind === 'sr' ? 'SR' : null

  return (
    <div className="relative pt-8 sm:pt-12">
      <div
        aria-hidden
        className="pointer-events-none absolute left-[14%] top-6 h-56 w-56 -translate-x-1/2 rounded-full bg-[var(--teal)]/25 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute right-[6%] top-24 h-72 w-72 rounded-full bg-[var(--gold)]/14 blur-3xl"
      />

      <section className="relative grid gap-12 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
        <div className="animate-fade-up">
          <h1 className="font-display max-w-lg text-4xl font-bold leading-[1.05] text-[var(--text-strong)] sm:text-5xl">
            Combine com seu duo de verdade.
          </h1>
          <p className="animate-fade-up-delay mt-4 max-w-md text-base text-[var(--text-muted)] sm:text-lg">
            Descubra as skins que combinam com as dos seus amigos e explore novas
            possibilidades de criar combos estilosos em cada partida.
          </p>

          <div className="mt-9">
            <Link
              to="/collection"
              className="rounded-md border border-[var(--line-strong)] px-4 py-2.5 text-sm font-medium transition hover:border-[var(--gold)] hover:text-[var(--gold-soft)]"
            >
              Ver minha coleção
            </Link>
          </div>
        </div>

        <aside className="animate-fade-up-delay rounded-[var(--radius)] border border-[var(--line)] bg-[var(--panel)] p-5 shadow-[var(--shadow-glow)]">
          {loading ? (
            <p className="text-sm text-[var(--text-muted)]">
              Buscando suas skins no League Client…
            </p>
          ) : !lcu?.connected ? (
            <div>
              <p className="font-display text-lg text-[var(--gold-soft)]">
                Abra o League Client
              </p>
              <p className="mt-1 text-sm text-[var(--text-muted)]">
                {lcu?.message ?? 'Aguardando o League Client…'}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--teal-soft)]">
                  Sua coleção
                </p>
                <p className="mt-1 font-medium text-[var(--gold-soft)]">
                  {me?.display_name ?? lcu.summoner?.displayName}
                </p>
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  {collectionSyncLabel(
                    me?.last_inventory_sync_at,
                    me?.skin_count,
                  )}
                  {' · '}
                  <button
                    type="button"
                    disabled={syncing}
                    onClick={() => void syncInventory().catch(() => undefined)}
                    className="text-[var(--teal-soft)] underline-offset-2 hover:underline disabled:opacity-50"
                  >
                    {syncing ? 'Sincronizando…' : 'Sincronizar coleção'}
                  </button>
                </p>
              </div>

              {error ? (
                <p className="text-sm text-[var(--danger)]">{error}</p>
              ) : null}

              <div className="border-t border-[var(--line)] pt-4">
                <div className="flex items-baseline justify-between gap-2">
                  <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--teal-soft)]">
                    Seu time
                    {queueHint ? (
                      <span className="ml-2 font-normal normal-case tracking-normal text-[var(--text-muted)]">
                        · {queueHint}
                      </span>
                    ) : null}
                  </h2>
                  {partyId ? (
                    <button
                      type="button"
                      disabled={syncing}
                      onClick={() => void syncParty().catch(() => undefined)}
                      className="text-xs text-[var(--text-muted)] transition hover:text-[var(--text-strong)] disabled:opacity-50"
                    >
                      Atualizar
                    </button>
                  ) : null}
                </div>

                {!partyId ? (
                  <p className="mt-3 text-sm text-[var(--text-muted)]">
                    Seu time ainda não tem ninguém por aqui. Entre num lobby no
                    LoL para começar.
                  </p>
                ) : (
                  <>
                    <ul className="mt-3 space-y-1.5">
                      {partyMembers.map((m) => (
                        <li
                          key={m.puuid}
                          className="flex items-center gap-2 text-sm"
                        >
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--teal)]" />
                          <span className="truncate">
                            {m.display_name}
                            {m.puuid === me?.puuid ? (
                              <span className="ml-1.5 text-xs text-[var(--gold-soft)]">
                                (você)
                              </span>
                            ) : null}
                          </span>
                        </li>
                      ))}
                    </ul>
                    {roomId ? (
                      <Link
                        to={`/room/${roomId}`}
                        className="btn-primary mt-4 w-full"
                      >
                        Combinar skins
                      </Link>
                    ) : (
                      <p className="mt-3 text-xs text-[var(--text-muted)]">
                        Esperando os outros jogadores entrarem…
                      </p>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </aside>
      </section>

      <section className="relative mt-16 border-t border-[var(--line)] pt-10 sm:mt-20 sm:pt-12">
        <h2 className="font-display text-2xl text-[var(--text-strong)] sm:text-3xl">
          Como funciona o Skin Draft
        </h2>
        <p className="mt-2 max-w-xl text-sm text-[var(--text-muted)]">
          Três passos para encontrar combinações que têm tudo a ver com vocês.
        </p>
        <ol className="mt-8 grid gap-8 sm:grid-cols-3">
          {HOW_IT_WORKS.map((item) => (
            <li key={item.step}>
              <p className="font-display text-3xl text-[var(--teal-soft)]">
                {item.step}
              </p>
              <p className="mt-2 font-display text-lg text-[var(--text-strong)]">
                {item.title}
              </p>
              <p className="mt-1.5 text-sm leading-relaxed text-[var(--text-muted)]">
                {item.body}
              </p>
            </li>
          ))}
        </ol>
      </section>

      <section className="relative mt-14 border-t border-[var(--line)] pt-10 sm:mt-16 sm:pt-12">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-2xl text-[var(--text-strong)] sm:text-3xl">
            No radar
          </h2>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--gold-soft)]">
            Próximos patches
          </p>
        </div>
        <p className="mt-2 max-w-xl text-sm text-[var(--text-muted)]">
          Tem mais coisa vindo por aí. Estas são algumas ideias para deixar seus
          drafts ainda melhores.
        </p>
        <ul className="mt-8 grid gap-6 sm:grid-cols-3">
          {COMING_SOON.map((item) => (
            <li key={item.title}>
              <p className="font-display text-lg text-[var(--gold-soft)]">
                {item.title}
              </p>
              <p className="mt-1.5 text-sm leading-relaxed text-[var(--text-muted)]">
                {item.body}
              </p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
