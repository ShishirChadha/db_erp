import { ImageResponse } from 'next/og'
import { getFont } from './fonts'
import type { MarketingProduct } from './product-data'

export const CARD_FORMATS = {
  wa_square: { width: 1080, height: 1080 },
  ig_portrait: { width: 1080, height: 1350 },
  ig_story: { width: 1080, height: 1920 },
  fb_link: { width: 1200, height: 630 },
} as const
export type CardFormat = keyof typeof CARD_FORMATS

const INK = '#0f172a'
const MUTED = '#64748b'
const PHONE_LINE = 'DigitalBluez · +91 99911 11193'

function imageUrl(storagePath: string): string {
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/product-images/${storagePath}`
}

// One photo cell -- always objectFit: 'contain' with a light letterbox background, never
// 'cover'. 'cover' crops whatever doesn't fit the box (a laptop's hinge/base/screen edge),
// which is exactly the "image is cut" problem the owner flagged from a real downloaded card.
function ImgBox({ src, w, h }: { src?: string; w: number; h: number }) {
  return (
    <div style={{ display: 'flex', width: w, height: h, background: '#f1f5f9', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} width={w} height={h} style={{ objectFit: 'contain' }} />
      ) : (
        <div style={{ display: 'flex', color: MUTED, fontSize: 26, fontFamily: 'Archivo', fontWeight: 700 }}>DigitalBluez</div>
      )}
    </div>
  )
}

// Collage of up to 4 real product photos (primary first) instead of a single hero shot --
// falls back gracefully as fewer photos are available, down to the existing placeholder
// block for a SKU with zero photos uploaded.
function Collage({ urls, w, h }: { urls: string[]; w: number; h: number }) {
  const gap = 6
  if (urls.length <= 1) return <ImgBox src={urls[0]} w={w} h={h} />

  if (urls.length === 2) {
    const cw = Math.floor((w - gap) / 2)
    return (
      <div style={{ display: 'flex', flexDirection: 'row', width: w, height: h, gap }}>
        <ImgBox src={urls[0]} w={cw} h={h} />
        <ImgBox src={urls[1]} w={w - cw - gap} h={h} />
      </div>
    )
  }

  if (urls.length === 3) {
    const leftW = Math.floor(w * 0.6)
    const rightW = w - leftW - gap
    const rightH = Math.floor((h - gap) / 2)
    return (
      <div style={{ display: 'flex', flexDirection: 'row', width: w, height: h, gap }}>
        <ImgBox src={urls[0]} w={leftW} h={h} />
        <div style={{ display: 'flex', flexDirection: 'column', width: rightW, height: h, gap }}>
          <ImgBox src={urls[1]} w={rightW} h={rightH} />
          <ImgBox src={urls[2]} w={rightW} h={h - rightH - gap} />
        </div>
      </div>
    )
  }

  const cw = Math.floor((w - gap) / 2)
  const rh = Math.floor((h - gap) / 2)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: w, height: h, gap }}>
      <div style={{ display: 'flex', flexDirection: 'row', width: w, height: rh, gap }}>
        <ImgBox src={urls[0]} w={cw} h={rh} />
        <ImgBox src={urls[1]} w={w - cw - gap} h={rh} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'row', width: w, height: h - rh - gap, gap }}>
        <ImgBox src={urls[2]} w={cw} h={h - rh - gap} />
        <ImgBox src={urls[3]} w={w - cw - gap} h={h - rh - gap} />
      </div>
    </div>
  )
}

// Deliberately minimal by owner request (2026-09-11): a downloaded card carries only the
// photo(s), the laptop's specification, and the DigitalBluez number -- no price, no
// discount badge, no condition badge, no review strip. Title is built from brand + model
// (not web_title, which auto-fills with the same config-summary string config_summary
// already shows below it -- see the WhatsApp template's identical fix in
// whatsapp-template.ts's templateTitle()) so the card doesn't repeat itself the way the
// old web_title-sourced heading did.
export async function renderProductCard(product: MarketingProduct, format: CardFormat, imagePaths: string[] = []): Promise<ImageResponse> {
  const { width, height } = CARD_FORMATS[format]
  const [bold, semibold, regular] = await Promise.all([
    getFont('Archivo', 800),
    getFont('Archivo', 700),
    getFont('IBM Plex Sans', 500),
  ])

  const isWide = format === 'fb_link'
  const urls = imagePaths.map(imageUrl)
  const title = [product.brand, product.model_name].filter(Boolean).join(' ') || product.display_title

  const footerHeights: Record<CardFormat, number> = { wa_square: 220, ig_portrait: 240, ig_story: 260, fb_link: 0 }
  const footerH = footerHeights[format]
  const imageW = isWide ? Math.round(width * 0.56) : width
  const imageH = isWide ? height : height - footerH

  const footer = (
    <div style={{ display: 'flex', flexDirection: 'column', width: isWide ? width - imageW : width, height: isWide ? height : footerH, padding: isWide ? 44 : 40, justifyContent: 'center', gap: 10, background: '#ffffff' }}>
      <div style={{ display: 'flex', fontFamily: 'Archivo', fontWeight: 800, fontSize: isWide ? 34 : 42, color: INK, lineHeight: 1.15 }}>
        {title.length > 48 ? title.slice(0, 45) + '…' : title}
      </div>
      {product.config_summary ? (
        <div style={{ display: 'flex', fontSize: isWide ? 22 : 26, color: MUTED, lineHeight: 1.3 }}>{product.config_summary}</div>
      ) : null}
      <div style={{ display: 'flex', marginTop: 6, fontFamily: 'Archivo', fontWeight: 700, fontSize: isWide ? 24 : 28, color: INK }}>{PHONE_LINE}</div>
    </div>
  )

  return new ImageResponse(
    (
      <div style={{ width, height, display: 'flex', flexDirection: isWide ? 'row' : 'column', background: '#ffffff', fontFamily: 'IBM Plex Sans' }}>
        <Collage urls={urls} w={imageW} h={imageH} />
        {footer}
      </div>
    ),
    { width, height, fonts: [{ name: 'Archivo', data: bold, weight: 800 }, { name: 'Archivo', data: semibold, weight: 700 }, { name: 'IBM Plex Sans', data: regular, weight: 500 }] }
  )
}
