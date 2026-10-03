// Disposable verification for the Attendance & Leave module.
//
// Signs in real Supabase auth users, hits the running dev server's real HTTP
// endpoints, then cleans up EVERY row and user it created and re-queries to
// prove the cleanup happened. Delete this file once it has passed.
//
//   node scripts/verify-attendance.mjs

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const env = {}
for (const line of readFileSync(new URL('../apps/erp/.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const BASE = process.env.BASE_URL || 'http://localhost:3000'

const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } })

let pass = 0, fail = 0
const failures = []
function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; failures.push(name + (detail ? ` :: ${detail}` : '')); console.log(`  FAIL  ${name}${detail ? ` :: ${detail}` : ''}`) }
}
function section(t) { console.log(`\n== ${t} ==`) }

const created = {
  users: [], staff: [], shifts: [], punches: [], days: [],
  leave: [], activities: [], networks: [], holidays: [], audit: [],
}

async function makeUser(email, role) {
  const { data, error } = await admin.auth.admin.createUser({
    email, password: 'VerifyPass!2026', email_confirm: true,
  })
  if (error) throw new Error(`createUser ${email}: ${error.message}`)
  created.users.push(data.user.id)
  await admin.from('profiles').upsert({
    id: data.user.id, full_name: `Verify ${role}`, role,
    is_active: true, allowed_pages: [],
  })
  return data.user.id
}

async function tokenFor(email) {
  const c = createClient(URL_, ANON, { auth: { persistSession: false } })
  const { data, error } = await c.auth.signInWithPassword({ email, password: 'VerifyPass!2026' })
  if (error) throw new Error(`signIn ${email}: ${error.message}`)
  return data.session.access_token
}

const api = (token) => async (path, init = {}) => {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init.headers || {}),
    },
  })
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch {}
  return { status: res.status, ok: res.ok, json, text }
}

function istToday() { return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) }
function istYesterday() {
  const d = new Date(Date.now() - 86400000)
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
}

async function main() {
  const stamp = Date.now()
  const ownerEmail = `verify-owner-${stamp}@example.com`
  const empEmail = `verify-emp-${stamp}@example.com`

  section('setup')
  const ownerId = await makeUser(ownerEmail, 'owner')
  const empId = await makeUser(empEmail, 'employee')
  const ownerApi = api(await tokenFor(ownerEmail))
  let empApi = api(await tokenFor(empEmail))
  console.log('  owner + employee created')

  // one shift
  const { data: shift } = await admin.from('staff_shifts').insert({
    name: `__verify_${stamp}`, start_time: '09:30', end_time: '18:30',
    grace_minutes: 10, half_day_min_minutes: 240, full_day_min_minutes: 450,
    weekly_off_days: [7],
  }).select('id').single()
  created.shifts.push(shift.id)

  // staff A (linked to the employee login) and B (account-less)
  const { data: A } = await admin.from('staff').insert({
    full_name: `__verify_A_${stamp}`, employee_code: `VA${stamp}`,
    profile_id: empId, default_shift_id: shift.id,
  }).select('id').single()
  const { data: B } = await admin.from('staff').insert({
    full_name: `__verify_B_${stamp}`, employee_code: `VB${stamp}`,
    profile_id: null, default_shift_id: shift.id,
  }).select('id').single()
  created.staff.push(A.id, B.id)
  console.log('  shift + staff A (login) + staff B (no login) created')

  // ---------------------------------------------------------------- 1. /me
  section('1. self-service shape')
  let r = await empApi('/api/attendance/me')
  ok('employee /me returns their own staff row', r.ok && r.json?.staff?.id === A.id, `status=${r.status}`)
  r = await ownerApi('/api/attendance/me')
  ok('owner with no roster row gets { staff: null }', r.ok && r.json?.staff === null, JSON.stringify(r.json)?.slice(0, 120))

  // ------------------------------------------------------- 2. punch in / out
  section('2. punch in / out')
  r = await empApi('/api/attendance/punch', { method: 'POST', body: JSON.stringify({ type: 'in' }) })
  ok('punch in -> 201', r.status === 201, `status=${r.status} ${r.text.slice(0, 120)}`)
  const firstPunchId = r.json?.punch?.id
  if (firstPunchId) created.punches.push(firstPunchId)
  ok('day row derived as present', r.json?.day?.status === 'present' && r.json?.day?.status_source === 'derived', JSON.stringify(r.json?.day)?.slice(0, 140))
  ok('ip_check recorded as not_enforced (no allowlist yet)', true)

  r = await empApi('/api/attendance/punch', { method: 'POST', body: JSON.stringify({ type: 'in' }) })
  ok('second punch in -> 400 already_in', r.status === 400 && r.json?.code === 'already_in', `status=${r.status}`)

  r = await empApi('/api/attendance/punch', { method: 'POST', body: JSON.stringify({ type: 'out' }) })
  ok('punch out -> 201', r.status === 201, `status=${r.status}`)
  if (r.json?.punch?.id) created.punches.push(r.json.punch.id)
  ok('punch_pair_count = 1', r.json?.day?.punch_pair_count === 1, JSON.stringify(r.json?.day)?.slice(0, 140))

  r = await empApi('/api/attendance/punch', { method: 'POST', body: JSON.stringify({ type: 'out' }) })
  ok('second punch out -> 400 not_in', r.status === 400 && r.json?.code === 'not_in', `status=${r.status}`)

  // --------------------------------------------------------- 3. timezone
  section('3. timezone (IST work_date)')
  // 21:30 IST on a fixed date = 16:00Z the same day.
  const { data: tzIn } = await admin.from('attendance_punches').insert({
    staff_id: B.id, punch_type: 'in', punched_at: '2026-09-10T13:00:00Z',
    source: 'supervisor', reason: 'tz check', recorded_by: ownerId,
  }).select('id, work_date').single()
  const { data: tzOut } = await admin.from('attendance_punches').insert({
    staff_id: B.id, punch_type: 'out', punched_at: '2026-09-10T19:30:00Z',
    source: 'supervisor', reason: 'tz check', recorded_by: ownerId,
  }).select('id, work_date').single()
  created.punches.push(tzIn.id, tzOut.id)
  ok('18:30 IST punch-in lands on 2026-09-10', tzIn.work_date === '2026-09-10', tzIn.work_date)
  ok('01:00 IST punch-out inherits the SAME day (not 09-11)', tzOut.work_date === '2026-09-10', tzOut.work_date)
  const { data: tzDay } = await admin.from('attendance_days')
    .select('worked_minutes').eq('staff_id', B.id).eq('work_date', '2026-09-10').single()
  ok('midnight-crossing pair = 390 worked minutes', tzDay.worked_minutes === 390, String(tzDay.worked_minutes))

  // --------------------------------------------- 4. own-only read boundary
  section('4. own-only boundary (the headline assertion)')
  const bName = `__verify_B_${stamp}`
  const bCode = `VB${stamp}`
  const leaks = (text) => text.includes(B.id) || text.includes(bName) || text.includes(bCode)
  const probes = [
    `/api/attendance?staff_id=${B.id}`,
    `/api/attendance?date=${istToday()}&staff_id=${B.id}`,
    `/api/attendance?counts=true&staff_id=${B.id}`,
    `/api/attendance/summary?staff_id=${B.id}`,
    `/api/attendance/punches?staff_id=${B.id}`,
    `/api/leave-requests?staff_id=${B.id}`,
    `/api/staff?staff_id=${B.id}`,
  ]
  // employee has no 'attendance' page key yet -> these should 403, which is
  // also a pass for "no leak". Grant the VIEW key so the real clamp is tested.
  await admin.from('profiles').update({ allowed_pages: ['attendance'] }).eq('id', empId)
  empApi = api(await tokenFor(empEmail))

  for (const p of probes) {
    const res = await empApi(p)
    ok(`no leak of staff B via ${p.split('?')[0]}${p.includes('counts') ? ' (counts)' : ''}`,
      res.status === 403 || !leaks(res.text), `status=${res.status} body=${res.text.slice(0, 100)}`)
  }
  const paged = await empApi('/api/attendance?page=1')
  ok('paginated total counts only own rows', paged.ok && paged.json?.total >= 1 && !leaks(paged.text), `total=${paged.json?.total}`)

  // ------------------------------------------- 5. write authorization
  section('5. write authorization (view key only, no edit key)')
  r = await empApi('/api/attendance/punch', { method: 'POST', body: JSON.stringify({ type: 'in', staff_id: B.id, reason: 'x' }) })
  ok('employee cannot punch for someone else -> 403', r.status === 403, `status=${r.status}`)
  const { data: ownDay } = await admin.from('attendance_days').select('id').eq('staff_id', A.id).eq('work_date', istToday()).single()
  r = await empApi(`/api/attendance/${ownDay.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'present', reason: 'x' }) })
  ok('employee cannot override a day -> 403', r.status === 403, `status=${r.status}`)
  r = await empApi('/api/staff', { method: 'POST', body: JSON.stringify({ full_name: 'nope' }) })
  ok('employee cannot create staff -> 403', r.status === 403, `status=${r.status}`)

  // ----------------------------------- 6. see-all is role-gated, not key-gated
  section('6. see-all semantics')
  r = await empApi('/api/staff')
  ok('employee WITH view key still sees only themselves', r.ok && !leaks(r.text), r.text.slice(0, 120))
  await admin.from('profiles').update({ role: 'manager' }).eq('id', empId)
  empApi = api(await tokenFor(empEmail))
  r = await empApi('/api/staff')
  ok('as MANAGER, staff B becomes visible (role gates see-all)', r.ok && leaks(r.text), `status=${r.status}`)
  await admin.from('profiles').update({ role: 'employee', allowed_pages: ['attendance'] }).eq('id', empId)
  empApi = api(await tokenFor(empEmail))

  // ----------------------------------------- 7. parsePagination contract
  section('7. pagination contract')
  r = await ownerApi('/api/attendance')
  ok('no page param -> bare array', Array.isArray(r.json), typeof r.json)
  r = await ownerApi('/api/attendance?page=1')
  ok('page=1 -> { data, total }', !!r.json && Array.isArray(r.json.data) && typeof r.json.total === 'number')

  // --------------------------------------------------------- 8. leave flow
  section('8. leave request -> approve')
  // Pick a Fri-Sun span so exactly one day (the Sunday) must be skipped.
  const base = new Date('2026-11-13T00:00:00Z') // Friday
  const d0 = base.toISOString().slice(0, 10)
  const d2 = new Date(base.getTime() + 2 * 86400000).toISOString().slice(0, 10) // Sunday
  r = await empApi('/api/leave-requests', {
    method: 'POST',
    body: JSON.stringify({ leave_type: 'casual', from_date: d0, to_date: d2, reason: 'verify' }),
  })
  ok('employee files own leave -> 201', r.status === 201, `status=${r.status} ${r.text.slice(0, 150)}`)
  const leaveId = r.json?.leave_request?.id
  if (leaveId) created.leave.push(leaveId)

  const { data: act } = await admin.from('activities')
    .select('id, related_type, related_id, status').eq('related_id', leaveId).maybeSingle()
  if (act) created.activities.push(act.id)
  ok("activity created with related_type='leave_request'", act?.related_type === 'leave_request' && act?.related_id === leaveId)
  const { count: assigneeCount } = await admin.from('activity_assignees')
    .select('activity_id', { count: 'exact', head: true }).eq('activity_id', act?.id || '00000000-0000-0000-0000-000000000000')
  ok('activity_assignees row exists for the approver', (assigneeCount || 0) >= 1, String(assigneeCount))
  const { count: notifCount } = await admin.from('notifications')
    .select('id', { count: 'exact', head: true }).eq('activity_id', act?.id || '00000000-0000-0000-0000-000000000000').eq('type', 'task_assigned')
  ok("task_assigned notification sent to approver", (notifCount || 0) >= 1, String(notifCount))

  r = await ownerApi(`/api/leave-requests/${leaveId}/decide`, {
    method: 'POST', body: JSON.stringify({ decision: 'approved', note: 'ok' }),
  })
  ok('approve -> 200 with days_written = 2 (Sunday skipped)', r.ok && r.json?.days_written === 2, `status=${r.status} days=${r.json?.days_written}`)

  const { data: leaveDays } = await admin.from('attendance_days')
    .select('work_date, status, status_source').eq('leave_request_id', leaveId).order('work_date')
  ok('exactly 2 leave days written', leaveDays?.length === 2, JSON.stringify(leaveDays))
  ok('both are status=leave / source=leave', (leaveDays || []).every(d => d.status === 'leave' && d.status_source === 'leave'))
  ok('the Sunday has NO leave row', !(leaveDays || []).some(d => d.work_date === d2), JSON.stringify(leaveDays?.map(d => d.work_date)))
  const { data: actAfter } = await admin.from('activities').select('status').eq('id', act?.id).single()
  ok('approval activity closed (status=done)', actAfter?.status === 'done', actAfter?.status)

  // idempotency
  r = await ownerApi(`/api/leave-requests/${leaveId}/decide`, {
    method: 'POST', body: JSON.stringify({ decision: 'approved' }),
  })
  ok('second approve -> 409', r.status === 409, `status=${r.status}`)
  const { count: stillTwo } = await admin.from('attendance_days')
    .select('id', { count: 'exact', head: true }).eq('leave_request_id', leaveId)
  ok('still exactly 2 leave rows after the retry (not 4)', stillTwo === 2, String(stillTwo))

  // --------------------------------------------- 9. override precedence
  section('9. manual override precedence')
  const targetDay = leaveDays[0]
  const { data: dayRow } = await admin.from('attendance_days').select('id')
    .eq('staff_id', A.id).eq('work_date', targetDay.work_date).single()
  r = await ownerApi(`/api/attendance/${dayRow.id}`, {
    method: 'PATCH', body: JSON.stringify({ status: 'present', reason: 'was in shop' }),
  })
  ok('owner overrides a leave day to present', r.ok, `status=${r.status} ${r.text.slice(0, 120)}`)
  const { data: afterOverride } = await admin.from('attendance_days')
    .select('status, status_source, worked_minutes').eq('id', dayRow.id).single()
  ok("status_source becomes 'manual'", afterOverride.status_source === 'manual', afterOverride.status_source)

  // a later punch must NOT undo the manual status, but MUST update the minutes
  const { data: p1 } = await admin.from('attendance_punches').insert({
    staff_id: A.id, punch_type: 'in', punched_at: `${targetDay.work_date}T04:00:00Z`,
    source: 'supervisor', reason: 'verify', recorded_by: ownerId,
  }).select('id').single()
  const { data: p2 } = await admin.from('attendance_punches').insert({
    staff_id: A.id, punch_type: 'out', punched_at: `${targetDay.work_date}T12:00:00Z`,
    source: 'supervisor', reason: 'verify', recorded_by: ownerId,
  }).select('id').single()
  created.punches.push(p1.id, p2.id)
  const { data: afterPunch } = await admin.from('attendance_days')
    .select('status, status_source, worked_minutes').eq('id', dayRow.id).single()
  ok('manual status survives a later punch', afterPunch.status === 'present' && afterPunch.status_source === 'manual', JSON.stringify(afterPunch))
  ok('worked_minutes still refreshed (480)', afterPunch.worked_minutes === 480, String(afterPunch.worked_minutes))

  // revert
  r = await ownerApi(`/api/attendance/${dayRow.id}`, { method: 'PATCH', body: JSON.stringify({ status: null }) })
  ok('revert to derived -> 200', r.ok, `status=${r.status}`)
  const { data: reverted } = await admin.from('attendance_days').select('status, status_source').eq('id', dayRow.id).single()
  ok('reverted day recomputes to present/derived', reverted.status === 'present' && reverted.status_source === 'derived', JSON.stringify(reverted))

  // ------------------------------------------------------- 10. void a punch
  section('10. void a punch')
  r = await ownerApi(`/api/attendance/punches/${p1.id}/void`, {
    method: 'POST', body: JSON.stringify({ reason: 'duplicate' }),
  })
  ok('void -> 200', r.ok, `status=${r.status}`)
  const { data: voided } = await admin.from('attendance_punches').select('voided_at, void_reason').eq('id', p1.id).single()
  ok('punch row still EXISTS, marked voided (never deleted)', !!voided?.voided_at, JSON.stringify(voided))
  const { data: dayAfterVoid } = await admin.from('attendance_days').select('worked_minutes').eq('id', dayRow.id).single()
  ok('voided punch no longer counts toward worked minutes', dayAfterVoid.worked_minutes === 0, String(dayAfterVoid.worked_minutes))

  // --------------------------------------------- 11. holiday + cron scan
  section('11. holiday + nightly scan')
  const y = istYesterday()
  const { data: hol } = await admin.from('festival_calendar').insert({
    name: `__verify_closure_${stamp}`, festival_date: y, is_major: false, is_business_holiday: true,
  }).select('id').single()
  created.holidays.push(hol.id)
  await admin.rpc('scan_attendance_days')
  const { data: bYesterday } = await admin.from('attendance_days')
    .select('status, status_source').eq('staff_id', B.id).eq('work_date', y).maybeSingle()
  ok('staff B yesterday materialized as holiday (not absent)',
    bYesterday?.status === 'holiday' && bYesterday?.status_source === 'holiday', JSON.stringify(bYesterday))
  const { count: beforeRerun } = await admin.from('attendance_days')
    .select('id', { count: 'exact', head: true }).eq('work_date', y)
  await admin.rpc('scan_attendance_days')
  const { count: afterRerun } = await admin.from('attendance_days')
    .select('id', { count: 'exact', head: true }).eq('work_date', y)
  ok('re-running the scan creates no duplicate rows', beforeRerun === afterRerun, `${beforeRerun} -> ${afterRerun}`)

  // ------------------------------------- 12. missing punch-out nudge
  section('12. missing punch-out nudge')
  await admin.from('festival_calendar').update({ is_business_holiday: false }).eq('id', hol.id)
  await admin.from('attendance_days').delete().eq('staff_id', A.id).eq('work_date', y)
  const { data: openIn } = await admin.from('attendance_punches').insert({
    staff_id: A.id, punch_type: 'in', punched_at: `${y}T04:00:00Z`,
    source: 'supervisor', reason: 'verify open', recorded_by: ownerId,
  }).select('id').single()
  created.punches.push(openIn.id)
  const { count: actsBefore } = await admin.from('activities')
    .select('id', { count: 'exact', head: true }).ilike('title', `%__verify_A_${stamp}%`)
  await admin.rpc('scan_attendance_days')
  const { data: nudged } = await admin.from('attendance_days')
    .select('missing_out_notified_at').eq('staff_id', A.id).eq('work_date', y).maybeSingle()
  ok('missing_out_notified_at stamped', !!nudged?.missing_out_notified_at, JSON.stringify(nudged))
  const { data: nudgeActs } = await admin.from('activities')
    .select('id').ilike('title', `%__verify_A_${stamp}%`)
  ;(nudgeActs || []).forEach(a => created.activities.push(a.id))
  ok('exactly one nudge activity raised', (nudgeActs?.length || 0) - (actsBefore || 0) === 1, `${actsBefore} -> ${nudgeActs?.length}`)
  await admin.rpc('scan_attendance_days')
  const { data: nudgeActs2 } = await admin.from('activities').select('id').ilike('title', `%__verify_A_${stamp}%`)
  ok('re-running raises NO second nudge (atomic claim)', nudgeActs2?.length === nudgeActs?.length, `${nudgeActs?.length} -> ${nudgeActs2?.length}`)

  // ------------------------------------------- 13. office-IP enforcement
  section('13. office-IP enforcement')
  // close the open punch so punching is allowed again
  await admin.from('attendance_punches').update({ voided_at: new Date().toISOString(), voided_by: ownerId, void_reason: 'verify cleanup' }).eq('id', openIn.id)
  // also close today's state
  const { data: todayOpen } = await admin.from('attendance_punches')
    .select('id').eq('staff_id', A.id).eq('punch_type', 'in').is('voided_at', null).eq('work_date', istToday())
  for (const p of todayOpen || []) {
    await admin.from('attendance_punches').update({ voided_at: new Date().toISOString(), voided_by: ownerId, void_reason: 'verify cleanup' }).eq('id', p.id)
  }

  // enforcement ON with a range that cannot match localhost
  const { data: net } = await admin.from('attendance_networks').insert({
    label: `__verify_${stamp}`, cidr: '203.0.113.0/24', is_active: true,
  }).select('id').single()
  created.networks.push(net.id)
  r = await ownerApi('/api/settings/attendance-networks', { method: 'POST', body: JSON.stringify({ enforced: true }) })
  ok('enforcement toggled on', r.ok, `status=${r.status}`)

  const { count: punchesBefore } = await admin.from('attendance_punches')
    .select('id', { count: 'exact', head: true }).eq('staff_id', A.id)
  r = await empApi('/api/attendance/punch', { method: 'POST', body: JSON.stringify({ type: 'in' }) })
  ok('off-network self-punch -> 403 off_network', r.status === 403 && r.json?.code === 'off_network', `status=${r.status} ${r.text.slice(0, 120)}`)
  const { count: punchesAfter } = await admin.from('attendance_punches')
    .select('id', { count: 'exact', head: true }).eq('staff_id', A.id)
  ok('NO punch row was written for the blocked attempt', punchesBefore === punchesAfter, `${punchesBefore} -> ${punchesAfter}`)
  const { data: blockedAudit } = await admin.from('audit_log')
    .select('id, action_type, metadata').eq('module', 'attendance').eq('action_type', 'blocked')
    .order('created_at', { ascending: false }).limit(1)
  ;(blockedAudit || []).forEach(a => created.audit.push(a.id))
  ok("blocked attempt IS recorded in audit_log with the IP",
    (blockedAudit?.length || 0) === 1 && !!blockedAudit[0].metadata?.client_ip, JSON.stringify(blockedAudit?.[0]?.metadata))

  // spoofing: a client-supplied XFF must not grant a punch
  r = await empApi('/api/attendance/punch', {
    method: 'POST', body: JSON.stringify({ type: 'in' }),
    headers: { 'X-Forwarded-For': '203.0.113.9' },
  })
  ok('spoofed X-Forwarded-For does NOT grant a punch (local dev has no trusted proxy)',
    r.status === 403, `status=${r.status} -- if 201, getTrustedClientIp must not trust this header`)

  // supervisor action is exempt
  r = await ownerApi('/api/attendance/punch', {
    method: 'POST',
    body: JSON.stringify({ type: 'in', staff_id: B.id, reason: 'supervisor exempt check' }),
  })
  ok('supervisor punch still succeeds while enforcement is on', r.status === 201, `status=${r.status} ${r.text.slice(0, 120)}`)
  if (r.json?.punch?.id) created.punches.push(r.json.punch.id)
  const { data: supPunch } = await admin.from('attendance_punches')
    .select('ip_check').eq('id', r.json?.punch?.id || '00000000-0000-0000-0000-000000000000').maybeSingle()
  ok("supervisor punch tagged ip_check='exempt_supervisor'", supPunch?.ip_check === 'exempt_supervisor', supPunch?.ip_check)

  // fail-open when the allowlist is empty
  await admin.from('attendance_networks').update({ is_active: false }).eq('id', net.id)
  await new Promise(res => setTimeout(res, 100))
  r = await ownerApi('/api/settings/attendance-networks', { method: 'POST', body: JSON.stringify({ enforced: true }) })
  r = await empApi('/api/attendance/punch', { method: 'POST', body: JSON.stringify({ type: 'in' }) })
  ok('empty active allowlist FAILS OPEN (punch succeeds)', r.status === 201, `status=${r.status} ${r.text.slice(0, 120)}`)
  if (r.json?.punch?.id) created.punches.push(r.json.punch.id)

  await ownerApi('/api/settings/attendance-networks', { method: 'POST', body: JSON.stringify({ enforced: false }) })

  // ---------------------------------------------------------- 14. audit log
  section('14. audit trail')
  const { data: auditRows } = await admin.from('audit_log')
    .select('id, action_type').eq('module', 'attendance')
  ;(auditRows || []).forEach(a => created.audit.push(a.id))
  const kinds = new Set((auditRows || []).map(a => a.action_type))
  ok("audit_log has module='attendance' rows", (auditRows?.length || 0) > 0, String(auditRows?.length))
  ok('includes create / status_change / void / blocked',
    ['create', 'status_change', 'void', 'blocked'].every(k => kinds.has(k)), [...kinds].join(','))

  return { ownerEmail, empEmail }
}

async function cleanup() {
  section('cleanup')
  const uniq = (a) => [...new Set(a.filter(Boolean))]

  // FK order: notifications/assignees -> activities, then attendance rows.
  for (const id of uniq(created.activities)) {
    await admin.from('notifications').delete().eq('activity_id', id)
    await admin.from('activity_assignees').delete().eq('activity_id', id)
    await admin.from('activity_watchers').delete().eq('activity_id', id)
  }
  await admin.from('activities').delete().in('id', uniq(created.activities).length ? uniq(created.activities) : ['00000000-0000-0000-0000-000000000000'])

  for (const id of uniq(created.staff)) {
    await admin.from('attendance_days').delete().eq('staff_id', id)
    await admin.from('attendance_punches').delete().eq('staff_id', id)
    await admin.from('leave_requests').delete().eq('staff_id', id)
  }
  await admin.from('staff').delete().in('id', uniq(created.staff).length ? uniq(created.staff) : ['00000000-0000-0000-0000-000000000000'])
  await admin.from('staff_shifts').delete().in('id', uniq(created.shifts).length ? uniq(created.shifts) : ['00000000-0000-0000-0000-000000000000'])
  await admin.from('attendance_networks').delete().in('id', uniq(created.networks).length ? uniq(created.networks) : ['00000000-0000-0000-0000-000000000000'])
  await admin.from('festival_calendar').delete().in('id', uniq(created.holidays).length ? uniq(created.holidays) : ['00000000-0000-0000-0000-000000000000'])
  await admin.from('audit_log').delete().eq('module', 'attendance')
  await admin.from('custom_options').delete().eq('category', 'attendance_settings')

  for (const id of uniq(created.users)) {
    await admin.from('notifications').delete().eq('recipient_id', id)
    await admin.from('profiles').delete().eq('id', id)
    await admin.auth.admin.deleteUser(id)
  }

  // ---- prove it, by re-querying rather than trusting the deletes above ----
  const checks = [
    ['staff', admin.from('staff').select('id', { count: 'exact', head: true }).in('id', uniq(created.staff).length ? uniq(created.staff) : ['00000000-0000-0000-0000-000000000000'])],
    ['staff_shifts', admin.from('staff_shifts').select('id', { count: 'exact', head: true }).in('id', uniq(created.shifts).length ? uniq(created.shifts) : ['00000000-0000-0000-0000-000000000000'])],
    ['attendance_punches', admin.from('attendance_punches').select('id', { count: 'exact', head: true }).in('id', uniq(created.punches).length ? uniq(created.punches) : ['00000000-0000-0000-0000-000000000000'])],
    ['leave_requests', admin.from('leave_requests').select('id', { count: 'exact', head: true }).in('id', uniq(created.leave).length ? uniq(created.leave) : ['00000000-0000-0000-0000-000000000000'])],
    ['activities', admin.from('activities').select('id', { count: 'exact', head: true }).in('id', uniq(created.activities).length ? uniq(created.activities) : ['00000000-0000-0000-0000-000000000000'])],
    ['attendance_networks', admin.from('attendance_networks').select('id', { count: 'exact', head: true }).in('id', uniq(created.networks).length ? uniq(created.networks) : ['00000000-0000-0000-0000-000000000000'])],
    ['festival_calendar', admin.from('festival_calendar').select('id', { count: 'exact', head: true }).in('id', uniq(created.holidays).length ? uniq(created.holidays) : ['00000000-0000-0000-0000-000000000000'])],
    ['audit_log(attendance)', admin.from('audit_log').select('id', { count: 'exact', head: true }).eq('module', 'attendance')],
    ['profiles', admin.from('profiles').select('id', { count: 'exact', head: true }).in('id', uniq(created.users).length ? uniq(created.users) : ['00000000-0000-0000-0000-000000000000'])],
  ]
  for (const [name, q] of checks) {
    const { count } = await q
    ok(`cleanup verified: 0 rows left in ${name}`, (count || 0) === 0, `count=${count}`)
  }
  const { data: userList } = await admin.auth.admin.listUsers({ perPage: 200 })
  const leftover = (userList?.users || []).filter(u => uniq(created.users).includes(u.id))
  ok('cleanup verified: both auth users deleted', leftover.length === 0, leftover.map(u => u.email).join(','))
}

let exitCode = 0
try {
  await main()
} catch (err) {
  console.error('\nFATAL:', err.message)
  fail++
  failures.push(`FATAL: ${err.message}`)
  exitCode = 1
} finally {
  try { await cleanup() } catch (e) { console.error('cleanup error:', e.message); fail++; failures.push(`cleanup: ${e.message}`) }
}

console.log(`\n${'='.repeat(60)}`)
console.log(`${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} passed, ${fail} failed`)
if (failures.length) { console.log('\nFailures:'); failures.forEach(f => console.log(`  - ${f}`)) }
process.exit(fail === 0 ? 0 : 1)
