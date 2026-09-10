import { supabaseAdmin } from '@/lib/supabase/service'

// Business-profile images (logo/signature/stamp/QR) are uploaded through the
// same private 'purchase-files' bucket the rest of Settings -> Business
// Profiles already uses (BusinessProfileManager.tsx never passes a `bucket`,
// so it defaults there) -- fetched here via the service-role client rather
// than a signed URL, since jsPDF needs the raw image bytes to embed.
const BUCKET = 'purchase-files'

export interface EntityImage {
  bytes: Uint8Array
  format: 'PNG' | 'JPEG' | 'WEBP'
}

function formatFromKey(key: string): EntityImage['format'] | null {
  const ext = key.split('.').pop()?.toLowerCase()
  if (ext === 'png') return 'PNG'
  if (ext === 'jpg' || ext === 'jpeg') return 'JPEG'
  if (ext === 'webp') return 'WEBP'
  return null
}

async function fetchImage(storageKey: string | null | undefined): Promise<EntityImage | null> {
  if (!storageKey) return null
  const format = formatFromKey(storageKey)
  if (!format) return null
  // Best-effort -- a missing/unreadable image must never break document
  // generation, it just renders without that graphic.
  try {
    const { data, error } = await supabaseAdmin.storage.from(BUCKET).download(storageKey)
    if (error || !data) return null
    const bytes = new Uint8Array(await data.arrayBuffer())
    return { bytes, format }
  } catch {
    return null
  }
}

// Forces every image into a fixed box (what the renderers did before) distorts
// non-square source images (a QR export is often not exactly square, e.g. it has
// a quiet-zone margin baked in unevenly) -- fit-within-box keeps aspect ratio so
// the QR stays scannable and logos/signatures don't look stretched.
export function fitWithinBox(pxWidth: number, pxHeight: number, maxW: number, maxH: number): { w: number; h: number } {
  if (!pxWidth || !pxHeight) return { w: maxW, h: maxH }
  const scale = Math.min(maxW / pxWidth, maxH / pxHeight)
  return { w: pxWidth * scale, h: pxHeight * scale }
}

export interface EntityBranding {
  logo: EntityImage | null
  signature: EntityImage | null
  stamp: EntityImage | null
  qrCode: EntityImage | null
}

export async function fetchEntityBranding(entity: {
  logo_url?: string | null
  signature_url?: string | null
  stamp_url?: string | null
  qr_code_url?: string | null
} | null): Promise<EntityBranding> {
  if (!entity) return { logo: null, signature: null, stamp: null, qrCode: null }
  const [logo, signature, stamp, qrCode] = await Promise.all([
    fetchImage(entity.logo_url),
    fetchImage(entity.signature_url),
    fetchImage(entity.stamp_url),
    fetchImage(entity.qr_code_url),
  ])
  return { logo, signature, stamp, qrCode }
}
