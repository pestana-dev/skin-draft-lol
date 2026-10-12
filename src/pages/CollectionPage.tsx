import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react'
import { SkinCard } from '../components/SkinCard'
import { RequireAuth } from '../components/RequireAuth'
import { useAuth } from '../contexts/AuthContext'
import { formatError } from '../lib/format'
import { supabase } from '../lib/supabase'
import type { Skin, SkinTheme } from '../lib/types'

const PAGE_SIZE = 48

type ViewMode = 'all' | 'owned'

function CollectionInner() {
  const { user } = useAuth()
  const [skins, setSkins] = useState<Skin[]>([])
  const [ownedIds, setOwnedIds] = useState<Set<string>>(new Set())
  const [themes, setThemes] = useState<SkinTheme[]>([])
  const [query, setQuery] = useState('')
  const [deferredQuery, setDeferredQuery] = useState('')
  const [themeFilter, setThemeFilter] = useState('')
  const [view, setView] = useState<ViewMode>('all')
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
    if (!user) return
    const { data, error: ownedError } = await supabase
      .from('user_skins')
      .select('skin_id')
      .eq('user_id', user.id)

    if (ownedError) throw ownedError
    setOwnedIds(new Set((data ?? []).map((r) => r.skin_id)))
    setOwnedReady(true)
  }, [user])

  const loadCatalog = useCallback(async () => {
    if (!ownedReady || !user) return

    const requestId = ++requestIdRef.current
    const hasContent = skins.length > 0
    // Só troca para skeleton na primeira carga / quando a grade está vazia
    if (!hasContent) setLoading(true)
    setError(null)

    try {
      if (view === 'owned') {
        const currentOwned = ownedIdsRef.current
        if (currentOwned.size === 0) {
          if (requestId !== requestIdRef.current) return
          setSkins([])
          setTotal(0)
          return
        }

        let ownedQuery = supabase
          .from('user_skins')
          .select('skin_id, skins!inner(*, champions(*))', {
            count: 'exact',
          })
          .eq('user_id', user.id)
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
    // skins.length propositalmente fora das deps — só evita skeleton se já há grade
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownedReady, view, user, deferredQuery, themeFilter, page])

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

  async function toggleSkin(skinId: string) {
    if (!user) return
    setError(null)
    const owned = ownedIds.has(skinId)

    // Atualização otimista — sem reload da grade
    setOwnedIds((prev) => {
      const next = new Set(prev)
      if (owned) next.delete(skinId)
      else next.add(skinId)
      return next
    })
    if (owned && view === 'owned') {
      setSkins((prev) => prev.filter((s) => s.id !== skinId))
      setTotal((t) => Math.max(0, t - 1))
    }

    try {
      if (owned) {
        const { error: delError } = await supabase
          .from('user_skins')
          .delete()
          .eq('user_id', user.id)
          .eq('skin_id', skinId)
        if (delError) throw delError
      } else {
        const { error: insError } = await supabase.from('user_skins').insert({
          user_id: user.id,
          skin_id: skinId,
        })
        if (insError) throw insError
      }
    } catch (err) {
      // Reverte se falhar
      setOwnedIds((prev) => {
        const next = new Set(prev)
        if (owned) next.add(skinId)
        else next.delete(skinId)
        return next
      })
      if (owned && view === 'owned') {
        void loadCatalog()
      }
      setError(formatError(err))
    }
  }

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
      <div className="mb-5">
        <h1 className="font-display text-3xl sm:text-4xl">Minha coleção</h1>
        <p className="mt-1 text-[var(--text-muted)]">
          Clique para marcar. Skins selecionadas ficam coloridas com ✓.
        </p>
      </div>

      <div className="sticky top-0 z-20 -mx-4 mb-5 border-b border-[var(--line)] bg-[var(--ink)]/90 px-4 py-3 backdrop-blur-md sm:-mx-6 sm:px-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex rounded-md border border-[var(--line)] bg-[var(--panel)] p-1">
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
          </div>

          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar campeão ou skin…"
            className="min-w-[180px] flex-1 rounded-md border border-[var(--line)] bg-[var(--panel)] px-3 py-2 text-sm outline-none focus:border-[var(--teal)]"
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
            <>Mostrando só as que você marcou · {total} no filtro atual</>
          ) : (
            <>
              {ownedOnPage > 0
                ? `${ownedOnPage} selecionada${ownedOnPage === 1 ? '' : 's'} nesta página · `
                : null}
              {total} no catálogo filtrado · {ownedCount} na sua coleção
            </>
          )}
        </p>
      </div>

      {error ? <p className="mb-4 text-sm text-[var(--danger)]">{error}</p> : null}

      {showSkeleton ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="skeleton aspect-[3/4] rounded-[var(--radius)]" />
          ))}
        </div>
      ) : skins.length === 0 ? (
        <div className="rounded-[var(--radius)] border border-[var(--line)] bg-[var(--panel)] p-8 text-center">
          {view === 'owned' ? (
            <>
              <p className="text-[var(--text-muted)]">
                Você ainda não marcou nenhuma skin
                {deferredQuery || themeFilter ? ' com esse filtro' : ''}.
              </p>
              <button
                type="button"
                onClick={() => {
                  setView('all')
                  setQuery('')
                  setThemeFilter('')
                }}
                className="mt-4 rounded-md bg-[var(--gold)] px-4 py-2 text-sm font-semibold text-[var(--ink)]"
              >
                Ir ao catálogo
              </button>
            </>
          ) : (
            <p className="text-[var(--text-muted)]">
              Nenhuma skin encontrada. Importe o catálogo com{' '}
              <code className="text-[var(--gold-soft)]">npm run import:catalog</code>.
            </p>
          )}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {skins.map((skin) => (
              <SkinCard
                key={skin.id}
                skin={skin}
                owned={ownedIds.has(skin.id)}
                onToggle={() => void toggleSkin(skin.id)}
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

export function CollectionPage() {
  return (
    <RequireAuth>
      <CollectionInner />
    </RequireAuth>
  )
}
