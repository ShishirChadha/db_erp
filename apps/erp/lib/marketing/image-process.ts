import sharp from 'sharp'
import { readFile } from 'fs/promises'
import path from 'path'

// Turns a raw uploaded product photo into a card-ready tile: cropped to the EXACT
// target cell size (not just letterboxed to fit it), auto-corrected, and re-encoded --
// so the card layout can lay tiles edge to edge with zero gap and zero blank space,
// regardless of what aspect ratio or exposure the original phone photo came in at.
// - fit: 'cover' + position: 'attention' crops to the target box using Sharp's
//   saliency detection (edges/skin-tone/high-frequency regions) to keep the
//   interesting part of the photo in frame, rather than a naive center-crop that could
//   slice off a laptop's corner.
// - normalise() stretches contrast to the image's own actual dynamic range (auto-tone);
//   a small, deliberately restrained modulate() bump adds a bit of punch without
//   tipping into an oversaturated/artificial look; sharpen() restores the crispness
//   resize() softens.
// Returns null (never throws) on a missing/corrupt/unreadable photo so one bad upload
// degrades to that cell's existing placeholder rather than failing the whole card.
export async function fetchAndProcessPhoto(url: string, targetW: number, targetH: number): Promise<string | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const buf = Buffer.from(await res.arrayBuffer())
    const out = await sharp(buf)
      .rotate() // auto-orient from EXIF before anything else touches pixel geometry
      .resize({
        width: Math.max(1, Math.round(targetW)),
        height: Math.max(1, Math.round(targetH)),
        fit: 'cover',
        position: sharp.strategy.attention,
      })
      .normalise()
      .modulate({ brightness: 1.03, saturation: 1.08 })
      .sharpen({ sigma: 0.6 })
      .jpeg({ quality: 90, mozjpeg: true })
      .toBuffer()
    return `data:image/jpeg;base64,${out.toString('base64')}`
  } catch {
    return null
  }
}

export interface BrandLogo {
  src: string
  width: number
  height: number
}

let logoCache: Promise<BrandLogo | null> | null = null

// The real DigitalBluez wordmark, trimmed of its source file's whitespace margin and
// cached in memory for the process lifetime (a static local asset never changes
// underneath a running server) -- used in the card footer instead of a plain text
// "DigitalBluez" label. Falls back to null (footer renders text-only) if the asset is
// ever missing, rather than failing card generation over a logo.
//
// Returns its trimmed pixel width/height alongside the data URI -- Satori (the engine
// behind next/og's ImageResponse) does not reliably resolve `width: 'auto'` on an
// <img>, so every caller must size it with an explicit numeric width computed from
// this real aspect ratio, not left to auto-size from a fixed height alone.
export function getBrandLogo(): Promise<BrandLogo | null> {
  if (!logoCache) {
    logoCache = (async () => {
      try {
        const filePath = path.join(process.cwd(), 'public', 'DB_LOGO.png')
        const buf = await readFile(filePath)
        const outBuf = await sharp(buf).trim().png().toBuffer()
        const meta = await sharp(outBuf).metadata()
        if (!meta.width || !meta.height) return null
        return { src: `data:image/png;base64,${outBuf.toString('base64')}`, width: meta.width, height: meta.height }
      } catch {
        return null
      }
    })()
  }
  return logoCache
}
