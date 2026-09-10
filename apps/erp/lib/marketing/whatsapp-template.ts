import type { MarketingProduct, RepresentativeUnit } from './product-data'

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

function cpuBullet(specs: Record<string, any>): string | null {
  const cpu = specs.cpu
  if (!cpu) return null
  const generation = specs.generation
  const hasGen = generation && /^\d+$/.test(String(generation))
  if (/^apple/i.test(cpu)) return `${cpu} Chip`
  if (/^r\d/i.test(cpu)) return `AMD Ryzen ${cpu.slice(1)}${hasGen ? ` ${generation}th Gen` : ''}`
  return `Intel Core ${cpu}${hasGen ? ` ${generation}th Generation` : ''}`
}

function ramSsdBullet(specs: Record<string, any>): string | null {
  const parts = [specs.ram, specs.ssd].filter(Boolean)
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

export function buildSpecBullets(product: MarketingProduct): string[] {
  const specs = product.specifications || {}
  return [cpuBullet(specs), ramSsdBullet(specs), screenBullet(specs)].filter((b): b is string => !!b)
}

// A clean brand+model heading for the template's title line -- deliberately NOT
// product.display_title, which falls back to the full config_summary
// ("Dell 5400 — i5 / 8th / 16GB / 512GB...") when web_title isn't curated. That
// summary is exactly what the bullets below already show; repeating it in the
// 🚨 title line duplicates it and doesn't match the owner's real terse style
// (e.g. "🚨Lenovo IdeaPad 5-14ITL05🚨").
export function templateTitle(product: MarketingProduct): string {
  const specs = product.specifications || {}
  const base = [product.brand, product.model_name].filter(Boolean).join(' ') || product.full_sku_code
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

export function buildProductListWhatsAppMessage(
  theme: string,
  products: MarketingProduct[],
  settings: WhatsAppTemplateSettings
): string {
  const sections = products.map((p) => {
    const bullets = buildSpecBullets(p).map((b) => `👉 ${b}`)
    return [templateTitle(p), ...bullets].join('\n')
  })

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
