import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import { SkinCard } from '../components/SkinCard'
import { RequireAuth } from '../components/RequireAuth'
import { useAuth } from '../contexts/AuthContext'
import { formatError } from '../lib/format'
import { supabase } from '../lib/supabase'
import type { Skin, SkinTheme } from '../lib/types'

const PAGE_SIZE = 48

function CollectionInner() {
  const { user } = useAuth()
  const [skins, setSkins] = useState<Skin[]>([])
  const [ownedIds, setOwnedIds] = useState<Set<string>>(new Set())
  const [themes, setThemes] = useState<SkinTheme[]>([])
  const [query, setQuery] = useState('')
  const [deferredQuery, setDeferredQuery] = useState('')
  const [themeFilter, setThemeFilter] = useState('')
  const [ownedOnly, setOwnedOnly] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [toggling, setToggling] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const [total, setTotal] = useState(0)
  const [, startTransition] = useTransition()

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
  }, [user])

  const loadCatalog = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      let skinQuery = supabase
        .from('skins')
        .select('*, champions(id, name, key, image_url)', { count: 'exact' })
        .eq('is_available', true)
        .order('name')
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)

      if (deferredQuery.trim()) {
        skinQuery = skinQuery.or(
          `name.ilike.%${deferredQuery.trim()}%,champion_id.ilike.%${deferredQuery.trim()}%`,
        )
      }

      if (themeFilter) {
        const { data: members, error: memberError } = await supabase
          .from('skin_theme_members')
          .select('skin_id')
          .eq('theme_id', themeFilter)

        if (memberError) throw memberError
        const ids = (members ?? []).map((m) => m.skin_id)
        if (ids.length === 0) {
          setSkins([])
          setTotal(0)
          setLoading(false)
          return
        }
        skinQuery = skinQuery.in('id', ids)
      }

      const { data, error: skinError, count } = await skinQuery
      if (skinError) throw skinError

      let rows = (data ?? []) as Skin[]
      if (ownedOnly) {
        rows = rows.filter((s) => ownedIds.has(s.id))
      }

      setSkins(rows)
      setTotal(count ?? rows.length)
    } catch (err) {
      setError(formatError(err))
    } finally {
      setLoading(false)
    }
  }, [deferredQuery, themeFilter, page, ownedOnly, ownedIds])

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
  }, [deferredQuery, themeFilter, ownedOnly])

  async function toggleSkin(skinId: string) {
    if (!user) return
    setToggling(skinId)
    setError(null)
    const owned = ownedIds.has(skinId)
    try {
      if (owned) {
        const { error: delError } = await supabase
          .from('user_skins')
          .delete()
          .eq('user_id', user.id)
          .eq('skin_id', skinId)
        if (delError) throw delError
        setOwnedIds((prev) => {
          const next = new Set(prev)
          next.delete(skinId)
          return next
        })
      } else {
        const { error: insError } = await supabase.from('user_skins').insert({
          user_id: user.id,
          skin_id: skinId,
        })
        if (insError) throw insError
        setOwnedIds((prev) => new Set(prev).add(skinId))
      }
    } catch (err) {
      setError(formatError(err))
    } finally {
      setToggling(null)
    }
  }

  const ownedCount = ownedIds.size
  const pageCount = useMemo(() => Math.max(1, Math.ceil(total / PAGE_SIZE)), [total])

  return (
    <div className="animate-fade-up">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl sm:text-4xl">Minha coleção</h1>
          <p className="mt-1 text-[var(--text-muted)]">
            Clique na skin para marcar ou desmarcar. {ownedCount} cadastrada
            {ownedCount === 1 ? '' : 's'}.
          </p>
        </div>
      </div>

      <div className="mb-5 flex flex-wrap gap-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar campeão ou skin…"
          className="min-w-[220px] flex-1 rounded-md border border-[var(--line)] bg-[var(--panel)] px-3 py-2 outline-none focus:border-[var(--teal)]"
        />
        <select
          value={themeFilter}
          onChange={(e) => setThemeFilter(e.target.value)}
          className="rounded-md border border-[var(--line)] bg-[var(--panel)] px-3 py-2 outline-none focus:border-[var(--teal)]"
        >
          <option value="">Todos os temas</option>
          {themes.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 rounded-md border border-[var(--line)] bg-[var(--panel)] px-3 py-2 text-sm">
          <input
            type="checkbox"
            checked={ownedOnly}
            onChange={(e) => setOwnedOnly(e.target.checked)}
          />
          Só possuídas
        </label>
      </div>

      {error ? <p className="mb-4 text-sm text-[var(--danger)]">{error}</p> : null}

      {loading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="skeleton aspect-[3/4] rounded-[var(--radius)]" />
          ))}
        </div>
      ) : skins.length === 0 ? (
        <div className="rounded-[var(--radius)] border border-[var(--line)] bg-[var(--panel)] p-8 text-center">
          <p className="text-[var(--text-muted)]">
            Nenhuma skin encontrada. Importe o catálogo com o script{' '}
            <code className="text-[var(--gold-soft)]">npm run import:catalog</code>.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {skins.map((skin) => (
              <SkinCard
                key={skin.id}
                skin={skin}
                owned={ownedIds.has(skin.id)}
                busy={toggling === skin.id}
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
