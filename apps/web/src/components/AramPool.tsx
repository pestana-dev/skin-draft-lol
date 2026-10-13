import type { Champion } from '../lib/types'

type Props = {
  champions: Champion[]
  syncedAt?: string | null
  isHost: boolean
  busy?: boolean
  onClear?: () => void
}

export function AramPool({
  champions,
  syncedAt,
  isHost,
  busy,
  onClear,
}: Props) {
  const lastSync = syncedAt
    ? new Date(syncedAt).toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    : null

  return (
    <section className="animate-fade-up-delay border-y border-[var(--line)] bg-[var(--panel)]/40 py-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 className="font-display text-base text-[var(--text-strong)]">
            Pool ARAM
          </h2>
          <span className="text-xs text-[var(--text-muted)]">
            {champions.length
              ? `${champions.length} campeões · só estes entram nas combinações`
              : 'Aguardando a select do party'}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {lastSync ? (
            <span className="text-[10px] text-[var(--text-muted)]">
              sync {lastSync}
            </span>
          ) : null}
          {isHost && champions.length > 0 ? (
            <button
              type="button"
              disabled={busy}
              onClick={onClear}
              className="text-xs text-[var(--danger)]/80 transition hover:text-[var(--danger)] disabled:opacity-50"
            >
              Limpar
            </button>
          ) : null}
        </div>
      </div>

      {champions.length > 0 ? (
        <ul className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:thin]">
          {champions.map((c) => (
            <li
              key={c.id}
              className="w-14 shrink-0 overflow-hidden rounded-md border border-[var(--line)] bg-[var(--ink-soft)] transition hover:border-[var(--teal)]/40"
              title={c.name}
            >
              {c.image_url ? (
                <img
                  src={c.image_url}
                  alt={c.name}
                  className="aspect-square w-full object-cover"
                  loading="lazy"
                />
              ) : (
                <div className="flex aspect-square items-center justify-center text-[10px] text-[var(--text-muted)]">
                  {c.name.slice(0, 2)}
                </div>
              )}
              <p className="truncate px-0.5 py-0.5 text-center text-[9px] text-[var(--text-muted)]">
                {c.name}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-[var(--text-muted)]">
          Entre na select ARAM no cliente para atualizar a lista.
        </p>
      )}
    </section>
  )
}
