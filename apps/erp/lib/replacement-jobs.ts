import { supabaseAdmin } from './supabase/service'
import { SELLABLE_STATUSES } from './sales-entry'

export async function generateReplacementJobNumber(): Promise<string> {
  const { data, error } = await supabaseAdmin.rpc('generate_replacement_job_number')
  if (error) throw error
  return data as string
}

export { SELLABLE_STATUSES }
