import { supabaseAdmin } from './supabase/service'

// Same job-number sequence as a serialized replacement job -- "replacement job" is one
// business record type regardless of what's being swapped, same as invoice numbers
// staying one sequence regardless of what's on the invoice.
export async function generateReplacementJobNumber(): Promise<string> {
  const { data, error } = await supabaseAdmin.rpc('generate_replacement_job_number')
  if (error) throw error
  return data as string
}
