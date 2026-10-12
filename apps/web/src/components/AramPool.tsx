import type { Champion } from '../lib/types'

type Props = {
  champions: Champion[]
  syncedAt?: string | null
  roomCode?: string
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
  const syncLabel = syncedAt
    ? new Date(syncedAt).toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    : null

  return (
    <section className="rounded-[var(--radius)] border border-[var(--line)] bg-[var(--panel)]/80 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg">Pool ARAM</h2>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Vem do party/select do LoL pelo app desktop — sem digitar código.
          </p>
        </div>
        <span
          className={[
            'rounded-md px-2.5 py-1 text-xs font-semibold uppercase tracking-wide',
            champions.length
              ? 'bg-[var(--teal)]/20 text-[var(--teal-soft)]'
              : 'bg-[var(--ink-soft)] text-[var(--text-muted)]',
          ].join(' ')}
        >
          {champions.length ? `${champions.length} champs` : 'Aguardando sync'}
        </span>
      </div>

      {champions.length > 0 ? (
        <ul className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
          {champions.map((c) => (
            <li
              key={c.id}
              className="overflow-hidden rounded-md border border-[var(--line)] bg-[var(--ink-soft)]"
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
                <div className="flex aspect-square items-center justify-center text-xs text-[var(--text-muted)]">
                  {c.name.slice(0, 2)}
                </div>
              )}
              <p className="truncate px-1.5 py-1 text-center text-[10px] text-[var(--text-muted)]">
                {c.name}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-4 rounded-md border border-dashed border-[var(--line)] bg-[var(--ink-soft)]/50 p-4 text-sm text-[var(--text-muted)]">
          Entre na select ARAM com o party — o app atualiza este pool sozinho.
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {isHost && champions.length > 0 ? (
          <button
            type="button"
            disabled={busy}
            onClick={onClear}
            className="rounded-md border border-[var(--danger)]/40 px-3 py-1.5 text-sm text-[var(--danger)] disabled:opacity-50"
          >
            Limpar pool
          </button>
        ) : null}
        {syncLabel ? (
          <span className="text-xs text-[var(--text-muted)]">Último sync: {syncLabel}</span>
        ) : null}
      </div>
    </section>
  )
}
