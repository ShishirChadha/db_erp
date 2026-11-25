// Shapes the Auto Check PowerShell script (lib/qc-agent/script.ts) and the
// /qc-test page send up. Every field is optional on purpose: a laptop that
// doesn't expose a WMI class, or a script run without admin rights, just leaves
// it out -- the rules turn a missing fact into "couldn't check", never a pass.

export interface HwDisk {
  name?: string
  media_type?: string        // 'SSD' | 'HDD' | 'Unspecified'
  bus_type?: string          // 'NVMe' | 'SATA' | 'USB' | ...
  health?: string            // 'Healthy' | 'Warning' | 'Unhealthy'
  operational?: string
  size_bytes?: number
  // Get-StorageReliabilityCounter (admin only)
  wear?: number | null       // percent of rated life used
  temperature?: number | null
  temperature_max?: number | null
  read_errors_uncorrected?: number | null
  write_errors_uncorrected?: number | null
  read_errors_total?: number | null
  power_on_hours?: number | null
}

export interface HwMonitor {
  maker_code?: string        // EDID 3-letter PNP id (AUO, BOE, LGD, ...)
  product_code?: string
  serial?: string
  name?: string
  year?: number | null
  week?: number | null
  width_cm?: number | null
  height_cm?: number | null
  internal?: boolean
}

export interface HwEvent {
  id: number
  provider?: string
  time?: string
}

/** Mac-only facts (lib/qc-agent/mac-script.ts). Absent on Windows reports. */
export interface MacFacts {
  model_identifier?: string      // "MacBookAir10,1"
  model_number?: string          // order number, e.g. "MPHF3HN/A"
  chip?: string                  // "Apple M1 Pro"; empty on Intel
  intel?: boolean
  activation_lock?: 'enabled' | 'disabled' | null   // T2 / Apple Silicon only
  find_my_token?: boolean | null // NVRAM fmm-mobileme-token-FMM present (older Intel)
  dep?: boolean | null           // "Enrolled via DEP"
  mdm?: boolean | null           // "MDM enrollment"
  dep_assigned?: boolean | null  // a Remote Management config is waiting for this Mac (admin only)
  firmware_password?: boolean | null  // Intel only, admin only
  filevault?: boolean | null
  smart_status?: string | null   // "Verified" | "Failing" | ...
  battery_condition?: string | null  // "Normal" | "Good" | "Service Recommended" | ...
  max_capacity_pct?: number | null   // Apple's own battery health figure
  panics_90d?: number | null
}

export interface HardwareReport {
  v?: number
  /** Absent = Windows (the original script). */
  platform?: 'windows' | 'mac'
  mac?: MacFacts
  is_admin?: boolean
  system?: {
    manufacturer?: string
    model?: string
    version?: string          // Win32_ComputerSystemProduct.Version (Lenovo's real model name)
    family?: string
    pc_system_type?: number   // 2 = mobile
    chassis_types?: number[]
  }
  bios?: { serial?: string; version?: string; release_date?: string; vendor?: string }
  board?: { manufacturer?: string; product?: string; serial?: string }
  enclosure_serial?: string
  cpu?: { name?: string; cores?: number; threads?: number; max_mhz?: number }[]
  memory?: { slot?: string; gb?: number; speed?: number; configured_speed?: number; manufacturer?: string; part_number?: string }[]
  memory_slots?: number | null
  disks?: HwDisk[]
  gpus?: { name?: string; driver_version?: string; status?: string; h_res?: number; v_res?: number; vram_bytes?: number | null; adapter_ram?: number | null }[]
  monitors?: HwMonitor[]
  touch?: boolean
  cameras?: string[]
  biometric?: string[]
  bluetooth?: { name?: string; status?: string }[]
  net?: { name?: string; description?: string; status?: string; media?: 'wifi' | 'ethernet' | 'other' }[]
  wifi_networks?: number | null
  wifi_best_signal?: number | null
  battery?: {
    present?: boolean
    name?: string
    manufacturer?: string
    serial?: string
    chemistry?: string
    design_mwh?: number | null
    full_mwh?: number | null
    cycles?: number | null
  } | null
  os?: { caption?: string; version?: string; build?: string; display_version?: string; edition?: string; arch?: string; install_date?: string }
  activation?: { licensed?: boolean | null; oem_key_in_bios?: boolean | null }
  join?: {
    azure_ad?: boolean | null
    domain?: boolean | null
    enterprise?: boolean | null
    workplace?: boolean | null
    mdm_enrollments?: number | null
    autopilot_tenant?: string | null
  }
  bitlocker?: { protection_on?: boolean | null; volume_status?: string | null; percent?: number | null } | null
  tpm?: { present?: boolean | null; ready?: boolean | null; version?: string | null } | null
  secure_boot?: boolean | null
  bios_password?: { source?: 'lenovo' | 'hp' | 'dell' | null; set?: boolean | null; detail?: string | null }
  computrace?: { windows_agent?: boolean | null; wpbt_binary?: boolean | null; bios_state?: string | null }
  problem_devices?: { name?: string; class?: string; code?: number }[]
  events?: HwEvent[]
  power?: { on_ac?: boolean | null; percent?: number | null }
}

export interface BackgroundResults {
  stage?: 'ram' | 'heat' | 'disk' | 'done'
  stage_progress?: number    // 0-100 within the current stage
  ram?: { tested_mb?: number; passes?: number; errors?: number; seconds?: number; error?: string | null }
  heat?: {
    skipped?: boolean
    seconds?: number
    on_ac?: boolean | null
    // % of base clock (Win32 "% Processor Performance") and % busy, every 5 s
    samples?: { t: number; perf: number | null; util: number | null; temp_c?: number | null; pressure?: string | null }[]
    error?: string | null
  }
  disk?: { mb?: number; write_mbps?: number; read_mbps?: number; mismatches?: number; io_errors?: number; skipped_reason?: string | null; error?: string | null
    /** Mac: false when the read-back may have come from memory (no admin password to flush the cache). */
    cache_flushed?: boolean | null }
  backup?: { minutes?: number; percent_drop?: number; hours?: number } | null
}

export interface LiveSnapshot {
  // Sent by the script every few seconds: what is plugged in right now.
  // `usb` holds only devices that were NOT there when the script started.
  usb?: { id: string; name?: string; path?: string }[]
  monitors_active?: number | null
  ethernet_up?: boolean | null
  on_ac?: boolean | null
  battery_percent?: number | null
  // Kept by the server across snapshots (never sent by the script), so a port
  // that was tested and then unplugged still counts.
  usb_seen?: { path: string; name?: string }[]
  ethernet_seen_up?: boolean
  monitors_max?: number
}

// One answer from the /qc-test page or the review screen.
export interface GuidedAnswer {
  result: 'pass' | 'fail' | 'na'
  note?: string
}

export interface InteractiveResults {
  answers?: Record<string, GuidedAnswer>
  cosmetic?: Record<string, CosmeticLevel>
  usb_ports_declared?: number | null
  // A request for the script on the laptop (e.g. step the brightness). The
  // script remembers the last `at` it ran, so this is never cleared.
  command?: { name: 'brightness_sweep'; at: string } | null
  finished?: boolean
}

export type CosmeticLevel = 'like_new' | 'light' | 'visible' | 'damaged'

export interface SessionOptions {
  heat_test?: boolean
  /** Set when the run was started from a unit's own QC tab ("Auto Test"):
   *  the result is saved against this unit only, never stocked in. */
  asset_id?: string
}
