'use client'

// Auto Check -- stock in + strict QC for a laptop/desktop, driven by a script
// on the machine itself. The engineer starts a run here (on their own phone or
// PC), types one line into PowerShell on the laptop, does the guided tests on
// the page that opens there, then reviews everything here and saves.
//
// The save goes through the SAME routes as the manual flow:
//   POST /api/stock-intake            (SKU match/create, duplicate-serial block, stock movement)
//   PUT  /api/asset-ledger/[id]/qc    (checklist rows, qc_passed/faulty, battery %, conditions)
// so nothing about how stock or QC is recorded changes. See docs/bible/processes/auto-check.md.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Copy, Download, Loader2, RefreshCw, Wifi, WifiOff, ChevronDown } from 'lucide-react'
import { buildLauncherCmd } from '@/lib/qc-agent/launcher'
import { macCommand } from '@/lib/qc-agent/mac-script'
import { toast } from 'sonner'
import { apiFetch } from '@/lib/api-client'
import { useRole } from '@/lib/auth/useRole'
import { useCustomOptions } from '@/lib/useCustomOptions'
import RequirePageAccess from '@/components/RequirePageAccess'
import { Checkbox } from '@/components/ui/checkbox'
import { SearchableSelect } from '@/components/SearchableSelect'
import { CategorySpecFields, parseFieldSchema } from '@/components/CategorySpecFields'
import { TYPE_TO_CATEGORY } from '@/lib/sku-category-map'
import type { BundledAccessory } from '@/components/AccessoryBundlePicker'
import { EMPTY_BUNDLED_MONITOR, type BundledMonitor } from '@/components/BundleMonitorFields'
import { ReceivedDateField, PurchasedByField, ConditionNotesField, UnitExtrasFields, todayIso } from '@/components/IntakeUnitFields'
import { VerdictList, effectiveDecision, overrideMissingReason, savedNote, type Decision } from '@/components/qc-agent/VerdictList'
import type { Evaluation } from '@/lib/qc-agent/evaluate'
import type { Verdict } from '@/lib/qc-agent/rules'

interface SessionView {
  id: string
  code: string
  command: string
  status: 'waiting' | 'running' | 'completed'
  expired: boolean
  expires_at: string
  options: { heat_test?: boolean; asset_id?: string }
  reported_at: string | null
  script_connected: boolean
  background: { stage: string | null; stage_progress: number | null }
  page_finished: boolean
  asset_id: string | null
  evaluation: Evaluation | null
}

interface OpenSession { id: string; code: string; created_at: string; reported_at: string | null; manufacturer: string | null; model: string | null; serial: string | null; asset_id: string | null }

const STAGES = [
  { key: 'ram', label: 'RAM test' },
  { key: 'heat', label: 'Heat test' },
  { key: 'disk', label: 'Disk test' },
]

const GRADES = ['A', 'B', 'C', 'D', 'Scrap']
const GRADE_HINT: Record<string, string> = { A: 'Superb', B: 'Good', C: 'Fair', D: 'Rough' }

function AutoCheckPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const sessionId = searchParams.get('s')
  const { hasPageAccess } = useRole()

  const [heatTest, setHeatTest] = useState(true)
  const [starting, setStarting] = useState(false)
  const [openSessions, setOpenSessions] = useState<OpenSession[]>([])
  const [view, setView] = useState<SessionView | null>(null)
  const [loadErr, setLoadErr] = useState('')

  // ---------- start / resume ----------
  useEffect(() => {
    if (sessionId) return
    apiFetch('/api/qc-agent/sessions').then((r) => (r.ok ? r.json() : [])).then((d) => setOpenSessions(Array.isArray(d) ? d : [])).catch(() => {})
  }, [sessionId])

  const start = async () => {
    setStarting(true)
    try {
      const res = await apiFetch('/api/qc-agent/sessions', { method: 'POST', body: JSON.stringify({ heat_test: heatTest }) })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Could not start')
      router.replace(`/dashboard/entry/auto-check?s=${body.id}`)
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setStarting(false)
    }
  }

  // ---------- polling ----------
  const savedRef = useRef(false)
  const load = useCallback(async () => {
    if (!sessionId) return
    const res = await apiFetch(`/api/qc-agent/sessions/${sessionId}`).catch(() => null)
    if (!res) return
    if (!res.ok) { setLoadErr((await res.json().catch(() => ({}))).error || 'Could not load this check'); return }
    setLoadErr('')
    setView(await res.json())
  }, [sessionId])

  useEffect(() => {
    if (!sessionId) { setView(null); return }
    load()
    const t = setInterval(() => {
      if (savedRef.current) return
      if (document.visibilityState === 'hidden') return
      load()
    }, 3000)
    return () => clearInterval(t)
  }, [sessionId, load])

  if (!sessionId) {
    return (
      <Shell>
        <div className="rounded-md border bg-card p-4 space-y-4">
          <p className="text-sm">
            Do the physical check, cleaning, charger and Windows install first. Then start here: you get a 6-letter code and one line to type on the laptop.
            The ERP reads the specs and runs the tests by itself; you answer the few things only a person can judge.
          </p>
          <label className="flex items-start gap-2 text-sm">
            <Checkbox checked={heatTest} onCheckedChange={(v) => setHeatTest(!!v)} className="mt-0.5" />
            <span>
              Run the 3-minute heat test <span className="text-muted-foreground">(recommended — catches a dried-out fan or paste. Keep the charger plugged in.)</span>
            </span>
          </label>
          {hasPageAccess('new_entry') ? (
            <button type="button" onClick={start} disabled={starting} className="bg-primary text-primary-foreground px-5 py-2 rounded font-medium disabled:opacity-50">
              {starting && <Loader2 className="inline size-4 animate-spin mr-1" />}Start Auto Check
            </button>
          ) : (
            <p className="text-sm text-muted-foreground">Your account can re-test units already in stock: open the unit, then QC &amp; Spec → Auto Test.</p>
          )}
          <LauncherDownload />
          <p className="text-xs text-muted-foreground">
            Checking several laptops at once? Start one check per laptop — each gets its own code. They all appear under &quot;Unfinished checks&quot; below, so you can switch between them.
            A laptop already in stock can also be re-tested from its own page: QC &amp; Spec → Auto Test.
          </p>
        </div>
        {openSessions.length > 0 && (
          <div className="rounded-md border bg-card p-4 mt-4">
            <div className="text-sm font-semibold mb-2">Unfinished checks</div>
            <ul className="divide-y">
              {openSessions.map((s) => (
                <li key={s.id} className="py-2 flex items-center justify-between gap-3 text-sm">
                  <span>
                    <span className="text-muted-foreground mr-2">{new Date(s.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    <span className="font-mono font-semibold">{s.code}</span>{' '}
                    {s.reported_at ? `${s.manufacturer || ''} ${s.model || ''} · ${s.serial || ''}` : <span className="text-muted-foreground">waiting for the laptop</span>}
                    {s.asset_id && <span className="ml-1 text-xs text-info">(re-test of a stocked unit)</span>}
                  </span>
                  <Link href={`/dashboard/entry/auto-check?s=${s.id}`} className="underline shrink-0">Open</Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Shell>
    )
  }

  if (loadErr) return <Shell><div className="text-destructive">{loadErr}</div></Shell>
  if (!view) return <Shell><Loader2 className="size-5 animate-spin" /></Shell>

  if (view.status === 'completed') {
    return (
      <Shell>
        <div className="rounded-md border border-success bg-success/10 p-4 space-y-2">
          <div className="font-semibold">Saved.</div>
          <div className="flex flex-wrap gap-4 text-sm">
            {view.asset_id && <Link className="underline" href={`/dashboard/stock/${view.asset_id}`}>Open this unit</Link>}
            <Link className="underline" href="/dashboard/live-stock">Go to Live Stock</Link>
            <button type="button" className="underline" onClick={() => { savedRef.current = false; router.replace('/dashboard/entry/auto-check') }}>Check the next laptop</button>
          </div>
        </div>
      </Shell>
    )
  }
  if (view.expired) {
    return (
      <Shell>
        <div className="rounded-md border border-warning bg-warning/10 p-4 text-sm">
          This code has expired (codes last 2 hours). <button type="button" className="underline" onClick={() => router.replace('/dashboard/entry/auto-check')}>Start a new check</button>
        </div>
      </Shell>
    )
  }

  if (!view.evaluation) return <Shell another><WaitingForLaptop view={view} /></Shell>

  return (
    <Shell another>
      <Review
        view={view}
        canSaveQc={hasPageAccess(['live_stock', 'stock'])}
        canStockIn={hasPageAccess('new_entry')}
        onSaved={() => { savedRef.current = true; load() }}
      />
    </Shell>
  )
}

function Shell({ children, another }: { children: React.ReactNode; another?: boolean }) {
  const router = useRouter()
  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-2">
        <button onClick={() => router.push('/dashboard/entry')} className="text-sm text-muted-foreground hover:text-foreground">← Back</button>
        {another && (
          <Link href="/dashboard/entry/auto-check" target="_blank" className="text-sm underline" title="Opens in a new tab; this check keeps running">
            + Check another laptop
          </Link>
        )}
      </div>
      <h1 className="text-2xl font-bold mb-1">Auto Check</h1>
      <p className="text-sm text-muted-foreground mb-4">Stock in a laptop or desktop and QC it, with the specs and tests read from the machine itself.</p>
      {children}
    </div>
  )
}

function CopyLine({ text }: { text: string }) {
  return (
    <div className="flex items-stretch gap-2">
      <code className="flex-1 min-w-0 break-all rounded bg-muted px-3 py-2 font-mono text-sm">{text}</code>
      <button
        type="button"
        onClick={() => navigator.clipboard?.writeText(text).then(() => toast.success('Copied'))}
        className="rounded border px-3 hover:bg-muted"
        title="Copy"
      >
        <Copy className="size-4" />
      </button>
    </div>
  )
}

// The pen-drive launcher, built in the browser for this ERP's own address.
function LauncherDownload() {
  const download = () => {
    const blob = new Blob([buildLauncherCmd(window.location.origin)], { type: 'application/octet-stream' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'DB Auto Check.cmd'
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return (
    <div className="rounded border border-dashed p-3 text-sm space-y-2">
      <div className="font-medium">One-time setup: the pen drive launcher</div>
      <p className="text-muted-foreground">
        Download this file once and copy it to the pen drive you use for testing. Then nobody has to type the long command:
        on each laptop, double-click <b>DB Auto Check</b>, click <b>Yes</b>, and type the 6-letter code.
      </p>
      <button type="button" onClick={download} className="inline-flex items-center gap-1 rounded border px-3 py-1.5 hover:bg-muted">
        <Download className="size-4" /> Download &quot;DB Auto Check.cmd&quot;
      </button>
    </div>
  )
}

function WaitingForLaptop({ view }: { view: SessionView }) {
  return (
    <div className="rounded-md border bg-card p-4 space-y-4">
      <div className="text-center">
        <div className="text-xs text-muted-foreground uppercase tracking-wide">Code</div>
        <div className="text-4xl font-mono font-bold tracking-[0.3em]">{view.code}</div>
      </div>
      <ol className="list-decimal pl-5 space-y-2 text-sm">
        <li><b>Windows:</b> plug the pen drive into the laptop and double-click <b>DB Auto Check</b>. Click <b>Yes</b> when Windows asks.</li>
        <li>Type the code <b className="font-mono tracking-widest">{view.code}</b> and press Enter. A wrong code just asks again.</li>
        <li>A test page opens on the laptop. Follow it there; results appear here by themselves.</li>
      </ol>
      <div className="rounded border p-3 text-sm space-y-2">
        <div className="font-medium">It&apos;s a Mac?</div>
        <ol className="list-decimal pl-5 space-y-1.5">
          <li>Press <b>Command + Space</b>, type <b>Terminal</b>, press Enter.</li>
          <li>Type this line and press Enter (it&apos;s the same for every Mac):
            <div className="mt-1.5"><CopyLine text={macCommand(typeof window !== 'undefined' ? window.location.origin : 'https://erp.digitalbluez.com')} /></div>
          </li>
          <li>Type the code <b className="font-mono tracking-widest">{view.code}</b>, then the Mac&apos;s login password (it stays on the Mac; Enter skips it, but then a few checks can&apos;t run).</li>
        </ol>
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground">No pen drive? Type the command instead</summary>
        <ol className="list-decimal pl-5 space-y-2 mt-2">
          <li>On the laptop, press <b>Win + X</b> and choose <b>Terminal (Admin)</b> (or <b>Windows PowerShell (Admin)</b>). Click Yes.</li>
          <li>Type this line exactly and press Enter:
            <div className="mt-2"><CopyLine text={view.command} /></div>
          </li>
        </ol>
        <div className="mt-2"><LauncherDownload /></div>
      </details>
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer">It says something about SSL/TLS or a secure channel</summary>
        <div className="mt-2">Older Windows 10 builds need TLS switched on first. Type this line instead:
          <div className="mt-1"><CopyLine text={`[Net.ServicePointManager]::SecurityProtocol='Tls12'; ${view.command}`} /></div>
        </div>
      </details>
      <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Waiting for the laptop…</div>
    </div>
  )
}

// ======================================================================
// Review + save
// ======================================================================

function Review({ view, canSaveQc, canStockIn, onSaved }: { view: SessionView; canSaveQc: boolean; canStockIn: boolean; onSaved: () => void }) {
  const ev = view.evaluation!
  const { values: typeOptions, addOption: addTypeOption } = useCustomOptions('stock_intake_type')
  const [templates, setTemplates] = useState<any[]>([])
  useEffect(() => {
    apiFetch('/api/sku-category-templates').then((r) => r.json()).then((d) => setTemplates(Array.isArray(d) ? d : [])).catch(() => {})
  }, [])

  // ----- unit + SKU -----
  const [type, setType] = useState(ev.type)
  const [specs, setSpecs] = useState<Record<string, any>>(ev.specs)
  const [specsTouched, setSpecsTouched] = useState(false)
  const [serial, setSerial] = useState(ev.serial)
  const [stickerSerial, setStickerSerial] = useState('')
  const [useMatch, setUseMatch] = useState(true)
  // A re-run of the script (new reported_at) refreshes untouched fields.
  const reportedRef = useRef(view.reported_at)
  useEffect(() => {
    if (reportedRef.current === view.reported_at) return
    reportedRef.current = view.reported_at
    if (!specsTouched) setSpecs(ev.specs)
    setSerial((s) => s || ev.serial)
  }, [view.reported_at, ev.specs, ev.serial, specsTouched])

  const category = TYPE_TO_CATEGORY[type] || 'OTHER'
  const template = templates.find((t) => t.category === category)
  const fields = (parseFieldSchema(template?.field_schema).fields || []).filter((f: any) => f.name !== 'model_year' || specs.brand === 'Apple')
  const match = ev.sku_match && category === ev.category ? ev.sku_match : null
  const usingMatch = !!match && useMatch
  const existing = ev.existing_unit

  // ----- per-unit intake fields -----
  const [receivedDate, setReceivedDate] = useState(todayIso())
  const [purchasedBy, setPurchasedBy] = useState('Digitalbluez')
  const [conditionNotes, setConditionNotes] = useState('')
  const [bundled, setBundled] = useState<BundledAccessory[]>([])
  const [bundleMonitor, setBundleMonitor] = useState(false)
  const [bundledMonitor, setBundledMonitor] = useState<BundledMonitor>(EMPTY_BUNDLED_MONITOR)

  // ----- QC decisions -----
  const [overrides, setOverrides] = useState<Record<string, Decision>>({})
  const setOverride = (key: string, d: Decision | null) =>
    setOverrides((o) => { const n = { ...o }; if (d) n[key] = d; else delete n[key]; return n })

  // The serial-sticker check is decided here, from what the engineer types.
  const verdicts: Verdict[] = useMemo(() => ev.verdicts.map((v) => {
    if (v.key !== 'serial_match') return v
    const typed = stickerSerial.toUpperCase().replace(/[^A-Z0-9]/g, '')
    const bios = (ev.serial || '').toUpperCase()
    if (ev.serial_placeholder) return { ...v, state: 'fail' as const, hard: true, note: 'The machine has no serial number programmed in its BIOS (typical of a replaced motherboard).' }
    if (typed.length < 4) return v
    return bios.endsWith(typed) || bios === typed
      ? { ...v, state: 'pass' as const, note: `Sticker ends in ${typed} — matches the BIOS serial ${bios}.` }
      : { ...v, state: 'fail' as const, hard: true, note: `Sticker "${typed}" does not match the BIOS serial ${bios} — the motherboard or bottom case may have been swapped.` }
  }), [ev.verdicts, ev.serial, ev.serial_placeholder, stickerSerial])

  const decisions = verdicts.map((v) => ({ v, d: effectiveDecision(v, overrides[v.key]) }))
  const pending = decisions.filter(({ v }) => v.state === 'pending')
  const undecided = decisions.filter(({ v, d }) => !d && v.state !== 'pending')
  const missingReasons = decisions.filter(({ v, d }) => overrideMissingReason(v, d))
  const failing = decisions.filter(({ d }) => d?.result === 'fail')
  const flags = verdicts.filter((v) => (v.state === 'fail' && v.hard) || v.state === 'warn')

  // ----- grade + conditions -----
  const kbBacklight = decisions.find(({ v }) => v.key === 'kb_backlight')?.d
  const charging = decisions.find(({ v }) => v.key === 'charging')?.d
  const [grade, setGrade] = useState<string | null>(null)
  const effectiveGrade = grade ?? ev.suggested_grade ?? ''
  const [battery, setBattery] = useState<string | null>(null)
  const [backup, setBackup] = useState<string | null>(null)
  const [storage, setStorage] = useState<string | null>(null)
  const storageValue = storage ?? String(ev.storage_health_percent ?? '')
  const ramVerdict = decisions.find(({ v }) => v.key === 'ram_test')
  const [warranty, setWarranty] = useState('')
  const [accessoriesText, setAccessoriesText] = useState<string | null>(null)
  const { values: conditionOptions } = useCustomOptions('condition_grade')
  const [cond, setCond] = useState<Record<string, string | null>>({})
  const condValue = (k: 'screen_condition' | 'keyboard_condition' | 'body_condition') => cond[k] ?? ev.conditions[k] ?? ''

  const missingRequired = !usingMatch && !existing
    ? fields.filter((f: any) => f.required && (specs[f.name] === undefined || specs[f.name] === '')).map((f: any) => f.label)
    : []

  const blockers: string[] = []
  if (!existing && !serial.trim()) blockers.push('Serial number is empty')
  if (existing && !existing.qcable) blockers.push(`This unit is "${existing.status.replace(/_/g, ' ')}" in the ERP — it isn't with us, so it can't be QC'd or stocked in again`)
  if (existing?.serial_mismatch) blockers.push(`Wrong laptop: ${existing.serial_mismatch}`)
  if (!existing && !canStockIn) blockers.push('This laptop is not in the ERP yet, and your account cannot stock in (needs New Entry access)')
  if (missingRequired.length) blockers.push(`Fill in: ${missingRequired.join(', ')}`)
  if (pending.length) blockers.push(`${pending.length} test(s) still running: ${pending.map(({ v }) => v.label).join(', ')}`)
  if (undecided.length) blockers.push(`${undecided.length} check(s) need your answer`)
  if (missingReasons.length) blockers.push('Write a reason for each failed check you are passing')
  if (!canSaveQc) blockers.push('Your account can stock in but not save QC (needs Live Stock or Stock access) — ask the owner')

  // ----- save -----
  const [saving, setSaving] = useState(false)
  const [savedAssetId, setSavedAssetId] = useState<string | null>(existing?.qcable ? existing.id : null)
  const [saveErr, setSaveErr] = useState('')

  const save = async () => {
    setSaving(true); setSaveErr('')
    try {
      let assetId = savedAssetId
      // 1) Stock in (skipped for a unit already in the ERP, or on a QC retry).
      if (!assetId) {
        let payload: Record<string, unknown>
        if (usingMatch) {
          payload = { sku_id: match!.id }
        } else {
          const allowed = new Set(fields.map((f: any) => f.name))
          const finalSpecs: Record<string, any> = {}
          for (const [k, val] of Object.entries(specs)) if (allowed.has(k) && val !== '' && val !== undefined) finalSpecs[k] = val
          if (allowed.has('has_backlit_keyboard') && kbBacklight) finalSpecs.has_backlit_keyboard = kbBacklight.result === 'pass'
          payload = { type, model: finalSpecs.model ?? finalSpecs.item_name, brand: finalSpecs.brand, specifications: finalSpecs }
          // New dropdown values the machine reported (a model or CPU not in the lists yet).
          await Promise.all(Object.entries(ev.spec_meta)
            .filter(([f, m]) => m.is_new && m.options_category && specs[f] === ev.specs[f] && allowed.has(f))
            .map(([f, m]) => apiFetch('/api/custom-options', { method: 'POST', body: JSON.stringify({ category: m.options_category, value: String(specs[f]) }) }).catch(() => null)))
        }
        const res = await apiFetch('/api/stock-intake', {
          method: 'POST',
          body: JSON.stringify({
            ...payload,
            serial_number: serial.trim(),
            purchased_by_type: purchasedBy,
            condition_notes: conditionNotes,
            received_date: receivedDate,
            bundled_accessories: bundled.length ? bundled.map((b) => ({ accessory_id: b.accessory_id, quantity: b.quantity })) : undefined,
            bundled_monitor: category === 'DES' && bundleMonitor && bundledMonitor.brand && bundledMonitor.size ? bundledMonitor : undefined,
          }),
        })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(body.error || 'Stock-in failed')
        assetId = body.id as string
        setSavedAssetId(assetId)
        const dup = body.possible_duplicates?.[0]
        if (dup) toast(`Heads up: similar existing SKU ${dup.full_sku_code}. The owner may merge them later.`)
        if (body.bundled_monitor_warning) toast.error(body.bundled_monitor_warning)
      }

      // 2) QC.
      const checks = decisions.map(({ v, d }) => ({ check_item: v.label, result: d!.result, notes: savedNote(v, d!) || undefined }))
      const highlights = [
        `Auto Check ${view.code}`,
        ev.battery_health_percent != null ? `battery ${ev.battery_health_percent}%` : null,
        numOrNull(storageValue) != null ? `SSD health ${numOrNull(storageValue)}%` : null,
        ramVerdict?.d ? `RAM test ${ramVerdict.d.result === 'pass' ? 'passed' : ramVerdict.d.result}` : null,
        failing.length ? `failed: ${failing.map(({ v }) => v.label).join(', ')}` : 'all checks passed',
      ].filter(Boolean).join(' · ')
      const qcRes = await apiFetch(`/api/asset-ledger/${assetId}/qc`, {
        method: 'PUT',
        body: JSON.stringify({
          checks,
          qc_grade: effectiveGrade || null,
          qc_notes: highlights,
          battery_health_percent: ev.device === 'laptop' ? numOrNull(battery ?? String(ev.battery_health_percent ?? '')) : undefined,
          estimated_backup_hours: ev.device === 'laptop' ? numOrNull(backup ?? String(ev.estimated_backup_hours ?? '')) : undefined,
          storage_health_percent: numOrNull(storageValue) != null ? Math.round(numOrNull(storageValue)!) : null,
          screen_condition: condValue('screen_condition') || null,
          keyboard_condition: condValue('keyboard_condition') || null,
          body_condition: condValue('body_condition') || null,
          included_accessories: (accessoriesText ?? (charging?.result === 'pass' ? 'Charger' : '')) || null,
          warranty_duration_months: warranty.trim() ? Number(warranty) : undefined,
        }),
      })
      const qcBody = await qcRes.json().catch(() => ({}))
      if (!qcRes.ok) throw new Error(`The unit is in stock, but QC didn't save: ${qcBody.error || qcRes.status}. Press Save again to retry the QC.`)

      // 3) Close the run (kills the code on the laptop).
      await apiFetch(`/api/qc-agent/sessions/${view.id}/complete`, { method: 'POST', body: JSON.stringify({ asset_id: assetId }) })
      toast.success(failing.length ? 'Saved — marked FAULTY (failed checks).' : 'Saved — QC passed.')
      onSaved()
    } catch (e: any) {
      setSaveErr(e.message)
    } finally {
      setSaving(false)
    }
  }

  const bg = view.background

  return (
    <div className="space-y-4">
      {/* status bar */}
      <div className="rounded-md border bg-card p-3 text-sm space-y-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-mono font-bold">{view.code}</span>
          <span className="flex items-center gap-1 text-muted-foreground">
            {view.script_connected ? <><Wifi className="size-4 text-success" /> Laptop connected</> : <><WifiOff className="size-4 text-warning" /> Laptop not reporting</>}
          </span>
          <span className="text-muted-foreground">{view.page_finished ? 'Test page finished' : 'Test page in progress'}</span>
        </div>
        <div className="flex gap-1">
          {STAGES.map((s) => {
            const order = ['ram', 'heat', 'disk', 'done']
            const cur = order.indexOf(bg.stage || 'ram')
            const me = order.indexOf(s.key)
            const skipped = s.key === 'heat' && view.options.heat_test === false
            const pct = skipped || cur > me ? 100 : cur === me ? (bg.stage_progress ?? 0) : 0
            return (
              <div key={s.key} className="flex-1">
                <div className="h-1.5 rounded bg-muted overflow-hidden"><div className="h-full bg-primary transition-[width]" style={{ width: `${pct}%` }} /></div>
                <div className="text-[11px] text-muted-foreground mt-0.5">{s.label}{skipped ? ' (off)' : cur === me ? ` ${pct}%` : cur > me ? ' ✓' : ''}</div>
              </div>
            )
          })}
        </div>
        {!view.script_connected && bg.stage !== 'done' && (
          <div className="text-xs text-muted-foreground">If the PowerShell window was closed, run the line again on the laptop: <CopyLine text={view.command} /></div>
        )}
      </div>

      {flags.length > 0 && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm space-y-1">
          <div className="font-semibold text-destructive">Red flags</div>
          {flags.map((v) => <div key={v.key}><b>{v.label}:</b> {v.note}</div>)}
        </div>
      )}

      {/* unit */}
      <div className="rounded-md border bg-card p-4 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block font-medium text-sm mb-1">Type</label>
            <SearchableSelect options={typeOptions} value={type} onChange={(v) => setType(v as any)} onOtherCommit={(v) => { if (!typeOptions.includes(v)) addTypeOption(v) }} />
          </div>
          <div>
            <label className="block font-medium text-sm mb-1">Serial Number (from BIOS)</label>
            <input value={serial} onChange={(e) => setSerial(e.target.value.toUpperCase())} className="border p-2 w-full rounded font-mono" />
            {ev.serial_placeholder && <p className="text-xs text-destructive mt-1">The BIOS has no real serial — type the one from the sticker.</p>}
          </div>
        </div>
        <div>
          <label className="block font-medium text-sm mb-1">Serial on the bottom sticker (last 6 characters)</label>
          <input value={stickerSerial} onChange={(e) => setStickerSerial(e.target.value)} placeholder="e.g. 4Q8F2K" className="border p-2 w-full rounded font-mono uppercase" />
          <p className="text-xs text-muted-foreground mt-1">Checks the motherboard is the one this laptop left the factory with. No sticker? Mark the check below N/A or Fail.</p>
        </div>
        {existing && (
          <div className={`rounded border p-3 text-sm ${existing.qcable ? 'border-info bg-info/10' : 'border-destructive bg-destructive/10'}`}>
            {existing.serial_mismatch
              ? <>{existing.serial_mismatch} Run the line on the right laptop, or start a new check for this one.</>
              : existing.qcable
                ? <>
                    {existing.target ? 'Re-testing' : 'This serial is already in stock:'} {existing.asset_number || 'no asset number yet'}, status <b>{existing.status.replace(/_/g, ' ')}</b>.
                    {' '}Saving <b>replaces its previous QC report</b> with this one — it won&apos;t be stocked in again.
                    {existing.status === 'ready_for_sale' && ' If every check passes it stays on sale; if any check fails it comes off sale as faulty.'}
                  </>
                : <>This serial is already in the ERP with status <b>{existing.status.replace(/_/g, ' ')}</b>. It can&apos;t be QC&apos;d or stocked in again from here.</>}
          </div>
        )}
      </div>

      {/* Full configuration, always shown */}
      {(existing || usingMatch) && (
        <div className="rounded-md border bg-card p-4 space-y-2">
          <div className="text-sm font-semibold">Configuration (read from the machine)</div>
          <ConfigGrid fields={fields} specs={ev.specs} />
          {usingMatch && !existing && <p className="text-xs text-muted-foreground">Saved under the matched SKU below. Pick &quot;Not the same&quot; to edit these.</p>}
          {existing && <HardwareDetails lines={ev.hardware_lines} />}
        </div>
      )}

      {/* SKU */}
      {!existing && (
        <div className="rounded-md border bg-card p-4 space-y-3">
          <div className="text-sm font-semibold">Model & specs</div>
          {match ? (
            <div className="space-y-2 text-sm">
              <label className="flex items-start gap-2">
                <input type="radio" checked={useMatch} onChange={() => setUseMatch(true)} className="mt-1" />
                <span>Matches existing SKU <b>{match.full_sku_code}</b> — {match.description} <span className="text-muted-foreground">({match.quantity_in_stock} in stock)</span></span>
              </label>
              <label className="flex items-start gap-2">
                <input type="radio" checked={!useMatch} onChange={() => setUseMatch(false)} className="mt-1" />
                <span>Not the same — create a new SKU from the detected specs</span>
              </label>
            </div>
          ) : (
            <div className="text-sm text-info">No existing SKU has this model and configuration — a new SKU will be created.</div>
          )}
          {!usingMatch && (
            <>
              <CategorySpecFields
                fields={fields}
                specs={specs}
                category={category}
                onChange={(name, value) => { setSpecsTouched(true); setSpecs((p) => ({ ...p, [name]: value })) }}
              />
              {Object.entries(ev.spec_meta).some(([, m]) => m.is_new) && (
                <p className="text-xs text-muted-foreground">
                  New to your dropdown lists (added on save): {Object.entries(ev.spec_meta).filter(([, m]) => m.is_new).map(([f, m]) => `${f} "${ev.specs[f] ?? m.detected}"`).join(', ')}
                </p>
              )}
            </>
          )}
          <HardwareDetails lines={ev.hardware_lines} />
        </div>
      )}

      {/* per-unit intake fields */}
      {!existing && (
        <div className="rounded-md border bg-card p-4 space-y-4">
          <ReceivedDateField value={receivedDate} onChange={setReceivedDate} />
          <PurchasedByField value={purchasedBy} onChange={setPurchasedBy} />
          <UnitExtrasFields
            category={category}
            bundled={bundled}
            onBundledChange={setBundled}
            bundleMonitor={bundleMonitor}
            onBundleMonitorChange={setBundleMonitor}
            bundledMonitor={bundledMonitor}
            onBundledMonitorChange={setBundledMonitor}
          />
          <ConditionNotesField value={conditionNotes} onChange={setConditionNotes} />
        </div>
      )}

      {/* QC */}
      <div>
        <div className="flex items-baseline justify-between mb-2">
          <h2 className="text-lg font-semibold">QC</h2>
          <span className="text-xs text-muted-foreground">{decisions.filter(({ d }) => d).length} of {decisions.length} settled</span>
        </div>
        <VerdictList verdicts={verdicts} overrides={overrides} onChange={setOverride} />
      </div>

      {/* grade + website facts */}
      <div className="rounded-md border bg-card p-4 space-y-3">
        <div className="text-sm font-semibold">Grade & condition (shown on the website)</div>
        {ramVerdict && (
          <div className="text-sm">
            <span className="text-muted-foreground">RAM health: </span>
            <span className={ramVerdict.v.state === 'fail' ? 'text-destructive font-medium' : ramVerdict.v.state === 'pass' ? 'text-success font-medium' : 'font-medium'}>
              {ramVerdict.v.state === 'pass' ? 'Passed' : ramVerdict.v.state === 'fail' ? 'FAILED' : ramVerdict.v.state === 'pending' ? 'Test running…' : 'Not confirmed'}
            </span>
            {ramVerdict.v.note && <span className="text-muted-foreground"> — {ramVerdict.v.note}</span>}
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium mb-1">SSD health (%)</label>
            <input type="number" min={0} max={100} value={storageValue} onChange={(e) => setStorage(e.target.value)} placeholder={ev.storage_health_percent == null ? 'needs Admin PowerShell' : ''} className="border p-2 w-full rounded" />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Grade {ev.suggested_grade && <span className="text-muted-foreground">(suggested {ev.suggested_grade})</span>}</label>
            <select value={effectiveGrade} onChange={(e) => setGrade(e.target.value)} className="border p-2 w-full rounded">
              <option value="">{ev.cosmetic_done ? 'Not graded' : 'Answer the cosmetic step first'}</option>
              {GRADES.map((g) => <option key={g} value={g}>{g}{GRADE_HINT[g] ? ` — ${GRADE_HINT[g]}` : ''}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Warranty (months)</label>
            <input type="number" min={0} value={warranty} onChange={(e) => setWarranty(e.target.value)} placeholder="e.g. 6" className="border p-2 w-full rounded" />
          </div>
          {ev.device === 'laptop' && (
            <>
              <div>
                <label className="block text-xs font-medium mb-1">Battery health (%)</label>
                <input type="number" min={0} max={100} value={battery ?? String(ev.battery_health_percent ?? '')} onChange={(e) => setBattery(e.target.value)} className="border p-2 w-full rounded" />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Est. backup (hours)</label>
                <input type="number" min={0} step={0.5} value={backup ?? String(ev.estimated_backup_hours ?? '')} onChange={(e) => setBackup(e.target.value)} placeholder="unplug 8+ min to measure" className="border p-2 w-full rounded" />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Screen condition</label>
                <SearchableSelect key={`sc-${ev.conditions.screen_condition}`} options={conditionOptions} value={condValue('screen_condition')} onChange={(v) => setCond((c) => ({ ...c, screen_condition: v }))} />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Keyboard condition</label>
                <SearchableSelect key={`kc-${ev.conditions.keyboard_condition}`} options={conditionOptions} value={condValue('keyboard_condition')} onChange={(v) => setCond((c) => ({ ...c, keyboard_condition: v }))} />
              </div>
            </>
          )}
          <div>
            <label className="block text-xs font-medium mb-1">Body condition</label>
            <SearchableSelect key={`bc-${ev.conditions.body_condition}`} options={conditionOptions} value={condValue('body_condition')} onChange={(v) => setCond((c) => ({ ...c, body_condition: v }))} />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Included accessories</label>
            <input value={accessoriesText ?? (charging?.result === 'pass' ? 'Charger' : '')} onChange={(e) => setAccessoriesText(e.target.value)} placeholder="e.g. Charger only" className="border p-2 w-full rounded" />
          </div>
        </div>
      </div>

      {/* save */}
      <div className="rounded-md border bg-card p-4 space-y-3 sticky bottom-2 shadow-sm">
        {blockers.length > 0 ? (
          <ul className="text-sm text-warning list-disc pl-5">{blockers.map((b) => <li key={b}>{b}</li>)}</ul>
        ) : (
          <div className={`text-sm font-medium ${failing.length ? 'text-destructive' : 'text-success'}`}>
            {failing.length ? `${failing.length} check(s) failed — the unit will be saved as FAULTY.` : 'Every check passed — the unit will be saved as QC passed.'}
          </div>
        )}
        {saveErr && <div className="text-sm text-destructive">{saveErr}</div>}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={save}
            disabled={saving || blockers.length > 0}
            className="bg-primary text-primary-foreground px-5 py-2 rounded font-medium disabled:opacity-50"
          >
            {saving && <Loader2 className="inline size-4 animate-spin mr-1" />}
            {savedAssetId && !existing?.qcable ? 'Retry saving QC' : existing?.qcable ? 'Save QC (replaces old report)' : 'Stock in + Save QC'}
          </button>
          <button type="button" title="Refresh" className="text-muted-foreground" onClick={() => location.reload()}><RefreshCw className="size-4" /></button>
        </div>
      </div>
    </div>
  )
}

// Every stock-entry field of the category with what the machine reported --
// Brand, Model, Processor, Generation, RAM, SSD, Screen, Graphics, ...
function ConfigGrid({ fields, specs }: { fields: any[]; specs: Record<string, any> }) {
  const show = (v: any) => (v === true ? 'Yes' : v === false ? 'No' : v === undefined || v === null || v === '' ? null : String(v))
  return (
    <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 text-sm">
      {fields.map((f: any) => {
        const v = show(specs[f.name])
        return (
          <div key={f.name} className="min-w-0">
            <dt className="text-xs text-muted-foreground">{f.label}{f.required ? ' *' : ''}</dt>
            <dd className={`break-words ${v ? 'font-medium' : 'text-muted-foreground'}`}>{v ?? '—'}</dd>
          </div>
        )
      })}
    </dl>
  )
}

function HardwareDetails({ lines }: { lines: string[] }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen((s) => !s)} className="text-xs text-muted-foreground flex items-center gap-1">
        <ChevronDown className={`size-3 transition-transform ${open ? 'rotate-180' : ''}`} /> What the machine reported (details)
      </button>
      {open && <ul className="text-xs text-muted-foreground space-y-0.5">{lines.map((l, i) => <li key={i}>{l}</li>)}</ul>}
    </>
  )
}

function numOrNull(s: string | null | undefined): number | null {
  if (s == null || String(s).trim() === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

export default function AutoCheckPageGuarded() {
  return (
    <RequirePageAccess pageKey={['new_entry', 'live_stock', 'stock']}>
      <AutoCheckPage />
    </RequirePageAccess>
  )
}
