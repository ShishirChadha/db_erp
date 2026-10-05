import { redirect } from 'next/navigation'
import { supabaseAdmin } from '@/lib/supabase/service'

// Thin redirect so a lead-linked activities row (related_type 'lead') has a
// real deep link from the Activity Hub (RELATED_TYPE_LINK_BASE builds
// `/dashboard/leads/<lead_id>`) -- the actual lead UI lives in the Sets
// master-detail view at /dashboard/leads?set=<set_id>&open=<lead_id>.
export default async function LeadRedirectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { data: lead } = await supabaseAdmin.from('leads').select('set_id').eq('id', id).maybeSingle()
  if (!lead) redirect('/dashboard/leads')
  redirect(`/dashboard/leads?set=${lead.set_id}&open=${id}`)
}
