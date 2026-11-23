'use client'

// Auto Check test page -- opened by the PowerShell script on the laptop being
// checked, at /qc-test/<code>. No login: the code is the credential, and this
// page can only save answers into that code's own session. The engineer goes
// through one screen per area; the hardware tests (RAM, heat, disk) run in the
// background meanwhile, and the review + save happens on their own ERP screen.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { Loader2, Wifi, WifiOff } from 'lucide-react'
import { AnswerButtons } from '@/components/qc-agent/AnswerButtons'
import { ColourTest, BleedTest, TouchGrid, describeMark, type ScreenMark } from '@/components/qc-agent/ScreenTest'
import { KeyboardTest } from '@/components/qc-agent/KeyboardTest'
import { TrackpadTest, SpeakerTest, MicTest, CameraTest } from '@/components/qc-agent/MediaTests'
import { CHECK_BY_KEY, COSMETIC_AREAS, COSMETIC_LEVELS, type DeviceKind } from '@/lib/qc-agent/checklist'
import type { GuidedAnswer, InteractiveResults, LiveSnapshot } from '@/lib/qc-agent/types'

interface TestState {
  code: string
  reported: boolean
  script_connected: boolean
  options: { heat_test?: boolean }
  machine: null | {
    device: DeviceKind; name: string; serial: string; touch: boolean
    has_camera: boolean; has_battery: boolean; has_lan: boolean; bios_password_known: boolean
  }
  background: { stage: string | null; stage_progress: number | null }
  live: LiveSnapshot | null
  interactive: InteractiveResults
}

const PHYS: Record<string, { hint: string; extra?: { passLabel?: string; failLabel?: string } }> = {
  phys_hinges: { hint: 'Open and close the lid: smooth, firm, stays at any angle, no creak or wobble.' },
  phys_cracks: { hint: 'Corners, lid, palm rest, bottom, hinge covers, screen bezel (cabinet and front panel on a desktop).' },
  phys_opened: { hint: 'Scratched or chewed screw heads, broken clips, uneven gaps between panels, glue, a missing or torn warranty sticker.', extra: { passLabel: 'No signs', failLabel: 'Looks opened / repaired' } },
  phys_liquid: { hint: 'Sticky keys, stains, corrosion near ports, a sugary or burnt smell.', extra: { passLabel: 'None', failLabel: 'Signs of liquid' } },
  phys_screws: { hint: 'All screws and rubber feet in place.' },
}

const STAGE_LABEL: Record<string, string> = { ram: 'RAM test', heat: 'Heat test', disk: 'Disk test', done: 'Background tests done' }

function useTestState(code: string) {
  const [state, setState] = useState<TestState | null>(null)
  const [gone, setGone] = useState<string | null>(null)
  const load = useCallback(async () => {
    const res = await fetch(`/api/qc-agent/${code}/state`, { cache: 'no-store' }).catch(() => null)
    if (!res) return
    if (res.status === 404 || res.status === 410) {
      const body = await res.json().catch(() => ({}))
      setGone(body.error || 'This code is not valid.')
      return
    }
    if (res.ok) setState(await res.json())
  }, [code])
  useEffect(() => {
    const first = setTimeout(load, 0)
    const t = setInterval(load, 3000)
    return () => { clearTimeout(first); clearInterval(t) }
  }, [load])
  return { state, setState, gone, reload: load }
}

export default function QcTestPage() {
  const params = useParams<{ code: string }>()
  const code = String(params.code || '').toUpperCase()
  const { state, setState, gone } = useTestState(code)
  const [step, setStep] = useState(0)
  const [screenMarks, setScreenMarks] = useState<ScreenMark[] | null>(null)
  const [saveErr, setSaveErr] = useState('')

  const save = useCallback(async (patch: Record<string, unknown>) => {
    setSaveErr('')
    const res = await fetch(`/api/qc-agent/${code}/interactive`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
    }).catch(() => null)
    if (!res || !res.ok) { setSaveErr('Could not save — check the internet connection.'); return }
    const body = await res.json()
    setState((s) => (s ? { ...s, interactive: body.interactive } : s))
  }, [code, setState])

  const answers = state?.interactive.answers || {}
  const answer = (key: string) => (a: GuidedAnswer) => save({ answers: { [key]: a } })
  const ask = (key: string, hint?: string, extra?: Partial<React.ComponentProps<typeof AnswerButtons>>) => (
    <AnswerButtons
      key={key}
      label={CHECK_BY_KEY[key]?.label || key}
      hint={hint}
      naLabel={CHECK_BY_KEY[key]?.naLabel}
      value={answers[key]}
      onAnswer={answer(key)}
      {...extra}
    />
  )

  const m = state?.machine
  const device: DeviceKind = m?.device || 'laptop'
  const live = state?.live

  // ---- charger: watch the script's live power state for unplug -> plug in ----
  const chargerSeq = useRef<'idle' | 'unplugged'>('idle')
  const [chargerMsg, setChargerMsg] = useState('')
  useEffect(() => {
    if (!live || answers.charging) return
    if (live.on_ac === false && chargerSeq.current === 'idle') { chargerSeq.current = 'unplugged'; setChargerMsg('Unplugged ✓ — now plug the charger back in.') }
    if (live.on_ac === true && chargerSeq.current === 'unplugged') {
      chargerSeq.current = 'idle'
      setChargerMsg('Charging detected ✓')
      save({ answers: { charging: { result: 'pass', note: `Unplug and re-plug detected (battery ${live.battery_percent ?? '?'}%).` } } })
    }
  }, [live, answers.charging, save])

  type Step = { id: string; title: string; body: React.ReactNode; keys: string[] }

  const steps: Step[] = useMemo(() => {
    if (!m) return []
    const list: Step[] = []
    list.push({
      id: 'locks', title: 'Locks', keys: ['oobe_company', ...(m.bios_password_known ? [] : ['bios_prompt'])],
      body: (
        <>
          <AnswerButtons
            label="During Windows setup, did it ask you to sign in to a company / organisation (work or school account)?"
            value={answers.oobe_company}
            onAnswer={answer('oobe_company')}
            passLabel="No, normal setup" failLabel="Yes, company sign-in"
          />
          {!m.bios_password_known && (
            <AnswerButtons
              label="When you opened the BIOS / boot menu to install Windows, did it ask for a password?"
              hint="This brand doesn't report BIOS passwords to Windows, so it has to be checked by eye."
              value={answers.bios_prompt}
              onAnswer={answer('bios_prompt')}
              passLabel="No password" failLabel="Asked for a password"
            />
          )}
        </>
      ),
    })
    const phys = ['phys_hinges', 'phys_cracks', 'phys_opened', 'phys_liquid', 'phys_screws'].filter((k) => !CHECK_BY_KEY[k].only || CHECK_BY_KEY[k].only === device)
    list.push({
      id: 'physical', title: 'Physical check', keys: phys,
      body: <>{phys.map((k) => ask(k, PHYS[k].hint, PHYS[k].extra))}</>,
    })
    const areas = COSMETIC_AREAS.filter((a) => !a.only || a.only === device)
    list.push({
      id: 'cosmetic', title: 'Cosmetic grade', keys: areas.map((a) => `cosmetic:${a.key}`),
      body: (
        <div className="space-y-3">
          {areas.map((a) => (
            <div key={a.key} className="rounded-xl border bg-card p-4">
              <div className="font-medium mb-2">{a.label}</div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {COSMETIC_LEVELS.map((l) => (
                  <button
                    key={l.key} type="button"
                    onClick={() => save({ cosmetic: { [a.key]: l.key } })}
                    className={`rounded-lg border px-3 py-3 text-sm font-semibold ${state?.interactive.cosmetic?.[a.key] === l.key ? 'bg-primary text-primary-foreground border-primary' : 'bg-card hover:bg-muted'}`}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ),
    })
    if (device === 'laptop') {
      list.push({
        id: 'screen', title: 'Screen', keys: ['screen_dots', 'screen_bleed', 'brightness'],
        body: (
          <>
            <div className="rounded-xl border bg-card p-4 space-y-3">
              <div className="font-medium">1. Dead / bright dots and lines</div>
              <p className="text-sm text-muted-foreground">The screen fills with 6 colours. Look closely at every part. Tap exactly on any dot or line, then press Next.</p>
              <ColourTest onDone={(marks) => {
                setScreenMarks(marks)
                save({ answers: { screen_dots: marks.length
                  ? { result: 'fail', note: `${marks.length} mark(s): ${marks.slice(0, 5).map(describeMark).join('; ')}` }
                  : { result: 'pass', note: 'Colour test clean.' } } })
              }} />
              {screenMarks && <p className="text-sm">{screenMarks.length ? `${screenMarks.length} mark(s) saved.` : 'No marks — clean.'}</p>}
            </div>
            {ask('screen_dots', 'Set automatically from the colour test above. Change it here if needed.')}
            <div className="rounded-xl border bg-card p-4 space-y-3">
              <div className="font-medium">2. Light bleed and pressure marks</div>
              <BleedTest onDone={() => {}} />
            </div>
            {ask('screen_bleed')}
            <div className="rounded-xl border bg-card p-4 space-y-3">
              <div className="font-medium">3. Brightness</div>
              <p className="text-sm text-muted-foreground">
                {state?.script_connected
                  ? 'Press the button and watch: the brightness steps down to 10% and back up to 100%.'
                  : 'The script is not connected — use the Fn brightness keys instead.'}
              </p>
              <button type="button" disabled={!state?.script_connected} onClick={() => save({ command: 'brightness_sweep' })}
                className="rounded-lg bg-primary text-primary-foreground px-4 py-3 text-sm font-semibold disabled:opacity-40">
                Run brightness sweep
              </button>
            </div>
            {ask('brightness', 'Smooth change, no flicker, and bright enough at 100%.')}
          </>
        ),
      })
      if (m.touch) {
        list.push({
          id: 'touch', title: 'Touch screen', keys: ['touch'],
          body: (
            <>
              <TouchGrid onComplete={() => save({ answers: { touch: { result: 'pass', note: 'Every cell of the touch grid responded.' } } })} />
              {ask('touch', 'Drag a finger over every square. Squares that never turn green are dead zones.')}
            </>
          ),
        })
      }
      list.push({
        id: 'keyboard', title: 'Keyboard', keys: ['keyboard', 'stuck_keys', 'fn_keys', 'kb_backlight'],
        body: (
          <>
            <KeyboardTest onResult={(r) => save({ answers: {
              keyboard: r.allPressed
                ? { result: 'pass', note: r.notOnLaptop.length ? `Every key works (not on this model: ${r.notOnLaptop.join(', ')}).` : 'Every key works.' }
                : { result: 'fail', note: `Keys not working: ${r.missing.join(', ')}` },
              stuck_keys: r.stuck ? { result: 'fail', note: `Key events with hands off: ${r.stuck}` } : { result: 'pass', note: 'No key events during the hands-off check.' },
            } })} />
            {ask('keyboard')}
            {ask('stuck_keys')}
            {ask('fn_keys', 'Hold Fn and try volume up/down/mute and brightness up/down.')}
            {ask('kb_backlight', 'Fn + the backlight key (often Space, F5, F9 or F10).')}
          </>
        ),
      })
      list.push({
        id: 'trackpad', title: 'Trackpad', keys: ['trackpad'],
        body: (
          <>
            <TrackpadTest onComplete={() => { if (!answers.trackpad) save({ answers: { trackpad: { result: 'pass', note: 'Clicks, two-finger scroll and all corners detected.' } } }) }} />
            {ask('trackpad', 'Also press the physical buttons (and the pointing stick, if it has one).')}
          </>
        ),
      })
      list.push({
        id: 'audio', title: 'Speakers & microphone', keys: ['speakers', 'microphone'],
        body: (<><SpeakerTest />{ask('speakers')}<MicTest />{ask('microphone')}</>),
      })
    }
    list.push({
      id: 'camera', title: 'Camera', keys: ['camera'],
      body: m.has_camera
        ? (<><CameraTest />{ask('camera')}</>)
        : (
          <AnswerButtons
            label={device === 'laptop' ? 'Windows found NO camera. Does this model have one?' : 'No camera found on this desktop.'}
            hint="If it should have one, the camera is faulty or unplugged."
            value={answers.camera}
            onAnswer={answer('camera')}
            passLabel="It works after all"
            failLabel="It should have one — faulty"
            naLabel="No camera on this model"
          />
        ),
    })
    list.push({ id: 'jack', title: 'Audio jack', keys: ['audio_jack'], body: ask('audio_jack', 'Plug in earphones and play the left/right test: sound only in the earphones, both sides.') })
    list.push({
      id: 'usb', title: 'USB ports', keys: ['usb_ports'],
      body: <UsbStep state={state} onDeclare={(n) => save({ usb_ports_declared: n })} ask={ask} />,
    })
    list.push({
      id: 'display', title: 'Display output', keys: ['display_out'],
      body: (
        <>
          <div className="rounded-xl border bg-card p-4 text-sm">
            Plug a monitor or TV into the HDMI / display port.{' '}
            <b>{(live?.monitors_active || 0) >= (device === 'laptop' ? 2 : 1) ? '✓ External screen detected.' : 'Waiting for a screen…'}</b>
            {(live?.monitors_max || 0) >= 2 && device === 'laptop' ? ' (Detected earlier — counts as passed.)' : ''}
          </div>
          {ask('display_out', 'Every display port, one at a time. Picture should be stable.')}
        </>
      ),
    })
    if (m.has_lan) {
      list.push({
        id: 'lan', title: 'LAN port', keys: ['ethernet'],
        body: (
          <>
            <div className="rounded-xl border bg-card p-4 text-sm">
              Plug in a network cable. <b>{live?.ethernet_seen_up ? '✓ Link came up.' : 'Waiting for a link…'}</b>
            </div>
            {ask('ethernet')}
          </>
        ),
      })
    }
    if (device === 'laptop') {
      list.push({
        id: 'charger', title: 'Charger', keys: ['charging'],
        body: (
          <>
            <div className="rounded-xl border bg-card p-4 text-sm space-y-1">
              <div>Now: <b>{live?.on_ac == null ? 'unknown' : live.on_ac ? 'on charger' : 'on battery'}</b>{live?.battery_percent != null ? ` · ${live.battery_percent}%` : ''}</div>
              <div>{chargerMsg || 'Unplug the charger, wait 3 seconds, then plug it back in.'}</div>
              {!state?.script_connected && <div className="text-warning">The script is not connected, so this can&apos;t be detected — answer by hand.</div>}
            </div>
            {ask('charging', 'Also wiggle the plug gently: charging must not drop in and out.')}
          </>
        ),
      })
    }
    list.push({
      id: 'fan', title: 'Fan & power', keys: device === 'desktop' ? ['fan', 'psu'] : ['fan'],
      body: (
        <>
          <div className="rounded-xl border bg-card p-4 text-sm">
            {state?.options.heat_test === false
              ? 'The heat test is off for this run — put the CPU under load some other way and listen.'
              : state?.background.stage === 'heat'
                ? 'The heat test is running now — listen to the fan.'
                : ['disk', 'done'].includes(state?.background.stage || '')
                  ? 'The heat test has finished. Answer from what you heard while it ran.'
                  : 'The heat test starts after the RAM test (a few minutes). Come back to this step then.'}
          </div>
          {ask('fan', 'Under load the fan should speed up and sound smooth — no grinding, clicking or rattling.')}
          {device === 'desktop' && ask('psu', 'Did the PC stay on through all the tests with no random restarts or burning smell?')}
        </>
      ),
    })
    return list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m, device, answers, state?.interactive.cosmetic, state?.script_connected, state?.background.stage, state?.options.heat_test, live, screenMarks, chargerMsg])

  const isDone = (s: Step) => s.keys.every((k) => k.startsWith('cosmetic:') ? !!state?.interactive.cosmetic?.[k.slice(9)] : !!answers[k])
  const remaining = steps.filter((s) => !isDone(s))
  const total = steps.length + 1
  const onFinish = step >= steps.length

  useEffect(() => { if (onFinish && remaining.length === 0 && !state?.interactive.finished) save({ finished: true }) }, [onFinish, remaining.length, state?.interactive.finished, save])

  if (gone) {
    return <Centered><div className="text-lg font-semibold">{gone}</div><p className="text-muted-foreground mt-2">You can close this window.</p></Centered>
  }
  if (!state) return <Centered><Loader2 className="size-6 animate-spin" /></Centered>
  if (!m) {
    return (
      <Centered>
        <Loader2 className="size-6 animate-spin mb-3" />
        <div className="font-semibold">Waiting for the script on this laptop to send its results…</div>
        <p className="text-sm text-muted-foreground mt-1">Code {code}. Keep the PowerShell window open.</p>
      </Centered>
    )
  }

  const current = steps[step]
  const bgStage = state.background.stage
  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 z-10 border-b bg-card/95 backdrop-blur">
        <div className="max-w-3xl mx-auto px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span className="font-bold">Auto Check · {code}</span>
          <span className="text-muted-foreground truncate">{m.name} · {m.serial}</span>
          <span className="ml-auto flex items-center gap-1.5 text-muted-foreground">
            {state.script_connected ? <Wifi className="size-4 text-success" /> : <WifiOff className="size-4 text-warning" />}
            {bgStage ? `${STAGE_LABEL[bgStage] || bgStage}${bgStage !== 'done' && state.background.stage_progress != null ? ` ${state.background.stage_progress}%` : ''}` : 'Starting tests…'}
          </span>
        </div>
        <div className="h-1 bg-muted"><div className="h-full bg-primary transition-[width]" style={{ width: `${(Math.min(step, steps.length) / (total - 1)) * 100}%` }} /></div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-5 space-y-4">
        {saveErr && <div className="rounded-lg border border-destructive bg-destructive/10 text-destructive p-3 text-sm">{saveErr}</div>}
        {!onFinish && current ? (
          <>
            <div className="flex items-baseline justify-between">
              <h1 className="text-xl font-bold">{current.title}</h1>
              <span className="text-sm text-muted-foreground">Step {step + 1} of {total}</span>
            </div>
            <div className="space-y-3">{current.body}</div>
          </>
        ) : (
          <div className="space-y-3">
            <h1 className="text-xl font-bold">Finished on this laptop</h1>
            {remaining.length ? (
              <div className="rounded-xl border border-warning bg-warning/10 p-4 text-sm">
                Still unanswered: {remaining.map((s) => s.title).join(', ')}. Go back to finish them, or answer them on the review screen.
                <div className="flex flex-wrap gap-2 mt-3">
                  {remaining.map((s) => (
                    <button key={s.id} type="button" onClick={() => setStep(steps.indexOf(s))} className="rounded-lg border bg-card px-3 py-2 font-semibold">{s.title}</button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-success bg-success/10 p-4">
                All checks on this laptop are answered. {bgStage === 'done' ? 'The background tests have finished too.' : 'Leave it running until the background tests finish.'}
                <div className="font-semibold mt-1">Now review and save on your ERP screen.</div>
              </div>
            )}
          </div>
        )}

        <div className="flex items-center justify-between pt-2">
          <button type="button" disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))} className="rounded-lg border bg-card px-5 py-3 font-semibold disabled:opacity-40">
            ← Back
          </button>
          {!onFinish && (
            <button type="button" onClick={() => { setStep((s) => s + 1); window.scrollTo(0, 0) }} className="rounded-lg bg-primary text-primary-foreground px-6 py-3 font-semibold">
              {current && isDone(current) ? 'Next →' : 'Skip for now →'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function UsbStep({ state, onDeclare, ask }: {
  state: TestState | null
  onDeclare: (n: number) => void
  ask: (key: string, hint?: string, extra?: any) => React.ReactNode
}) {
  const declared = state?.interactive.usb_ports_declared ?? 0
  const seen = state?.live?.usb_seen || []
  const connected = state?.script_connected
  return (
    <>
      <div className="rounded-xl border bg-card p-4 space-y-3">
        <div className="font-medium">How many USB ports can you test on this machine (USB-A and USB-C)?</div>
        <div className="flex flex-wrap gap-2">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
            <button key={n} type="button" onClick={() => onDeclare(n)}
              className={`size-11 rounded-lg border font-semibold ${declared === n ? 'bg-primary text-primary-foreground border-primary' : 'bg-card hover:bg-muted'}`}>{n}</button>
          ))}
        </div>
        <p className="text-sm text-muted-foreground">
          Plug the <b>same</b> pen drive or mouse into each port, one at a time, and wait for the tick. {!connected && <span className="text-warning">The script is not connected, so ports can&apos;t be detected — answer by hand.</span>}
        </p>
        <div className="text-sm font-semibold">{seen.length} of {declared || '?'} ports detected</div>
        <ul className="text-sm text-muted-foreground space-y-0.5">
          {seen.map((s, i) => <li key={s.path}>✓ Port {i + 1}: {s.name || 'device'} <span className="text-xs">({s.path.slice(-28)})</span></li>)}
        </ul>
      </div>
      {ask('usb_ports', declared && seen.length >= declared ? 'All declared ports detected a device.' : 'Mark Works once every port has a tick, or Problem if one never does.', {
        passDisabled: connected ? !(declared && seen.length >= declared) : false,
      })}
    </>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen flex flex-col items-center justify-center text-center p-6">{children}</div>
}
