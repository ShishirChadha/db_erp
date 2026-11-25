// Pass/fail rules for every Auto Check item, in one place so the thresholds
// are easy to find and tune. Pure: facts in, verdicts out.
//
// Verdict states:
//   pass / fail / na -- decided (by the script, or by a guided answer)
//   warn             -- something looks off; the engineer must decide
//   unknown          -- couldn't be checked (no admin rights, class missing);
//                       the engineer must decide
//   pending          -- a background test is still running
//   missing          -- a guided check nobody has answered yet
// Only pass/fail/na can be saved; everything else blocks the save button.

import type { BackgroundResults, HardwareReport, InteractiveResults, LiveSnapshot, SessionOptions } from './types'
import { CHECKS, checksFor, type CheckDef, type DeviceKind, type Platform } from './checklist'
import { macModel } from './mac-models'
import { batteryHealth, internalDisks, internalMonitor, isPlaceholderSerial, parseCpu } from './parse'

export type VerdictState = 'pass' | 'fail' | 'na' | 'warn' | 'unknown' | 'pending' | 'missing'

export interface Verdict {
  key: string
  label: string
  area: string
  kind: CheckDef['kind']
  state: VerdictState
  note: string
  naLabel?: string
  /** A hard fail: overriding it to pass needs a written reason. */
  hard?: boolean
}

export const THRESHOLDS = {
  batteryGood: 70,       // >= this: pass
  batteryFail: 60,       // < this: fail (replace battery); in between: warn + lower grade
  batteryCyclesWarn: 1000,
  diskWearFail: 80,      // % of rated SSD life used
  diskTempWarn: 70,      // °C
  heatSustainedPass: 90, // % of base clock held over the last minute under full load
  heatSustainedFail: 75,
  heatTempWarn: 97,      // °C, where the laptop reports it
  ssdMinReadMbps: 150,
  ssdMinWriteMbps: 50,
  hddMinReadMbps: 40,
  ramMinTestedMb: 1024,
  panelNewerYears: 2,    // panel made this many years after the CPU launched -> likely replaced
}

// SSD makers that laptop brands actually fit at the factory, plus the big
// retail brands. Anything else gets a "check this disk's quality" warning.
const KNOWN_DISK_BRANDS = /samsung|sk ?hynix|hynix|kioxia|toshiba|micron|crucial|western digital|wdc|\bwd\b|sandisk|intel|lite-?on|ssstc|kingston|seagate|hgst|hitachi|union memory|ymtc|phison|adata|transcend|biwin|foresee|longsys|lexar|pny|corsair|sabrent|solidigm|bc\d{3}|pm\d{3,4}|mzvl|mz-|sdbp|thnsn|kbg|kxg|hfm|hfs|ct\d{3}|st\d{3,4}|nvme ca|ca\d-|ssd mz|lenovo|dell|hp\b|apple/i

const GENERIC_BATTERY_MAKER = /^(|oem|generic|default|unknown|li-?ion|lion|battery|x+|\d+|na|n\/a|smp-?oem)$/i

const v = (def: CheckDef, state: VerdictState, note = '', hard = false): Verdict => ({
  key: def.key, label: def.label, area: def.area, kind: def.kind, state, note, naLabel: def.naLabel, hard: hard || undefined,
})

export interface RuleInput {
  report: HardwareReport | null
  background: BackgroundResults | null
  interactive: InteractiveResults | null
  live: LiveSnapshot | null
  options: SessionOptions
  device: DeviceKind
  /** Default windows (the original script). */
  platform?: Platform
}

// ---------- Mac-only rules ----------

function activationLock(def: CheckDef, r: HardwareReport): Verdict {
  const m = r.mac || {}
  if (m.activation_lock === 'enabled') {
    return v(def, 'fail', "Activation Lock is ON. The previous owner must remove this Mac from their Apple ID (Find My), or Apple unlocks it with proof of purchase. Don't sell it locked.", true)
  }
  if (m.activation_lock === 'disabled') return v(def, 'pass', 'Activation Lock is off.')
  if (m.find_my_token === true) return v(def, 'fail', 'Find My Mac is on (an iCloud token is stored in the firmware). Sign out of iCloud / remove it from Find My first.', true)
  if (m.find_my_token === false) return v(def, 'pass', 'No Find My token in the firmware (this Mac has no Activation Lock chip).')
  return v(def, 'unknown', 'Could not read the Activation Lock state. Check System Settings → Apple ID is signed out and Find My is off.')
}

function firmwarePassword(def: CheckDef, r: HardwareReport): Verdict {
  const m = r.mac || {}
  if (!m.intel) return v(def, 'na', 'Apple Silicon Macs have no firmware password.')
  if (m.firmware_password === true) return v(def, 'fail', 'A firmware password is set. Remove it (Recovery → Startup Security Utility) before sale.', true)
  if (m.firmware_password === false) return v(def, 'pass', 'No firmware password.')
  return v(def, 'unknown', "Needs the Mac's password to check. Or restart holding Option: a padlock means a firmware password is set.")
}

function fileVault(def: CheckDef, r: HardwareReport): Verdict {
  const fv = r.mac?.filevault
  if (fv === true) return v(def, 'fail', 'FileVault is ON. Turn it off (System Settings → Privacy & Security → FileVault) before sale.', true)
  if (fv === false) return v(def, 'pass', 'FileVault is off.')
  return v(def, 'unknown', 'FileVault state not readable.')
}

function macCompanyLock(def: CheckDef, r: HardwareReport, answers: InteractiveResults['answers']): Verdict {
  const m = r.mac || {}
  const reasons: string[] = []
  if (m.dep) reasons.push('enrolled through Apple Business Manager (DEP)')
  if (m.mdm) reasons.push('enrolled in a company MDM')
  if (m.dep_assigned) reasons.push('a company Remote Management setup is waiting for this Mac (it will lock again after the next reinstall)')
  const oobe = answers?.oobe_company
  if (oobe?.result === 'fail') reasons.push('macOS setup showed a Remote Management screen')
  if (reasons.length) return v(def, 'fail', `Company-locked: ${reasons.join('; ')}. The company must release it from Apple Business Manager.`, true)
  if (!oobe) return v(def, 'missing', 'Answer on the Mac: did macOS setup show a "Remote Management" screen?')
  return v(def, 'pass', m.dep_assigned === false
    ? 'No DEP/MDM enrollment and no Remote Management waiting for this Mac.'
    : 'No DEP/MDM enrollment. (Pre-assigned Remote Management needs the Mac password to check; setup showed none.)')
}

function macDiskHealth(def: CheckDef, r: HardwareReport): Verdict {
  const disks = internalDisks(r)
  if (!disks.length) return v(def, 'fail', 'No internal disk found.', true)
  const s = r.mac?.smart_status
  const name = `${disks[0].name || 'SSD'} (${disks[0].bus_type || 'internal'})`
  if (!s) return v(def, 'unknown', `${name}: S.M.A.R.T. status not reported.`)
  if (/verified/i.test(s)) return v(def, 'pass', `${name}: S.M.A.R.T. Verified. (A Mac doesn't report SSD wear % without extra tools — the read/write test below checks the data.)`)
  return v(def, 'fail', `${name}: S.M.A.R.T. status "${s}". The SSD is failing.`, true)
}

function macStability(def: CheckDef, r: HardwareReport): Verdict {
  const n = r.mac?.panics_90d
  if (n == null) return v(def, 'unknown', 'Crash reports could not be read.')
  if (n > 0) return v(def, 'warn', `${n} kernel panic(s) (the Mac restarted after a crash) in the last 90 days. OK only if it happened during setup; otherwise suspect RAM, SSD or the logic board.`)
  return v(def, 'pass', 'No kernel panics in the last 90 days.')
}

const PRESSURE_RANK: Record<string, number> = { nominal: 0, fair: 0, moderate: 1, serious: 2, heavy: 2, critical: 3, trapping: 3, sleeping: 3 }

function macSiliconHeat(def: CheckDef, bg: BackgroundResults): Verdict {
  const samples = bg.heat?.samples || []
  const levels = samples.map((s) => (s.pressure || '').toLowerCase()).filter((p) => p in PRESSURE_RANK)
  if (!levels.length) return v(def, 'unknown', "Apple Silicon heat needs the Mac's password (powermetrics). Feel the base and listen to the fan instead.")
  const worst = levels.reduce((a, b) => (PRESSURE_RANK[b] > PRESSURE_RANK[a] ? b : a))
  const util = samples.reduce((a, s) => a + (s.util ?? 0), 0) / Math.max(1, samples.length)
  const summary = `Worst thermal pressure in 3 minutes at full load: ${worst}`
  if (util < 80) return v(def, 'unknown', `The load didn't reach full CPU use. ${summary}`)
  if (PRESSURE_RANK[worst] >= 3) return v(def, 'fail', `${summary} — overheats and throttles hard. Check the fan / vents.`, true)
  if (PRESSURE_RANK[worst] === 2) return v(def, 'warn', `${summary}. Normal for a fanless MacBook Air under long load; suspicious on a Pro.`)
  return v(def, 'pass', summary)
}

// ---------- individual auto rules ----------

function biosPassword(def: CheckDef, r: HardwareReport): Verdict {
  const bp = r.bios_password
  if (bp?.set === true) return v(def, 'fail', `BIOS password is set (${bp.source}${bp.detail ? `: ${bp.detail}` : ''}). Remove it before sale.`, true)
  if (bp?.set === false) return v(def, 'pass', `Checked through ${bp.source} firmware.`)
  return v(def, 'unknown', 'This brand doesn\'t report it to Windows — confirm the BIOS opens without a password prompt.')
}

function companyLock(def: CheckDef, r: HardwareReport, answers: InteractiveResults['answers']): Verdict {
  const j = r.join || {}
  const reasons: string[] = []
  if (j.azure_ad) reasons.push('joined to a company Azure AD')
  if (j.enterprise) reasons.push('enterprise-joined')
  if (j.domain) reasons.push('joined to a company domain')
  if ((j.mdm_enrollments || 0) > 0) reasons.push(`${j.mdm_enrollments} MDM enrollment(s)`)
  if (j.autopilot_tenant) reasons.push(`registered to company "${j.autopilot_tenant}" (Autopilot)`)
  const oobe = answers?.oobe_company
  if (oobe?.result === 'fail') reasons.push('Windows setup showed a company sign-in')
  if (reasons.length) return v(def, 'fail', `Company-locked: ${reasons.join('; ')}.`, true)
  if (j.workplace) return v(def, 'warn', 'A work/school account is added (workplace join). Remove it before sale.')
  if (!oobe) return v(def, 'missing', 'Answer on the laptop: did Windows setup show a company sign-in?')
  return v(def, 'pass', 'Not joined to any company, no MDM, no Autopilot record.')
}

function computrace(def: CheckDef, r: HardwareReport): Verdict {
  const c = r.computrace || {}
  if (c.windows_agent) return v(def, 'fail', 'Computrace / Absolute agent (rpcnet) found in Windows — the laptop may be tracked or locked by its old owner.', true)
  const state = (c.bios_state || '').toLowerCase()
  if (state && /activ|enable/.test(state) && !/disable|deactiv|inactive|not activated/.test(state)) {
    return v(def, 'warn', `Firmware tracking module reports "${c.bios_state}". Check it is not activated.`)
  }
  if (c.wpbt_binary) return v(def, 'warn', 'Firmware installs a program into Windows at boot (wpbbin.exe). Usually a maker utility — check it is not Computrace.')
  return v(def, 'pass', c.bios_state ? `Firmware module: ${c.bios_state}.` : 'No tracking agent found.')
}

function bitlocker(def: CheckDef, r: HardwareReport): Verdict {
  const b = r.bitlocker
  if (!b || b.protection_on == null) return v(def, 'unknown', 'Not readable without admin rights.')
  if (b.protection_on) return v(def, 'fail', `BitLocker is ON (${b.volume_status || 'protected'}). Turn it off (or record our recovery key) before sale.`, true)
  if (b.volume_status && !/fullydecrypted/i.test(b.volume_status)) {
    return v(def, 'warn', `Drive encryption state: ${b.volume_status} (${b.percent ?? '?'}%). Usually Windows' automatic device encryption waiting to start — turn it off.`)
  }
  return v(def, 'pass', 'Drive is not encrypted.')
}

function activation(def: CheckDef, r: HardwareReport): Verdict {
  const a = r.activation || {}
  const edition = [r.os?.caption, r.os?.display_version].filter(Boolean).join(' ')
  if (a.licensed === true) return v(def, 'pass', `${edition || 'Windows'} — activated${a.oem_key_in_bios ? ' (key in BIOS)' : ''}.`)
  if (a.licensed === false) {
    return a.oem_key_in_bios
      ? v(def, 'fail', 'Not activated, though a Windows key is built into the BIOS — connect to the internet and activate.', true)
      : v(def, 'warn', 'Not activated and no key in the BIOS — needs a licence before sale.')
  }
  return v(def, 'unknown', 'Activation state not readable.')
}

function diskHealth(def: CheckDef, r: HardwareReport): Verdict {
  const disks = internalDisks(r)
  if (!disks.length) return v(def, 'fail', 'No internal disk found.', true)
  const notes: string[] = []
  let state: VerdictState = 'pass'
  let hard = false
  let countersRead = false
  for (const d of disks) {
    const label = `${d.name || 'Disk'} (${d.media_type || '?'}, ${d.bus_type || '?'})`
    const bits: string[] = []
    if (d.health && !/healthy/i.test(d.health)) { state = 'fail'; hard = true; bits.push(`health "${d.health}"`) }
    if (d.wear != null) {
      countersRead = true
      bits.push(`${d.wear}% life used`)
      if (d.wear >= THRESHOLDS.diskWearFail) { state = 'fail'; hard = true }
    }
    const unc = (d.read_errors_uncorrected || 0) + (d.write_errors_uncorrected || 0)
    if (d.read_errors_uncorrected != null || d.write_errors_uncorrected != null) countersRead = true
    if (unc > 0) { state = 'fail'; hard = true; bits.push(`${unc} uncorrected read/write errors`) }
    if (d.temperature != null && d.temperature >= THRESHOLDS.diskTempWarn) { if (state === 'pass') state = 'warn'; bits.push(`${d.temperature}°C`) }
    if (d.power_on_hours != null) bits.push(`${d.power_on_hours} h used`)
    notes.push(`${label}: ${bits.join(', ') || 'healthy'}`)
  }
  if (state === 'pass' && !countersRead) {
    return v(def, 'unknown', `${notes.join(' · ')}. Wear and error counters need an Admin PowerShell — run again as admin, or decide by hand.`)
  }
  return v(def, state, notes.join(' · '), hard)
}

function diskTest(def: CheckDef, r: HardwareReport, bg: BackgroundResults | null): Verdict {
  const d = bg?.disk
  if (!d) return v(def, 'pending', 'Runs after the RAM and heat tests.')
  if (d.error) return v(def, 'unknown', `Disk test could not run: ${d.error}`)
  if (d.skipped_reason) return v(def, 'unknown', `Disk test skipped: ${d.skipped_reason}`)
  const speed = `${d.mb ?? '?'} MB written and read back · write ${d.write_mbps ?? '?'} MB/s · read ${d.read_mbps ?? '?'} MB/s`
  if ((d.mismatches || 0) > 0 || (d.io_errors || 0) > 0) {
    return v(def, 'fail', `${d.mismatches || 0} blocks read back wrong, ${d.io_errors || 0} I/O errors. ${speed}`, true)
  }
  const sys = internalDisks(r)[0]
  const hdd = /hdd/i.test(sys?.media_type || '')
  const slow = hdd
    ? (d.read_mbps ?? 999) < THRESHOLDS.hddMinReadMbps
    : (d.read_mbps ?? 999) < THRESHOLDS.ssdMinReadMbps || (d.write_mbps ?? 999) < THRESHOLDS.ssdMinWriteMbps
  if (slow) return v(def, 'warn', `Data verified, but the disk is slow for its type. ${speed}`)
  if (d.cache_flushed === false) return v(def, 'warn', `Data verified, but without the Mac's password the read-back may have come from memory, not the SSD. ${speed}`)
  return v(def, 'pass', `Data verified. ${speed}`)
}

const DISK_PROVIDERS = /^(disk|stor|iastor|nvme|stornvme|storahci|ntfs|volmgr|partmgr|amd_sata|amdsata)/i

function diskEvents(def: CheckDef, r: HardwareReport): Verdict {
  const ev = (r.events || []).filter((e) => [7, 51, 129, 153].includes(e.id) && DISK_PROVIDERS.test(e.provider || 'disk'))
  if (!ev.length) return v(def, 'pass', 'No disk errors in the system log since Windows was installed.')
  const bad = ev.filter((e) => e.id === 7)
  const summary = Object.entries(ev.reduce<Record<string, number>>((acc, e) => { acc[`event ${e.id}`] = (acc[`event ${e.id}`] || 0) + 1; return acc }, {}))
    .map(([k, n]) => `${k} ×${n}`).join(', ')
  if (bad.length) return v(def, 'fail', `Bad blocks reported (${summary}).`, true)
  return v(def, 'warn', `Disk retries / resets logged (${summary}). Can be a loose cable or failing disk.`)
}

function ramTest(def: CheckDef, bg: BackgroundResults | null): Verdict {
  const t = bg?.ram
  if (!t) return v(def, 'pending', 'Running in the background (about 4 minutes).')
  if (t.error) return v(def, 'unknown', `RAM test could not run: ${t.error}`)
  const summary = `${((t.tested_mb || 0) / 1024).toFixed(1)} GB tested × ${t.passes ?? 0} passes in ${Math.round((t.seconds || 0) / 60)} min`
  if ((t.errors || 0) > 0) return v(def, 'fail', `${t.errors} memory errors. ${summary}`, true)
  if ((t.tested_mb || 0) < THRESHOLDS.ramMinTestedMb) return v(def, 'warn', `Only a small part of the RAM could be tested. ${summary}`)
  return v(def, 'pass', `0 errors. ${summary}. (Catches most bad RAM; a boot-time MemTest86 run is deeper.)`)
}

export function analyseHeat(bg: BackgroundResults | null) {
  const h = bg?.heat
  if (!h || h.skipped) return null
  const samples = (h.samples || []).filter((s) => s.perf != null)
  if (samples.length < 4) return { sustained: null, loadOk: false, maxTemp: null as number | null, early: null as number | null }
  const end = samples[samples.length - 1].t
  const last = samples.filter((s) => s.t >= end - 60)
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length)
  const sustained = Math.round(avg(last.map((s) => s.perf as number)))
  const early = Math.round(avg(samples.slice(0, 3).map((s) => s.perf as number)))
  const util = avg(samples.map((s) => s.util ?? 0))
  const temps = samples.map((s) => s.temp_c).filter((t): t is number => t != null && t > 0)
  return { sustained, early, loadOk: util >= 80, maxTemp: temps.length ? Math.max(...temps) : null }
}

function heat(def: CheckDef, bg: BackgroundResults | null, options: SessionOptions, r?: HardwareReport): Verdict {
  if (options.heat_test === false || bg?.heat?.skipped) return v(def, 'na', 'Heat test switched off for this run.')
  if (!bg?.heat || (bg.stage && ['ram', 'heat'].includes(bg.stage))) return v(def, 'pending', 'Runs after the RAM test (3 minutes at full load).')
  if (bg.heat.error) return v(def, 'unknown', `Heat test could not run: ${bg.heat.error}`)
  if (r?.platform === 'mac' && r.mac?.chip) return macSiliconHeat(def, bg)
  const a = analyseHeat(bg)
  if (!a || a.sustained == null) return v(def, 'unknown', 'The speed counter is not available on this machine — feel the base and listen to the fan instead.')
  const temp = a.maxTemp ? ` · peak ${Math.round(a.maxTemp)}°C` : ''
  const ac = bg.heat.on_ac === false ? ' · ran on battery (speed is often capped on battery — run it plugged in)' : ''
  const what = r?.platform === 'mac' ? 'of full speed allowed by macOS' : 'of base speed'
  const summary = `Held ${a.sustained}% ${what} for the last minute (started at ${a.early}%)${temp}${ac}`
  if (!a.loadOk) return v(def, 'unknown', `The load didn't reach full CPU use. ${summary}`)
  if (a.sustained < THRESHOLDS.heatSustainedFail) return v(def, 'fail', `Slows down badly when hot — clean the fan and re-paste. ${summary}`, true)
  if (a.sustained < THRESHOLDS.heatSustainedPass || (a.maxTemp != null && a.maxTemp >= THRESHOLDS.heatTempWarn) || bg.heat.on_ac === false) {
    return v(def, 'warn', summary)
  }
  return v(def, 'pass', summary)
}

function stability(def: CheckDef, r: HardwareReport): Verdict {
  const ev = r.events || []
  const whea = ev.filter((e) => /whea/i.test(e.provider || ''))
  const bugcheck = ev.filter((e) => e.id === 1001 && /bugcheck|wer-systemerrorreporting/i.test(e.provider || ''))
  const power = ev.filter((e) => (e.id === 41 && /kernel-power/i.test(e.provider || '')) || (e.id === 6008 && /eventlog/i.test(e.provider || '')))
  if (whea.length) return v(def, 'fail', `${whea.length} hardware error(s) reported by the CPU/chipset (WHEA). Usually RAM, CPU or board trouble.`, true)
  if (bugcheck.length) return v(def, 'warn', `${bugcheck.length} blue-screen crash(es) since install. OK only if caused by a driver during setup.`)
  if (power.length) return v(def, 'warn', `${power.length} unexpected shutdown(s). Fine if you forced it off during setup; otherwise suspect power or heat.`)
  return v(def, 'pass', 'No crashes, unexpected shutdowns or hardware errors since install.')
}

function drivers(def: CheckDef, r: HardwareReport): Verdict {
  const bad = r.problem_devices || []
  if (!bad.length) return v(def, 'pass', 'Every device in Device Manager is working.')
  const list = bad.slice(0, 6).map((d) => `${d.name || 'Unknown device'}${d.code ? ` (code ${d.code})` : ''}`).join('; ')
  const core = bad.some((d) => /processor|display|system|memory/i.test(d.class || ''))
  return v(def, 'warn', `${bad.length} device(s) not working: ${list}${bad.length > 6 ? '…' : ''}. ${core ? 'Includes a core device — check carefully. ' : ''}Install drivers and re-check, or mark fail.`)
}

function originalParts(def: CheckDef, r: HardwareReport): Verdict {
  const risks: string[] = []
  const info: string[] = []
  if (isPlaceholderSerial(r.bios?.serial)) risks.push('the BIOS has no real serial number (typical of a replacement motherboard)')

  const cpu = parseCpu(r.cpu?.[0]?.name)
  const panel = internalMonitor(r)
  if (panel?.year && cpu.launchYear && panel.year - cpu.launchYear > THRESHOLDS.panelNewerYears) {
    risks.push(`the screen panel (${panel.maker_code || '?'} ${panel.product_code || ''}) was made in ${panel.year}, years after this model came out — screen likely replaced`)
  }

  const b = r.battery
  if (b?.present) {
    if (GENERIC_BATTERY_MAKER.test((b.manufacturer || '').trim())) risks.push(`battery maker is "${b.manufacturer || 'blank'}" — possibly a non-original battery`)
    if (b.cycles != null && b.cycles <= 5 && cpu.launchYear && new Date().getFullYear() - cpu.launchYear >= 3) {
      info.push('battery looks new (≤5 cycles on an older model) — probably replaced')
    }
  }

  for (const d of internalDisks(r)) {
    if (d.name && !KNOWN_DISK_BRANDS.test(d.name)) risks.push(`SSD "${d.name}" is not a brand makers fit at the factory — check its quality`)
  }

  const sticks = r.memory || []
  const makers = new Set(sticks.map((s) => (s.manufacturer || '').trim().toLowerCase()).filter(Boolean))
  const parts = new Set(sticks.map((s) => (s.part_number || '').trim().toLowerCase()).filter(Boolean))
  if (sticks.length > 1 && (makers.size > 1 || parts.size > 1)) info.push('RAM sticks differ (upgraded or replaced)')

  const note = [...risks, ...info].join('; ')
  if (risks.length) return v(def, 'warn', `${note[0].toUpperCase()}${note.slice(1)}. A script can't prove a repair — look closer and decide.`)
  return v(def, 'pass', info.length ? `${info.join('; ')}. No risky signs.` : 'No signs of replaced parts that a script can detect.')
}

function batteryHealthRule(def: CheckDef, r: HardwareReport): Verdict {
  const b = r.battery
  if (!b?.present) return v(def, 'fail', 'No battery detected.', true)
  const condition = r.mac?.battery_condition
  if (condition && /service|replace|poor|check/i.test(condition)) {
    return v(def, 'fail', `macOS says the battery needs service ("${condition}")${b.cycles != null ? ` · ${b.cycles} cycles` : ''}. Replace the battery.`, true)
  }
  const pct = batteryHealth(r)
  if (pct == null) return v(def, 'unknown', 'Battery capacity not reported — check the battery report by hand.')
  const bits = [`${pct}% of original capacity`]
  if (b.cycles != null) bits.push(`${b.cycles} cycles`)
  if (b.manufacturer) bits.push(b.manufacturer)
  if (condition) bits.push(`macOS: ${condition}`)
  const note = bits.join(' · ')
  if (pct < THRESHOLDS.batteryFail) return v(def, 'fail', `${note}. Replace the battery.`, true)
  if (pct < THRESHOLDS.batteryGood) return v(def, 'warn', `${note}. Usable but weak — grade is lowered one step.`)
  if (b.cycles != null && b.cycles >= THRESHOLDS.batteryCyclesWarn) return v(def, 'warn', `${note}. Very high cycle count.`)
  return v(def, 'pass', note)
}

function wifi(def: CheckDef, r: HardwareReport, device: DeviceKind): Verdict {
  const adapters = (r.net || []).filter((n) => n.media === 'wifi')
  if (!adapters.length) return device === 'laptop' ? v(def, 'fail', 'No Wi-Fi adapter found.', true) : v(def, 'na', 'No Wi-Fi card in this desktop.')
  const off = adapters.every((a) => /disabled|not present/i.test(a.status || ''))
  if (off) return v(def, 'unknown', `Wi-Fi adapter is ${adapters[0].status}. Switch it on and re-check.`)
  const n = r.wifi_networks
  if (n == null) return v(def, 'unknown', 'Could not scan for networks.')
  if (n === 0) return v(def, 'warn', 'Adapter works but sees no networks — check the antenna.')
  return v(def, 'pass', `${adapters[0].description || 'Wi-Fi'} sees ${n} network(s)${r.wifi_best_signal != null ? `, best signal ${r.wifi_best_signal}%` : ''}.`)
}

function bluetooth(def: CheckDef, r: HardwareReport, device: DeviceKind): Verdict {
  const bt = r.bluetooth || []
  if (!bt.length) return device === 'laptop' ? v(def, 'warn', 'No Bluetooth found — check whether this model has it.') : v(def, 'na', 'No Bluetooth in this desktop.')
  const ok = bt.some((b) => /^ok$/i.test(b.status || ''))
  return ok ? v(def, 'pass', bt[0].name || 'Bluetooth radio working.') : v(def, 'warn', `Bluetooth present but status "${bt[0].status}".`)
}

// ---------- guided items ----------

function guided(def: CheckDef, input: RuleInput): Verdict {
  const answers = input.interactive?.answers || {}
  const a = answers[def.key]
  const r = input.report

  // Facts that make a guided check not apply, or decide it automatically.
  if (def.key === 'touch' && !r?.touch) return v(def, 'na', 'No touch screen on this unit.')
  if ((def.key === 'touch_bar' || def.key === 'touch_id') && !a) {
    const known = macModel(r?.mac?.model_identifier)
    if (known && def.key === 'touch_bar' && !known.touchBar) return v(def, 'na', 'This model has no Touch Bar.')
    if (known && def.key === 'touch_id' && !known.touchId) return v(def, 'na', 'This model has no Touch ID.')
  }
  if (def.key === 'camera' && !(r?.cameras || []).length && !a) {
    return input.device === 'laptop'
      ? v(def, 'warn', 'No camera found by the system. If this model has one, it is faulty or unplugged.')
      : v(def, 'na', 'No camera on this desktop.')
  }
  if (def.key === 'ethernet' && !a) {
    const hasLan = (r?.net || []).some((n) => n.media === 'ethernet')
    if (!hasLan) return v(def, 'na', 'No LAN port found.')
    if (input.live?.ethernet_seen_up) return v(def, 'pass', 'Cable plugged in — link came up.')
  }
  if (def.key === 'display_out' && !a && (input.live?.monitors_max || 0) >= 2) {
    return v(def, 'pass', 'External monitor detected.')
  }
  if (def.key === 'usb_ports' && !a) {
    const declared = input.interactive?.usb_ports_declared
    const seen = input.live?.usb_seen?.length || 0
    if (declared && seen >= declared) return v(def, 'pass', `${seen} of ${declared} ports detected a device.`)
    if (declared) return v(def, 'missing', `${seen} of ${declared} ports tested so far.`)
  }
  if (def.key === 'serial_match' && !a) return v(def, 'missing', 'Type the serial from the bottom sticker on the review screen.')
  if (a) return v(def, a.result, a.note || '')
  return v(def, 'missing', 'Not answered yet.')
}

// ---------- entry point ----------

export function evaluateChecks(input: RuleInput): Verdict[] {
  const r = input.report
  const mac = input.platform === 'mac'
  return checksFor(input.device, input.platform || 'windows').map((def): Verdict => {
    if (def.kind === 'guided') return guided(def, input)
    if (!r) return v(def, 'pending', 'Waiting for the script.')
    const answers = input.interactive?.answers
    if (mac) {
      switch (def.key) {
        case 'activation_lock': return activationLock(def, r)
        case 'firmware_password': return firmwarePassword(def, r)
        case 'filevault': return fileVault(def, r)
        case 'company_lock': return macCompanyLock(def, r, answers)
        case 'disk_health': return macDiskHealth(def, r)
        case 'stability': return macStability(def, r)
      }
    }
    switch (def.key) {
      case 'bios_password': {
        const out = biosPassword(def, r)
        const prompt = answers?.bios_prompt
        if (out.state === 'unknown' && prompt) {
          return prompt.result === 'fail'
            ? v(def, 'fail', 'Engineer saw a BIOS/boot password prompt.', true)
            : v(def, 'pass', 'Engineer confirmed: no BIOS/boot password prompt.')
        }
        return out
      }
      case 'company_lock': return companyLock(def, r, answers)
      case 'computrace': return computrace(def, r)
      case 'bitlocker': return bitlocker(def, r)
      case 'activation': return activation(def, r)
      case 'disk_health': return diskHealth(def, r)
      case 'disk_test': return diskTest(def, r, input.background)
      case 'disk_events': return diskEvents(def, r)
      case 'ram_test': return ramTest(def, input.background)
      case 'heat': return heat(def, input.background, input.options, r)
      case 'stability': return stability(def, r)
      case 'drivers': return drivers(def, r)
      case 'original_parts': return originalParts(def, r)
      case 'battery_health': return batteryHealthRule(def, r)
      case 'wifi': return wifi(def, r, input.device)
      case 'bluetooth': return bluetooth(def, r, input.device)
      default: return v(def, 'unknown', '')
    }
  })
}

// A check key's definition, for callers outside this file.
export const checkDef = (key: string) => CHECKS.find((c) => c.key === key)
