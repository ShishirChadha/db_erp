// wa.me share-link + UTM helpers for the Marketing Content Studio. No Meta Cloud API
// call here -- WhatsApp distribution is deliberately "generate + copy/share-link",
// not an automated send (see docs/decisions.md's Marketing module ADR): free,
// instant, no template pre-approval, no business-initiated-message ban risk.
// lib/whatsapp.ts's sendWhatsAppTemplate() remains the internal-digest-only sender.

const STOREFRONT_URL = process.env.NEXT_PUBLIC_STOREFRONT_URL || 'http://localhost:3001'

// UTMs are attached to every generated product link from day one, before the ads/
// attribution phase exists, so that phase can read historical clicks retroactively.
// campaign is the marketing_assets row id -- lets Performance reporting join a sale's
// attribution straight back to the post that produced it.
export function buildProductUrl(webSlug: string, opts: { source: string; assetId?: string | null }): string {
  const url = new URL(`/product/${webSlug}`, STOREFRONT_URL)
  url.searchParams.set('utm_source', opts.source)
  url.searchParams.set('utm_medium', 'social')
  if (opts.assetId) url.searchParams.set('utm_campaign', opts.assetId)
  return url.toString()
}

// wa.me/?text= (no phone number) opens the user's own chat picker -- the sender picks
// who to send to. This is the shape used for sharing to a broadcast list, status, or
// a specific contact from the ERP user's own WhatsApp.
export function buildWhatsAppShareLink(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`
}

// wa.me/<number>?text= pre-fills a chat with one specific number (e.g. the business's
// own number, for a customer-facing "chat with us about this" link on a card).
export function buildWhatsAppDirectLink(phoneE164NoPlus: string, text: string): string {
  return `https://wa.me/${phoneE164NoPlus}?text=${encodeURIComponent(text)}`
}

export function buildFacebookShareLink(url: string): string {
  return `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`
}
