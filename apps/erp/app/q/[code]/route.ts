import { NextRequest } from 'next/server'
import { liveSessionByCode } from '@/lib/qc-agent/session'
import { buildAgentScript } from '@/lib/qc-agent/script'
import { buildMacScript } from '@/lib/qc-agent/mac-script'

// GET /q/ABC123 -- the Auto Check PowerShell script, for
//   irm https://erp.digitalbluez.com/q/ABC123 | iex
// Kept at a short top-level path because the engineer types it by hand on the
// laptop being checked. No login: the code is the credential, and the script
// it returns can only write into that code's own session row.
//
// Errors come back as a PowerShell one-liner too, so `| iex` prints a readable
// message instead of a parse error.

const psText = (body: string, status = 200) =>
  new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } })

export async function GET(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const found = await liveSessionByCode(code)
  // ?check=1 -- the launcher (/q/go) asking "is this code good?" before running.
  const check = req.nextUrl.searchParams.get('check') === '1'
  if ('error' in found) {
    const status = found.error.status
    const msg = status === 410
      ? 'This Auto Check code has expired or was already used. Start a new one in the ERP.'
      : 'Unknown Auto Check code. Check the 6 letters on your ERP screen and try again.'
    if (check) return psText(msg)
    // 200 so irm hands the text to iex instead of throwing.
    return psText(`Write-Host '${msg}' -ForegroundColor Red\r\n`)
  }
  const { row } = found
  if (check) return psText('OK')
  // ?os=mac -- the bash script for a Mac (fetched by /mac). ?quick=1 shortens the
  // background tests for local development only; never honoured in production.
  if (req.nextUrl.searchParams.get('os') === 'mac') {
    return psText(buildMacScript({
      base: req.nextUrl.origin,
      code: row.code,
      heatTest: row.options?.heat_test !== false,
      quick: process.env.NODE_ENV !== 'production' && req.nextUrl.searchParams.get('quick') === '1',
    }))
  }
  return psText(buildAgentScript({
    base: req.nextUrl.origin,
    code: row.code,
    heatTest: row.options?.heat_test !== false,
  }))
}
