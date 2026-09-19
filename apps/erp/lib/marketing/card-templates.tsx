import { ImageResponse } from 'next/og'
import { getFont } from './fonts'
import { fetchAndProcessPhoto, getBrandLogo, type BrandLogo } from './image-process'
import type { MarketingProduct } from './product-data'

export const CARD_FORMATS = {
  wa_square: { width: 1080, height: 1080 },
  ig_portrait: { width: 1080, height: 1350 },
  ig_story: { width: 1080, height: 1920 },
  fb_link: { width: 1200, height: 630 },
} as const
export type CardFormat = keyof typeof CARD_FORMATS

export const INK = '#0f172a'
export const MUTED = '#64748b'
const PHONE_LINE = 'DigitalBluez · +91 99911 11193'
// Sampled directly from the real DB_LOGO.png pixels (public/DB_LOGO.png) rather than
// hand-picked, so the card's accent bar is the exact brand orange/blue, not an
// approximation of it.
const BRAND_ORANGE = '#F08030'
const BRAND_BLUE = '#30A0E0'
const ACCENT_GRADIENT = `linear-gradient(90deg, ${BRAND_ORANGE} 0%, ${BRAND_BLUE} 100%)`
const ACCENT_GRADIENT_VERTICAL = `linear-gradient(180deg, ${BRAND_ORANGE} 0%, ${BRAND_BLUE} 100%)`

export function imageUrl(storagePath: string): string {
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/product-images/${storagePath}`
}

// Thin hairline gutter between grid tiles (a deliberate, uniform separator -- not the
// old undersized-crop letterboxing bug this whole layout was rewritten to fix). Shows
// as white, the same as every card's background, since it's a real `gap` on the flex
// container rather than a border/overlay, and reads as a clean grid divider the way
// Instagram/Apple Photos grids do rather than as a raw edge-to-edge photo mosaic.
const TILE_GAP = 4

// Splits `total` pixels into `count` near-equal integer segments that sum EXACTLY to
// `total - gap*(count-1)` (any remainder goes to the last segment) -- the building
// block every grid shape below uses instead of ad hoc Math.floor/subtraction pairs, so
// cells plus the `gap`-width dividers between them always tile a card exactly, with
// zero rounding-error over/underflow.
function evenSplit(total: number, count: number, gap = 0): number[] {
  const usable = total - gap * (count - 1)
  const base = Math.floor(usable / count)
  const sizes = new Array(count).fill(base)
  sizes[count - 1] = usable - base * (count - 1)
  return sizes
}

export interface Tile {
  src: string | null // pre-processed data: URI, exact-fit to w x h -- or null for "no photo"
  w: number
  h: number
}

// One grid cell. Real photos arrive already cropped by Sharp to these exact pixel
// dimensions (see image-process.ts), so objectFit: 'cover' here is a no-op safety net,
// not what's doing the cropping -- there is deliberately no letterbox background or gap
// around it, which is what makes adjacent tiles read as one seamless photo block instead
// of a scrapbook of mismatched thumbnails. A missing photo (upload never happened, or
// processing failed) falls back to a soft brand-tinted tile with the wordmark centered,
// so an incomplete gallery still looks designed rather than broken.
function ImgTile({ src, w, h, logo }: { src: string | null; w: number; h: number; logo: BrandLogo | null }) {
  return (
    <div style={{ display: 'flex', width: w, height: h, background: '#eef2f7', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} width={w} height={h} style={{ objectFit: 'cover' }} />
      ) : logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logo.src} width={Math.min(w, h) * 0.4} height={Math.min(w, h) * 0.4 * (logo.height / logo.width)} style={{ opacity: 0.5 }} />
      ) : (
        <div style={{ display: 'flex', color: MUTED, fontSize: 26, fontFamily: 'Archivo', fontWeight: 700 }}>DigitalBluez</div>
      )}
    </div>
  )
}

// Cell pixel sizes for a hero-weighted single-product gallery of `n` photos (1-4),
// with a TILE_GAP hairline reserved between every adjacent pair so cropped tiles tile
// with a clean thin divider rather than touching edge-to-edge. Order matches the photo
// order (primary photo first, per getProductImagePaths). Mirrored exactly by
// renderGallery below -- this function decides SIZES, that one decides JSX (including
// the matching `gap: TILE_GAP` on each flex container), both must agree on shape.
function galleryCellSizes(n: number, w: number, h: number): { w: number; h: number }[] {
  if (n <= 1) return [{ w, h }]

  if (n === 2) {
    // Stacked top/bottom, not side-by-side: each cell is full-width and only
    // half-height, i.e. landscape-shaped like a laid-flat laptop photo -- a tall
    // narrow side-by-side split is what produced the old "half the card is blank"
    // letterboxing bug once photos are forced to a mismatched aspect ratio.
    const [h0, h1] = evenSplit(h, 2, TILE_GAP)
    return [{ w, h: h0 }, { w, h: h1 }]
  }

  if (n === 3) {
    // Hero on top (full width, ~55% height -- still landscape-shaped), two photos
    // side by side underneath.
    const heroH = Math.round(h * 0.55)
    const restH = h - heroH - TILE_GAP
    const [w0, w1] = evenSplit(w, 2, TILE_GAP)
    return [{ w, h: heroH }, { w: w0, h: restH }, { w: w1, h: restH }]
  }

  // n === 4: 2x2 grid -- on a near-square card each cell is itself near-square.
  const [w0, w1] = evenSplit(w, 2, TILE_GAP)
  const [h0, h1] = evenSplit(h, 2, TILE_GAP)
  return [{ w: w0, h: h0 }, { w: w1, h: h0 }, { w: w0, h: h1 }, { w: w1, h: h1 }]
}

export function renderGallery(tiles: Tile[], w: number, h: number, logo: BrandLogo | null) {
  const n = tiles.length
  if (n <= 1) return <ImgTile src={tiles[0]?.src ?? null} w={w} h={h} logo={logo} />

  if (n === 2) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', width: w, height: h, gap: TILE_GAP }}>
        <ImgTile src={tiles[0].src} w={tiles[0].w} h={tiles[0].h} logo={logo} />
        <ImgTile src={tiles[1].src} w={tiles[1].w} h={tiles[1].h} logo={logo} />
      </div>
    )
  }

  if (n === 3) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', width: w, height: h, gap: TILE_GAP }}>
        <ImgTile src={tiles[0].src} w={tiles[0].w} h={tiles[0].h} logo={logo} />
        <div style={{ display: 'flex', flexDirection: 'row', width: w, height: tiles[1].h, gap: TILE_GAP }}>
          <ImgTile src={tiles[1].src} w={tiles[1].w} h={tiles[1].h} logo={logo} />
          <ImgTile src={tiles[2].src} w={tiles[2].w} h={tiles[2].h} logo={logo} />
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: w, height: h, gap: TILE_GAP }}>
      <div style={{ display: 'flex', flexDirection: 'row', width: w, height: tiles[0].h, gap: TILE_GAP }}>
        <ImgTile src={tiles[0].src} w={tiles[0].w} h={tiles[0].h} logo={logo} />
        <ImgTile src={tiles[1].src} w={tiles[1].w} h={tiles[1].h} logo={logo} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'row', width: w, height: tiles[2].h, gap: TILE_GAP }}>
        <ImgTile src={tiles[2].src} w={tiles[2].w} h={tiles[2].h} logo={logo} />
        <ImgTile src={tiles[3].src} w={tiles[3].w} h={tiles[3].h} logo={logo} />
      </div>
    </div>
  )
}

// Fetches+Sharp-processes every gallery photo IN PARALLEL, each cropped to its exact
// final cell size up front -- ImageResponse's JSX tree is built synchronously in one
// pass (Satori has no async-component support), so every photo must already be a
// ready `data:` URI by the time renderGallery runs.
export async function prepareGalleryTiles(storagePaths: string[], w: number, h: number): Promise<Tile[]> {
  const sizes = galleryCellSizes(storagePaths.length, w, h)
  return Promise.all(
    storagePaths.map(async (p, i) => ({ src: await fetchAndProcessPhoto(imageUrl(p), sizes[i].w, sizes[i].h), ...sizes[i] }))
  )
}

// 2 items go 1 column x 2 rows (stacked), not 2 cols x 1 row (side by side) -- same
// landscape-cell reasoning as galleryCellSizes. Beyond 4 it's a plain even grid.
function multiGridDims(n: number): { cols: number; rows: number } {
  if (n <= 1) return { cols: 1, rows: 1 }
  if (n === 2) return { cols: 1, rows: 2 }
  if (n <= 4) return { cols: 2, rows: 2 }
  if (n <= 6) return { cols: 3, rows: 2 }
  return { cols: 3, rows: 3 }
}

function multiGridCellSizes(n: number, w: number, h: number): { w: number; h: number }[] {
  const { cols, rows } = multiGridDims(n)
  const colWidths = evenSplit(w, cols, TILE_GAP)
  const rowHeights = evenSplit(h, rows, TILE_GAP)
  const sizes: { w: number; h: number }[] = []
  for (let i = 0; i < n; i++) sizes.push({ w: colWidths[i % cols], h: rowHeights[Math.floor(i / cols)] })
  return sizes
}

function renderMultiGrid(tiles: Tile[], w: number, h: number, logo: BrandLogo | null) {
  const n = tiles.length
  const { cols, rows } = multiGridDims(n)
  const rowEls = []
  for (let r = 0; r < rows; r++) {
    const rowH = tiles[r * cols]?.h ?? 0
    const cellsInRow = []
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c
      if (i >= n) continue
      cellsInRow.push(<ImgTile key={i} src={tiles[i].src} w={tiles[i].w} h={tiles[i].h} logo={logo} />)
    }
    rowEls.push(<div key={r} style={{ display: 'flex', flexDirection: 'row', width: w, height: rowH, gap: TILE_GAP }}>{cellsInRow}</div>)
  }
  return <div style={{ display: 'flex', flexDirection: 'column', width: w, height: h, gap: TILE_GAP }}>{rowEls}</div>
}

async function prepareMultiGridTiles(storagePaths: string[], w: number, h: number): Promise<Tile[]> {
  const sizes = multiGridCellSizes(storagePaths.length, w, h)
  return Promise.all(
    storagePaths.map(async (p, i) => ({ src: await fetchAndProcessPhoto(imageUrl(p), sizes[i].w, sizes[i].h), ...sizes[i] }))
  )
}

// The brand lockup used in every footer below: the real trimmed wordmark image plus
// the phone number beside it, instead of a plain text-only line -- falls back to
// text-only if the logo asset can't be read for any reason.
export function BrandLine({ logo, size }: { logo: BrandLogo | null; size: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      {logo && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logo.src} width={size * (logo.width / logo.height)} height={size} />
      )}
      <div style={{ display: 'flex', fontFamily: 'Archivo', fontWeight: 700, fontSize: size * 0.62, color: INK }}>
        {logo ? '+91 99911 11193' : PHONE_LINE}
      </div>
    </div>
  )
}

// Multi-product collage -- one photo per selected item (Today's Picks' multi-select),
// not a multi-photo gallery of one product (that's renderProductCard/renderGallery
// above). Deliberately carries no per-item title/spec text (several different
// products, no single header makes sense) -- just the seamless photo grid and the
// brand line, matching the same minimal-card philosophy as the single-product card.
export async function renderMultiItemCollage(imagePaths: string[], format: CardFormat): Promise<ImageResponse> {
  const { width, height } = CARD_FORMATS[format]
  const [bold, logo] = await Promise.all([getFont('Archivo', 800), getBrandLogo()])
  const footerH = format === 'fb_link' ? 0 : 130
  const gridH = height - footerH
  const tiles = await prepareMultiGridTiles(imagePaths, width, gridH)

  return new ImageResponse(
    (
      <div style={{ width, height, display: 'flex', flexDirection: 'column', background: '#ffffff', fontFamily: 'IBM Plex Sans' }}>
        {renderMultiGrid(tiles, width, gridH, logo)}
        {footerH > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', width, height: footerH, background: '#ffffff' }}>
            <div style={{ display: 'flex', width, height: 5, background: ACCENT_GRADIENT }} />
            <div style={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <BrandLine logo={logo} size={44} />
            </div>
          </div>
        )}
      </div>
    ),
    { width, height, fonts: [{ name: 'Archivo', data: bold, weight: 800 }] }
  )
}

// Deliberately minimal by owner request (2026-09-11): a downloaded card carries only the
// photo(s), the laptop's specification, and the DigitalBluez number -- no price, no
// discount badge, no condition badge, no review strip. Title is built from brand + model
// (not web_title, which auto-fills with the same config-summary string config_summary
// already shows below it -- see the WhatsApp template's identical fix in
// whatsapp-template.ts's templateTitle()) so the card doesn't repeat itself the way the
// old web_title-sourced heading did.
//
// Photo handling (2026-09-19 redesign): every gallery photo is Sharp-processed to the
// EXACT pixel size of its cell (crop, auto-tone, sharpen -- see image-process.ts)
// before the card is composed, so multiple photos of different original aspect ratios
// tile edge to edge with zero gap and zero letterbox, regardless of how they were shot.
export async function renderProductCard(product: MarketingProduct, format: CardFormat, imagePaths: string[] = []): Promise<ImageResponse> {
  const { width, height } = CARD_FORMATS[format]
  const [bold, semibold, regular, logo] = await Promise.all([
    getFont('Archivo', 800),
    getFont('Archivo', 700),
    getFont('IBM Plex Sans', 500),
    getBrandLogo(),
  ])

  const isWide = format === 'fb_link'
  const title = [product.brand, product.model_name].filter(Boolean).join(' ') || product.display_title

  const footerHeights: Record<CardFormat, number> = { wa_square: 220, ig_portrait: 240, ig_story: 260, fb_link: 0 }
  const footerH = footerHeights[format]
  // The accent bar is a real 5px slice of the canvas, not an overlay -- both the gallery
  // and footer sizes below are shrunk by it so gallery + accent + footer sum to exactly
  // `height` (portrait/square) or `width` (fb_link), never overflowing the fixed canvas.
  const ACCENT = 5
  const imageW = isWide ? Math.round(width * 0.56) : width
  const imageH = isWide ? height : height - footerH - (footerH > 0 ? ACCENT : 0)
  const footerW = isWide ? width - imageW - ACCENT : width

  const tiles = await prepareGalleryTiles(imagePaths, imageW, imageH)

  const footerContent = (
    <div style={{ display: 'flex', flexDirection: 'column', width: footerW, height: isWide ? height : footerH, padding: isWide ? 44 : 40, justifyContent: 'center', gap: 12, background: '#ffffff' }}>
      <div style={{ display: 'flex', fontFamily: 'Archivo', fontWeight: 800, fontSize: isWide ? 36 : 46, color: INK, lineHeight: 1.12 }}>
        {title.length > 48 ? title.slice(0, 45) + '…' : title}
      </div>
      {product.config_summary ? (
        <div style={{ display: 'flex', fontSize: isWide ? 23 : 27, color: MUTED, lineHeight: 1.3 }}>{product.config_summary}</div>
      ) : null}
      <div style={{ display: 'flex', marginTop: 4 }}>
        <BrandLine logo={logo} size={isWide ? 32 : 38} />
      </div>
    </div>
  )

  return new ImageResponse(
    (
      <div style={{ width, height, display: 'flex', flexDirection: isWide ? 'row' : 'column', background: '#ffffff', fontFamily: 'IBM Plex Sans' }}>
        {renderGallery(tiles, imageW, imageH, logo)}
        {/* A thin brand-color accent bar between photo and footer -- a top border on a
            portrait/square card, a left border on the wide fb_link layout -- is the one
            deliberate color accent on an otherwise photo-led, restrained card. */}
        {footerH > 0 && !isWide && <div style={{ display: 'flex', width, height: ACCENT, background: ACCENT_GRADIENT }} />}
        {isWide && <div style={{ display: 'flex', width: ACCENT, height, background: ACCENT_GRADIENT_VERTICAL }} />}
        {footerContent}
      </div>
    ),
    { width, height, fonts: [{ name: 'Archivo', data: bold, weight: 800 }, { name: 'Archivo', data: semibold, weight: 700 }, { name: 'IBM Plex Sans', data: regular, weight: 500 }] }
  )
}
