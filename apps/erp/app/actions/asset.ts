"use server";

import { createClient } from "@/lib/supabase/server";

// Get a single next asset number
export async function getNextAssetNumber(prefix: string = "DBAS"): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("next_asset_number_int");
  if (error) throw new Error(`Failed to generate asset number: ${error.message}`);
  return `${prefix}${data}`;
}

// Get multiple next asset numbers at once (for batch insert)
export async function getNextAssetNumbers(count: number, prefix: string = "DBAS"): Promise<string[]> {
  const supabase = await createClient();
  // Call a custom RPC that returns an array of next numbers
  const { data, error } = await supabase.rpc("next_asset_numbers_int", { count });
  if (error) throw new Error(`Failed to generate asset numbers: ${error.message}`);
  return data.map((num: number) => `${prefix}${num}`);
}