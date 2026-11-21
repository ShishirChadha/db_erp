// Live US dollar -> rupee rate for DB's usage and credit figures, so the owner
// never types one. Frankfurter (European Central Bank reference rates, free, no
// key) first, exchangerate-api's open endpoint as a fallback; cached 6 hours
// by Next's data cache. Only the currency pair is sent -- no business data.

export interface UsdInr { rate: number; date: string | null; source: string }

const FALLBACK: UsdInr = { rate: 92, date: null, source: 'fallback (rate service unreachable)' }
let memo: { at: number; value: UsdInr } | null = null

export async function liveUsdInr(): Promise<UsdInr> {
  if (memo && Date.now() - memo.at < 6 * 3600_000) return memo.value
  const value = (await fromFrankfurter()) || (await fromOpenEr()) || memo?.value || FALLBACK
  if (value !== FALLBACK) memo = { at: Date.now(), value }
  return value
}

async function fromFrankfurter(): Promise<UsdInr | null> {
  try {
    const res = await fetch('https://api.frankfurter.dev/v1/latest?base=USD&symbols=INR', { next: { revalidate: 21600 }, signal: AbortSignal.timeout(5000) })
    const j = await res.json()
    const rate = Number(j?.rates?.INR)
    return res.ok && rate > 50 && rate < 200 ? { rate, date: j.date ?? null, source: 'European Central Bank (via Frankfurter)' } : null
  } catch { return null }
}

async function fromOpenEr(): Promise<UsdInr | null> {
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD', { next: { revalidate: 21600 }, signal: AbortSignal.timeout(5000) })
    const j = await res.json()
    const rate = Number(j?.rates?.INR)
    const date = j?.time_last_update_unix ? new Date(j.time_last_update_unix * 1000).toISOString().slice(0, 10) : null
    return res.ok && rate > 50 && rate < 200 ? { rate, date, source: 'ExchangeRate-API' } : null
  } catch { return null }
}
