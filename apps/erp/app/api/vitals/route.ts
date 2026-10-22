import { NextRequest, NextResponse } from 'next/server'
import { recordWebVitals } from '@db/db/web-vitals'

// Beacon target for components/WebVitalsReporter.tsx. Public on purpose (it
// has to accept reports from pages with no session); all validation and
// anonymisation lives in recordWebVitals().
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const raw = await req.text().catch(() => '')
  if (raw.length > 8_000) return new NextResponse(null, { status: 413 })
  let body: unknown = null
  try { body = JSON.parse(raw) } catch { return new NextResponse(null, { status: 400 }) }
  await recordWebVitals('erp', body)
  // 204 whatever happened: the browser does nothing with the answer.
  return new NextResponse(null, { status: 204 })
}
