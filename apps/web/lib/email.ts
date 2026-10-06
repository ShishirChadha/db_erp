// Thin wrapper around Resend's REST API -- no SDK dependency, a single JSON
// POST. Mirrors apps/erp/lib/email.ts exactly (same env var names, same
// shape), duplicated rather than imported because apps/web and apps/erp are
// separately deployed apps with separate env/Vercel projects -- the ERP
// having RESEND_API_KEY set does nothing for apps/web until it's set here
// too. Requires RESEND_API_KEY and RESEND_FROM_EMAIL; RESEND_FROM_EMAIL must
// be an address on a domain verified in the Resend dashboard, or every send
// is rejected by Resend itself.
export interface SendEmailResult {
  success: boolean
  messageId?: string
  error?: string
}

export async function sendEmail(input: { to: string; subject: string; html: string }): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY
  const fromEmail = process.env.RESEND_FROM_EMAIL
  if (!apiKey || !fromEmail) {
    return { success: false, error: 'Email is not configured yet -- set RESEND_API_KEY and RESEND_FROM_EMAIL.' }
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: fromEmail, to: input.to, subject: input.subject, html: input.html }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return { success: false, error: data.message || `Resend API error (${res.status})` }
    return { success: true, messageId: data.id }
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to reach email provider' }
  }
}
