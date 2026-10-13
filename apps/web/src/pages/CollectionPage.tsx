import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react'
import { Link } from 'react-router-dom'
import { SkinCard } from '../components/SkinCard'
import { usePlayer } from '../contexts/PlayerContext'
import { formatError } from '../lib/format'
import { supabase } from '../lib/supabase'
import type { Skin, SkinTheme } from '../lib/types'

const PAGE_SIZE = 64

type ViewMode = 'all' | 'owned'

export function CollectionPage() {
  const { me, isDesktop, syncing, syncInventory } = usePlayer()
  const [skins, setSkins] = useState<Skin[]>([])
  const [ownedIds, setOwnedIds] = useState<Set<string>>(new Set())
  const [themes, setThemes] = useState<SkinTheme[]>([])
  const [query, setQuery] = useState('')
  const [deferredQuery, setDeferredQuery] = useState('')
  const [themeFilter, setThemeFilter] = useState('')
  const [view, setView] = useState<ViewMode>('owned')
  const [loading, setLoading] = useState(true)
  const [ownedReady, setOwnedReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const [total, setTotal] = useState(0)
  const [, startTransition] = useTransition()

  const ownedIdsRef = useRef(ownedIds)
  ownedIdsRef.current = ownedIds
  const requestIdRef = useRef(0)

  useEffect(() => {
    const t = window.setTimeout(() => {
      startTransition(() => setDeferredQuery(query))
    }, 200)
    return () => window.clearTimeout(t)
  }, [query])

  const loadOwned = useCallback(async () => {
    if (!me?.id) {
      setOwnedIds(new Set())
      setOwnedReady(true)
      return
    }
    const { data, error: ownedError } = await supabase
      .from('player_skins')
      .select('skin_id')
      .eq('player_id', me.id)

    if (ownedError) throw ownedError
    setOwnedIds(new Set((data ?? []).map((r) => r.skin_id)))
    setOwnedReady(true)
  }, [me?.id])

  const loadCatalog = useCallback(async () => {
    if (!ownedReady) return

    const requestId = ++requestIdRef.current
    const hasContent = skins.length > 0
    if (!hasContent) setLoading(true)
    setError(null)

    try {
      if (view === 'owned') {
        const currentOwned = ownedIdsRef.current
        if (currentOwned.size === 0 || !me?.id) {
          if (requestId !== requestIdRef.current) return
          setSkins([])
          setTotal(0)
          return
        }

        let ownedQuery = supabase
          .from('player_skins')
          .select('skin_id, skins!inner(*, champions(*))', {
            count: 'exact',
          })
          .eq('player_id', me.id)
          .order('name', { referencedTable: 'skins', ascending: true })
          .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)

        if (deferredQuery.trim()) {
          const q = deferredQuery.trim()
          ownedQuery = ownedQuery.or(
            `name.ilike.%${q}%,champion_id.ilike.%${q}%`,
            { referencedTable: 'skins' },
          )
        }

        if (themeFilter) {
          const { data: members, error: memberError } = await supabase
            .from('skin_theme_members')
            .select('skin_id')
            .eq('theme_id', themeFilter)

          if (memberError) throw memberError
          const themeIds = (members ?? []).map((m) => m.skin_id)
          const allowed = themeIds.filter((id) => currentOwned.has(id))
          if (allowed.length === 0) {
            if (requestId !== requestIdRef.current) return
            setSkins([])
            setTotal(0)
            return
          }
          ownedQuery = ownedQuery.in('skin_id', allowed)
        }

        const { data, error: ownedError, count } = await ownedQuery
        if (ownedError) throw ownedError
        if (requestId !== requestIdRef.current) return

        const rows = (data ?? [])
          .map((row) => row.skins as unknown as Skin)
          .filter(Boolean)

        setSkins(rows)
        setTotal(count ?? rows.length)
        return
      }

      let skinQuery = supabase
        .from('skins')
        .select('*, champions(id, name, key, image_url)', { count: 'exact' })
        .eq('is_available', true)
        .order('name')
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)

      if (deferredQuery.trim()) {
        const q = deferredQuery.trim()
        skinQuery = skinQuery.or(`name.ilike.%${q}%,champion_id.ilike.%${q}%`)
      }

      if (themeFilter) {
        const { data: members, error: memberError } = await supabase
          .from('skin_theme_members')
          .select('skin_id')
          .eq('theme_id', themeFilter)

        if (memberError) throw memberError
        const ids = (members ?? []).map((m) => m.skin_id)
        if (ids.length === 0) {
          if (requestId !== requestIdRef.current) return
          setSkins([])
          setTotal(0)
          return
        }
        skinQuery = skinQuery.in('id', ids)
      }

      const { data, error: skinError, count } = await skinQuery
      if (skinError) throw skinError
      if (requestId !== requestIdRef.current) return

      setSkins((data ?? []) as Skin[])
      setTotal(count ?? (data ?? []).length)
    } catch (err) {
      if (requestId !== requestIdRef.current) return
      setError(formatError(err))
    } finally {
      if (requestId === requestIdRef.current) setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownedReady, view, me?.id, deferredQuery, themeFilter, page])

  useEffect(() => {
    void loadOwned().catch((err) => setError(formatError(err)))
    void supabase
      .from('skin_themes')
      .select('*')
      .order('name')
      .then(({ data }) => setThemes(data ?? []))
  }, [loadOwned])

  useEffect(() => {
    void loadCatalog()
  }, [loadCatalog])

  useEffect(() => {
    setPage(0)
  }, [deferredQuery, themeFilter, view])

  const ownedCount = ownedIds.size
  const pageCount = useMemo(
    () => Math.max(1, Math.ceil(total / PAGE_SIZE)),
    [total],
  )
  const ownedOnPage = useMemo(
    () => skins.filter((s) => ownedIds.has(s.id)).length,
    [skins, ownedIds],
  )

  const showSkeleton = (loading || !ownedReady) && skins.length === 0

  return (
    <div className="animate-fade-up">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl sm:text-4xl">Minha coleção</h1>
          <p className="mt-1 text-[var(--text-muted)]">Sua coleção do LoL.</p>
        </div>
        {isDesktop ? (
          <button
            type="button"
            disabled={syncing}
            onClick={() =>
              void syncInventory()
                .then(() => loadOwned())
                .then(() => loadCatalog())
                .catch((err) => setError(formatError(err)))
            }
            className="rounded-md bg-[var(--gold)] px-4 py-2 text-sm font-semibold text-[var(--ink)] disabled:opacity-50"
          >
            {syncing ? 'Sincronizando…' : 'Sincronizar do LoL'}
          </button>
        ) : (
          <Link to="/" className="text-sm text-[var(--teal-soft)]">
            Abra o app de PC
          </Link>
        )}
      </div>

      <div className="sticky top-0 z-20 -mx-4 mb-4 border-b border-[var(--line)] bg-[var(--ink)]/90 px-4 py-3 backdrop-blur-md sm:-mx-6 sm:px-6">
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <div className="flex rounded-md border border-[var(--line)] bg-[var(--panel)] p-1">
            <button
              type="button"
              onClick={() => setView('owned')}
              className={[
                'rounded px-3 py-1.5 text-sm font-medium transition',
                view === 'owned'
                  ? 'bg-[var(--teal)] text-[var(--ink)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text)]',
              ].join(' ')}
            >
              Minhas skins
              <span className="ml-1.5 tabular-nums opacity-80">{ownedCount}</span>
            </button>
            <button
              type="button"
              onClick={() => setView('all')}
              className={[
                'rounded px-3 py-1.5 text-sm font-medium transition',
                view === 'all'
                  ? 'bg-[var(--panel-elevated)] text-[var(--gold-soft)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text)]',
              ].join(' ')}
            >
              Catálogo
            </button>
          </div>

          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar campeão ou skin…"
            className="min-w-[160px] flex-1 rounded-md border border-[var(--line)] bg-[var(--panel)] px-3 py-2 text-sm outline-none focus:border-[var(--teal)]"
          />

          <select
            value={themeFilter}
            onChange={(e) => setThemeFilter(e.target.value)}
            className="rounded-md border border-[var(--line)] bg-[var(--panel)] px-3 py-2 text-sm outline-none focus:border-[var(--teal)]"
          >
            <option value="">Todos os temas</option>
            {themes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>

        <p className="mt-2 text-xs text-[var(--text-muted)]">
          {view === 'owned' ? (
            <>{total} skins sincronizadas no filtro atual</>
          ) : (
            <>
              {ownedOnPage > 0
                ? `${ownedOnPage} suas nesta página · `
                : null}
              {total} no catálogo · {ownedCount} na sua coleção
            </>
          )}
        </p>
      </div>

      {error ? <p className="mb-4 text-sm text-[var(--danger)]">{error}</p> : null}

      {!me?.id && isDesktop ? (
        <p className="mb-4 text-sm text-[var(--text-muted)]">
          Abra o LoL para sincronizar.
        </p>
      ) : null}

      {showSkeleton ? (
        <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7 xl:grid-cols-8">
          {Array.from({ length: 16 }).map((_, i) => (
            <div key={i} className="skeleton aspect-[3/5] rounded-md" />
          ))}
        </div>
      ) : skins.length === 0 ? (
        <div className="rounded-[var(--radius)] border border-[var(--line)] bg-[var(--panel)] p-8 text-center">
          <p className="text-[var(--text-muted)]">
            {view === 'owned'
              ? 'Nenhuma skin sincronizada ainda.'
              : 'Nenhuma skin no catálogo.'}
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7 xl:grid-cols-8">
            {skins.map((skin) => (
              <SkinCard
                key={skin.id}
                skin={skin}
                owned={view === 'owned' || ownedIds.has(skin.id)}
                compact
              />
            ))}
          </div>

          <div className="mt-6 flex items-center justify-center gap-3">
            <button
              type="button"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="rounded-md border border-[var(--line)] px-3 py-1.5 text-sm disabled:opacity-40"
            >
              Anterior
            </button>
            <span className="text-sm text-[var(--text-muted)]">
              {page + 1} / {pageCount}
            </span>
            <button
              type="button"
              disabled={page + 1 >= pageCount}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-md border border-[var(--line)] px-3 py-1.5 text-sm disabled:opacity-40"
            >
              Próxima
            </button>
          </div>
        </>
      )}
    </div>
  )
}
