import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser, hasPageAccess } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'
import { getPublishedProductById, getInStockProductById, findPublishedProducts, findInStockProducts, getRepresentativeUnit, type MarketingProduct } from '@/lib/marketing/product-data'
import { generateSingleProductPost, generateBlogDraft, type BrandVoice } from '@/lib/marketing/generate'
import { buildProductUrl, buildWhatsAppShareLink } from '@/lib/marketing/share-links'
import { buildSingleProductWhatsAppMessage, buildProductListWhatsAppMessage, type WhatsAppTemplateSettings } from '@/lib/marketing/whatsapp-template'

// Generates a marketing_assets draft grounded in real published-catalogue data.
// canEditPage('marketing') gates this (owner or an explicitly-granted employee) --
// generation is a draft, not a publish, so it doesn't need to be owner-only.
//
// WhatsApp is deliberately NOT AI-generated -- it's the owner's real, highest-
// frequency channel (sent daily), and their actual style is a fixed terse
// emoji-bulleted template, not narrative prose (see lib/marketing/whatsapp-template.ts
// and docs/decisions.md). Instagram/Facebook/Google Business Profile keep the
// AI-authored caption path, which is what the daily-generation cap below guards
// (a WhatsApp send costs zero AI tokens and isn't counted against it).
export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasPageAccess(sessionUser, 'marketing')) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const body = await req.json()
  const { mode, platform, sku_id, filter, theme, topic } = body as {
    mode: 'single_product' | 'product_list' | 'blog'
    platform: 'whatsapp' | 'instagram' | 'facebook' | 'google_business' | 'blog'
    sku_id?: string
    filter?: { category?: string; brand?: string; spec?: Record<string, string>; priceMin?: number; priceMax?: number; inStockOnly?: boolean; limit?: number; skuIds?: string[]; search?: string }
    theme?: string
    topic?: string
  }

  const { data: settingsRow } = await supabaseAdmin.from('marketing_settings').select('*').eq('id', true).maybeSingle()
  const voice: BrandVoice = {
    brandVoice: settingsRow?.brand_voice,
    defaultCta: settingsRow?.default_cta,
    contactBlock: settingsRow?.contact_block,
    disclaimer: settingsRow?.disclaimer,
  }
  const waSettings: WhatsAppTemplateSettings = {
    whatsappFlavorLines: settingsRow?.whatsapp_flavor_lines || [],
    defaultWarrantyLabel: settingsRow?.default_warranty_label || null,
    contactBlock: settingsRow?.contact_block || null,
  }
  const isAiCall = (mode === 'single_product' && platform !== 'whatsapp') || mode === 'blog'
  if (isAiCall) {
    const cap = settingsRow?.daily_generation_cap ?? 50
    const since = new Date(); since.setHours(0, 0, 0, 0)
    const { count: usedToday } = await supabaseAdmin
      .from('marketing_assets')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', since.toISOString())
      .not('ai_model', 'is', null)
    if ((usedToday ?? 0) >= cap) {
      return NextResponse.json({ error: `Daily AI-generation cap (${cap}) reached. Adjust it in Settings -> Marketing.` }, { status: 429 })
    }
  }

  try {
    if (mode === 'single_product') {
      if (!sku_id) return NextResponse.json({ error: 'sku_id is required' }, { status: 400 })
      if (platform === 'blog') return NextResponse.json({ error: 'Use mode=blog for blog posts.' }, { status: 400 })

      // WhatsApp's template carries no product URL, so any currently-in-stock item can
      // be promoted regardless of website-publish status (same reasoning as
      // findInStockProducts / Product List). Instagram/Facebook/Google Business Profile
      // content always ends with a real deep link (buildProductUrl below), which only
      // resolves for a published SKU -- those platforms keep the publish requirement.
      const product = platform === 'whatsapp' ? await getInStockProductById(sku_id) : await getPublishedProductById(sku_id)
      if (!product) {
        const message = platform === 'whatsapp'
          ? 'That item is not currently in stock.'
          : 'That SKU is not published on the website yet -- publish it first via SKU Master -> Website, or generate a WhatsApp message instead (WhatsApp doesn\'t require publishing).'
        return NextResponse.json({ error: message }, { status: 400 })
      }

      let bodyWithLink: string
      let hashtags: string[] = []
      let ctaText: string | null = null
      let altText: string | null = null
      let aiModel: string | null = null
      let inputTokens: number | null = null
      let outputTokens: number | null = null

      if (platform === 'whatsapp') {
        const unit = await getRepresentativeUnit(product.id)
        bodyWithLink = buildSingleProductWhatsAppMessage(product, unit, waSettings)
      } else {
        const result = await generateSingleProductPost({ product, platform, voice })
        const url = buildProductUrl(product.web_slug, { source: platform })
        bodyWithLink = `${result.data.body_text}\n\n${result.data.cta_text}\n${url}${voice.contactBlock ? `\n${voice.contactBlock}` : ''}`
        hashtags = result.data.hashtags
        ctaText = result.data.cta_text
        altText = result.data.alt_text ?? null
        aiModel = 'claude-sonnet-5'
        inputTokens = result.inputTokens
        outputTokens = result.outputTokens
      }

      const insert = {
        kind: 'single_product' as const,
        platform,
        format: platform === 'whatsapp' ? 'wa_text' : 'none',
        title: product.display_title,
        body_text: bodyWithLink,
        hashtags,
        cta_text: ctaText,
        alt_text: altText,
        source_sku_ids: [product.id],
        source_filter: null,
        status: 'draft',
        ai_model: aiModel,
        ai_input_tokens: inputTokens,
        ai_output_tokens: outputTokens,
        created_by: sessionUser.id,
      }
      const { data: row, error } = await supabaseAdmin.from('marketing_assets').insert(insert).select('*').single()
      if (error) return NextResponse.json({ error: error.message }, { status: 400 })

      await logAuditEvent({
        actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
        actionType: 'create', module: 'marketing', tableName: 'marketing_assets', recordId: row.id,
        recordLabel: row.title, metadata: { ai_input_tokens: inputTokens, ai_output_tokens: outputTokens },
      })
      return NextResponse.json({ asset: row, product, whatsapp_share_link: buildWhatsAppShareLink(bodyWithLink) }, { status: 201 })
    }

    if (mode === 'product_list') {
      // findInStockProducts, not findPublishedProducts -- this broadcast promotes real
      // current inventory to an existing contact list, not the website (no product
      // links in the template), so it isn't gated to published SKUs. limit defaults to
      // 60 (not the old hard 20) so "all X in stock" with no other filter actually shows
      // everything realistic; still bounded so a filterless, category-less request can't
      // return the entire catalogue as one WhatsApp message.
      const products = await findInStockProducts({ ...filter, limit: filter?.limit ?? 60 })
      if (products.length === 0) return NextResponse.json({ error: 'No in-stock products matched that filter.' }, { status: 400 })

      const themeLabel = theme || 'Products in Stock'
      const bodyText = buildProductListWhatsAppMessage(themeLabel, products, waSettings)

      const insert = {
        kind: 'product_list' as const,
        platform: 'whatsapp' as const,
        format: 'wa_text' as const,
        title: themeLabel,
        body_text: bodyText,
        hashtags: [],
        source_sku_ids: products.map((p) => p.id),
        source_filter: filter || null,
        status: 'draft',
        created_by: sessionUser.id,
      }
      const { data: row, error } = await supabaseAdmin.from('marketing_assets').insert(insert).select('*').single()
      if (error) return NextResponse.json({ error: error.message }, { status: 400 })

      await logAuditEvent({
        actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
        actionType: 'create', module: 'marketing', tableName: 'marketing_assets', recordId: row.id,
        recordLabel: row.title,
      })
      return NextResponse.json({ asset: row, products, whatsapp_share_link: buildWhatsAppShareLink(bodyText) }, { status: 201 })
    }

    if (mode === 'blog') {
      if (!topic) return NextResponse.json({ error: 'topic is required' }, { status: 400 })
      const products = await findPublishedProducts({ ...filter, limit: 8 })
      const result = await generateBlogDraft({ topic, products, voice })

      const insert = {
        kind: 'blog' as const,
        platform: 'blog' as const,
        format: 'none' as const,
        title: result.data.title,
        body_text: result.data.body_markdown,
        hashtags: result.data.tags,
        source_sku_ids: products.map((p) => p.id),
        source_filter: filter || null,
        status: 'draft',
        ai_model: 'claude-sonnet-5',
        ai_input_tokens: result.inputTokens,
        ai_output_tokens: result.outputTokens,
        created_by: sessionUser.id,
      }
      const { data: row, error } = await supabaseAdmin.from('marketing_assets').insert(insert).select('*').single()
      if (error) return NextResponse.json({ error: error.message }, { status: 400 })

      await logAuditEvent({
        actor: { id: sessionUser.id, email: sessionUser.email, role: sessionUser.role },
        actionType: 'create', module: 'marketing', tableName: 'marketing_assets', recordId: row.id,
        recordLabel: row.title, metadata: { ai_input_tokens: result.inputTokens, ai_output_tokens: result.outputTokens, meta_title: result.data.meta_title, meta_description: result.data.meta_description },
      })
      return NextResponse.json({ asset: row, products }, { status: 201 })
    }

    return NextResponse.json({ error: `Unknown mode: ${mode}` }, { status: 400 })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Generation failed' }, { status: 500 })
  }
}

export type { MarketingProduct }
