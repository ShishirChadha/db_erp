import { cache } from 'react'
import type { Metadata } from 'next'
import { createPublicSupabaseClient } from '@db/db/public'
import { productImageUrl } from '@/lib/image-url'

// Owner-managed SEO data (ERP: Settings -> Website SEO). Read through the
// public_seo_* / public_redirects views only; every read degrades to "no
// override" on error, so a hiccup here can never break page rendering.

export interface SeoSettings {
  default_description: string | null
  default_og_image_path: string | null
  product_description_template: string | null
}

export interface SeoOverride {
  entity_type: 'product' | 'category' | 'static' | 'blog'
  entity_key: string
  meta_title: string | null
  meta_description: string | null
  og_image_path: string | null
  robots_index: boolean | null
  canonical_override: string | null
}

export const getSeoSettings = cache(async (): Promise<SeoSettings> => {
  try {
    const supabase = createPublicSupabaseClient()
    const { data } = await supabase
      .from('public_seo_settings')
      .select('default_description, default_og_image_path, product_description_template')
      .maybeSingle()
    return (data as SeoSettings) ?? { default_description: null, default_og_image_path: null, product_description_template: null }
  } catch {
    return { default_description: null, default_og_image_path: null, product_description_template: null }
  }
})

export const getSeoOverride = cache(async (type: SeoOverride['entity_type'], key: string): Promise<SeoOverride | null> => {
  try {
    const supabase = createPublicSupabaseClient()
    const { data } = await supabase
      .from('public_seo_overrides')
      .select('entity_type, entity_key, meta_title, meta_description, og_image_path, robots_index, canonical_override')
      .eq('entity_type', type)
      .eq('entity_key', key)
      .maybeSingle()
    return (data as SeoOverride) ?? null
  } catch {
    return null
  }
})

// Single-hop by construction: the ERP flattens chains and rejects loops when a
// redirect is saved, so one lookup is always the final destination.
export const getRedirectTarget = cache(async (fromPath: string): Promise<string | null> => {
  try {
    const supabase = createPublicSupabaseClient()
    const { data } = await supabase.from('public_redirects').select('to_path').eq('from_path', fromPath).maybeSingle()
    const to = (data as { to_path: string } | null)?.to_path ?? null
    return to && to !== fromPath ? to : null
  } catch {
    return null
  }
})

// "{title}, from {price}" -> filled in. Unknown tokens are left untouched.
export function renderTemplate(template: string, values: Record<string, string | null | undefined>): string {
  return template.replace(/\{(\w+)\}/g, (match, token: string) => values[token] ?? match).replace(/\s+/g, ' ').trim()
}

// Applies a published owner override on top of a page's built-in metadata.
// Only the fields the owner actually filled in change anything.
export async function withSeoOverride(
  base: Metadata,
  type: SeoOverride['entity_type'],
  key: string
): Promise<Metadata> {
  const override = await getSeoOverride(type, key)
  if (!override) return base

  const merged: Metadata = { ...base }
  if (override.meta_title) merged.title = override.meta_title
  if (override.meta_description) merged.description = override.meta_description
  if (override.canonical_override) merged.alternates = { ...base.alternates, canonical: override.canonical_override }
  if (override.robots_index !== null) {
    merged.robots = override.robots_index ? { index: true, follow: true } : { index: false, follow: false }
  }
  if (override.meta_title || override.meta_description || override.og_image_path) {
    merged.openGraph = {
      ...(base.openGraph ?? {}),
      ...(override.meta_title ? { title: override.meta_title } : {}),
      ...(override.meta_description ? { description: override.meta_description } : {}),
      ...(override.og_image_path ? { images: [productImageUrl(override.og_image_path)] } : {}),
    } as Metadata['openGraph']
  }
  return merged
}
