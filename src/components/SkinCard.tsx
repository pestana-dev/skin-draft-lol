import type { Skin } from '../lib/types'

type Props = {
  skin: Skin
  owned?: boolean
  onToggle?: () => void
  busy?: boolean
  compact?: boolean
}

export function SkinCard({ skin, owned = false, onToggle, busy, compact }: Props) {
  const championName = skin.champions?.name
  const interactive = Boolean(onToggle)

  return (
    <button
      type="button"
      disabled={!interactive || busy}
      onClick={onToggle}
      className={[
        'group relative overflow-hidden rounded-[var(--radius)] border text-left transition',
        owned
          ? 'border-[var(--teal)] shadow-[var(--shadow-glow)]'
          : 'border-[var(--line)] hover:border-[var(--line-strong)]',
        interactive ? 'cursor-pointer' : 'cursor-default',
        busy ? 'opacity-60' : '',
      ].join(' ')}
    >
      <div className={compact ? 'aspect-[3/4]' : 'aspect-[16/9] sm:aspect-[3/4]'}>
        {skin.tile_url || skin.splash_url ? (
          <img
            src={skin.tile_url || skin.splash_url || ''}
            alt={skin.name}
            loading="lazy"
            className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex h-full items-center justify-center bg-[var(--panel)] text-[var(--text-muted)]">
            Sem imagem
          </div>
        )}
      </div>

      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[var(--ink)] via-[var(--ink)]/85 to-transparent p-3 pt-10">
        <p className="truncate text-sm font-semibold text-[var(--text-strong)]">{skin.name}</p>
        {championName ? (
          <p className="truncate text-xs text-[var(--text-muted)]">{championName}</p>
        ) : null}
      </div>

      {interactive ? (
        <span
          className={[
            'absolute right-2 top-2 rounded-md px-2 py-1 text-[10px] font-semibold uppercase tracking-wide',
            owned
              ? 'bg-[var(--teal)] text-[var(--ink)]'
              : 'bg-[var(--ink)]/70 text-[var(--text-muted)]',
          ].join(' ')}
        >
          {owned ? 'Possuída' : 'Marcar'}
        </span>
      ) : null}
    </button>
  )
}
