import { supabaseAdmin } from './supabase/service'
import { SELLABLE_STATUSES } from './sales-entry'

export async function generateRepairJobNumber(): Promise<string> {
  const { data, error } = await supabaseAdmin.rpc('generate_repair_job_number')
  if (error) throw error
  return data as string
}

export { SELLABLE_STATUSES }
