// Server-side: one Auto Check session row -> everything the review screen shows.
// Detected specs matched to the owner's dropdown spellings, the existing SKU
// this unit belongs to (if any), whether the serial is already in the ERP, the
// QC verdicts, condition fields and a suggested grade.
//
// Never selects cost/vendor columns: employees use this screen.

import { supabaseAdmin } from '@/lib/supabase/service'
import { normalizeSpecifications } from '@/lib/sku-normalizer'
import { getCustomOptionsCategory } from '@/lib/sku-field-options'
import { normalizeForComparison } from '@/lib/text-normalize'
import { findDuplicateSerial } from '@/lib/duplicate-serial'
import { COSMETIC_AREAS, COSMETIC_LEVELS, TEMPLATE_SYNONYMS, CHECKS, RE_QC_STATUSES, type DeviceKind } from './checklist'
import { aNumber, macModel } from './mac-models'
import { platformOf, batteryHealth, gpuMemoryGb, cleanSerial, deviceKind, detectSpecs, internalDisks, internalMonitor, isPlaceholderSerial, parseCpu } from './parse'
import { evaluateChecks, THRESHOLDS, type Verdict } from './rules'
import type { BackgroundResults, CosmeticLevel, HardwareReport, InteractiveResults, LiveSnapshot, SessionOptions } from './types'

export interface SessionRow {
  id: string
  code: string
  created_by: string
  created_at: string
  expires_at: string
  status: 'waiting' | 'running' | 'completed'
  options: SessionOptions | null
  hardware_report: HardwareReport | null
  reported_at: string | null
  background_results: BackgroundResults | null
  live: LiveSnapshot | null
  live_at: string | null
  interactive_results: InteractiveResults | null
  asset_id: string | null
  completed_at: string | null
}

export interface SpecMeta {
  detected: string
  is_new: boolean
  options_category: string | null
}

export interface SkuMatch {
  id: string
  full_sku_code: string
  description: string
  quantity_in_stock: number
  specifications: Record<string, any>
}

export interface Evaluation {
  device: DeviceKind
  type: 'Laptop' | 'Desktop'
  category: 'LAP' | 'DES'
  serial: string
  serial_placeholder: boolean
  specs: Record<string, any>
  spec_meta: Record<string, SpecMeta>
  sku_match: SkuMatch | null
  existing_unit: {
    id: string; status: string; asset_number: string | null; qcable: boolean
    /** The run was started from this unit's QC tab. */
    target: boolean
    /** Target unit's recorded serial, when it differs from the machine's -- wrong laptop. */
    serial_mismatch: string | null
  } | null
  verdicts: Verdict[]
  battery_health_percent: number | null
  /** 100 - wear of the worst internal drive; null when wear couldn't be read (no admin). */
  storage_health_percent: number | null
  estimated_backup_hours: number | null
  conditions: { screen_condition: string | null; keyboard_condition: string | null; body_condition: string | null }
  suggested_grade: string | null
  cosmetic_done: boolean
  hardware_lines: string[]
}



// ---------- grading ----------

const LEVEL_RANK: Record<CosmeticLevel, number> = { like_new: 0, light: 1, visible: 2, damaged: 3 }
const GRADES = ['A', 'B', 'C', 'D']

const conditionOf = (level: CosmeticLevel | undefined) =>
  level ? COSMETIC_LEVELS.find((l) => l.key === level)?.condition ?? null : null

function worst(levels: (CosmeticLevel | undefined)[]): CosmeticLevel | undefined {
  const present = levels.filter((l): l is CosmeticLevel => !!l)
  if (!present.length) return undefined
  return present.reduce((a, b) => (LEVEL_RANK[b] > LEVEL_RANK[a] ? b : a))
}

export function gradeAndConditions(device: DeviceKind, cosmetic: Record<string, CosmeticLevel> | undefined, batteryPct: number | null) {
  const c = cosmetic || {}
  const areas = COSMETIC_AREAS.filter((a) => !a.only || a.only === device)
  const done = areas.every((a) => !!c[a.key])
  const overall = worst(areas.map((a) => c[a.key]))
  let grade: string | null = null
  if (done && overall) {
    let idx = LEVEL_RANK[overall]
    // A weak battery (usable but under the "good" line) costs one grade step.
    if (device === 'laptop' && batteryPct != null && batteryPct < THRESHOLDS.batteryGood) idx = Math.min(idx + 1, GRADES.length - 1)
    grade = GRADES[idx]
  }
  const conditions = device === 'laptop'
    ? {
        screen_condition: conditionOf(c.screen_glass),
        keyboard_condition: conditionOf(worst([c.keys, c.palmrest])),
        body_condition: conditionOf(worst([c.lid, c.palmrest, c.bottom])),
      }
    : { screen_condition: null, keyboard_condition: null, body_condition: conditionOf(worst([c.case, c.front])) }
  return { grade, conditions, done }
}

// ---------- dropdown matching ----------

const cmp = (field: string, value: unknown): string => {
  if (value == null) return ''
  const s = String(value).trim()
  if (/^(no|none|na|n\/a|nil|integrated|-|0)$/i.test(s)) return ''
  if (field === 'screen_size') { const n = parseFloat(s); return Number.isFinite(n) ? String(n) : '' }
  if (field === 'generation') return (s.match(/\d+/) || [normalizeForComparison(s)])[0]
  return normalizeForComparison(s).replace(/\s+/g, '')
}

// "4GB NVIDIA T500" and "NVIDIA T500" are the same card: compare the model,
// and the memory only when both sides state it.
function gpuParts(v: unknown): { gb: string | null; name: string } {
  const s = String(v ?? '')
  const gb = s.match(/(\d+)\s*GB/i)?.[1] ?? null
  const name = normalizeForComparison(s.replace(/\d+\s*GB/ig, ' ').replace(/\b(nvidia|geforce|amd|graphics)\b/ig, ' ')).replace(/\s+/g, '')
  return { gb, name }
}
function sameGpu(a: unknown, b: unknown): boolean {
  const x = gpuParts(a), y = gpuParts(b)
  if (x.name && y.name && x.name !== y.name) return false
  if (x.gb && y.gb && x.gb !== y.gb) return false
  return true
}

// For picking the dropdown spelling: same card AND same memory (or neither states it).
function sameGpuExact(a: unknown, b: unknown): boolean {
  const x = gpuParts(a), y = gpuParts(b)
  return !!x.name && x.name === y.name && x.gb === y.gb
}

async function canonicalizeSpecs(category: string, detected: Record<string, any>, fieldNames: string[]) {
  const specs: Record<string, any> = {}
  const meta: Record<string, SpecMeta> = {}
  const wanted = fieldNames.filter((f) => detected[f] !== undefined && detected[f] !== '')
  const optionCats = Array.from(new Set(wanted.map((f) => getCustomOptionsCategory(category, f)).filter((c): c is string => !!c)))

  const byCat: Record<string, string[]> = {}
  if (optionCats.length) {
    const { data } = await supabaseAdmin
      .from('custom_options').select('category, value').in('category', optionCats).eq('is_active', true)
    for (const row of data || []) (byCat[row.category] ||= []).push(row.value)
  }

  for (const field of wanted) {
    const raw = detected[field]
    const optCat = getCustomOptionsCategory(category, field) || null
    if (typeof raw === 'boolean' || !optCat) {
      specs[field] = raw
      meta[field] = { detected: String(raw), is_new: false, options_category: null }
      continue
    }
    const target = cmp(field, raw)
    const hit = field === 'gpu'
      ? (byCat[optCat] || []).find((o) => sameGpuExact(o, raw))
      : (byCat[optCat] || []).find((o) => cmp(field, o) === target && target !== '')
    specs[field] = hit ?? (field === 'screen_size' ? `${raw} inch` : String(raw))
    meta[field] = { detected: String(raw), is_new: !hit, options_category: optCat }
  }
  return { specs, meta }
}

// ---------- SKU matching ----------

// resolveOrCreateSku only reuses a SKU when EVERY spec matches exactly, and
// Auto Check fills more fields (resolution, webcam, OS) than most existing SKUs
// were entered with -- so sending detected specs would mint a duplicate SKU for
// nearly every unit. Instead the review screen picks the existing SKU for the
// same brand + model whose price-relevant fields match, and sends its sku_id.
async function findSkuMatch(category: string, specs: Record<string, any>, variantFields: string[]): Promise<SkuMatch | null> {
  if (!specs.brand || !specs.model) return null
  const norm = await normalizeSpecifications(category, specs)
  const { data } = await supabaseAdmin
    .from('sku_master')
    .select('id, full_sku_code, sku_description, quantity_in_stock, specifications, brand, model_name, status')
    .eq('category', category)
    .neq('status', 'archived')
    .ilike('brand', String(specs.brand))
    .limit(500)
  const model = normalizeForComparison(String(specs.model))
  const fields = Array.from(new Set([...variantFields, 'generation']))
  // Apple SKUs here are named inconsistently ("Macbook A2337", "MacBook Air
  // A2337", "Macbook Pro 2485"); the A-number is the reliable part.
  const wantA = /^apple$/i.test(String(specs.brand)) ? aNumber(String(specs.model)) : null

  let best: { row: any; score: number } | null = null
  for (const row of data || []) {
    const rowModelRaw = String(row.specifications?.model || row.model_name || '')
    if (wantA) { if (aNumber(rowModelRaw) !== wantA) continue }
    else if (normalizeForComparison(rowModelRaw) !== model) continue
    let score = 0
    let ok = true
    for (const f of fields) {
      const a = cmp(f, norm[f])
      const b = cmp(f, row.specifications?.[f])
      if (f === 'gpu' && a && b) { if (!sameGpu(norm[f], row.specifications?.[f])) { ok = false; break } score++ }
      else if (a && b) { if (a !== b) { ok = false; break } score++ }
      else if (f === 'gpu' && (a || b)) { ok = false; break } // integrated vs discrete
    }
    if (!ok) continue
    if (!best || score > best.score || (score === best.score && (row.quantity_in_stock || 0) > (best.row.quantity_in_stock || 0))) {
      best = { row, score }
    }
  }
  if (!best) return null
  const r = best.row
  return {
    id: r.id,
    full_sku_code: r.full_sku_code,
    description: r.sku_description || `${r.brand} ${r.model_name}`,
    quantity_in_stock: r.quantity_in_stock ?? 0,
    specifications: r.specifications || {},
  }
}

// ---------- hardware summary lines (for the review screen) ----------

function hardwareLines(r: HardwareReport): string[] {
  const lines: string[] = []
  if (r.platform === 'mac') {
    const id = r.mac?.model_identifier
    const known = macModel(id)
    lines.push(`Mac: ${id || '?'}${known ? ` = ${known.family} ${known.a} (${known.year})` : ' — not in the model table, type the A-number from the bottom case'}${r.mac?.model_number ? ` · order no. ${r.mac.model_number}` : ''}`)
  }
  const cpu = parseCpu(r.cpu?.[0]?.name)
  if (cpu.model) lines.push(`CPU: ${cpu.model}${r.cpu?.[0]?.cores ? ` (${r.cpu[0].cores} cores / ${r.cpu[0].threads} threads)` : ''}`)
  if (r.memory?.length) {
    lines.push(`RAM: ${r.memory.map((m) => `${m.gb}GB ${m.manufacturer || ''} ${m.configured_speed || m.speed || ''}MHz`.replace(/\s+/g, ' ')).join(' + ')}${r.memory_slots ? ` · ${r.memory.length} of ${r.memory_slots} slots used` : ''}`)
  }
  for (const d of internalDisks(r)) lines.push(`Disk: ${d.name} · ${d.media_type} ${d.bus_type} · ${Math.round((d.size_bytes || 0) / 1e9)} GB`)
  for (const g of r.gpus || []) {
    const gb = gpuMemoryGb(g)
    lines.push(`Graphics: ${g.name}${gb ? ` · ${gb} GB dedicated memory` : ''}`)
  }
  const mon = internalMonitor(r)
  if (mon) lines.push(`Screen panel: ${[mon.maker_code, mon.product_code, mon.name].filter(Boolean).join(' ')}${mon.year ? ` · made ${mon.year}` : ''}`)
  if (r.battery?.present) {
    const pct = batteryHealth(r)
    lines.push(`Battery: ${[r.battery.manufacturer, r.battery.name].filter(Boolean).join(' ')} · ${r.battery.full_mwh ?? '?'} of ${r.battery.design_mwh ?? '?'} mWh${pct != null ? ` (${pct}%)` : ''} · ${r.battery.cycles ?? '?'} cycles`)
  }
  if (r.platform === 'mac') lines.push(`macOS ${r.os?.version || '?'}${r.mac?.battery_condition ? ` · battery condition: ${r.mac.battery_condition}` : ''}`)
  else if (r.os?.caption) lines.push(`Windows: ${r.os.caption} ${r.os.display_version || ''} (build ${r.os.build || '?'})`)
  const w11 = [r.tpm?.present ? `TPM ${r.tpm.version || ''}`.trim() : r.tpm ? 'no TPM' : null, r.secure_boot == null ? null : r.secure_boot ? 'Secure Boot on' : 'Secure Boot off']
    .filter(Boolean).join(' · ')
  if (w11) lines.push(`Security chip: ${w11}`)
  if (r.bios) lines.push(`BIOS: ${r.bios.vendor || ''} ${r.bios.version || ''} · serial ${r.bios.serial || '(blank)'}`)
  if (r.is_admin === false) {
    lines.push(r.platform === 'mac'
      ? "⚠ The Mac's password was not given — firmware password, pre-assigned Remote Management, Apple Silicon heat and the disk-cache flush could not be checked."
      : '⚠ Script ran WITHOUT admin rights — disk wear, BitLocker and TPM could not be read.')
  }
  return lines
}

function storageHealth(r: HardwareReport): number | null {
  const wears = internalDisks(r).map((d) => d.wear).filter((w): w is number => typeof w === 'number')
  return wears.length ? Math.max(0, Math.min(100, Math.round(100 - Math.max(...wears)))) : null
}

function sameSerial(a: string, b: string): boolean {
  const n = (x: string) => x.toUpperCase().replace(/[^A-Z0-9]/g, '')
  return n(a) === n(b)
}

// "Auto Test" from a unit's page must be run on THAT unit. Returns a reason when
// the machine is clearly a different one, else null.
function targetMismatch(
  target: { id: string; serial_number: string | null },
  existing: { id: string; asset_number: string | null } | null,
  serial: string,
): string | null {
  if (!serial || isPlaceholderSerial(serial)) return null
  if (target.serial_number && !sameSerial(target.serial_number, serial)) {
    return `This machine's serial is ${serial}, but the unit you started from is recorded as ${target.serial_number}.`
  }
  if (existing && existing.id !== target.id) {
    return `This machine (serial ${serial}) is a different unit in the ERP${existing.asset_number ? ` (${existing.asset_number})` : ''}.`
  }
  return null
}

// ---------- entry point ----------

export async function evaluateSession(row: SessionRow): Promise<Evaluation | null> {
  const r = row.hardware_report
  if (!r) return null
  const device = deviceKind(r)
  const category = device === 'laptop' ? 'LAP' : 'DES'

  const { data: template } = await supabaseAdmin
    .from('sku_category_templates').select('field_schema, qc_checklist').eq('category', category).maybeSingle()
  let schema: any = template?.field_schema
  if (typeof schema === 'string') { try { schema = JSON.parse(schema) } catch { schema = null } }
  const fieldNames: string[] = (schema?.fields || []).map((f: any) => f.name)
  const variantFields: string[] = schema?.variant_fields || []

  const [{ specs, meta }, existing] = await Promise.all([
    canonicalizeSpecs(category, detectSpecs(r), fieldNames),
    findDuplicateSerial(cleanSerial(r.bios?.serial)),
  ])
  const targetId = row.options?.asset_id
  const { data: target } = targetId
    ? await supabaseAdmin.from('asset_ledger').select('id, status, asset_number, serial_number').eq('id', targetId).maybeSingle()
    : { data: null }
  const skuMatch = await findSkuMatch(category, specs, variantFields).catch(() => null)

  const interactive = row.interactive_results || {}
  const verdicts = evaluateChecks({
    report: r,
    background: row.background_results,
    interactive,
    live: row.live,
    options: row.options || {},
    device,
    platform: platformOf(r),
  })

  // The owner's own per-category QC items that this list doesn't already cover.
  const ours = new Set(CHECKS.map((c) => normalizeForComparison(c.label)))
  const templateItems: string[] = Array.isArray(template?.qc_checklist) ? template!.qc_checklist : []
  for (const item of templateItems) {
    const n = normalizeForComparison(item)
    if (TEMPLATE_SYNONYMS[n] || ours.has(n)) continue
    const key = `tpl:${n}`
    const a = interactive.answers?.[key]
    verdicts.push({
      key, label: item, area: 'Your extra checks', kind: 'guided',
      state: a ? a.result : 'missing', note: a?.note || 'From your QC list for this category — check by hand.',
    })
  }

  const pct = batteryHealth(r)
  const { grade, conditions, done } = gradeAndConditions(device, interactive.cosmetic, pct)
  const serial = cleanSerial(r.bios?.serial)

  return {
    device,
    type: device === 'laptop' ? 'Laptop' : 'Desktop',
    category,
    serial: isPlaceholderSerial(serial) ? '' : serial,
    serial_placeholder: isPlaceholderSerial(serial),
    specs,
    spec_meta: meta,
    sku_match: skuMatch,
    existing_unit: target
      ? {
          id: target.id, status: target.status, asset_number: target.asset_number,
          qcable: RE_QC_STATUSES.includes(target.status), target: true,
          serial_mismatch: targetMismatch(target, existing, serial),
        }
      : existing
        ? { id: existing.id, status: existing.status, asset_number: existing.asset_number, qcable: RE_QC_STATUSES.includes(existing.status), target: false, serial_mismatch: null }
        : null,
    verdicts,
    battery_health_percent: pct,
    storage_health_percent: storageHealth(r),
    estimated_backup_hours: row.background_results?.backup?.hours ?? null,
    conditions,
    suggested_grade: grade,
    cosmetic_done: done,
    hardware_lines: hardwareLines(r),
  }
}
