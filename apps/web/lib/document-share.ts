import { supabaseAdmin } from '@db/db/admin'

// digitalbluez.com/d/<code>: a PI or quotation shared from the ERP on WhatsApp
// (apps/erp/lib/assistant/share.ts writes document_share_links). The code is
// the only credential; the table is service-role only, so it is read here on
// the server and never from the browser.
export type SharedDocument =
  | { state: 'ok'; code: string; title: string; storagePath: string; openCount: number }
  | { state: 'expired'; title: string }
  | { state: 'missing' }

export async function findSharedDocument(rawCode: string): Promise<SharedDocument> {
  const code = String(rawCode || '').toLowerCase()
  if (!/^[a-z2-9]{10}$/.test(code)) return { state: 'missing' }
  const { data } = await supabaseAdmin
    .from('document_share_links')
    .select('code, title, storage_path, expires_at, open_count')
    .eq('code', code)
    .maybeSingle()
  if (!data) return { state: 'missing' }
  if (new Date(data.expires_at).getTime() < Date.now()) return { state: 'expired', title: data.title }
  return { state: 'ok', code: data.code, title: data.title, storagePath: data.storage_path, openCount: data.open_count || 0 }
}
