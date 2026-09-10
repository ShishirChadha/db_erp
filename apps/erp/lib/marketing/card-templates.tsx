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

const BRAND_BLUE = '#1d4ed8'
const INK = '#0f172a'
const MUTED = '#64748b'

function imageUrl(storagePath: string): string {
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/product-images/${storagePath}`
}

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })

export async function renderProductCard(product: MarketingProduct, format: CardFormat): Promise<ImageResponse> {
  const { width, height } = CARD_FORMATS[format]
  const [bold, semibold, regular] = await Promise.all([
    getFont('Archivo', 800),
    getFont('Archivo', 700),
    getFont('IBM Plex Sans', 500),
  ])

  const isStory = format === 'ig_story'
  const isWide = format === 'fb_link'
  const imgH = isWide ? height : Math.round(height * (isStory ? 0.55 : 0.6))

  return new ImageResponse(
    (
      <div
        style={{
          width, height,
          display: 'flex', flexDirection: isWide ? 'row' : 'column',
          background: '#ffffff', fontFamily: 'IBM Plex Sans',
        }}
      >
        <div style={{ display: 'flex', width: isWide ? Math.round(width * 0.48) : width, height: isWide ? height : imgH, position: 'relative', background: '#e2e8f0' }}>
          {product.primary_image_path ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imageUrl(product.primary_image_path)} width={isWide ? Math.round(width * 0.48) : width} height={isWide ? height : imgH} style={{ objectFit: 'cover' }} />
          ) : (
            <div style={{ display: 'flex', width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', color: MUTED, fontSize: 28 }}>DigitalBluez</div>
          )}
          {product.percent_off ? (
            <div style={{ position: 'absolute', top: 28, left: 28, display: 'flex', background: '#dc2626', color: '#fff', padding: '10px 22px', borderRadius: 999, fontFamily: 'Archivo', fontWeight: 800, fontSize: 30 }}>
              {product.percent_off}% OFF
            </div>
          ) : null}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, padding: isWide ? 48 : 56, justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', fontFamily: 'Archivo', fontWeight: 800, fontSize: isWide ? 40 : 52, color: INK, lineHeight: 1.1 }}>
              {product.display_title.length > 60 ? product.display_title.slice(0, 57) + '…' : product.display_title}
            </div>
            {product.config_summary ? (
              <div style={{ display: 'flex', marginTop: 18, fontSize: isWide ? 24 : 30, color: MUTED }}>{product.config_summary}</div>
            ) : null}
            {product.web_condition_grade ? (
              <div style={{ display: 'flex', marginTop: 16, background: '#ecfdf5', color: '#047857', padding: '8px 18px', borderRadius: 999, fontSize: 22, fontFamily: 'Archivo', fontWeight: 700, alignSelf: 'flex-start' }}>
                {product.web_condition_grade} condition
              </div>
            ) : null}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
              <div style={{ display: 'flex', fontFamily: 'Archivo', fontWeight: 800, fontSize: isWide ? 44 : 56, color: BRAND_BLUE }}>{inr.format(product.web_price)}</div>
              {product.market_price && product.market_price > product.web_price ? (
                <div style={{ display: 'flex', fontSize: 28, color: MUTED, textDecoration: 'line-through' }}>{inr.format(product.market_price)}</div>
              ) : null}
            </div>
            <div style={{ display: 'flex', marginTop: 22, fontSize: 22, color: MUTED }}>4.9★ · 97 Google Reviews · Warranty backed</div>
            <div style={{ display: 'flex', marginTop: 6, fontFamily: 'Archivo', fontWeight: 700, fontSize: 26, color: INK }}>DigitalBluez · +91 99911 11193</div>
          </div>
        </div>
      </div>
    ),
    { width, height, fonts: [{ name: 'Archivo', data: bold, weight: 800 }, { name: 'Archivo', data: semibold, weight: 700 }, { name: 'IBM Plex Sans', data: regular, weight: 500 }] }
  )
}
