import type { MarketingProduct, RepresentativeUnit } from './product-data'
import { isMissingSpecValue, cpuSortKey, compareCpuSortKey } from './cpu-sort'

// Deterministic (no AI call) WhatsApp message builder, matching the owner's real
// broadcast style exactly -- a terse emoji-bulleted template, not narrative prose.
// Every fact (CPU/RAM/SSD/screen, battery health, warranty) is read straight off
// real inventory data; the only owner-editable inputs are marketing_settings'
// whatsapp_flavor_lines/default_warranty_label/contact_block. Deliberately no AI
// call for this platform -- it's the highest-frequency channel (sent daily) and a
// fixed template is both cheaper and more consistent than re-generating prose that
// would just be reformatted back into bullets anyway. IG/Facebook/GBP keep the
// AI-authored caption path in generate.ts, since those benefit from real prose.

export interface WhatsAppTemplateSettings {
  whatsappFlavorLines: string[]
  defaultWarrantyLabel: string | null
  contactBlock: string | null
}

// Real `specifications.generation` values are inconsistent across SKUs -- some are a
// bare number ("10"), some already carry the ordinal suffix ("10th", "11th Gen"), some
// are the literal string "No" (data-entry placeholder for "not recorded"). The old check
// (`/^\d+$/.test(generation)`) only matched the bare-number form, so every already-
// suffixed value silently dropped out of the bullet -- two laptops that differ only by
// generation (e.g. an i5 10th Gen and an i5 11th Gen, same RAM/SSD/screen) rendered as
// textually identical spec blocks, reading as duplicate entries in a broadcast even
// though findInStockProducts correctly kept them as separate SKUs. A missing/"No"
// generation now renders nothing at all (owner's explicit ask), rather than the old
// bug's literal "... i5 No Generation".
function generationLabel(generation: unknown): string {
  if (isMissingSpecValue(generation)) return ''
  const raw = String(generation).trim()
  if (/^\d+$/.test(raw)) return `${raw}th`
  return raw
}

function cpuBullet(specs: Record<string, any>): string | null {
  const cpu = specs.cpu
  if (!cpu) return null
  const genLabel = generationLabel(specs.generation)
  if (/^apple/i.test(cpu)) return `${cpu} Chip`
  if (/^r\d/i.test(cpu)) return `AMD Ryzen ${cpu.slice(1)}${genLabel ? ` ${genLabel} Gen` : ''}`
  return `Intel Core ${cpu}${genLabel ? ` ${genLabel} Generation` : ''}`
}

// Some real rows have both ram and ssd missing/"No" (data never captured at intake) --
// rather than a broken-looking bullet ("No / N"), default the *display* to a stated
// baseline (owner's explicit choice) when BOTH are missing. A single missing field (ram
// set but ssd not, or vice versa) just omits that one field rather than guessing it.
function ramSsdBullet(specs: Record<string, any>): string | null {
  const ramMissing = isMissingSpecValue(specs.ram)
  const ssdMissing = isMissingSpecValue(specs.ssd)
  if (ramMissing && ssdMissing) return '8GB / 256GB'
  const parts = [ramMissing ? null : specs.ram, ssdMissing ? null : specs.ssd].filter(Boolean)
  return parts.length ? parts.join(' / ') : null
}

function screenBullet(specs: Record<string, any>): string | null {
  if (!specs.screen_size) return null
  const touch = specs.display_type || 'Non-Touch'
  return `${specs.screen_size}"inches" ${touch} display`
}

// Deterministic per-run rotation (not random) so re-generating the same SKU on the
// same day picks the same flavor lines rather than jittering on every click --
// stable across repeated generates, still varies day to day / product to product.
function pickFlavorLines(pool: string[], seed: string, count: number): string[] {
  if (pool.length === 0) return []
  let hash = 0
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0
  const start = hash % pool.length
  const picked: string[] = []
  for (let i = 0; i < Math.min(count, pool.length); i++) picked.push(pool[(start + i) % pool.length])
  return picked
}

// The CPU/RAM/SSD spec vocabulary (cpuBullet/ramSsdBullet, including the "No"->empty
// handling and the 8GB/256GB missing-data fallback) only makes sense for categories that
// actually have cpu/ram/ssd fields in their sku_category_templates field_schema --
// confirmed Laptop and Desktop, nothing else (Monitor has size/resolution/panel_type,
// Accessory has item_name/description, RAM/SSD/GPU/CPU components have their own
// capacity/type fields, etc.). Applying the laptop bullet builder to those categories
// produced nonsense output (e.g. a power cable or a RAM stick both rendering "👉 8GB /
// 256GB", monitors showing a fake RAM/SSD line they don't have at all) -- every other
// category instead uses product.config_diff, a generic per-field spec line already
// built from that category's own real field_schema (see product-data.ts).
const CPU_AWARE_CATEGORIES = new Set(['LAP', 'DES'])

export function buildSpecBullets(product: MarketingProduct): string[] {
  if (!CPU_AWARE_CATEGORIES.has(product.category)) {
    return product.config_diff ? product.config_diff.split(' / ').filter(Boolean) : []
  }
  const specs = product.specifications || {}
  return [cpuBullet(specs), ramSsdBullet(specs), screenBullet(specs)].filter((b): b is string => !!b)
}

// A clean identifying heading for the template's title line -- deliberately NOT
// product.display_title, which falls back to the full config_summary
// ("Dell 5400 — i5 / 8th / 16GB / 512GB...") when web_title isn't curated. That
// summary is exactly what the bullets below already show; repeating it in the
// 🚨 title line duplicates it and doesn't match the owner's real terse style
// (e.g. "🚨Lenovo IdeaPad 5-14ITL05🚨"). model_name is empty for categories that don't
// capture a "model" field at all (Accessory/Other use item_name instead, e.g. "Power
// Cable C to C") -- fall back to that, then to the SKU code, rather than printing a
// bare brand with no identifying info.
export function templateTitle(product: MarketingProduct): string {
  const specs = product.specifications || {}
  const identifier =
    (product.model_name && product.model_name.trim()) ||
    (typeof specs.item_name === 'string' && specs.item_name.trim()) ||
    null
  const base = [product.brand, identifier].filter(Boolean).join(' ') || product.full_sku_code
  const extras = [specs.screen_size ? `${specs.screen_size}"` : null, specs.model_year || null].filter(Boolean)
  return extras.length ? `${base} ${extras.join(' ')}` : base
}

export function buildSingleProductWhatsAppMessage(
  product: MarketingProduct,
  unit: RepresentativeUnit | null,
  settings: WhatsAppTemplateSettings
): string {
  const specBullets = buildSpecBullets(product)
  const flavorLines = pickFlavorLines(settings.whatsappFlavorLines, product.id, 2)
  const batteryBullet = unit?.battery_health_percent != null ? `${unit.battery_health_percent}% Battery Health` : null

  const specLines = [...specBullets, batteryBullet].filter((b): b is string => !!b).map((b) => `💫 ${b}`)
  const flavorLineLines = flavorLines.map((f) => `💫 ${f}`)
  const warrantyLabel = unit?.warranty_duration_months
    ? `${unit.warranty_duration_months} Months Warranty`
    : settings.defaultWarrantyLabel

  const lines = [
    `🚨${templateTitle(product)}🚨`,
    '',
    ...specLines,
    ...flavorLineLines,
    '',
    ...(warrantyLabel ? [`🕊${warrantyLabel}`] : []),
    '🕊 Bill and Box',
    '',
    ...(settings.contactBlock ? [settings.contactBlock] : []),
  ]
  return lines.join('\n')
}

// One CPU/RAM/SSD line for a single config variant, used under a shared model header
// (buildProductListWhatsAppMessage groups by templateTitle) -- screen *size* is already
// in that header, so it isn't repeated per variant. Touch is called out only when it's
// actually "Touch" (the non-default case) -- two variants that differ only by touch
// would otherwise render an identical line under the same header.
function variantBullet(product: MarketingProduct): string {
  if (!CPU_AWARE_CATEGORIES.has(product.category)) return product.config_diff || ''
  const specs = product.specifications || {}
  const parts = [cpuBullet(specs), ramSsdBullet(specs)].filter((b): b is string => !!b)
  if (specs.display_type && /^touch$/i.test(String(specs.display_type))) parts.push('Touch')
  return parts.join(' / ')
}

// Group a brand's products into model-header sections (brand + model + screen/year, via
// templateTitle) so several real config variants of the same laptop -- e.g. a Dell
// Latitude 5310 13.3" in both an 8GB/256GB and a 16GB/512GB build -- print under one
// header with one bullet line per variant, instead of repeating the full header per
// variant. Ordered i3 (lowest generation first) -> i5 -> i7 -> i9 -> everything else,
// both for which header comes first (by its lowest-tier variant) and which variant
// bullet comes first within a header spanning more than one tier (e.g. a model sold
// with both an i5 and an i7 build).
function buildModelSections(products: MarketingProduct[]): string[] {
  const groups = new Map<string, MarketingProduct[]>()
  for (const p of products) {
    const title = templateTitle(p)
    const existing = groups.get(title)
    if (existing) existing.push(p)
    else groups.set(title, [p])
  }

  return Array.from(groups.entries())
    .map(([title, variants]) => {
      const sortedVariants = [...variants].sort((a, b) => compareCpuSortKey(cpuSortKey(a.specifications), cpuSortKey(b.specifications)))
      const groupKey = sortedVariants.length ? cpuSortKey(sortedVariants[0].specifications) : ([4, Number.MAX_SAFE_INTEGER] as [number, number])
      return { title, groupKey, variants: sortedVariants }
    })
    .sort((a, b) => compareCpuSortKey(a.groupKey, b.groupKey) || a.title.localeCompare(b.title))
    .map(({ title, variants }) => {
      const bullets = variants.map((p) => variantBullet(p)).filter((b) => b.length > 0).map((b) => `👉 ${b}`)
      return [title, ...bullets].join('\n')
    })
}

export function buildProductListWhatsAppMessage(
  theme: string,
  products: MarketingProduct[],
  settings: WhatsAppTemplateSettings
): string {
  // Brand first (owner's explicit ask): group by brand, sort brands alphabetically, then
  // apply the existing model-header + CPU-tier sort rules within each brand's own list.
  const brandGroups = new Map<string, MarketingProduct[]>()
  for (const p of products) {
    const brand = p.brand || 'Other'
    const existing = brandGroups.get(brand)
    if (existing) existing.push(p)
    else brandGroups.set(brand, [p])
  }

  const sections = Array.from(brandGroups.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([brand, brandProducts]) => [`*${brand}*`, ...buildModelSections(brandProducts)].join('\n\n'))

  const lines = [
    `🚨${theme}🚨`,
    '',
    ...sections.flatMap((s, i) => (i < sections.length - 1 ? [s, ''] : [s])),
    '',
    'Price:- Call for best',
    '',
    ...(settings.contactBlock ? [settings.contactBlock] : []),
  ]
  return lines.join('\n')
}
