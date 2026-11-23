// Raw Windows facts -> the ERP's own spec vocabulary ("i5", "8th", "16GB",
// "512GB", "14 inch"). Pure functions, no I/O, so they are easy to check
// against sample script output (lib/qc-agent/fixtures).
//
// Matching against the owner's dropdown lists (custom_options) happens later,
// in evaluate.ts -- this file only produces the best plain reading of the
// hardware.

import type { HardwareReport, HwDisk } from './types'
import type { DeviceKind } from './checklist'

const clean = (s: string | undefined | null) =>
  (s || '').replace(/\((R|TM|C)\)/gi, '').replace(/\s+/g, ' ').trim()

// Firmware placeholder strings that mean "nobody programmed a value" --
// typical of a replacement motherboard.
const PLACEHOLDER_RE = /^(|default string|to be filled by o\.?e\.?m\.?|system serial number|not applicable|none|n\/a|0+|1234567890?|0123456789|chassis serial number|invalid|unknown|x+)$/i

export function isPlaceholderSerial(serial: string | undefined | null): boolean {
  return PLACEHOLDER_RE.test((serial || '').trim())
}

export function cleanSerial(serial: string | undefined | null): string {
  return (serial || '').trim().toUpperCase().replace(/\s+/g, '')
}

// ---- Brand ----

const BRAND_RULES: [RegExp, string][] = [
  [/lenovo/i, 'Lenovo'],
  [/hewlett|^hp\b|^hp$/i, 'HP'],
  [/dell/i, 'Dell'],
  [/acer/i, 'Acer'],
  [/asus/i, 'Asus'],
  [/microsoft/i, 'Microsoft'],
  [/apple/i, 'Apple'],
  [/samsung/i, 'Samsung'],
  [/msi|micro-star/i, 'MSI'],
  [/toshiba|dynabook/i, 'Toshiba'],
  [/fujitsu/i, 'Fujitsu'],
  [/panasonic/i, 'Panasonic'],
  [/lg electronics/i, 'LG'],
  [/huawei/i, 'Huawei'],
  [/xiaomi|timi/i, 'Xiaomi'],
  [/infinix/i, 'Infinix'],
  [/avita/i, 'Avita'],
]

export function parseBrand(manufacturer: string | undefined): string {
  const m = clean(manufacturer)
  for (const [re, brand] of BRAND_RULES) if (re.test(m)) return brand
  // "Dell Inc." style suffixes on anything we don't know.
  return m.replace(/\b(inc|corp|corporation|co|ltd|limited|llc)\.?$/i, '').trim()
}

// ---- Model ----

export function parseModel(report: HardwareReport, brand: string): string {
  const sys = report.system || {}
  let model = clean(sys.model)
  // Lenovo's Model is a machine-type code (20S0S0XX00); the marketing name
  // ("ThinkPad T14 Gen 1") lives in Win32_ComputerSystemProduct.Version.
  if (brand === 'Lenovo') {
    const version = clean(sys.version) || clean(sys.family)
    if (version && !/^\d/.test(version) && !/^lenovo$/i.test(version)) model = version
  }
  // "HP EliteBook 840 G5 Notebook PC" -> "EliteBook 840 G5"
  model = model.replace(new RegExp(`^${brand}\\s+`, 'i'), '')
  model = model.replace(/^(hewlett[- ]packard|hp)\s+/i, '')
  model = model.replace(/\s+(notebook|laptop|desktop|mobile workstation|workstation|tower|mini)?\s*pc$/i, '')
  model = model.replace(/\s+(notebook|laptop)$/i, '')
  // Asus' "VivoBook_ASUSLaptop X512FA_X512FA"
  model = model.replace(/_ASUSLaptop/i, '').replace(/_/g, ' ')
  return model.replace(/\s+/g, ' ').trim()
}

// ---- CPU ----

export interface CpuReading {
  cpu: string          // "i5", "Ryzen 5", "Core Ultra 5", "Celeron", ...
  generation: string   // "8th", "12th", "" when it has no meaningful generation
  model: string        // full cleaned name, for notes
  launchYear: number | null
}

const ordinal = (n: number) => {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] || 'th'
  return `${n}${s}`
}

// Rough launch year per Intel Core generation -- used only to tell whether a
// screen panel is much newer than the machine (a replaced screen).
const INTEL_GEN_YEAR: Record<number, number> = {
  1: 2010, 2: 2011, 3: 2012, 4: 2013, 5: 2015, 6: 2015, 7: 2016, 8: 2017,
  9: 2018, 10: 2019, 11: 2020, 12: 2022, 13: 2023, 14: 2024,
}
const RYZEN_SERIES_YEAR: Record<number, number> = { 1: 2017, 2: 2018, 3: 2019, 4: 2020, 5: 2021, 6: 2022, 7: 2023, 8: 2024 }

export function intelGeneration(modelNumber: string): number | null {
  // modelNumber is the part after "i5-": "8350U", "10210U", "1135G7", "520M"
  const digits = (modelNumber.match(/^\d+/) || [''])[0]
  if (digits.length === 5) return Number(digits.slice(0, 2))
  if (digits.length === 4) {
    if (digits[0] === '1' && /[0-4]/.test(digits[1]) && /^\d{4}[A-Z]/i.test(modelNumber)) {
      // 1065G7 -> 10, 1135G7 -> 11, 1235U -> 12, 1345U -> 13
      return Number(digits.slice(0, 2))
    }
    return Number(digits[0])
  }
  if (digits.length === 3) return 1
  return null
}

export function parseCpu(name: string | undefined): CpuReading {
  const model = clean(name).replace(/\s+CPU\b/i, '').replace(/\s*@.*$/, '').trim()
  const none: CpuReading = { cpu: '', generation: '', model, launchYear: null }
  if (!model) return none

  const ultra = model.match(/Core\s+Ultra\s+([579])/i)
  if (ultra) return { cpu: `Core Ultra ${ultra[1]}`, generation: '', model, launchYear: 2023 }
  // 2023+ "Intel Core 5 120U" (no "i")
  const core = model.match(/\bCore\s+([357])\s+\d{3}[A-Z]/i)
  if (core) return { cpu: `Core ${core[1]}`, generation: '', model, launchYear: 2023 }

  // 1st gen: "Intel Core i5 CPU M 520"
  const first = model.match(/\bi([3579])\s+(?:CPU\s+)?[A-Z]\s*\d{3}\b/i)
  if (first) return { cpu: `i${first[1]}`, generation: '1st', model, launchYear: 2010 }

  let m = model.match(/\bi([3579])[- ](\d{3,5}[A-Z0-9]*)/i)
  if (m) {
    const gen = intelGeneration(m[2])
    return {
      cpu: `i${m[1]}`,
      generation: gen ? ordinal(gen) : '',
      model,
      launchYear: gen ? INTEL_GEN_YEAR[gen] ?? null : null,
    }
  }
  m = model.match(/Ryzen\s+([3579])(?:\s+PRO)?\s+(\d)(\d{3})/i)
  if (m) {
    const series = Number(m[2])
    return { cpu: `Ryzen ${m[1]}`, generation: `${series}000 series`, model, launchYear: RYZEN_SERIES_YEAR[series] ?? null }
  }
  m = model.match(/Ryzen\s+([3579])/i)
  if (m) return { cpu: `Ryzen ${m[1]}`, generation: '', model, launchYear: null }
  if (/Xeon/i.test(model)) return { cpu: 'Xeon', generation: '', model, launchYear: null }
  if (/Celeron/i.test(model)) return { cpu: 'Celeron', generation: '', model, launchYear: null }
  if (/Pentium/i.test(model)) return { cpu: 'Pentium', generation: '', model, launchYear: null }
  if (/Athlon/i.test(model)) return { cpu: 'Athlon', generation: '', model, launchYear: null }
  if (/Snapdragon/i.test(model)) return { cpu: 'Snapdragon', generation: '', model, launchYear: null }
  return none
}

// ---- RAM / storage ----

export function totalRamGb(report: HardwareReport): number | null {
  const sticks = report.memory || []
  const total = sticks.reduce((sum, s) => sum + (Number(s.gb) || 0), 0)
  return total > 0 ? Math.round(total) : null
}

const MARKET_SIZES_GB = [64, 120, 128, 240, 250, 256, 320, 480, 500, 512, 640, 750, 960, 1000, 2000, 4000]

export function marketedSize(bytes: number | undefined): string {
  if (!bytes || bytes <= 0) return ''
  const gb = bytes / 1e9
  let best = MARKET_SIZES_GB[0]
  for (const s of MARKET_SIZES_GB) if (Math.abs(s - gb) < Math.abs(best - gb)) best = s
  if (Math.abs(best - gb) / best > 0.12) return `${Math.round(gb)}GB`
  return best >= 1000 ? `${best / 1000}TB` : `${best}GB`
}

export function internalDisks(report: HardwareReport): HwDisk[] {
  return (report.disks || [])
    .filter((d) => !/usb|sd|mmc|virtual|file backed/i.test(d.bus_type || '') && (d.size_bytes || 0) > 16e9)
    .sort((a, b) => (b.size_bytes || 0) - (a.size_bytes || 0))
}

const isHdd = (d: HwDisk) => /hdd/i.test(d.media_type || '')

// ---- GPU ----

const INTEGRATED_GPU_RE = /intel|microsoft basic|radeon\(?\s*tm\)?\s+graphics$|radeon graphics|vega \d+ graphics|radeon\s+(r[2-7]|hd \d{4}) graphics|parsec|virtual|displaylink|citrix|remote/i

export function discreteGpu(report: HardwareReport): string {
  const names = (report.gpus || []).map((g) => clean(g.name)).filter(Boolean)
  const discrete = names.find((n) => !INTEGRATED_GPU_RE.test(n))
  if (!discrete) return ''
  return discrete
    .replace(/^NVIDIA\s+GeForce\s+/i, '')
    .replace(/\s+Laptop GPU$/i, '')
    .replace(/^AMD\s+/i, 'AMD ')
    .trim()
}

// ---- Screen ----

const COMMON_SIZES = [10.1, 11.6, 12.0, 12.5, 13.0, 13.3, 13.5, 14.0, 15.0, 15.6, 16.0, 17.3]

export function internalMonitor(report: HardwareReport) {
  const mons = report.monitors || []
  return mons.find((m) => m.internal) || (mons.length === 1 ? mons[0] : undefined)
}

export function screenInches(report: HardwareReport): number | null {
  const mon = internalMonitor(report)
  if (!mon?.width_cm || !mon?.height_cm) return null
  const diag = Math.sqrt(mon.width_cm ** 2 + mon.height_cm ** 2) / 2.54
  let best = COMMON_SIZES[0]
  for (const s of COMMON_SIZES) if (Math.abs(s - diag) < Math.abs(best - diag)) best = s
  return Math.abs(best - diag) <= 0.6 ? best : Math.round(diag * 10) / 10
}

export function resolution(report: HardwareReport): string {
  const g = (report.gpus || []).find((x) => x.h_res && x.v_res)
  return g ? `${g.h_res}x${g.v_res}` : ''
}

// ---- Device kind ----

const LAPTOP_CHASSIS = new Set([8, 9, 10, 11, 12, 14, 18, 21, 30, 31, 32])

export function deviceKind(report: HardwareReport): DeviceKind {
  if (report.battery?.present) return 'laptop'
  if (report.system?.pc_system_type === 2) return 'laptop'
  if ((report.system?.chassis_types || []).some((t) => LAPTOP_CHASSIS.has(t))) return 'laptop'
  return 'desktop'
}

// ---- OS ----

export function osName(report: HardwareReport): string {
  return clean(report.os?.caption).replace(/^Microsoft\s+/i, '')
}

// ---- Battery ----

export function batteryHealth(report: HardwareReport): number | null {
  const b = report.battery
  if (!b?.design_mwh || !b.full_mwh || b.design_mwh <= 0) return null
  return Math.min(100, Math.round((b.full_mwh / b.design_mwh) * 100))
}

/**
 * The plain detected specs, keyed by the LAP/DES template field names. Only
 * non-empty values are included; evaluate.ts then keeps just the fields the
 * category's template actually has.
 */
export function detectSpecs(report: HardwareReport): Record<string, string | number | boolean> {
  const brand = parseBrand(report.system?.manufacturer)
  const cpu = parseCpu(report.cpu?.[0]?.name)
  const ram = totalRamGb(report)
  const disks = internalDisks(report)
  const kind = deviceKind(report)
  const out: Record<string, string | number | boolean> = {}

  if (brand) out.brand = brand
  const model = parseModel(report, brand)
  if (model) out.model = model
  if (cpu.cpu) out.cpu = cpu.cpu
  if (cpu.generation) out.generation = cpu.generation
  if (ram) out.ram = `${ram}GB`

  if (kind === 'desktop') {
    const ssd = disks.find((d) => !isHdd(d))
    const hdd = disks.find(isHdd)
    if (ssd) out.ssd = marketedSize(ssd.size_bytes)
    if (hdd) out.hdd = Math.round((hdd.size_bytes || 0) / 1e9)
  } else if (disks[0]) {
    out.ssd = isHdd(disks[0]) ? `${marketedSize(disks[0].size_bytes)} HDD` : marketedSize(disks[0].size_bytes)
  }

  const gpu = discreteGpu(report)
  if (gpu) out.gpu = gpu

  if (kind === 'laptop') {
    const inches = screenInches(report)
    if (inches) out.screen_size = inches
    out.display_type = report.touch ? 'Touch' : 'Non-Touch'
    const res = resolution(report)
    if (res) out.resolution = res
    out.has_webcam = (report.cameras || []).length > 0
    out.has_fingerprint_reader = (report.biometric || []).length > 0
  }
  const os = osName(report)
  if (os) out.os = os
  return out
}
