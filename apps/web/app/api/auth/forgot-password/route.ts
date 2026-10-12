import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@db/db/admin'
import { sendEmail } from '@/lib/email'
import { passwordResetEmailHtml } from '@/lib/email-templates'

// Always answers the same way whether or not the address has an account, so
// this endpoint can't be used to find out who is a customer. The recovery link
// is generated server-side (no PKCE verifier needed), so it works when the
// email is opened on a different device from the one that asked for it.
//
// Best-effort per-address cooldown: serverless instances don't share memory,
// so this only blunts a single instance being hammered -- GoTrue and Resend
// remain the real rate limits.
const recent = new Map<string, number>()
const COOLDOWN_MS = 60_000

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const generic = NextResponse.json({ success: true })

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return NextResponse.json({ error: 'Enter a valid email address' }, { status: 400 })
  }

  const last = recent.get(email)
  if (last && Date.now() - last < COOLDOWN_MS) return generic
  recent.set(email, Date.now())
  if (recent.size > 500) recent.clear()

  try {
    const { data, error } = await supabaseAdmin.auth.admin.generateLink({ type: 'recovery', email })
    // No such user (or any failure): say nothing different to the caller.
    if (error || !data?.properties?.action_link) return generic

    const result = await sendEmail({
      to: email,
      subject: 'Reset your DigitalBluez password',
      html: passwordResetEmailHtml({ actionLink: data.properties.action_link }),
    })
    if (!result.success) console.error('[forgot-password] email not sent:', result.error)
  } catch (err: any) {
    console.error('[forgot-password] failed:', err?.message)
  }
  return generic
}
