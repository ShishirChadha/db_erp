import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { SocialPostSchema, BlogDraftSchema, type SocialPost, type BlogDraft } from './schemas'
import type { MarketingProduct } from './product-data'

// Marketing content generator. Same forced-tool structured-output shape as
// lib/recon/ai-extract.ts, applied to generation instead of extraction: the model is
// asked only for PHRASING (body copy, hashtags, CTA); every price, spec, and
// availability fact is injected as real data below and re-inserted into the final
// asset verbatim by the callers in app/api/marketing/generate/route.ts -- the model
// is never the source of a number a customer will see.

const MODEL = 'claude-sonnet-5'

export interface AiGenerateResult<T> {
  data: T
  inputTokens: number
  outputTokens: number
}

function getClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not set. Add it to apps/erp/.env.local to enable the Marketing Content Studio.')
  }
  return new Anthropic({ apiKey })
}

async function generateViaTool<T>(params: {
  toolName: string
  toolDescription: string
  schema: z.ZodType<T>
  system: string
  content: string
}): Promise<AiGenerateResult<T>> {
  const client = getClient()
  const inputSchema = z.toJSONSchema(params.schema, { target: 'draft-7' }) as Anthropic.Tool.InputSchema

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: params.system,
    tools: [{ name: params.toolName, description: params.toolDescription, input_schema: inputSchema }],
    tool_choice: { type: 'tool', name: params.toolName },
    messages: [{ role: 'user', content: params.content }],
  })

  const toolUse = message.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
  if (!toolUse) throw new Error('Model did not return structured content.')

  const parsed = params.schema.safeParse(toolUse.input)
  if (!parsed.success) throw new Error(`Generated content did not match expected shape: ${parsed.error.message}`)

  return { data: parsed.data, inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens }
}

export interface BrandVoice {
  brandVoice?: string | null
  defaultCta?: string | null
  contactBlock?: string | null
  disclaimer?: string | null
}

const BASE_SYSTEM = (voice: BrandVoice) => `You write marketing copy for DigitalBluez, a refurbished-laptop/desktop reseller in Greater Noida, India.
${voice.brandVoice ? `Brand voice: ${voice.brandVoice}` : 'Brand voice: friendly, trustworthy, a little energetic -- speaks to value-conscious buyers (students, remote workers, small businesses) considering refurbished tech.'}
Hard rules:
- Never state a price, a spec value (RAM/SSD/CPU/screen size), a warranty duration, or a stock count as a number in your copy -- those are inserted separately from verified inventory data after you write. Refer to them only descriptively ("a solid mid-range config", "backed by our warranty") if at all, never numerically.
- Never invent a feature, condition, or claim not given to you in the product facts below.
- Do not use excessive emojis -- 2 to 5 well-placed ones per post, matched to the platform.
${voice.disclaimer ? `- ${voice.disclaimer}` : ''}`

function productFacts(p: MarketingProduct): string {
  const lines = [
    `Title: ${p.display_title}`,
    `Category: ${p.category}`,
    `Configuration: ${p.config_summary || 'n/a'}`,
    p.web_condition_grade ? `Condition grade: ${p.web_condition_grade}` : null,
    p.web_highlights?.length ? `Highlights: ${p.web_highlights.join('; ')}` : null,
    p.availability_bucket === 'low_stock' ? 'Stock note: low stock, limited units left' : null,
  ].filter(Boolean)
  return lines.join('\n')
}

export async function generateSingleProductPost(params: {
  product: MarketingProduct
  platform: 'whatsapp' | 'instagram' | 'facebook' | 'google_business'
  voice: BrandVoice
}): Promise<AiGenerateResult<SocialPost>> {
  const platformNote: Record<string, string> = {
    whatsapp: 'Write for a WhatsApp broadcast/status message -- direct, conversational, short paragraphs.',
    instagram: 'Write an Instagram caption -- punchy opening line, can be a bit longer, hashtags matter.',
    facebook: 'Write a Facebook post -- slightly more descriptive than Instagram, fewer hashtags.',
    google_business: 'Write a Google Business Profile update post -- concise, local-SEO friendly, minimal hashtags.',
  }
  return generateViaTool({
    toolName: 'write_social_post',
    toolDescription: 'Write a single-product promotional social post.',
    schema: SocialPostSchema,
    system: BASE_SYSTEM(params.voice),
    content: `${platformNote[params.platform]}\n\nProduct facts (grounded, do not restate numerically):\n${productFacts(params.product)}`,
  })
}

export async function generateBlogDraft(params: {
  topic: string
  products: MarketingProduct[]
  voice: BrandVoice
}): Promise<AiGenerateResult<BlogDraft>> {
  const productLines = params.products.map((p) => `- ${p.display_title} (${p.config_summary})`).join('\n')
  return generateViaTool({
    toolName: 'write_blog_draft',
    toolDescription: 'Write a full blog post draft for the DigitalBluez website.',
    schema: BlogDraftSchema,
    system: BASE_SYSTEM(params.voice),
    content: `Write a buying-guide-style blog post on: "${params.topic}"\n\nGround it in these real products currently in stock (reference them by name descriptively; do not state their prices or exact specs as numbers -- links with real prices will be inserted after each mention):\n${productLines}`,
  })
}
