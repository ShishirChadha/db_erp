"use server";

import { createClient } from "@/lib/supabase/server";

export async function suggestNextInvoiceNumber(prefix: string = "DBIN"): Promise<string> {
  const supabase = await createClient();
  const currentYear = new Date().getFullYear();
  const nextYear = (currentYear + 1) % 100;
  const financialYear = `${currentYear}-${nextYear}`;

  const { data, error } = await supabase
    .from("invoices")
    .select("invoice_number")
    .ilike("invoice_number", `${prefix}/${financialYear}/%`)
    .order("invoice_number", { ascending: false })
    .limit(1);

  if (error) throw new Error("Failed to fetch last invoice number");

  let lastNumber = 0;
  if (data && data.length > 0) {
    const parts = data[0].invoice_number.split("/");
    const numPart = parts[parts.length - 1];
    lastNumber = parseInt(numPart, 10) || 0;
  }

  const nextNumber = lastNumber + 1;
  return `${prefix}/${financialYear}/${String(nextNumber).padStart(4, "0")}`;
}

export async function isInvoiceNumberUnique(invoiceNumber: string): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("invoices")
    .select("id")
    .eq("invoice_number", invoiceNumber)
    .maybeSingle();
  if (error) throw new Error("Failed to check invoice number");
  return !data;
}