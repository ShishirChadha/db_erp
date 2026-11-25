import { NextRequest } from 'next/server'
import { buildGoScript } from '@/lib/qc-agent/launcher'

// GET /q/go -- what the "DB Auto Check.cmd" pen-drive launcher runs: asks for
// the 6-letter code, checks it, then runs that code's Auto Check script.
// No login and no secrets: on its own it can do nothing without a live code.
// (A static segment, so it wins over /q/[code]; "go" is never a valid code.)
export function GET(req: NextRequest) {
  return new Response(buildGoScript(req.nextUrl.origin), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}
