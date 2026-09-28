import sharp from 'sharp'

// Raw phone-camera uploads (multi-MB, arbitrary dimensions) were landing in the
// product-images bucket unmodified, then getting re-transformed by Vercel's Image
// Optimization on every storefront page view -- which is what burned through the
// account's free Transformations quota (see apps/web/next.config.ts). Shrinking once
// here, at upload time, replaces that per-view cost with a one-time cost and keeps
// page weight small even now that the storefront serves images unoptimized.
const MAX_DIMENSION = 1600
const WEBP_QUALITY = 82
const MAX_INPUT_BYTES = 20 * 1024 * 1024

export interface ProcessedImage {
  buffer: Buffer
  width: number
  height: number
  contentType: 'image/webp'
}

// fit: 'inside' + withoutEnlargement -- caps the longest side without cropping or
// upscaling, so a landscape banner keeps its own aspect ratio (HomeBanners.tsx
// deliberately renders banners uncropped) and a small existing image is left alone.
export async function processUploadedImage(input: Buffer): Promise<ProcessedImage> {
  if (input.byteLength > MAX_INPUT_BYTES) {
    throw new Error('Image is too large (max 20MB)')
  }
  const buffer = await sharp(input)
    .rotate()
    .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: WEBP_QUALITY })
    .toBuffer()
  const meta = await sharp(buffer).metadata()
  if (!meta.width || !meta.height) throw new Error('Could not read processed image dimensions')
  return { buffer, width: meta.width, height: meta.height, contentType: 'image/webp' }
}
