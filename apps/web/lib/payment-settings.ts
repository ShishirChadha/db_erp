import { cache } from 'react'
import { createPublicSupabaseClient } from '@db/db/public'

export interface PaymentSettings {
  upi_discount_pct: number
  card_discount_pct: number
  cod_handling_fee_pct: number
  cod_token_amount: number
  cod_enabled: boolean
}

const DEFAULTS: PaymentSettings = {
  upi_discount_pct: 0,
  card_discount_pct: 0,
  cod_handling_fee_pct: 5,
  cod_token_amount: 1000,
  cod_enabled: true,
}

// Read through the public view (never the raw website_payment_settings
// table) -- same convention as every other anon-readable config
// (public_cross_sell_rules, public_upgrade_options), even though nothing
// here is actually sensitive. Falls back to safe defaults rather than
// throwing if the row is somehow missing, since this gates whether checkout
// can proceed at all.
export const getPaymentSettings = cache(async (): Promise<PaymentSettings> => {
  const supabase = createPublicSupabaseClient()
  const { data } = await supabase.from('public_payment_settings').select('*').maybeSingle()
  return (data as PaymentSettings | null) ?? DEFAULTS
})
