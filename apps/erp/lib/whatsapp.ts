// Thin wrapper around Meta's WhatsApp Cloud API -- mirrors lib/email.ts's shape
// exactly ({success, messageId, error}, graceful no-op when unconfigured) so the
// digest send path can treat both channels identically.
//
// Unlike email, WhatsApp credentials have no env-var home yet (there's no
// account until the owner does the free Meta developer-app setup described in
// Settings -> Digests) -- they live in digest_channel_config, with the access
// token encrypted at rest via lib/auth/password-vault.ts (same scheme already
// used for staff account passwords). Business-initiated messages require a
// pre-approved template; this only supports the template-message shape.
import { decryptPassword } from '@/lib/auth/password-vault'

export interface WhatsAppConfig {
  phoneNumberId: string
  accessTokenEncrypted: string
  templateName: string
  graphApiVersion: string
}

export interface SendWhatsAppInput {
  to: string // E.164, no leading '+' (e.g. "919991111193")
  config: WhatsAppConfig
  bodyParams: string[] // positional {{1}}, {{2}}, ... values for the approved template
}

export interface SendWhatsAppResult {
  success: boolean
  messageId?: string
  error?: string
}

export async function sendWhatsAppTemplate(input: SendWhatsAppInput): Promise<SendWhatsAppResult> {
  const { to, config, bodyParams } = input
  if (!config.phoneNumberId || !config.accessTokenEncrypted || !config.templateName) {
    return { success: false, error: 'WhatsApp is not configured yet -- set it up in Settings -> Digests.' }
  }

  let accessToken: string
  try {
    accessToken = decryptPassword(config.accessTokenEncrypted)
  } catch {
    return { success: false, error: 'Stored WhatsApp access token could not be decrypted -- re-enter it in Settings -> Digests.' }
  }

  try {
    const res = await fetch(
      `https://graph.facebook.com/${config.graphApiVersion}/${config.phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          type: 'template',
          template: {
            name: config.templateName,
            language: { code: 'en' },
            components: bodyParams.length
              ? [{ type: 'body', parameters: bodyParams.map((text) => ({ type: 'text', text })) }]
              : undefined,
          },
        }),
      }
    )
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      return { success: false, error: data?.error?.message || `WhatsApp API error (${res.status})` }
    }
    return { success: true, messageId: data?.messages?.[0]?.id }
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to reach WhatsApp' }
  }
}
