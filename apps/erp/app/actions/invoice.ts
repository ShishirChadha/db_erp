"use server";

import { supabaseAdmin } from "@/lib/supabase/service";
import { financialYear } from "@/lib/sales-entry";
import { getCookieSessionUser, canEditPage } from "@/lib/auth/session";
import { getInvoicingMode } from "@/lib/invoice-finalize";

// Mints the next real invoice number atomically via next_document_number().
// Never a client-side scan, never editable once assigned -- entityKey maps to
// a business_profiles.key ('digitalbluez' | 'techtenth' | 'cash').
// A server action is reachable by any request, so it checks the caller's
// invoices edit grant itself, and refuses an entity still in Zoho transition
// mode ('external') -- that entity's legal series is still issued in Zoho, so an
// ERP-minted number would be out of sequence (same rule as invoice-finalize).
export async function mintInvoiceNumber(entityKey: string = "digitalbluez"): Promise<string> {
  const sessionUser = await getCookieSessionUser();
  if (!canEditPage(sessionUser, "invoices")) throw new Error("Unauthorized");
  if ((await getInvoicingMode(entityKey)) === "external") {
    throw new Error("This entity's invoices are still generated in Zoho (transition mode) -- the ERP can't issue one.");
  }
  const { data, error } = await supabaseAdmin.rpc("next_document_number", {
    p_entity_key: entityKey,
    p_doc_type: "sales_invoice",
    p_financial_year: financialYear(),
  });
  if (error) throw new Error(`Failed to mint invoice number: ${error.message}`);
  return data as string;
}
