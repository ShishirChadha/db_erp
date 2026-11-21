import { supabaseAdmin } from '@/lib/supabase/service'

// List prices, per the Claude API model table (USD per million tokens) and
// sarvam.ai/api-pricing (INR, pay-as-you-go), as of 2026-11. Cache writes are
// 1.25x the input price for the 5-minute cache and 2x for the 1-hour cache. Update here if a provider changes price.
export const CLAUDE_PRICES: Record<string, { input: number; output: number; cacheRead: number }> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.1 },
  // Haiku 5.5: prompts up to 100K tokens (DB's are ~11-20K). Above that it is
  // $0.50 / $2.50, which DB never reaches.
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01 },
  'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.2 },
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-opus-4-8': { input: 5, output: 25, cacheRead: 0.5 },
}
const SARVAM_STT_INR_PER_MIN = 0.49
const SARVAM_TTS_INR_PER_1K = { 'bulbul:v4-flash': 2, 'bulbul:v3': 3 } as const

export async function recordClaudeUsage(p: {
  profileId: string; threadId: string; model: string; usdInr: number
  usage: {
    input_tokens?: number | null; output_tokens?: number | null; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null
    cache_creation?: { ephemeral_5m_input_tokens?: number | null; ephemeral_1h_input_tokens?: number | null } | null
  }
}) {
  const price = CLAUDE_PRICES[p.model] || CLAUDE_PRICES['claude-opus-5-5']
  const input = p.usage.input_tokens || 0
  const output = p.usage.output_tokens || 0
  const read = p.usage.cache_read_input_tokens || 0
  const write = p.usage.cache_creation_input_tokens || 0
  const write1h = Math.min(write, p.usage.cache_creation?.ephemeral_1h_input_tokens || 0)
  const write5m = write - write1h
  const usd = (input * price.input + output * price.output + read * price.cacheRead + write5m * price.input * 1.25 + write1h * price.input * 2) / 1_000_000
  await supabaseAdmin.from('assistant_usage').insert({
    profile_id: p.profileId, thread_id: p.threadId, provider: 'anthropic', model: p.model,
    input_tokens: input, output_tokens: output, cache_read_tokens: read, cache_write_tokens: write,
    cost_usd: usd, cost_inr: usd * p.usdInr,
  })
}

export async function recordSarvamUsage(p: {
  profileId: string; kind: 'stt' | 'tts'; usdInr: number; seconds?: number; characters?: number; model: string
}) {
  const inr = p.kind === 'stt'
    ? ((p.seconds || 0) / 60) * SARVAM_STT_INR_PER_MIN
    : ((p.characters || 0) / 1000) * (SARVAM_TTS_INR_PER_1K[p.model as keyof typeof SARVAM_TTS_INR_PER_1K] ?? 2)
  await supabaseAdmin.from('assistant_usage').insert({
    profile_id: p.profileId, provider: p.kind === 'stt' ? 'sarvam_stt' : 'sarvam_tts', model: p.model,
    audio_seconds: p.seconds ?? null, characters: p.characters ?? null,
    cost_inr: inr, cost_usd: inr / p.usdInr,
  })
}

// Azure and Google voices are free inside their monthly allowance; record the
// characters so Settings can show how much of it is used.
export const FREE_TTS_CHARS = { azure_tts: 500_000, google_tts: 1_000_000 } as const

export async function recordFreeTtsUsage(p: { profileId: string; provider: 'azure_tts' | 'google_tts'; model: string; characters: number }) {
  await supabaseAdmin.from('assistant_usage').insert({
    profile_id: p.profileId, provider: p.provider, model: p.model, characters: p.characters, cost_inr: 0, cost_usd: 0,
  })
}

export async function usageSummary(since: string | null) {
  const monthStart = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }).slice(0, 8) + '01'
  const todayStart = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
  const from = [since, monthStart].filter(Boolean).sort()[0] as string
  const { data } = await supabaseAdmin.from('assistant_usage')
    .select('created_at, provider, cost_usd, cost_inr, thread_id, characters')
    .gte('created_at', `${from}T00:00:00+05:30`)
    .limit(20000)
  const rows = data || []
  const sum = (filter: (r: any) => boolean) => rows.filter(filter).reduce(
    (a, r) => ({ usd: a.usd + Number(r.cost_usd), inr: a.inr + Number(r.cost_inr) }), { usd: 0, inr: 0 })
  const ist = (r: any) => new Date(r.created_at).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
  const claude = (r: any) => r.provider === 'anthropic'
  const sarvam = (r: any) => r.provider === 'sarvam_stt' || r.provider === 'sarvam_tts'
  const chars = (provider: string) => rows.filter((r) => r.provider === provider && ist(r) >= monthStart).reduce((a, r) => a + (Number(r.characters) || 0), 0)
  const conversationsThisMonth = new Set(rows.filter((r) => ist(r) >= monthStart && r.thread_id).map((r) => r.thread_id)).size
  return {
    today: { claude: sum((r) => claude(r) && ist(r) === todayStart), sarvam: sum((r) => sarvam(r) && ist(r) === todayStart) },
    month: { claude: sum((r) => claude(r) && ist(r) >= monthStart), sarvam: sum((r) => sarvam(r) && ist(r) >= monthStart) },
    since_credit: since ? { claude: sum((r) => claude(r) && ist(r) >= since), sarvam: sum((r) => sarvam(r) && ist(r) >= since) } : null,
    conversations_this_month: conversationsThisMonth,
    free_voice_chars_month: { azure: chars('azure_tts'), google: chars('google_tts') },
  }
}
