import { CLAUDE_PRICES } from './usage'

// The organisation's real Claude spend, read from Anthropic's own billing data
// with an Admin API key (sk-ant-admin..., created in the Claude Console). This
// covers every use of the key -- DB, Marketing, bank-statement reading -- not
// just DB.
//
// Two sources, because Anthropic offers no single real-time one:
//   - /v1/organizations/analytics/cost: the billed amount in USD, typically
//     complete within ~4 hours (up to 24), stamped with data_refreshed_at;
//   - the token usage report: about 30 minutes behind, used for "today" and
//     priced here at list prices.
// Anthropic has no API for the prepaid credit balance, so the balance is
// "credit you loaded" minus this spend since that date.
const BASE = 'https://api.anthropic.com/v1/organizations'
const VERSION = '2026-10-21'
const ANALYTICS_BETA = 'analytics-usage-cost-2026-08-24'

const cache = new Map<string, { at: number; value: unknown }>()
async function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key)
  // Anthropic asks for polling no more often than about once a minute.
  if (hit && Date.now() - hit.at < 60_000) return hit.value as T
  const value = await fn()
  cache.set(key, { at: Date.now(), value })
  return value
}

async function get(adminKey: string, path: string, params: [string, string][], beta: boolean) {
  const qs = params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')
  const res = await fetch(`${BASE}${path}?${qs}`, {
    headers: {
      'x-api-key': adminKey,
      'anthropic-version': VERSION,
      ...(beta ? { 'anthropic-beta': ANALYTICS_BETA } : {}),
    },
    signal: AbortSignal.timeout(20_000),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = data?.error?.message || `Anthropic billing API error (${res.status})`
    throw new Error(/requires an Admin API key/i.test(msg) ? 'This needs an Admin API key (sk-ant-admin…), not the normal API key.' : res.status === 401 ? `Anthropic rejected the Admin key: ${msg}` : msg)
  }
  return data
}

// USD billed between two instants, split into the API's 31-day maximum spans.
export async function billedCost(adminKey: string, from: Date, to: Date) {
  return cached(`cost:${adminKey.slice(-6)}:${from.toISOString()}:${to.toISOString().slice(0, 15)}`, async () => {
    let usd = 0
    const byModel = new Map<string, number>()
    let refreshedAt: string | null = null
    for (let start = from; start < to;) {
      const end = new Date(Math.min(to.getTime(), start.getTime() + 31 * 86400_000))
      let page: string | null = null
      do {
        const params: [string, string][] = [['starting_at', start.toISOString()], ['ending_at', end.toISOString()], ['group_by[]', 'model'], ['limit', '1000']]
        if (page) params.push(['page', page])
        const data = await get(adminKey, '/analytics/cost', params, true)
        for (const row of data.data || []) {
          const amount = Number(row.cost?.amount || 0) / 100 // fractional cents -> USD
          usd += amount
          const m = row.group?.model || 'other'
          byModel.set(m, (byModel.get(m) || 0) + amount)
        }
        if (data.data_refreshed_at && (!refreshedAt || data.data_refreshed_at < refreshedAt)) refreshedAt = data.data_refreshed_at
        page = data.has_more ? data.next_page : null
      } while (page)
      start = end
    }
    return { usd, by_model: Object.fromEntries(byModel), data_refreshed_at: refreshedAt }
  })
}

// Today's tokens (IST day), about 30 minutes behind, priced at list prices.
export async function todayFromTokens(adminKey: string) {
  const ist = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
  const start = new Date(`${ist}T00:00:00+05:30`)
  return cached(`tokens:${adminKey.slice(-6)}:${ist}:${new Date().toISOString().slice(0, 15)}`, async () => {
    let usd = 0, tokens = 0, requestsModels = new Set<string>()
    let page: string | null = null
    do {
      const params: [string, string][] = [['starting_at', start.toISOString()], ['bucket_width', '1h'], ['group_by[]', 'model'], ['limit', '48']]
      if (page) params.push(['page', page])
      const data = await get(adminKey, '/usage_report/messages', params, false)
      for (const bucket of data.data || []) {
        for (const r of bucket.results || []) {
          const p = CLAUDE_PRICES[r.model] || CLAUDE_PRICES['claude-opus-5-5']
          const write5 = r.cache_creation?.ephemeral_5m_input_tokens || 0
          const write1h = r.cache_creation?.ephemeral_1h_input_tokens || 0
          usd += (
            (r.uncached_input_tokens || 0) * p.input + (r.output_tokens || 0) * p.output
            + (r.cache_read_input_tokens || 0) * p.cacheRead + write5 * p.input * 1.25 + write1h * p.input * 2
          ) / 1_000_000
          tokens += (r.uncached_input_tokens || 0) + (r.output_tokens || 0) + (r.cache_read_input_tokens || 0) + write5 + write1h
          if (r.model) requestsModels.add(r.model)
        }
      }
      page = data.has_more ? data.next_page : null
    } while (page)
    return { usd, tokens, models: [...requestsModels] }
  })
}

export async function anthropicBilling(adminKey: string, creditSince: string | null) {
  const now = new Date()
  const ist = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
  const monthStart = new Date(`${ist.slice(0, 8)}01T00:00:00+05:30`)
  const [month, today, since] = await Promise.all([
    billedCost(adminKey, monthStart, now),
    todayFromTokens(adminKey),
    creditSince ? billedCost(adminKey, new Date(`${creditSince}T00:00:00+05:30`), now) : Promise.resolve(null),
  ])
  return { month, today, since }
}
