export type DraftMode = 'theme' | 'color' | 'free'
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

export type RunDraftResponse = {
  room_id: string
  round: number
  mode: DraftMode
  theme_slug: string | null
  theme_name: string | null
  results: Array<{
    user_id: string
    skin_id: string
    slot: number
    round: number
  }>
}
