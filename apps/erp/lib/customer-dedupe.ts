import type { SupabaseClient } from "@supabase/supabase-js";

export interface DuplicateCustomerMatch {
  id: string;
  customer_name: string;
  phone: string | null;
}

export interface DuplicateCustomerCheckResult {
  // Same phone number as an existing active customer -- hard block (matches the
  // customers_active_phone_unique DB index, so this is a friendly pre-check for
  // the same rule the database will enforce regardless).
  blockingMatch: DuplicateCustomerMatch | null;
  // Same name (case/whitespace-insensitive) but a different phone -- names repeat
  // constantly in this customer base (many customers are just "Amit" or "Rohit"),
  // so this is a non-blocking heads-up, not a hard rule.
  nameWarningMatch: DuplicateCustomerMatch | null;
}

// Checks for an existing active customer that collides with the given name/phone
// before insert/update, so staff get an immediate, specific error instead of a
// raw Postgres unique-violation. `excludeId` is the customer's own id on edit, so
// it doesn't collide with itself.
export async function checkDuplicateCustomer(
  supabase: SupabaseClient,
  { customer_name, phone, excludeId }: { customer_name: string; phone: string; excludeId?: string }
): Promise<DuplicateCustomerCheckResult> {
  const trimmedPhone = phone.trim();
  const trimmedName = customer_name.trim();

  let blockingMatch: DuplicateCustomerMatch | null = null;
  if (trimmedPhone) {
    let query = supabase
      .from("customers")
      .select("id, customer_name, phone")
      .eq("is_deleted", false)
      .eq("phone", trimmedPhone)
      .limit(1);
    if (excludeId) query = query.neq("id", excludeId);
    const { data } = await query;
    blockingMatch = (data && data[0]) || null;
  }

  let nameWarningMatch: DuplicateCustomerMatch | null = null;
  if (trimmedName) {
    let query = supabase
      .from("customers")
      .select("id, customer_name, phone")
      .eq("is_deleted", false)
      .ilike("customer_name", trimmedName)
      .limit(1);
    if (excludeId) query = query.neq("id", excludeId);
    const { data } = await query;
    const match = (data && data[0]) || null;
    if (match && (match.phone || "").trim() !== trimmedPhone) {
      nameWarningMatch = match;
    }
  }

  return { blockingMatch, nameWarningMatch };
}
