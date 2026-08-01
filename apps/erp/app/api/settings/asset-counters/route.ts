import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import { getSessionUser } from '@/lib/auth/session'
import { logAuditEvent } from '@/lib/audit-log'

const PREFIXES = ['DBAS', 'TTAS', 'CSAS', 'OTHR']

// Finds the true highest new-format (PREFIX + 2-digit year + '-' + sequence) asset
// number for a given prefix/year. Old-format legacy numbers (no year segment, e.g.
// "DBAS682") are deliberately excluded -- they can never belong to a specific
// year's counter, and a naive string ORDER BY would otherwise rank them above
// higher new-format numbers (e.g. "DBAS682" > "DBAS26-699" lexicographically,
// since '6' > '2' at the first differing character), silently resetting the
// counter to the wrong value whenever old- and new-format numbers coexist.
async function findMaxForYear(prefix: string, yearSuffix: string): Promise<number> {
  const { data: candidates } = await supabaseAdmin
    .from('asset_ledger')
    .select('asset_number')
    .ilike('asset_number', `${prefix}%`)
    .limit(5000)

  const newFormatRegex = new RegExp(`^${prefix}(\\d{2})-(\\d+)$`)
  let maxNum = 0
  for (const row of candidates ?? []) {
    const m = row.asset_number?.match(newFormatRegex)
    if (!m) continue
    if (m[1] !== yearSuffix) continue
    const num = parseInt(m[2], 10)
    if (num > maxNum) maxNum = num
  }
  return maxNum
}

export async function GET(req: NextRequest) {
  const currentYear = new Date().getFullYear().toString()

  const { data: counters } = await supabaseAdmin
    .from('asset_counters')
    .select('prefix, year, last_number, year_suffix')
    .eq('year', currentYear)
    .in('prefix', PREFIXES)

  const result = PREFIXES.map(prefix => {
    const existing = counters?.find(c => c.prefix === prefix)
    return {
      prefix,
      year: currentYear,
      last_number: existing ? existing.last_number : 0,
      year_suffix: existing?.year_suffix || '',
    }
  })

  return NextResponse.json(result)
}

export async function PUT(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  const body = await req.json()
  const { prefix, last_number, year_suffix } = body

  if (!prefix || last_number === undefined) {
    return NextResponse.json({ error: 'prefix and last_number required' }, { status: 400 })
  }

  if (!PREFIXES.includes(prefix)) {
    return NextResponse.json({ error: 'Invalid prefix' }, { status: 400 })
  }

  const currentYear = new Date().getFullYear().toString()
  const effectiveSuffix = year_suffix || currentYear.slice(-2)

  // Check for collision against real new-format assets for this prefix+year only.
  const currentMax = await findMaxForYear(prefix, effectiveSuffix)
  if (last_number < currentMax) {
    return NextResponse.json(
      { error: `Cannot set last number to ${last_number} because existing assets have numbers up to ${currentMax}.` },
      { status: 400 }
    )
  }

  const { error } = await supabaseAdmin
    .from('asset_counters')
    .upsert(
      {
        prefix,
        year: currentYear,
        last_number,
        year_suffix: year_suffix || null,
      },
      { onConflict: 'prefix,year' }
    )

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  await logAuditEvent({
    actor: { id: sessionUser?.id ?? null, email: sessionUser?.email, role: sessionUser?.role },
    actionType: 'update',
    module: 'settings',
    tableName: 'asset_counters',
    recordId: `${prefix}-${currentYear}`,
    recordLabel: `${prefix} ${currentYear}`,
    metadata: { prefix, year: currentYear, last_number, year_suffix: year_suffix || null, previous_max: currentMax },
  })

  return NextResponse.json({ success: true })
}

export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req)
  const currentYear = new Date().getFullYear().toString()

  const { data: existingCounters } = await supabaseAdmin
    .from('asset_counters')
    .select('prefix, year_suffix')
    .eq('year', currentYear)
    .in('prefix', PREFIXES)
  const suffixByPrefix = new Map((existingCounters ?? []).map(c => [c.prefix, c.year_suffix]))
  const recalculated: Record<string, number> = {}

  for (const prefix of PREFIXES) {
    const effectiveSuffix = suffixByPrefix.get(prefix) || currentYear.slice(-2)
    const maxNum = await findMaxForYear(prefix, effectiveSuffix)
    recalculated[prefix] = maxNum

    // Upsert the counter with the recalculated value (only new-format assets for
    // this exact year/suffix count -- old-format legacy numbers never influence it).
    await supabaseAdmin
      .from('asset_counters')
      .upsert(
        {
          prefix,
          year: currentYear,
          last_number: maxNum,
          year_suffix: effectiveSuffix || null,
        },
        { onConflict: 'prefix,year' }
      )
  }

  await logAuditEvent({
    actor: { id: sessionUser?.id ?? null, email: sessionUser?.email, role: sessionUser?.role },
    actionType: 'update',
    module: 'settings',
    tableName: 'asset_counters',
    recordId: currentYear,
    recordLabel: `Recalculate all counters (${currentYear})`,
    metadata: { year: currentYear, recalculated },
  })

  return NextResponse.json({ success: true })
}