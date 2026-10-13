import type { PartyMemberSnapshot, Player, SummonerInfo } from './types'

export type LcuStatus = {
  connected: boolean
  message: string
  summoner: SummonerInfo | null
  party: {
    partyId: string
    source: string
    members: Array<{
      puuid: string
      gameName?: string | null
      tagLine?: string | null
      primaryRole?: string | null
      secondaryRole?: string | null
    }>
    aramChampionIds: string[]
    queueId?: number | null
    queueKind?: string
    /** True só na Champ Select do client (não no lobby). */
    inChampSelect?: boolean
  } | null
}

export type SyncMeResult = {
  player_id: string
  puuid: string
  display_name: string
  skin_count: number
  last_inventory_sync_at: string | null
}

export type SyncPartyResult = {
  room_id: string
  room_code: string
  party_id: string
  host_id: string | null
  aram_count: number
  queue_id?: number | null
  queue_kind?: string | null
  members: PartyMemberSnapshot[]
}

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core')
  return tauriInvoke<T>(cmd, args)
}

export async function desktopLcuStatus(): Promise<LcuStatus> {
  return invoke<LcuStatus>('lcu_status')
}

export async function desktopSyncMe(): Promise<SyncMeResult> {
  return invoke<SyncMeResult>('sync_me')
}

export async function desktopSyncParty(opts?: {
  syncInventory?: boolean
}): Promise<SyncPartyResult> {
  return invoke<SyncPartyResult>('sync_party', {
    syncInventory: opts?.syncInventory ?? false,
  })
}

export function summonerToPlayer(
  summoner: SummonerInfo,
  sync?: Partial<SyncMeResult>,
): Player {
  return {
    id: sync?.player_id ?? '',
    puuid: summoner.puuid,
    game_name: summoner.gameName,
    tag_line: summoner.tagLine,
    display_name: summoner.displayName,
    last_inventory_sync_at: sync?.last_inventory_sync_at ?? null,
    skin_count: sync?.skin_count,
  }
}
