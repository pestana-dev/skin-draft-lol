import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const publishableKey =
  (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ||
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)

export const isSupabaseConfigured = Boolean(url && publishableKey)

export const supabase: SupabaseClient = isSupabaseConfigured
  ? createClient(url!, publishableKey!)
  : (null as unknown as SupabaseClient)

export function requireSupabase(): SupabaseClient {
  if (!isSupabaseConfigured) {
    throw new Error(
      'Configure VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY no arquivo .env',
    )
  }
  return supabase
}
