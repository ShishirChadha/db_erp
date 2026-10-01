// Downscale an image in the browser before it is uploaded.
//
// Why this has to happen client-side, even though /api/storage/upload-image
// already resizes with sharp: the server only gets to run if the request body
// arrives intact, and a raw phone photo often does not.
//   - Vercel caps a Serverless Function request body at 4.5MB. A modern phone
//     camera JPEG is routinely 4-8MB, so the body is rejected or cut short
//     before the route's own 20MB MAX_INPUT_BYTES check is ever reached.
//   - lib/api-client.ts aborts mutations after 30s (DEFAULT_TIMEOUT_MS.MUTATE).
//     Several MB over a typical Indian broadband upstream can exceed that.
// Either way the route receives a partial multipart body, req.formData()
// resolves with truncated bytes, and sharp fails with
// "VipsJpeg: premature end of JPEG image" -- which is what the user sees.
//
// Downscaling first makes the upload a few hundred KB, so none of the above
// applies. The server still re-encodes to webp afterwards: this is a transport
// guard, not a replacement for it, and the server stays authoritative about
// the stored format (a client could always skip this).
//
// MAX_DIMENSION matches lib/image-process.ts so the server's own resize is
// then a no-op (fit: 'inside' + withoutEnlargement leaves it alone).
const MAX_DIMENSION = 1600
const JPEG_QUALITY = 0.9

// Files below this are already small enough to send untouched -- re-encoding
// them would only lose quality for no transport benefit.
const SKIP_BELOW_BYTES = 1024 * 1024

export async function downscaleImageFile(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) return file
  if (file.size < SKIP_BELOW_BYTES) return file

  let bitmap: ImageBitmap
  try {
    // imageOrientation: 'from-image' applies the EXIF rotation, so a portrait
    // phone photo is not silently uploaded sideways -- the server's sharp
    // .rotate() can no longer do it for us once we have re-encoded the pixels
    // and dropped the EXIF block.
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    // Unsupported/!decodable here (e.g. HEIC on a browser without support).
    // Send the original and let the server report a real error.
    return file
  }

  const { width, height } = bitmap
  const scale = Math.min(1, MAX_DIMENSION / Math.max(width, height))
  const w = Math.max(1, Math.round(width * scale))
  const h = Math.max(1, Math.round(height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) { bitmap.close(); return file }
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close()

  const blob = await new Promise<Blob | null>(resolve =>
    canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY)
  )
  // Never return something larger than we started with (can happen when the
  // source was already well-compressed at a modest resolution).
  if (!blob || blob.size >= file.size) return file

  const name = file.name.replace(/\.[^.]+$/, '') + '.jpg'
  return new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() })
}
