import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@db/db/admin'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function POST(req: NextRequest) {
  const { email } = await req.json()
  if (typeof email !== 'string' || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 })
  }

  const { error } = await supabaseAdmin
    .from('newsletter_subscribers')
    .upsert({ email: email.toLowerCase().trim(), unsubscribed_at: null }, { onConflict: 'email' })

  if (error) return NextResponse.json({ error: 'Could not subscribe right now.' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
