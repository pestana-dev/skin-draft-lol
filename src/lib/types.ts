export type DraftMode = 'theme' | 'color'
export type RoomStatus = 'waiting' | 'ready' | 'completed' | 'cancelled'

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

export type Profile = {
  id: string
  display_name: string
  avatar_url: string | null
  created_at: string
}

export type DraftRoom = {
  id: string
  code: string
  host_id: string
  mode: DraftMode
  status: RoomStatus
  settings: {
    avoid_duplicate_skins?: boolean
    aram_pool?: string[]
    aram_synced_at?: string | null
  }
  created_at: string
}

export type DraftParticipant = {
  room_id: string
  user_id: string
  position: number
  is_ready: boolean
  joined_at: string
  profiles?: Profile | null
}

export type DraftResult = {
  id: string
  room_id: string
  round: number
  skin_id: string
  user_id: string
  slot: number
  meta: {
    mode?: DraftMode
    theme_slug?: string | null
    theme_name?: string | null
  }
  created_at: string
  skins?: Skin | null
  profiles?: Profile | null
}

export type ThemeMatchMember = {
  user_id: string
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
  participant_total: number
  members: ThemeMatchMember[]
}

export type ThemeMatchesResponse = {
  room_id: string
  room_code: string
  participant_total: number
  aram_pool: string[]
  matches: ThemeMatch[]
}
