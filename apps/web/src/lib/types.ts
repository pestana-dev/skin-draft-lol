export type DraftMode = 'theme' | 'color'
export type RoomStatus = 'waiting' | 'ready' | 'completed' | 'cancelled'
export type QueueKind = 'aram' | 'sr' | 'unknown'

export type Champion = {
  id: string
  name: string
  key: string | null
  image_url: string | null
}

export type Skin = {
  id: string
  champion_id: string
  name: string
  splash_url: string | null
  tile_url: string | null
  rarity: string | null
  is_available: boolean
  num: number | null
  champions?: Champion | null
}

export type SkinTheme = {
  id: string
  slug: string
  name: string
}

export type SummonerInfo = {
  puuid: string
  gameName: string
  tagLine: string
  displayName: string
}

export type Player = {
  id: string
  puuid: string
  game_name: string | null
  tag_line: string | null
  display_name: string
  last_inventory_sync_at: string | null
  avatar_url?: string | null
  skin_count?: number
  created_at?: string
}

/** @deprecated use Player */
export type Profile = Player

export type DraftRoom = {
  id: string
  code: string
  host_id: string | null
  party_id?: string | null
  mode: DraftMode
  status: RoomStatus
  settings: {
    avoid_duplicate_skins?: boolean
    aram_pool?: string[]
    aram_synced_at?: string | null
    queue_kind?: QueueKind | string
    queue_id?: number | null
    unique_champions?: boolean
  }
  created_at: string
}

export type PartyMemberSnapshot = {
  player_id: string
  puuid: string
  display_name: string
  game_name?: string | null
  tag_line?: string | null
  primary_role?: string | null
  secondary_role?: string | null
  last_inventory_sync_at: string | null
  skin_count: number
}

export type DraftParticipant = {
  room_id: string
  player_id: string
  user_id?: string
  position: number
  is_ready: boolean
  joined_at: string
  player?: Player | null
  profiles?: Player | null
}

export type DraftResult = {
  id: string
  room_id: string
  round: number
  skin_id: string
  player_id: string
  user_id?: string
  slot: number
  meta: {
    mode?: DraftMode
    theme_slug?: string | null
    theme_name?: string | null
  }
  created_at: string
  skins?: Skin | null
  player?: Player | null
  profiles?: Player | null
}

export type ThemeMatchSkinOption = {
  skin_id: string
  skin_name: string
  splash_url: string | null
  tile_url: string | null
}

export type ThemeMatchChampion = {
  champion_id: string
  champion_name: string
  champion_image_url: string | null
  roles?: string[]
  skin_count: number
  skins: ThemeMatchSkinOption[]
}

export type ThemeMatchPlayer = {
  player_id: string
  puuid?: string
  display_name: string
  primary_role?: string | null
  secondary_role?: string | null
  skin_count: number
  champion_count: number
  champions: ThemeMatchChampion[]
}

/** @deprecated flat member shape */
export type ThemeMatchMember = {
  player_id?: string
  user_id?: string
  display_name: string
  skin_id: string
  skin_name: string
  splash_url: string | null
  tile_url: string | null
  champion_id: string
  champion_name: string
}

export type ThemeMatch = {
  theme_id: string
  theme_slug: string
  theme_name: string
  match_count: number
  option_count?: number
  participant_total: number
  players: ThemeMatchPlayer[]
  members?: ThemeMatchPlayer[] | ThemeMatchMember[]
}

export type ThemeMatchesResponse = {
  room_id: string
  room_code: string
  participant_total: number
  queue_kind?: QueueKind | string
  queue_id?: number | null
  unique_champions?: boolean
  filter_aram?: boolean
  aram_pool: string[]
  matches: ThemeMatch[]
}
