// The Auto Check QC list -- one place that names every check, which area it sits
// in, and who decides it:
//   auto    -- the script's facts / background tests decide; the engineer only
//              has to act on a warning or an unknown.
//   guided  -- a person must answer (on the /qc-test page on the laptop, or on
//              the review screen). Nothing is pre-filled: an unanswered guided
//              item blocks the save, so a skipped check can never pass silently
//              (the old QC screen started every item as "pass").
//
// `label` is what lands in asset_qc_checks.check_item, and so on the website's
// customer Test Report for passed units -- keep it short and customer-readable.
// Internal detail goes in the item's note, which the public view never selects.

export type CheckKind = 'auto' | 'guided'
export type DeviceKind = 'laptop' | 'desktop'

export interface CheckDef {
  key: string
  label: string
  area: string
  kind: CheckKind
  /** Which machines the check applies to (default: both). */
  only?: DeviceKind
  /** Guided items: can "not present / no such port" be a valid answer? */
  naLabel?: string
}

export const AREAS = [
  'Locks & security',
  'Storage',
  'Memory',
  'Performance',
  'Battery',
  'Display',
  'Keyboard & trackpad',
  'Audio & camera',
  'Ports & wireless',
  'Physical',
] as const

export const CHECKS: CheckDef[] = [
  // Locks & security -- the faults a customer can't fix and we can't fix later.
  { key: 'bios_password', label: 'No BIOS password', area: 'Locks & security', kind: 'auto' },
  { key: 'company_lock', label: 'No company / MDM lock', area: 'Locks & security', kind: 'auto' },
  { key: 'computrace', label: 'No theft-tracking lock (Computrace)', area: 'Locks & security', kind: 'auto' },
  { key: 'bitlocker', label: 'Disk not encrypted (BitLocker off)', area: 'Locks & security', kind: 'auto' },
  { key: 'activation', label: 'Windows activated', area: 'Locks & security', kind: 'auto' },
  { key: 'serial_match', label: 'Serial sticker matches the machine', area: 'Locks & security', kind: 'guided' },

  { key: 'disk_health', label: 'SSD / HDD health', area: 'Storage', kind: 'auto' },
  { key: 'disk_test', label: 'Disk read/write test', area: 'Storage', kind: 'auto' },
  { key: 'disk_events', label: 'No disk errors logged', area: 'Storage', kind: 'auto' },

  { key: 'ram_test', label: 'RAM test', area: 'Memory', kind: 'auto' },

  { key: 'heat', label: 'Heat test (no slow-down under load)', area: 'Performance', kind: 'auto' },
  { key: 'fan', label: 'Fan runs quietly', area: 'Performance', kind: 'guided' },
  { key: 'stability', label: 'No crashes or hardware errors', area: 'Performance', kind: 'auto' },
  { key: 'drivers', label: 'All devices working', area: 'Performance', kind: 'auto' },
  { key: 'original_parts', label: 'Original parts check', area: 'Performance', kind: 'auto' },
  { key: 'psu', label: 'Power supply stable', area: 'Performance', kind: 'guided', only: 'desktop' },

  { key: 'battery_health', label: 'Battery health', area: 'Battery', kind: 'auto', only: 'laptop' },
  { key: 'charging', label: 'Charger & charging port', area: 'Battery', kind: 'guided', only: 'laptop' },

  { key: 'screen_dots', label: 'Screen: no dead or bright dots, no lines', area: 'Display', kind: 'guided', only: 'laptop' },
  { key: 'screen_bleed', label: 'Screen: no light bleed or pressure marks', area: 'Display', kind: 'guided', only: 'laptop' },
  { key: 'brightness', label: 'Brightness control, no flicker', area: 'Display', kind: 'guided', only: 'laptop' },
  { key: 'touch', label: 'Touch screen', area: 'Display', kind: 'guided', only: 'laptop' },

  { key: 'keyboard', label: 'Keyboard: every key works', area: 'Keyboard & trackpad', kind: 'guided', only: 'laptop' },
  { key: 'stuck_keys', label: 'Keyboard: no stuck keys', area: 'Keyboard & trackpad', kind: 'guided', only: 'laptop' },
  { key: 'fn_keys', label: 'Fn / volume / brightness keys', area: 'Keyboard & trackpad', kind: 'guided', only: 'laptop' },
  { key: 'kb_backlight', label: 'Keyboard backlight', area: 'Keyboard & trackpad', kind: 'guided', only: 'laptop', naLabel: 'No backlight on this model' },
  { key: 'trackpad', label: 'Trackpad & clicks', area: 'Keyboard & trackpad', kind: 'guided', only: 'laptop' },

  { key: 'speakers', label: 'Speakers (left & right, no rattle)', area: 'Audio & camera', kind: 'guided', only: 'laptop' },
  { key: 'microphone', label: 'Microphone', area: 'Audio & camera', kind: 'guided', only: 'laptop' },
  { key: 'camera', label: 'Camera', area: 'Audio & camera', kind: 'guided', naLabel: 'No camera on this model' },
  { key: 'audio_jack', label: 'Headphone / audio jack', area: 'Audio & camera', kind: 'guided', naLabel: 'No audio jack' },

  { key: 'usb_ports', label: 'All USB ports', area: 'Ports & wireless', kind: 'guided' },
  { key: 'display_out', label: 'HDMI / display output', area: 'Ports & wireless', kind: 'guided', naLabel: 'No display port' },
  { key: 'ethernet', label: 'Ethernet (LAN) port', area: 'Ports & wireless', kind: 'guided', naLabel: 'No LAN port' },
  { key: 'wifi', label: 'Wi-Fi', area: 'Ports & wireless', kind: 'auto' },
  { key: 'bluetooth', label: 'Bluetooth', area: 'Ports & wireless', kind: 'auto' },

  { key: 'phys_hinges', label: 'Hinges firm, lid stays in place', area: 'Physical', kind: 'guided', only: 'laptop' },
  { key: 'phys_cracks', label: 'No cracks or broken plastic', area: 'Physical', kind: 'guided' },
  { key: 'phys_opened', label: 'No signs of being opened or badly repaired', area: 'Physical', kind: 'guided' },
  { key: 'phys_liquid', label: 'No liquid damage', area: 'Physical', kind: 'guided' },
  { key: 'phys_screws', label: 'All screws & rubber feet present', area: 'Physical', kind: 'guided' },
]

// Units that are physically with us and can be re-QC'd. A fresh QC replaces the
// unit's previous checklist (PUT /api/asset-ledger/[id]/qc deletes the old rows).
// Out on rent / reserved for a web order / sold / scrapped are not in our hands.
export const RE_QC_STATUSES = ['received', 'in_stock', 'qc_pending', 'qc_passed', 'ready_for_sale', 'faulty', 'rma_returned']

export const CHECK_BY_KEY: Record<string, CheckDef> = Object.fromEntries(CHECKS.map((c) => [c.key, c]))

export function checksFor(device: DeviceKind): CheckDef[] {
  return CHECKS.filter((c) => !c.only || c.only === device)
}

// The owner's own QC list per category (sku_category_templates.qc_checklist) is
// honoured: each template item this list already covers is folded in, and any
// item it doesn't cover is added as an extra guided check, answered on the review
// screen. Keys are normalizeForComparison() forms of the template wording.
export const TEMPLATE_SYNONYMS: Record<string, string> = {
  'screen': 'screen_dots',
  'keyboard': 'keyboard',
  'trackpad': 'trackpad',
  'touchpad': 'trackpad',
  'battery health': 'battery_health',
  'battery': 'battery_health',
  'ports connectivity': 'usb_ports',
  'ports': 'usb_ports',
  'body cosmetic condition': 'phys_cracks',
  'boot os': 'activation',
  'camera': 'camera',
  'webcam': 'camera',
  'audio': 'speakers',
  'speakers': 'speakers',
  'wifi': 'wifi',
  'wi fi': 'wifi',
  'charging': 'charging',
  'stress test': 'heat',
  'psu power': 'psu',
  'fans cooling': 'fan',
  'storage health': 'disk_health',
  'ram check': 'ram_test',
  'network lan': 'ethernet',
}

// ---- Cosmetic grading (Cashify-style), asked on the /qc-test page ----

export const COSMETIC_AREAS: { key: string; label: string; only?: DeviceKind }[] = [
  { key: 'lid', label: 'Lid / top cover', only: 'laptop' },
  { key: 'palmrest', label: 'Palm rest & keyboard area', only: 'laptop' },
  { key: 'bottom', label: 'Bottom', only: 'laptop' },
  { key: 'screen_glass', label: 'Screen surface & bezel', only: 'laptop' },
  { key: 'keys', label: 'Keys (shine / worn letters)', only: 'laptop' },
  { key: 'case', label: 'Cabinet / case', only: 'desktop' },
  { key: 'front', label: 'Front panel & ports area', only: 'desktop' },
]

export const COSMETIC_LEVELS = [
  { key: 'like_new', label: 'Like new', condition: 'Excellent' },
  { key: 'light', label: 'Light marks', condition: 'Good' },
  { key: 'visible', label: 'Visible scratches / dents', condition: 'Fair' },
  { key: 'damaged', label: 'Damaged', condition: 'Poor' },
] as const
