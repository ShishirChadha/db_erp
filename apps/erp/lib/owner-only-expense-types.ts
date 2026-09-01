import { supabaseAdmin } from '@/lib/supabase/service'

// The current set of expense_types values marked owner_only in custom_options
// (Settings -> Dropdown Options) -- e.g. Salaries, Bank Charges, GST Payment by
// default, but owner-configurable, not hardcoded. Used to keep both the option
// list AND the underlying `expenses` rows themselves fully invisible to a
// non-owner, not merely absent from the dropdown -- `type` is free text, so a
// row can exist with a sensitive type regardless of how it was entered.
export async function getOwnerOnlyExpenseTypes(): Promise<string[]> {
  const { data } = await supabaseAdmin
    .from('custom_options')
    .select('value')
    .eq('category', 'expense_types')
    .eq('owner_only', true)
  return (data || []).map((r) => r.value)
}

export function isOwnerOnlyType(type: string | null | undefined, ownerOnlyTypes: string[]): boolean {
  if (!type) return false
  return ownerOnlyTypes.some((t) => t.toLowerCase() === type.trim().toLowerCase())
}
