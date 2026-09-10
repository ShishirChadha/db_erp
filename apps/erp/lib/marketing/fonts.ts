// Fetches Google Fonts as raw TTF bytes at request time for use with next/og's
// ImageResponse (which renders via Satori and needs a font buffer, not a <link> tag
// or @import -- it cannot resolve Google Fonts on its own the way a browser can).
// Requesting the CSS with an old-Firefox User-Agent is the standard trick to make
// Google's font CDN return .ttf instead of .woff2 (Satori's TTF/OTF support is the
// most reliable; woff2 support varies by version). Buffers are cached in memory for
// the life of the server process -- a font file never changes underneath a fixed
// family+weight, so there's no need to ever refetch within one running instance.
const fontCache = new Map<string, Promise<ArrayBuffer>>()

async function fetchGoogleFontBuffer(family: string, weight: number): Promise<ArrayBuffer> {
  const cssUrl = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@${weight}`
  const css = await fetch(cssUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 6.1; rv:1.0) Gecko/20100101 Firefox/1.0' },
  }).then((r) => r.text())
  const match = css.match(/src: url\(([^)]+)\) format\('(?:truetype|opentype)'\)/)
  if (!match) throw new Error(`Could not resolve a TTF URL for Google Font ${family} ${weight}`)
  return fetch(match[1]).then((r) => r.arrayBuffer())
}

export function getFont(family: string, weight: number): Promise<ArrayBuffer> {
  const key = `${family}:${weight}`
  if (!fontCache.has(key)) fontCache.set(key, fetchGoogleFontBuffer(family, weight))
  return fontCache.get(key)!
}
