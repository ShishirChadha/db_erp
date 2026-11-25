import { NextRequest } from 'next/server'
import { buildMacBootstrap } from '@/lib/qc-agent/mac-script'

// GET /mac -- the one fixed line for every Mac:
//   curl -L erp.digitalbluez.com/mac | bash
// Asks for the 6-letter code, checks it, then runs /q/<code>?os=mac. No login
// and no secrets: without a live code it can do nothing.
export function GET(req: NextRequest) {
  return new Response(buildMacBootstrap(req.nextUrl.origin), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}
