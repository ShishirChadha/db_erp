"use server";

import { supabaseAdmin } from "@/lib/supabase/service";
import { financialYear } from "@/lib/sales-entry";

// Mints the next real invoice number atomically via next_document_number().
// Never a client-side scan, never editable once assigned -- entityKey maps to
// a business_profiles.key ('digitalbluez' | 'techtenth' | 'cash').
export async function mintInvoiceNumber(entityKey: string = "digitalbluez"): Promise<string> {
  const { data, error } = await supabaseAdmin.rpc("next_document_number", {
    p_entity_key: entityKey,
    p_doc_type: "sales_invoice",
    p_financial_year: financialYear(),
  });
  if (error) throw new Error(`Failed to mint invoice number: ${error.message}`);
  return data as string;
}
