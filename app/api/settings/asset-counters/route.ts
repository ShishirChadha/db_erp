import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'

const PREFIXES = ['DBAS', 'TTAS', 'CSAS', 'OTHR']

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
  const body = await req.json()
  const { prefix, last_number, year_suffix } = body

  if (!prefix || last_number === undefined) {
    return NextResponse.json({ error: 'prefix and last_number required' }, { status: 400 })
  }

  if (!PREFIXES.includes(prefix)) {
    return NextResponse.json({ error: 'Invalid prefix' }, { status: 400 })
  }

  const currentYear = new Date().getFullYear().toString()

  // Check for collision: see if any existing asset has number > last_number
  const { data: maxAsset } = await supabaseAdmin
    .from('asset_ledger')
    .select('asset_number')
    .ilike('asset_number', `${prefix}%`)
    .order('asset_number', { ascending: false })
    .limit(1)

  if (maxAsset && maxAsset.length > 0) {
    const lastAsset = maxAsset[0].asset_number
    const match = lastAsset.match(/(\d+)$/)
    if (match) {
      const currentMax = parseInt(match[1], 10)
      if (last_number < currentMax) {
        return NextResponse.json(
          { error: `Cannot set last number to ${last_number} because existing assets have numbers up to ${currentMax}.` },
          { status: 400 }
        )
      }
    }
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

  return NextResponse.json({ success: true })
}

export async function POST(req: NextRequest) {
  const currentYear = new Date().getFullYear().toString()

  for (const prefix of PREFIXES) {
    // Find the highest asset number currently in use for this prefix
    const { data: maxAsset } = await supabaseAdmin
      .from('asset_ledger')
      .select('asset_number')
      .ilike('asset_number', `${prefix}%`)
      .order('asset_number', { ascending: false })
      .limit(1)

    let maxNum = 0
    let maxSuffix = ''

    if (maxAsset && maxAsset.length > 0) {
      const lastAsset = maxAsset[0].asset_number

      // Try the new format first: e.g., DBAS26-5
      const newRegex = new RegExp(`^${prefix}(\\d{2})-(\\d+)$`)
      const newMatch = lastAsset.match(newRegex)
      if (newMatch) {
        maxSuffix = newMatch[1]
        maxNum = parseInt(newMatch[2], 10)
      } else {
        // Fallback to old format: e.g., DBAS5
        const oldMatch = lastAsset.match(/(\d+)$/)
        if (oldMatch) {
          maxNum = parseInt(oldMatch[1], 10)
        }
      }
    } else {
      // No assets exist – leave the counter unchanged
      continue
    }

    // Upsert the counter with recalculated values
    await supabaseAdmin
      .from('asset_counters')
      .upsert(
        {
          prefix,
          year: currentYear,
          last_number: maxNum,
          year_suffix: maxSuffix || null,
        },
        { onConflict: 'prefix,year' }
      )
  }

  return NextResponse.json({ success: true })
}