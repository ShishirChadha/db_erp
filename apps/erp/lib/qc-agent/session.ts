// Auto Check session helpers shared by the routes.
//
// The 6-character code is the only credential the laptop being checked ever
// holds -- it never logs into the ERP. Everything a code can do is write into
// its own qc_agent_sessions row; stock and QC are only ever written by the
// engineer's own logged-in save. A code dies 2 hours after it was made, or as
// soon as that save completes. 32^6 ≈ 1.07 billion possible codes against a
// handful live at once makes guessing one impractical.

import { randomInt } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/service'
import type { SessionRow } from './evaluate'

export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no 0/O/1/I
// Who can open a run at all: new_entry (stock in + QC) or Live Stock / Stock
// (Auto Test of a unit already in stock). The start route narrows it per kind.
export const AUTO_CHECK_PAGES = ['new_entry', 'live_stock', 'stock']

export const CODE_TTL_MS = 2 * 60 * 60 * 1000
export const MAX_BODY_BYTES = 256 * 1024

/** The one line the engineer types into PowerShell on the laptop. */
export function agentCommand(origin: string, code: string) {
  return `irm ${origin}/q/${code} | iex`
}

export function newCode(): string {
  let s = ''
  for (let i = 0; i < 6; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]
  return s
}

export function normalizeCode(raw: string): string | null {
  const c = (raw || '').trim().toUpperCase()
  return /^[A-Z2-9]{6}$/.test(c) ? c : null
}

export const SESSION_COLUMNS =
  'id, code, created_by, created_at, expires_at, status, options, hardware_report, reported_at, background_results, live, live_at, interactive_results, asset_id, completed_at'

export const isExpired = (row: Pick<SessionRow, 'expires_at'>) => new Date(row.expires_at).getTime() < Date.now()

/**
 * Look up a live (not expired, not completed) session by its code. Returns a
 * ready NextResponse on failure so code-only routes stay short.
 */
export async function liveSessionByCode(rawCode: string): Promise<{ row: SessionRow } | { error: NextResponse }> {
  const code = normalizeCode(rawCode)
  if (!code) return { error: NextResponse.json({ error: 'Unknown code' }, { status: 404 }) }
  const { data, error } = await supabaseAdmin.from('qc_agent_sessions').select(SESSION_COLUMNS).eq('code', code).maybeSingle()
  if (error) return { error: NextResponse.json({ error: error.message }, { status: 500 }) }
  if (!data) return { error: NextResponse.json({ error: 'Unknown code' }, { status: 404 }) }
  const row = data as SessionRow
  if (row.status === 'completed') return { error: NextResponse.json({ error: 'This check is already saved. Start a new one.', status: 'completed' }, { status: 410 }) }
  if (isExpired(row)) return { error: NextResponse.json({ error: 'This code has expired. Start a new check in the ERP.', status: 'expired' }, { status: 410 }) }
  return { row }
}

/** Parse a JSON body, refusing anything over MAX_BODY_BYTES. */
export async function readJsonLimited(req: NextRequest): Promise<{ body: any } | { error: NextResponse }> {
  const declared = Number(req.headers.get('content-length') || 0)
  if (declared > MAX_BODY_BYTES) return { error: NextResponse.json({ error: 'Too large' }, { status: 413 }) }
  const text = await req.text()
  if (Buffer.byteLength(text) > MAX_BODY_BYTES) return { error: NextResponse.json({ error: 'Too large' }, { status: 413 }) }
  try {
    const body = JSON.parse(text.replace(/^﻿/, ''))
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('not an object')
    return { body }
  } catch {
    return { error: NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  }
}
