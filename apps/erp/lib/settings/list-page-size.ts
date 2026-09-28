import { supabaseAdmin } from '@/lib/supabase/service'

// Global rows-per-page for every paginated list page, owner-configurable from
// Settings (components/ListPageSizeManager.tsx). Same single key/value-row
// pattern as lib/auth/device-sessions.ts's getMaxDevices().
export const DEFAULT_LIST_PAGE_SIZE = 50
export const MIN_LIST_PAGE_SIZE = 50
export const MAX_LIST_PAGE_SIZE = 500

export async function getListPageSize(): Promise<number> {
  const { data } = await supabaseAdmin.from('app_settings').select('value').eq('key', 'list_page_size').maybeSingle()
  const n = data ? parseInt(data.value, 10) : NaN
  return Number.isFinite(n) && n >= MIN_LIST_PAGE_SIZE ? n : DEFAULT_LIST_PAGE_SIZE
}
