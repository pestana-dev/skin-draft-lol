type BrandMarkProps = {
  /** Compact header mark vs hero wordmark */
  size?: 'sm' | 'md' | 'lg' | 'hero'
  /** Show “Skin Draft” + LoL lockup */
  withWordmark?: boolean
  className?: string
  bob?: boolean
}

const FROG_SIZE: Record<NonNullable<BrandMarkProps['size']>, string> = {
  sm: 'h-10 w-10',
  md: 'h-12 w-12',
  lg: 'h-16 w-16',
  hero: 'h-24 w-24 sm:h-28 sm:w-28',
}

const TITLE_SIZE: Record<NonNullable<BrandMarkProps['size']>, string> = {
  sm: 'text-xl sm:text-2xl',
  md: 'text-2xl sm:text-3xl',
  lg: 'text-3xl sm:text-4xl',
  hero: 'text-5xl sm:text-6xl lg:text-7xl',
}

/** Original mascot SVG (no external asset / Riot IP). */
export function BrandFrog({
  size = 'md',
  bob = false,
  className = '',
}: Pick<BrandMarkProps, 'size' | 'bob' | 'className'>) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      className={[
        FROG_SIZE[size],
        'shrink-0 drop-shadow-[0_6px_18px_rgba(61,184,160,0.4)]',
        bob ? 'animate-frog-bob' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <ellipse cx="32" cy="38" rx="18" ry="16" fill="#2ec4a8" />
      <ellipse cx="32" cy="42" rx="11" ry="8" fill="#e6c76a" />
      <circle cx="23" cy="28" r="7.5" fill="#f7fafc" />
      <circle cx="41" cy="28" r="7.5" fill="#f7fafc" />
      <circle cx="24.5" cy="29" r="3.4" fill="#0b1220" />
      <circle cx="42.5" cy="29" r="3.4" fill="#0b1220" />
      <circle cx="25.6" cy="27.8" r="1.1" fill="#fff" />
      <circle cx="43.6" cy="27.8" r="1.1" fill="#fff" />
      <path
        d="M25 46c3.2 3.2 10.8 3.2 14 0"
        stroke="#0d3d36"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <ellipse cx="17" cy="36" rx="3" ry="2" fill="#e35d6a" opacity="0.45" />
      <ellipse cx="47" cy="36" rx="3" ry="2" fill="#e35d6a" opacity="0.45" />
      <ellipse cx="22" cy="53" rx="5" ry="2.4" fill="#249e88" />
      <ellipse cx="42" cy="53" rx="5" ry="2.4" fill="#249e88" />
    </svg>
  )
}

export function BrandMark({
  size = 'md',
  withWordmark = true,
  className = '',
  bob = false,
}: BrandMarkProps) {
  if (!withWordmark) {
    return <BrandFrog size={size} bob={bob} className={className} />
  }

  return (
    <span className={['inline-flex items-center gap-2.5 sm:gap-3', className].join(' ')}>
      <BrandFrog size={size} bob={bob} />
      <span className="min-w-0">
        <span
          className={[
            'font-display block font-bold leading-[0.95] text-[var(--gold-soft)]',
            TITLE_SIZE[size],
          ].join(' ')}
        >
          Skin Draft
        </span>
        <span
          className={[
            'font-display mt-0.5 block font-semibold uppercase tracking-[0.14em] text-[var(--teal-soft)]',
            size === 'hero' ? 'text-base sm:text-lg' : 'text-[0.7rem] sm:text-xs',
          ].join(' ')}
        >
          LoL
        </span>
      </span>
    </span>
  )
}
