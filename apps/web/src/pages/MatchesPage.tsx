import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AramPool } from '../components/AramPool'
import { usePlayer } from '../contexts/PlayerContext'
import {
  useLiveChampSelectPicks,
  type LivePick,
} from '../hooks/useLiveChampSelectPicks'
import {
  useRoomMatches,
  type LobbyParticipant,
} from '../hooks/useRoomMatches'
import { collectionSyncLabel, formatError, matchSizeLabel } from '../lib/format'
import {
  championRoleLabels,
  coversOpenRole,
  isFlexibleRole,
  matchedPlayerRole,
  openLaneRoles,
  queueLabel,
  roleFitScore,
  roleLabel,
  sortChampionsByRole,
  suggestAramAssignment,
  suggestAssignmentAroundChampion,
  suggestRoleAwareAssignment,
  type LaneRole,
} from '../lib/matchFeasibility'
import {
  buildMatchGroups,
  collectAnchorOptions,
  type AnchorOption,
  type LineupSlot,
  type MatchGroup,
} from '../lib/matchGroups'
import { resolveQueueKind } from '../lib/resolveQueueKind'
import { supabase } from '../lib/supabase'
import type { Champion, ThemeMatch, ThemeMatchPlayer } from '../lib/types'

function syncBadge(p: LobbyParticipant) {
  const count = p.player?.skin_count ?? 0
  if (!count) return 'Coleção ainda não salva'
  return collectionSyncLabel(p.player?.last_inventory_sync_at, count)
}

export function MatchesPage() {
  const { roomId } = useParams<{ roomId: string }>()
  const {
    me,
    lcu,
    isDesktop,
    pickInClient,
    syncParty,
    lastInventorySyncAt,
  } = usePlayer()
  const champSelect = lcu?.champSelect ?? null
  const inChampSelect = Boolean(champSelect) || Boolean(lcu?.party?.inChampSelect)
  const canPick = isDesktop && inChampSelect

  const { room, participants, data, error, setError, loading, refreshRoom } =
    useRoomMatches(roomId)

  const {
    championsByKey,
    skinMetaByLcuId,
    livePicksByPlayer,
    activePicks,
    takenChampions,
    lockedAramPicks,
    lockedAramPicksKey,
  } = useLiveChampSelectPicks({
    champSelect,
    participants,
    mePuuid: me?.puuid,
    onError: (msg) => setError(msg),
  })

  const [aramChampions, setAramChampions] = useState<Champion[]>([])
  const [busy, setBusy] = useState(false)
  const [picking, setPicking] = useState(false)
  const [anchorQuery, setAnchorQuery] = useState('')
  const [anchorChampionId, setAnchorChampionId] = useState<string | null>(null)
  const [anchorPlayerId, setAnchorPlayerId] = useState<string | null>(null)
  const [anchorOpen, setAnchorOpen] = useState(false)
  const assignmentCacheRef = useRef(
    new Map<string, Record<string, string> | null>(),
  )
  const assignmentCacheKeyRef = useRef('')

  const isHost = Boolean(room?.host_id && room.host_id === me?.id)
  const aramPool = room?.settings?.aram_pool ?? []
  const aramPoolKey = aramPool.join('|')

  useEffect(() => {
    if (championsByKey.size === 0 || !aramPoolKey) {
      setAramChampions([])
      return
    }
    const poolSet = new Set(aramPoolKey.split('|').filter(Boolean))
    const aramList: Champion[] = []
    for (const c of championsByKey.values()) {
      if (poolSet.has(c.id)) aramList.push(c)
    }
    aramList.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
    setAramChampions(aramList)
  }, [aramPoolKey, championsByKey])

  // Recarrega combinações após sync de inventário
  const lastHandledInventoryRef = useRef<number | null>(null)
  useEffect(() => {
    if (!roomId || !lastInventorySyncAt) return
    if (lastHandledInventoryRef.current === lastInventorySyncAt) return
    lastHandledInventoryRef.current = lastInventorySyncAt
    void refreshRoom({ quiet: true }).catch(() => undefined)
  }, [roomId, lastInventorySyncAt, refreshRoom])

  async function clearAramPool() {
    if (!room) return
    setBusy(true)
    setError(null)
    try {
      const { error: rpcError } = await supabase.rpc('update_aram_pool', {
        p_code: room.code,
        p_champion_ids: [],
      })
      if (rpcError) throw rpcError
      await refreshRoom({ quiet: true })
    } catch (err) {
      setError(formatError(err))
    } finally {
      setBusy(false)
    }
  }

  async function pickSkin(skinId: string) {
    if (!canPick || picking) return
    setPicking(true)
    setError(null)
    try {
      // Cache: skin já mapeada via select (LCU id)
      for (const [lcuId, meta] of skinMetaByLcuId) {
        if (meta.id !== skinId) continue
        const championKey = Math.floor(lcuId / 1000)
        if (championKey > 0) {
          await pickInClient(championKey, lcuId)
          return
        }
      }
      const { data: skin, error: skinError } = await supabase
        .from('skins')
        .select('id, num, champions(key)')
        .eq('id', skinId)
        .single()
      if (skinError) throw skinError
      const champ = skin.champions as { key?: string | null } | null
      const championKey = Number(champ?.key)
      const skinNum = Number(skin.num ?? 0)
      if (!Number.isFinite(championKey) || championKey <= 0) {
        throw new Error('Campeão sem key Riot — sincronize o catálogo')
      }
      const lcuSkinId =
        championKey * 1000 + (Number.isFinite(skinNum) ? skinNum : 0)
      await pickInClient(championKey, lcuSkinId)
    } catch (err) {
      setError(formatError(err))
    } finally {
      setPicking(false)
    }
  }

  const localLivePick = me?.id ? livePicksByPlayer[me.id] ?? null : null
  const teamReady =
    inChampSelect &&
    participants.length >= 2 &&
    participants.every((p) => {
      const pick = livePicksByPlayer[p.player_id]
      return Boolean(pick && !pick.is_intent && pick.lcu_champion_id > 0)
    })

  const matches = data?.matches ?? []
  const total = data?.participant_total ?? participants.length
  const queueKind = resolveQueueKind({
    lcuQueueKind: lcu?.party?.queueKind,
    partyId: lcu?.party?.partyId,
    queueId: lcu?.party?.queueId ?? null,
    inChampSelect: Boolean(lcu?.party?.inChampSelect),
    benchEnabled: Boolean(champSelect?.benchEnabled),
    dataQueueKind: data?.queue_kind,
    roomQueueKind: room?.settings?.queue_kind,
  })
  const isSr = queueKind === 'sr'
  const isAram = queueKind === 'aram'
  const filterAram = isAram && Boolean(data?.filter_aram)
  const showAramPool =
    isAram &&
    (filterAram || aramPool.length > 0 || Boolean(champSelect?.benchEnabled))
  const showRoles = isSr

  const allAnchorOptions = useMemo(
    () => collectAnchorOptions(matches),
    [matches],
  )
  const anchorSelected = useMemo(() => {
    if (!anchorChampionId || !anchorPlayerId) return null
    return (
      allAnchorOptions.find(
        (o) =>
          o.champion_id === anchorChampionId &&
          o.player_id === anchorPlayerId,
      ) ?? null
    )
  }, [allAnchorOptions, anchorChampionId, anchorPlayerId])
  const filteredAnchorOptions = useMemo(() => {
    const q = anchorQuery.trim().toLowerCase()
    if (!q) return allAnchorOptions.slice(0, 14)
    return allAnchorOptions
      .filter(
        (o) =>
          o.champion_name.toLowerCase().includes(q) ||
          o.display_name.toLowerCase().includes(q),
      )
      .slice(0, 14)
  }, [anchorQuery, allAnchorOptions])

  const matchGroups = useMemo((): MatchGroup[] => {
    if (assignmentCacheKeyRef.current !== lockedAramPicksKey) {
      assignmentCacheRef.current = new Map()
      assignmentCacheKeyRef.current = lockedAramPicksKey
    }
    return buildMatchGroups({
      matches,
      showRoles,
      isAram,
      anchorChampionId,
      anchorPlayerId,
      lockedAramPicks,
      lockedAramPicksKey,
      assignmentCache: assignmentCacheRef.current,
    })
  }, [
    matches,
    showRoles,
    isAram,
    anchorChampionId,
    anchorPlayerId,
    lockedAramPicks,
    lockedAramPicksKey,
  ])

  const anchoredMatchCount = useMemo(
    () => matchGroups.reduce((n, g) => n + g.items.length, 0),
    [matchGroups],
  )

  useEffect(() => {
    if (!showRoles && (anchorChampionId || anchorPlayerId)) {
      setAnchorChampionId(null)
      setAnchorPlayerId(null)
      setAnchorQuery('')
    }
  }, [showRoles, anchorChampionId, anchorPlayerId])

  // LCU em SR com sala ainda suja de ARAM → re-sync e recarrega combinações
  useEffect(() => {
    if (!isDesktop || !roomId || lcu?.party?.queueKind !== 'sr') return
    const staleAram =
      room?.settings?.queue_kind === 'aram' ||
      (room?.settings?.aram_pool?.length ?? 0) > 0 ||
      data?.filter_aram === true ||
      data?.queue_kind === 'aram'
    if (!staleAram) return
    let cancelled = false
    void syncParty()
      .then(() => {
        if (!cancelled) return refreshRoom({ quiet: true })
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [
    isDesktop,
    roomId,
    lcu?.party?.queueKind,
    room?.settings?.queue_kind,
    room?.settings?.aram_pool,
    data?.filter_aram,
    data?.queue_kind,
    syncParty,
    refreshRoom,
  ])

  if (loading && !room) {
    return <p className="text-[var(--text-muted)]">Montando o party…</p>
  }

  if (error && !room) {
    return (
      <div className="rounded-[var(--radius)] border border-[var(--line)] bg-[var(--panel)] p-6">
        <h1 className="font-display text-2xl">Não foi possível abrir a sala</h1>
        <p className="mt-2 text-sm text-[var(--danger)]">{error}</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void refreshRoom()}
            className="rounded-md bg-[var(--gold)] px-4 py-2 text-sm font-semibold text-[var(--ink)]"
          >
            Tentar de novo
          </button>
          <Link to="/" className="text-sm text-[var(--teal-soft)]">
            Voltar ao início
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="animate-fade-up">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--teal-soft)]">
            {queueLabel(queueKind)}
            {filterAram ? ' · filtrado pelo pool' : ''}
          </p>
          <h1 className="font-display text-3xl sm:text-4xl">Combinações</h1>
          <p className="mt-1 max-w-2xl text-[var(--text-muted)]">
            {canPick
              ? 'Clique na skin — o pick vai para o League Client. Aqui só espelhamos a select ao vivo.'
              : inChampSelect
                ? 'Select aberta no client — espelhando escolhas do time.'
                : 'Só combinações possíveis. Entre na select do LoL para pickar pelo Skin Draft.'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refreshRoom()}
          disabled={loading || busy || picking}
          className="rounded-md border border-[var(--line-strong)] px-4 py-2 text-sm disabled:opacity-50"
        >
          {loading ? 'Atualizando…' : 'Atualizar'}
        </button>
      </div>

      <PartyStrip
        participants={participants}
        hostId={room?.host_id ?? null}
        meId={me?.id ?? null}
        picks={livePicksByPlayer}
        inChampSelect={inChampSelect}
      />

      {activePicks.length > 0 ? (
        <PicksBar picks={activePicks} meId={me?.id ?? null} />
      ) : null}

      {teamReady ? (
        <div className="animate-fade-up-delay mt-4 rounded-[var(--radius)] border border-[var(--gold)]/40 bg-[var(--gold)]/10 px-4 py-3">
          <p className="font-display text-lg text-[var(--gold-soft)]">
            Time com campeões na select
          </p>
          <p className="mt-0.5 text-sm text-[var(--text-muted)]">
            Espelho do client — confirme o lock no League of Legends.
          </p>
        </div>
      ) : null}

      {showAramPool ? (
        <div className="mt-5">
          <AramPool
            champions={aramChampions}
            syncedAt={room?.settings?.aram_synced_at}
            isHost={isHost}
            busy={busy}
            onClear={() => void clearAramPool()}
          />
        </div>
      ) : null}

      {error ? (
        <p className="mt-4 text-sm text-[var(--danger)]">{error}</p>
      ) : null}

      {showRoles ? (
        <ChampionAnchorBar
          query={anchorQuery}
          onQueryChange={setAnchorQuery}
          open={anchorOpen}
          onOpenChange={setAnchorOpen}
          options={filteredAnchorOptions}
          selected={anchorSelected}
          onSelect={(opt) => {
            setAnchorChampionId(opt.champion_id)
            setAnchorPlayerId(opt.player_id)
            setAnchorQuery('')
            setAnchorOpen(false)
          }}
          onClear={() => {
            setAnchorChampionId(null)
            setAnchorPlayerId(null)
            setAnchorQuery('')
          }}
        />
      ) : null}

      <div className="mt-6">
        {loading && !data ? (
          <p className="text-[var(--text-muted)]">Analisando coleções…</p>
        ) : participants.length < 2 ? (
          <div className="rounded-[var(--radius)] border border-dashed border-[var(--line)] bg-[var(--panel)]/50 px-6 py-10 text-center">
            <p className="text-[var(--text-muted)]">
              Aguarde o party — precisa de pelo menos 2 pessoas.
            </p>
          </div>
        ) : matches.length === 0 ? (
          <div className="rounded-[var(--radius)] border border-[var(--line)] bg-[var(--panel)] p-8 text-center">
            <p className="text-[var(--text-muted)]">
              Nenhuma combinação possível sem conflito de campeão.
              {filterAram
                ? ' Ajuste o party ou sincronize as coleções.'
                : ' Sincronize as coleções do party.'}
            </p>
            <Link
              to="/collection"
              className="mt-4 inline-block text-[var(--teal-soft)]"
            >
              Ir à coleção
            </Link>
          </div>
        ) : anchoredMatchCount === 0 &&
          anchorChampionId &&
          anchorPlayerId ? (
          <div className="rounded-[var(--radius)] border border-[var(--line)] bg-[var(--panel)] p-8 text-center">
            <p className="text-[var(--text-muted)]">
              Nenhum tema fecha o time com{' '}
              {anchorSelected?.champion_name ?? 'esse campeão'} para{' '}
              {anchorSelected?.display_name ?? 'essa pessoa'}.
            </p>
            <button
              type="button"
              onClick={() => {
                setAnchorChampionId(null)
                setAnchorPlayerId(null)
                setAnchorQuery('')
              }}
              className="mt-4 text-sm text-[var(--teal-soft)] hover:underline"
            >
              Limpar busca
            </button>
          </div>
        ) : (
          <div className="space-y-5">
            {matchGroups.map((group, groupIndex) => {
              const anchored = Boolean(group.lineup)
              return (
                <section key={group.key} className="space-y-3">
                  {group.lineup ? (
                    <LineupBanner
                      lineup={group.lineup}
                      themeCount={group.items.length}
                      index={groupIndex + 1}
                      lockHits={group.lockHits}
                    />
                  ) : null}
                  <div
                    className={
                      anchored ? 'space-y-3 pl-0 sm:pl-2' : 'space-y-5'
                    }
                  >
                    {group.items.map(({ match, assignment, lockHits }, index) => (
                      <MatchCard
                        key={match.theme_id}
                        match={match}
                        total={total}
                        rank={
                          isAram
                            ? groupIndex + 1
                            : anchored
                              ? index + 1
                              : groupIndex + 1
                        }
                        showRoles={showRoles}
                        anchorChampionId={
                          showRoles ? anchorChampionId : null
                        }
                        anchorPlayerId={showRoles ? anchorPlayerId : null}
                        pickHits={isAram ? (lockHits ?? 0) : 0}
                        lockedPicks={isAram ? lockedAramPicks : null}
                        fixedAssignment={assignment}
                        canPick={canPick}
                        meId={me?.id ?? null}
                        picks={livePicksByPlayer}
                        localPick={localLivePick}
                        takenChampions={takenChampions}
                        picking={picking}
                        onPick={(skinId) => void pickSkin(skinId)}
                      />
                    ))}
                  </div>
                </section>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function PartyStrip({
  participants,
  hostId,
  meId,
  picks,
  inChampSelect,
}: {
  participants: LobbyParticipant[]
  hostId: string | null
  meId: string | null
  picks: Record<string, LivePick>
  inChampSelect: boolean
}) {
  if (participants.length === 0) {
    return (
      <p className="text-sm text-[var(--text-muted)]">Ninguém na sala ainda.</p>
    )
  }

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
          {inChampSelect ? 'Select ao vivo' : 'No party'}
        </p>
        <p className="text-xs text-[var(--text-muted)]">
          {participants.length}{' '}
          {participants.length === 1 ? 'jogador' : 'jogadores'}
        </p>
      </div>
      <ul className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:thin]">
        {participants.map((p, index) => {
          const pid = p.player_id
          const name = p.player?.display_name ?? 'Jogador'
          const initial = name.trim().charAt(0).toUpperCase() || '?'
          const pick = picks[pid]
          return (
            <li
              key={pid}
              className="animate-fade-up flex min-w-[9.5rem] max-w-[12rem] shrink-0 items-center gap-2.5 rounded-md border border-[var(--line)] bg-[var(--ink-soft)]/90 px-2.5 py-2"
              style={{ animationDelay: `${index * 0.05}s` }}
            >
              <span
                className={[
                  'relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-display text-sm font-bold',
                  pid === meId
                    ? 'bg-[var(--teal)]/25 text-[var(--teal-soft)] ring-1 ring-[var(--teal)]/50'
                    : 'bg-[var(--panel-elevated)] text-[var(--gold-soft)]',
                ].join(' ')}
              >
                {pick?.tile_url || pick?.splash_url || pick?.champion_image_url ? (
                  <img
                    src={
                      pick.tile_url ||
                      pick.splash_url ||
                      pick.champion_image_url ||
                      ''
                    }
                    alt=""
                    className="h-full w-full rounded-full object-cover object-top"
                  />
                ) : (
                  initial
                )}
                {pick ? (
                  <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-[var(--teal)] ring-2 ring-[var(--ink-soft)]" />
                ) : null}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 truncate text-sm font-medium text-[var(--text-strong)]">
                  <span className="truncate">{name}</span>
                  {pid === hostId ? (
                    <span className="shrink-0 text-[9px] uppercase tracking-wide text-[var(--gold-soft)]">
                      host
                    </span>
                  ) : null}
                </span>
                <span className="block truncate text-[10px] text-[var(--text-muted)]">
                  {pick
                    ? `${pick.champion_name}${pick.is_intent ? ' (hover)' : ''}${
                        pick.skin_id ? ` · ${pick.skin_name}` : ''
                      }`
                    : inChampSelect
                      ? 'sem campeão ainda'
                      : syncBadge(p)}
                </span>
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function PicksBar({
  picks,
  meId,
}: {
  picks: LivePick[]
  meId: string | null
}) {
  return (
    <div className="mt-4">
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
        No client
      </p>
      <ul className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:thin]">
        {picks.map((pick) => (
          <li
            key={pick.player_id}
            className={[
              'flex shrink-0 items-center gap-2 rounded-md border px-2 py-1.5',
              pick.player_id === meId
                ? 'border-[var(--gold)]/50 bg-[var(--gold)]/10'
                : 'border-[var(--line)] bg-[var(--panel)]/70',
            ].join(' ')}
          >
            {(pick.tile_url || pick.splash_url || pick.champion_image_url) && (
              <img
                src={
                  pick.tile_url ||
                  pick.splash_url ||
                  pick.champion_image_url ||
                  ''
                }
                alt=""
                className="h-10 w-10 rounded object-cover object-top"
              />
            )}
            <span className="pr-1">
              <span className="block text-sm font-medium text-[var(--text-strong)]">
                {pick.champion_name}
                {pick.is_intent ? ' · hover' : ''}
              </span>
              <span className="block max-w-[9rem] truncate text-[10px] text-[var(--text-muted)]">
                {pick.skin_id ? pick.skin_name : 'skin padrão / pendente'}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function LineupBanner({
  lineup,
  themeCount,
  index,
  lockHits,
}: {
  lineup: LineupSlot[]
  themeCount: number
  index: number
  lockHits?: number
}) {
  return (
    <div className="rounded-[var(--radius)] border border-[var(--gold)]/30 bg-gradient-to-r from-[var(--gold)]/10 via-[var(--panel)]/80 to-[var(--panel)]/40 px-3 py-3">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--gold-soft)]">
          {lockHits && lockHits > 0
            ? `Select · formação ${index}`
            : `Formação ${index}`}
        </p>
        <p className="text-[11px] text-[var(--text-muted)]">
          {lockHits && lockHits > 0
            ? `${lockHits} pick${lockHits === 1 ? '' : 's'} da select · `
            : ''}
          {themeCount} {themeCount === 1 ? 'tema' : 'temas'}
        </p>
      </div>
      <ul className="flex flex-wrap gap-2">
        {lineup.map((slot) => (
          <li
            key={slot.player_id}
            className={[
              'flex min-w-[7.5rem] items-center gap-2 rounded-md border px-2 py-1.5',
              slot.isAnchor
                ? 'border-[var(--gold)]/55 bg-[var(--gold)]/15'
                : 'border-[var(--line)] bg-[var(--ink-soft)]/70',
            ].join(' ')}
          >
            {slot.champion_image_url ? (
              <img
                src={slot.champion_image_url}
                alt=""
                className="h-8 w-8 rounded object-cover"
              />
            ) : (
              <span className="flex h-8 w-8 items-center justify-center rounded bg-[var(--panel)] text-[10px] text-[var(--text-muted)]">
                ?
              </span>
            )}
            <span className="min-w-0">
              <span className="block truncate text-xs font-medium text-[var(--text-strong)]">
                {slot.champion_name}
              </span>
              <span className="block truncate text-[10px] text-[var(--text-muted)]">
                {slot.display_name}
                {slot.isAnchor ? ' · base' : ''}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function ChampionAnchorBar({
  query,
  onQueryChange,
  open,
  onOpenChange,
  options,
  selected,
  onSelect,
  onClear,
}: {
  query: string
  onQueryChange: (q: string) => void
  open: boolean
  onOpenChange: (open: boolean) => void
  options: AnchorOption[]
  selected: AnchorOption | null
  onSelect: (opt: AnchorOption) => void
  onClear: () => void
}) {
  return (
    <div className="mt-5 rounded-[var(--radius)] border border-[var(--line)] bg-[var(--panel)]/60 px-3 py-2.5">
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
        Campeão + jogador
      </p>
      <div className="relative max-w-xl">
        {selected ? (
          <div className="flex items-center gap-2 rounded-md border border-[var(--gold)]/40 bg-[var(--gold)]/10 px-2 py-1.5">
            {selected.champion_image_url ? (
              <img
                src={selected.champion_image_url}
                alt=""
                className="h-8 w-8 rounded object-cover"
              />
            ) : null}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-[var(--text-strong)]">
                {selected.champion_name}
              </span>
              <span className="block truncate text-[11px] text-[var(--text-muted)]">
                {selected.display_name}
              </span>
            </span>
            <button
              type="button"
              onClick={onClear}
              className="shrink-0 text-[11px] text-[var(--teal-soft)] hover:underline"
            >
              limpar
            </button>
          </div>
        ) : (
          <>
            <input
              type="search"
              value={query}
              onChange={(e) => {
                onQueryChange(e.target.value)
                onOpenChange(true)
              }}
              onFocus={() => onOpenChange(true)}
              onBlur={() => {
                window.setTimeout(() => onOpenChange(false), 120)
              }}
              placeholder="Buscar campeão ou jogador…"
              className="w-full rounded-md border border-[var(--line)] bg-[var(--ink-soft)] px-3 py-1.5 text-sm text-[var(--text-strong)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--gold)]/50"
            />
            {open && options.length > 0 ? (
              <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border border-[var(--line)] bg-[var(--panel)] shadow-lg">
                {options.map((opt) => (
                  <li key={opt.key}>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => onSelect(opt)}
                      className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm hover:bg-[var(--ink-soft)]"
                    >
                      {opt.champion_image_url ? (
                        <img
                          src={opt.champion_image_url}
                          alt=""
                          className="h-7 w-7 rounded object-cover"
                        />
                      ) : null}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[var(--text-strong)]">
                          {opt.champion_name}
                        </span>
                        <span className="block truncate text-[11px] text-[var(--text-muted)]">
                          {opt.display_name}
                          {opt.theme_count > 1
                            ? ` · ${opt.theme_count} temas`
                            : ''}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            {open && query.trim() && options.length === 0 ? (
              <p className="absolute z-20 mt-1 w-full rounded-md border border-[var(--line)] bg-[var(--panel)] px-2.5 py-2 text-xs text-[var(--text-muted)] shadow-lg">
                Nenhuma combinação campeão + jogador
              </p>
            ) : null}
          </>
        )}
      </div>
      <p className="mt-1.5 text-[10px] text-[var(--text-muted)]">
        {selected
          ? 'Temas agrupados pelas formações que fecham com esse campeão nessa pessoa.'
          : 'Escolha quem joga qual campeão para montar as combinações em torno disso.'}
      </p>
    </div>
  )
}

function MatchCard({
  match,
  total,
  rank,
  showRoles,
  anchorChampionId,
  anchorPlayerId,
  pickHits,
  lockedPicks,
  fixedAssignment,
  canPick,
  meId,
  picks,
  localPick,
  takenChampions,
  picking,
  onPick,
}: {
  match: ThemeMatch
  total: number
  rank: number
  showRoles: boolean
  anchorChampionId: string | null
  anchorPlayerId: string | null
  pickHits: number
  lockedPicks: Record<string, string> | null
  fixedAssignment: Record<string, string> | null
  canPick: boolean
  meId: string | null
  picks: Record<string, LivePick>
  localPick: LivePick | null
  takenChampions: Map<string, string>
  picking: boolean
  onPick: (skinId: string) => void
}) {
  const players = match.players ?? []
  const missing = total - match.match_count

  const assignment = useMemo(() => {
    if (fixedAssignment) return fixedAssignment
    try {
      if (showRoles && anchorChampionId && anchorPlayerId) {
        return suggestAssignmentAroundChampion(
          players,
          anchorChampionId,
          anchorPlayerId,
          true,
        )
      }
      return showRoles
        ? suggestRoleAwareAssignment(players)
        : suggestAramAssignment(players, lockedPicks)
    } catch {
      return null
    }
  }, [
    fixedAssignment,
    players,
    showRoles,
    anchorChampionId,
    anchorPlayerId,
    lockedPicks,
  ])

  const openRoles = showRoles ? openLaneRoles(players) : new Set<LaneRole>()
  const optionCount =
    match.option_count ??
    players.reduce((n, p) => n + (p.skin_count ?? 0), 0)
  const liveOnTheme = players.filter((p) => {
    const pick = picks[p.player_id]
    if (!pick) return false
    return p.champions?.some((c) => c.champion_id === pick.champion_id)
  }).length

  const orderedPlayers = useMemo(() => {
    if (!anchorPlayerId) return players
    return [...players].sort((a, b) => {
      if (a.player_id === anchorPlayerId) return -1
      if (b.player_id === anchorPlayerId) return 1
      return (a.display_name ?? '').localeCompare(b.display_name ?? '', 'pt-BR')
    })
  }, [players, anchorPlayerId])

  return (
    <article className="overflow-hidden rounded-[var(--radius)] border border-[var(--line)] bg-[var(--panel)]/90">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] px-4 py-3">
        <div className="flex flex-wrap items-baseline gap-3">
          <span className="font-mono text-sm text-[var(--text-muted)]">#{rank}</span>
          <h2 className="font-display text-xl text-[var(--gold-soft)]">
            {match.theme_name}
          </h2>
          <span className="text-xs text-[var(--text-muted)]">
            {optionCount} {optionCount === 1 ? 'opção' : 'opções'}
          </span>
          {pickHits > 0 ? (
            <span className="rounded-md border border-[var(--gold)]/40 bg-[var(--gold)]/10 px-2 py-0.5 text-xs text-[var(--gold-soft)]">
              {pickHits} pick{pickHits === 1 ? '' : 's'} da select
            </span>
          ) : null}
          {liveOnTheme > 0 ? (
            <span className="text-xs text-[var(--teal-soft)]">
              {liveOnTheme} na select neste tema
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="rounded-md bg-[var(--teal)]/20 px-2.5 py-1 font-medium text-[var(--teal-soft)]">
            {matchSizeLabel(match.match_count, total)}
          </span>
          {missing > 0 ? (
            <span className="text-[var(--text-muted)]">
              {missing} fora desta linha
            </span>
          ) : null}
        </div>
      </header>

      <div className="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-3">
        {orderedPlayers.map((player) => (
          <PlayerThemeColumn
            key={player.player_id}
            player={player}
            showRoles={showRoles}
            openRoles={openRoles}
            suggestedChampionId={assignment?.[player.player_id] ?? null}
            isAnchor={
              (Boolean(anchorPlayerId) &&
                player.player_id === anchorPlayerId) ||
              Boolean(lockedPicks?.[player.player_id])
            }
            canPick={canPick}
            meId={meId}
            pick={picks[player.player_id] ?? null}
            localPick={localPick}
            takenChampions={takenChampions}
            picking={picking}
            onPick={onPick}
          />
        ))}
      </div>
    </article>
  )
}

const VISIBLE_SKINS = 3

type FlatSkin = {
  skin_id: string
  skin_name: string
  splash_url: string | null
  tile_url: string | null
  champion_id: string
  champion_name: string
  champion_image_url: string | null
  roles: string[]
  fit: number
  mastery_points: number
  mastery_level: number
}

function flattenPlayerSkins(
  player: ThemeMatchPlayer,
  prioritizeRoles: boolean,
  openRoles: Set<LaneRole>,
): FlatSkin[] {
  const source = player.champions ?? []
  const champs = prioritizeRoles
    ? sortChampionsByRole(
        source,
        player.primary_role,
        player.secondary_role,
        openRoles,
      )
    : [...source].sort((a, b) =>
        (a.champion_name ?? '').localeCompare(b.champion_name ?? '', 'pt-BR'),
      )

  const flexible = isFlexibleRole(player.primary_role, player.secondary_role)
  const rows: FlatSkin[] = []
  for (const champ of champs) {
    if (!champ?.champion_id) continue
    const fit = prioritizeRoles
      ? flexible
        ? coversOpenRole(champ.roles, openRoles)
          ? 2
          : 0
        : roleFitScore(champ.roles, player.primary_role, player.secondary_role)
      : 0
    for (const skin of champ.skins ?? []) {
      if (!skin?.skin_id) continue
      rows.push({
        ...skin,
        champion_id: champ.champion_id,
        champion_name: champ.champion_name ?? 'Campeão',
        champion_image_url: champ.champion_image_url ?? null,
        roles: champ.roles ?? [],
        fit,
        mastery_points: champ.mastery_points ?? 0,
        mastery_level: champ.mastery_level ?? 0,
      })
    }
  }
  return rows
}

function rankSkins(
  skins: FlatSkin[],
  opts: {
    suggestedChampionId: string | null
    selectedSkinId: string | null
    selectedChampionId: string | null
    takenChampions: Map<string, string>
    playerId: string
    prioritizeRole: boolean
  },
): FlatSkin[] {
  const {
    suggestedChampionId,
    selectedSkinId,
    selectedChampionId,
    takenChampions,
    playerId,
    prioritizeRole,
  } = opts
  return [...skins].sort((a, b) => {
    const aSelected =
      a.skin_id === selectedSkinId ||
      (!selectedSkinId && a.champion_id === selectedChampionId)
    const bSelected =
      b.skin_id === selectedSkinId ||
      (!selectedSkinId && b.champion_id === selectedChampionId)
    if (aSelected !== bSelected) return aSelected ? -1 : 1

    // SR: rota escolhida antes da sugestão de tema / maestria
    if (prioritizeRole && b.fit !== a.fit) return b.fit - a.fit

    const aSuggested = suggestedChampionId === a.champion_id
    const bSuggested = suggestedChampionId === b.champion_id
    if (aSuggested !== bSuggested) return aSuggested ? -1 : 1

    if (!prioritizeRole && b.fit !== a.fit) return b.fit - a.fit
    if (b.mastery_points !== a.mastery_points) {
      return b.mastery_points - a.mastery_points
    }
    if (b.mastery_level !== a.mastery_level) {
      return b.mastery_level - a.mastery_level
    }

    const aTaken =
      takenChampions.has(a.champion_id) &&
      takenChampions.get(a.champion_id) !== playerId
    const bTaken =
      takenChampions.has(b.champion_id) &&
      takenChampions.get(b.champion_id) !== playerId
    if (aTaken !== bTaken) return aTaken ? 1 : -1

    return (a.skin_name ?? '').localeCompare(b.skin_name ?? '', 'pt-BR')
  })
}

function PlayerThemeColumn({
  player,
  showRoles,
  openRoles,
  suggestedChampionId,
  isAnchor,
  canPick,
  meId,
  pick,
  localPick,
  takenChampions,
  picking,
  onPick,
}: {
  player: ThemeMatchPlayer
  showRoles: boolean
  openRoles: Set<LaneRole>
  suggestedChampionId: string | null
  isAnchor: boolean
  canPick: boolean
  meId: string | null
  pick: LivePick | null
  localPick: LivePick | null
  takenChampions: Map<string, string>
  picking: boolean
  onPick: (skinId: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const primary = roleLabel(player.primary_role)
  const secondary = roleLabel(player.secondary_role)
  const flexible = isFlexibleRole(player.primary_role, player.secondary_role)
  const isMine = Boolean(meId && player.player_id === meId)

  const selectedSkinId =
    isMine && localPick?.skin_id ? localPick.skin_id : null
  const selectedChampionId =
    isMine && localPick?.champion_id ? localPick.champion_id : null

  const skins = useMemo(() => {
    const flat = flattenPlayerSkins(player, showRoles, openRoles)
    return rankSkins(flat, {
      suggestedChampionId,
      selectedSkinId,
      selectedChampionId,
      takenChampions,
      playerId: player.player_id,
      prioritizeRole: showRoles,
    })
  }, [
    player,
    showRoles,
    openRoles,
    suggestedChampionId,
    selectedSkinId,
    selectedChampionId,
    takenChampions,
  ])

  const visible = skins.slice(0, VISIBLE_SKINS)
  const hidden = skins.slice(VISIBLE_SKINS)
  const shown = expanded ? skins : visible
  const liveOnColumn =
    pick && player.champions?.some((c) => c.champion_id === pick.champion_id)
      ? pick
      : null
  const effectiveSuggested =
    suggestedChampionId &&
    skins.some((s) => s.champion_id === suggestedChampionId)
      ? suggestedChampionId
      : (skins[0]?.champion_id ?? null)

  return (
    <section
      className={[
        'rounded-md border bg-[var(--ink-soft)]/80',
        isAnchor
          ? 'border-[var(--gold)]/45 ring-1 ring-[var(--gold)]/20'
          : isMine && canPick
            ? 'border-[var(--teal)]/35'
            : 'border-[var(--line)]',
      ].join(' ')}
    >
      <header className="flex items-center gap-1.5 px-2 pt-1.5 pb-1">
        <p className="min-w-0 truncate text-sm font-medium text-[var(--text-strong)]">
          {player.display_name}
        </p>
        {isAnchor ? (
          <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wide text-[var(--gold-soft)]">
            base
          </span>
        ) : null}
        {isMine && canPick ? (
          <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wide text-[var(--teal-soft)]">
            você
          </span>
        ) : null}
        {showRoles && (primary || secondary || flexible) ? (
          <span className="shrink-0 text-[10px] text-[var(--text-muted)]">
            {flexible
              ? 'Fill'
              : `${primary ?? '—'}${
                  secondary && secondary !== primary ? `/${secondary}` : ''
                }`}
          </span>
        ) : null}
        {liveOnColumn ? (
          <span className="ml-auto min-w-0 truncate text-[10px] text-[var(--gold-soft)]">
            {liveOnColumn.champion_name}
            {liveOnColumn.is_intent ? ' ·' : ''}
          </span>
        ) : (
          <span className="ml-auto shrink-0 text-[10px] text-[var(--text-muted)]">
            {skins.length}
          </span>
        )}
      </header>

      {skins.length === 0 ? (
        <p className="px-2 pb-2 text-[10px] leading-snug text-[var(--text-muted)]">
          Sem skins neste tema
        </p>
      ) : (
        <ul className="grid grid-cols-3 gap-1.5 px-2 pb-2">
          {shown.map((skin) => (
            <SkinTile
              key={skin.skin_id}
              skin={skin}
              player={player}
              showRoles={showRoles}
              openRoles={openRoles}
              flexible={flexible}
              primary={primary}
              suggestedChampionId={effectiveSuggested}
              canPick={canPick}
              isMine={isMine}
              localPick={localPick}
              takenChampions={takenChampions}
              picking={picking}
              onPick={onPick}
            />
          ))}
        </ul>
      )}

      {hidden.length > 0 ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-center justify-center gap-1 border-t border-[var(--line)] px-2 py-1 text-[10px] text-[var(--text-muted)] transition hover:bg-[var(--panel)]/40 hover:text-[var(--text-strong)]"
        >
          {expanded
            ? 'Mostrar menos'
            : `+${hidden.length} skin${hidden.length === 1 ? '' : 's'}`}
        </button>
      ) : null}
    </section>
  )
}

function formatMasteryPoints(points: number): string {
  if (points >= 1_000_000) return `${(points / 1_000_000).toFixed(1)}M`
  if (points >= 10_000) return `${Math.round(points / 1000)}k`
  if (points >= 1000) return `${(points / 1000).toFixed(1)}k`
  return String(points)
}

/** Escudo com M + nível legível ao lado. */
function MasteryBadge({
  level,
  points,
}: {
  level: number
  points: number
}) {
  const lvl = Math.max(0, Math.min(level || 0, 99))
  if (lvl <= 0 && points <= 0) return null
  const display = lvl > 0 ? lvl : 1

  const fill =
    display >= 7
      ? { outer: '#c9a227', mid: '#f0d878', inner: '#8a6a12' }
      : display >= 5
        ? { outer: '#c9a227', mid: '#e6c76a', inner: '#6e5610' }
        : display >= 3
          ? { outer: '#3db8a0', mid: '#7ed9c7', inner: '#1a6b5c' }
          : { outer: '#8b97ab', mid: '#c5cedd', inner: '#3a4454' }

  const chipTone =
    display >= 7
      ? 'border-[var(--gold)] text-[var(--gold-soft)]'
      : display >= 5
        ? 'border-[var(--gold)]/70 text-[var(--gold-soft)]'
        : display >= 3
          ? 'border-[var(--teal)]/70 text-[var(--teal-soft)]'
          : 'border-white/25 text-[var(--text)]'

  return (
    <span
      className="inline-flex shrink-0 items-center gap-1"
      title={`Maestria ${display}${points > 0 ? ` · ${formatMasteryPoints(points)} pts` : ''}`}
      aria-label={`Maestria ${display}`}
    >
      <span className="relative inline-flex h-6 w-5 items-center justify-center">
        <svg
          viewBox="0 0 40 48"
          className="absolute inset-0 h-full w-full drop-shadow"
          aria-hidden
        >
          <path
            d="M20 2 L36 8 L36 26 C36 36 28 43 20 46 C12 43 4 36 4 26 L4 8 Z"
            fill={fill.outer}
          />
          <path
            d="M20 5.5 L33 10.5 L33 25.5 C33 34 26.5 40 20 42.5 C13.5 40 7 34 7 25.5 L7 10.5 Z"
            fill={fill.mid}
          />
          <path
            d="M20 9 L29.5 13 L29.5 24.5 C29.5 31.5 24.5 36.5 20 38.5 C15.5 36.5 10.5 31.5 10.5 24.5 L10.5 13 Z"
            fill={fill.inner}
            opacity={0.92}
          />
        </svg>
        <span
          className={[
            'relative z-[1] font-display text-[10px] font-bold leading-none',
            display >= 3 ? 'text-[var(--ink)]' : 'text-[var(--text-strong)]',
            'drop-shadow-[0_1px_1px_rgba(0,0,0,0.35)]',
          ].join(' ')}
        >
          M
        </span>
      </span>
      <span
        className={[
          'rounded border bg-black/80 px-1.5 py-0.5 font-display text-[11px] font-bold leading-none tabular-nums',
          chipTone,
        ].join(' ')}
      >
        {display}
      </span>
    </span>
  )
}

function SkinTile({
  skin,
  player,
  showRoles,
  openRoles,
  flexible,
  primary,
  suggestedChampionId,
  canPick,
  isMine,
  localPick,
  takenChampions,
  picking,
  onPick,
}: {
  skin: FlatSkin
  player: ThemeMatchPlayer
  showRoles: boolean
  openRoles: Set<LaneRole>
  flexible: boolean
  primary: string | null
  suggestedChampionId: string | null
  canPick: boolean
  isMine: boolean
  localPick: LivePick | null
  takenChampions: Map<string, string>
  picking: boolean
  onPick: (skinId: string) => void
}) {
  const suggested = suggestedChampionId === skin.champion_id
  const champRoles = showRoles ? championRoleLabels(skin.roles) : []
  const roleTag = champRoles.slice(0, 2).join('/')
  const laneMatch = showRoles
    ? matchedPlayerRole(
        skin.roles,
        player.primary_role,
        player.secondary_role,
      )
    : null
  const onPlayerRole = Boolean(laneMatch)
  const onOpenRole =
    showRoles && flexible && coversOpenRole(skin.roles, openRoles)
  const highlighted = onPlayerRole || onOpenRole
  const dimOffRole = !showRoles
    ? false
    : suggested
      ? false
      : flexible
        ? !onOpenRole && openRoles.size > 0
        : !onPlayerRole && Boolean(primary)

  const selectedBySkin =
    isMine &&
    Boolean(localPick?.skin_id) &&
    localPick?.skin_id === skin.skin_id
  const selectedByChamp =
    isMine &&
    !localPick?.skin_id &&
    localPick?.champion_id === skin.champion_id
  const selected = selectedBySkin || selectedByChamp
  const dimNotSuggested =
    Boolean(suggestedChampionId) && !suggested && !selected
  const takenBy = takenChampions.get(skin.champion_id)
  const takenByOther = Boolean(takenBy) && takenBy !== player.player_id
  const canClick = canPick && isMine && !picking && (!takenByOther || selected)
  const showSuggestion = Boolean(suggestedChampionId) && suggested

  const tileClass = [
    'group relative overflow-hidden rounded border bg-[var(--panel)] text-left transition',
    selected
      ? 'border-[var(--gold)] ring-1 ring-[var(--gold)]/70'
      : showSuggestion
        ? 'border-[var(--gold)] ring-1 ring-[var(--gold)]/50'
        : highlighted && !dimNotSuggested
          ? 'border-[var(--teal)]/50'
          : 'border-[var(--line)]',
    dimNotSuggested || (dimOffRole && !selected) ? 'opacity-35' : '',
    takenByOther && !selected ? 'opacity-35' : '',
    canClick ? 'cursor-pointer hover:border-[var(--gold-soft)]' : '',
    isMine && canPick && !canClick && !selected ? 'cursor-not-allowed' : '',
    isMine && !canPick ? 'cursor-default' : '',
  ].join(' ')

  const masteryLvl = skin.mastery_level ?? 0
  const masteryPts = skin.mastery_points ?? 0
  const hasMastery = masteryLvl > 0 || masteryPts > 0

  const title = `${skin.skin_name} · ${skin.champion_name}${
    roleTag ? ` · ${roleTag}` : ''
  }${
    hasMastery
      ? ` · maestria ${masteryLvl || 1}${
          masteryPts > 0 ? ` (${formatMasteryPoints(masteryPts)} pts)` : ''
        }`
      : ''
  }${selected ? ' · no client' : ''}${takenByOther ? ' · já pegaram' : ''}${
    showSuggestion && !selected ? ' · recomendado' : ''
  }${isMine && canClick ? ' · clique para pickar no LoL' : ''}${
    isMine && !canPick ? ' · disponível na select' : ''
  }`

  const inner = (
    <>
      <div className="aspect-square bg-[var(--ink)]">
        {skin.tile_url || skin.splash_url ? (
          <img
            src={skin.tile_url || skin.splash_url || ''}
            alt={skin.skin_name}
            className="h-full w-full object-cover object-top"
            loading="lazy"
          />
        ) : null}
      </div>
      {skin.champion_image_url ? (
        <div className="absolute left-1 top-1 rounded-md bg-black/50 p-0.5 shadow-md backdrop-blur-[2px]">
          <img
            src={skin.champion_image_url}
            alt=""
            className="h-7 w-7 rounded-sm border border-white/20 object-cover"
            loading="lazy"
          />
        </div>
      ) : null}
      <div className="absolute right-1 top-1 z-[1] flex flex-col items-end gap-0.5">
        {hasMastery ? (
          <MasteryBadge level={masteryLvl} points={masteryPts} />
        ) : null}
        {roleTag ? (
          <span
            className={[
              'rounded bg-black/70 px-1 py-0.5 text-[9px] font-semibold',
              selected || showSuggestion || highlighted
                ? 'text-[var(--teal-soft)]'
                : 'text-[var(--text)]',
            ].join(' ')}
          >
            {roleTag}
          </span>
        ) : null}
      </div>
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/55 to-transparent px-1.5 pb-1 pt-5">
        <p className="truncate text-[10px] font-medium leading-tight text-[var(--text-strong)]">
          {skin.champion_name}
        </p>
        {selected ? (
          <p className="truncate text-[8px] font-bold uppercase tracking-wide text-[var(--gold-soft)]">
            no client
          </p>
        ) : takenByOther && canPick ? (
          <p className="truncate text-[8px] font-bold uppercase tracking-wide text-[var(--danger)]">
            ocupado
          </p>
        ) : showSuggestion ? (
          <p className="truncate text-[8px] font-bold uppercase tracking-wide text-[var(--gold-soft)]">
            recomendado
          </p>
        ) : null}
      </div>
    </>
  )

  return (
    <li>
      {isMine && canPick ? (
        <button
          type="button"
          disabled={!canClick}
          onClick={() => onPick(skin.skin_id)}
          className={tileClass}
          title={title}
        >
          {inner}
        </button>
      ) : (
        <div className={tileClass} title={title}>
          {inner}
        </div>
      )}
    </li>
  )
}
