import { BUSINESS_PHONE_DISPLAY, BUSINESS_PHONE_TEL, WHATSAPP_NUMBER } from '@/lib/business-info'

// Our stand-in for NewJaisa's multi-service-center locator, which assumes a
// network we don't have. We're a single location -- so instead of pretending
// otherwise, this is just a direct line to a real person.
export function NeedHelpCTA() {
  return (
    <div className="flex items-center gap-4 text-sm">
      <span className="text-muted-foreground">Need help with this product?</span>
      <a
        href={`https://wa.me/${WHATSAPP_NUMBER}`}
        target="_blank"
        rel="noopener noreferrer"
        className="font-semibold text-brand-orange hover:underline"
      >
        WhatsApp us
      </a>
      <a href={`tel:${BUSINESS_PHONE_TEL}`} className="font-semibold text-brand-orange hover:underline">
        Call {BUSINESS_PHONE_DISPLAY}
      </a>
    </div>
  )
}
