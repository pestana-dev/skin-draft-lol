import { useState } from 'react'
import { skinImageCandidates } from '../lib/skinImage'
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
  const candidates = skinImageCandidates(skin)
  const [imageIndex, setImageIndex] = useState(0)
  const src = candidates[imageIndex]

  return (
    <button
      type="button"
      disabled={!interactive || busy}
      onClick={onToggle}
      aria-pressed={owned}
      className={[
        'group relative overflow-hidden rounded-md border text-left transition duration-200',
        owned
          ? 'border-[var(--teal)]/80 ring-1 ring-[var(--teal)]/40'
          : 'border-[var(--line)] opacity-45 grayscale-[45%] hover:border-[var(--line-strong)] hover:opacity-85 hover:grayscale-0',
        interactive ? 'cursor-pointer' : 'cursor-default',
        busy ? 'opacity-60' : '',
      ].join(' ')}
    >
      <div className={compact ? 'aspect-[3/5]' : 'aspect-[2/3]'}>
        {src ? (
          <img
            src={src}
            alt={skin.name}
            loading="lazy"
            onError={() => {
              setImageIndex((i) => (i + 1 < candidates.length ? i + 1 : i))
            }}
            className="h-full w-full object-cover object-top transition duration-500 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex h-full items-center justify-center bg-[var(--panel)] text-[var(--text-muted)]">
            Sem imagem
          </div>
        )}
      </div>

      <div
        className={[
          'absolute inset-x-0 bottom-0 bg-gradient-to-t from-[var(--ink)] via-[var(--ink)]/80 to-transparent',
          compact ? 'px-1.5 pb-1.5 pt-6' : 'p-3 pt-10',
        ].join(' ')}
      >
        <p
          className={[
            'truncate font-semibold leading-tight text-[var(--text-strong)]',
            compact ? 'text-[11px]' : 'text-sm',
          ].join(' ')}
        >
          {skin.name}
        </p>
        {championName ? (
          <p
            className={[
              'truncate text-[var(--text-muted)]',
              compact ? 'text-[9px]' : 'text-xs',
            ].join(' ')}
          >
            {championName}
          </p>
        ) : null}
      </div>

      {interactive ? (
        <span
          className={[
            'absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold transition',
            owned
              ? 'bg-[var(--teal)] text-[var(--ink)]'
              : 'border border-white/20 bg-[var(--ink)]/55 text-white/50 group-hover:border-white/40 group-hover:text-white/80',
          ].join(' ')}
          aria-hidden
        >
          {owned ? '✓' : '+'}
        </span>
      ) : null}
    </button>
  )
}
