import { getSiteProfile } from '@/lib/site-profile'

// Our stand-in for NewJaisa's multi-service-center locator, which assumes a
// network we don't have. We're a single location -- so instead of pretending
// otherwise, this is just a direct line to a real person.
export async function NeedHelpCTA() {
  const profile = await getSiteProfile()
  return (
    <div className="flex items-center gap-4 text-sm">
      <span className="text-muted-foreground">Need help with this product?</span>
      <a
        href={`https://wa.me/${profile.whatsappNumber}`}
        target="_blank"
        rel="noopener noreferrer"
        className="font-semibold text-brand-orange hover:underline"
      >
        WhatsApp us
      </a>
      <a href={`tel:${profile.phoneTel}`} className="font-semibold text-brand-orange hover:underline">
        Call {profile.phoneDisplay}
      </a>
    </div>
  )
}
