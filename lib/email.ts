// Thin wrapper around Resend's REST API -- no SDK dependency needed, it's a
// single JSON POST. Requires RESEND_API_KEY and RESEND_FROM_EMAIL in the
// environment; RESEND_FROM_EMAIL must be an address on a domain verified in
// the Resend dashboard, or every send will be rejected by Resend itself.
export interface SendEmailInput {
  to: string
  subject: string
  html: string
  attachmentFilename: string
  attachmentBuffer: ArrayBuffer
}

export interface SendEmailResult {
  success: boolean
  messageId?: string
  error?: string
}

export async function sendEmailWithAttachment(input: SendEmailInput): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY
  const fromEmail = process.env.RESEND_FROM_EMAIL
  if (!apiKey || !fromEmail) {
    return { success: false, error: 'Email is not configured yet -- set RESEND_API_KEY and RESEND_FROM_EMAIL (see docs/current-progress.md).' }
  }

  const attachmentBase64 = Buffer.from(input.attachmentBuffer).toString('base64')

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromEmail,
        to: input.to,
        subject: input.subject,
        html: input.html,
        attachments: [{ filename: input.attachmentFilename, content: attachmentBase64 }],
      }),
    })

    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      return { success: false, error: data.message || `Resend API error (${res.status})` }
    }
    return { success: true, messageId: data.id }
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to reach email provider' }
  }
}
