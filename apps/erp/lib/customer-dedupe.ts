import type { SupabaseClient } from "@supabase/supabase-js";

export interface DuplicateCustomerMatch {
  id: string;
  customer_name: string;
  phone: string | null;
  gst_number?: string | null;
}

export interface DuplicateCustomerCheckResult {
  // Same mobile AND the same GSTIN, or same mobile where either side has no
  // GSTIN -- a hard block. One person can run two GST-registered companies on
  // one mobile (2026-11-24, Cognoverse + Beamstack), so a shared mobile alone
  // is no longer a duplicate. The DB index customers_active_phone_gst_unique
  // enforces the same-GSTIN / both-blank cases; "one blank, one set" is
  // enforced here only (an index can't compare across rows like that).
  blockingMatch: DuplicateCustomerMatch | null;
  // Other customers on this mobile with a different GSTIN -- allowed, shown as
  // a heads-up so a genuine duplicate still gets noticed.
  sharedPhoneMatches: DuplicateCustomerMatch[];
  // Same name (case/whitespace-insensitive) but a different phone -- names repeat
  // constantly in this customer base (many customers are just "Amit" or "Rohit"),
  // so this is a non-blocking heads-up, not a hard rule.
  nameWarningMatch: DuplicateCustomerMatch | null;
}

export const normalizeGstin = (g: string | null | undefined) => (g || "").trim().toUpperCase();

// Checks for an existing active customer that collides with the given
// name/phone/GSTIN before insert/update, so staff get an immediate, specific
// error instead of a raw Postgres unique-violation. `excludeId` is the
// customer's own id on edit, so it doesn't collide with itself.
export async function checkDuplicateCustomer(
  supabase: SupabaseClient,
  { customer_name, phone, gst_number, excludeId }: { customer_name: string; phone: string; gst_number?: string | null; excludeId?: string }
): Promise<DuplicateCustomerCheckResult> {
  const trimmedPhone = phone.trim();
  const trimmedName = customer_name.trim();
  const gst = normalizeGstin(gst_number);

  let blockingMatch: DuplicateCustomerMatch | null = null;
  const sharedPhoneMatches: DuplicateCustomerMatch[] = [];
  if (trimmedPhone) {
    let query = supabase
      .from("customers")
      .select("id, customer_name, phone, gst_number")
      .eq("is_deleted", false)
      .eq("phone", trimmedPhone)
      .limit(20);
    if (excludeId) query = query.neq("id", excludeId);
    const { data } = await query;
    for (const m of (data || []) as DuplicateCustomerMatch[]) {
      const other = normalizeGstin(m.gst_number);
      if (!gst || !other || other === gst) blockingMatch = blockingMatch || m;
      else sharedPhoneMatches.push(m);
    }
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

  return { blockingMatch, sharedPhoneMatches, nameWarningMatch };
}
