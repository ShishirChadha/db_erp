// A plain `window.open(URL.createObjectURL(blob))` opens the PDF fine, but a
// blob: URL carries no HTTP headers at all -- the server's Content-Disposition
// filename (customer name + document number) is invisible to the browser, so
// "Save As" falls back to a generic/meaningless name. Triggering a real
// <a download="..."> click instead preserves the filename the server chose,
// parsed straight out of that same header rather than recomputed client-side.
function filenameFromResponse(res: Response, fallbackName: string): string {
  const disposition = res.headers.get('Content-Disposition') || ''
  const match = disposition.match(/filename="([^"]+)"/)
  return match?.[1] || fallbackName
}

export async function downloadPdfFromResponse(res: Response, fallbackName: string) {
  const filename = filenameFromResponse(res, fallbackName)
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

// A plain Blob has no name -- a blob: URL made from one carries none either,
// so Chrome's *built-in* PDF viewer (what PdfPreviewDialog's iframe shows)
// falls back to the blob URL's own random id when its own Save/Download
// button is used, same root problem as the app's Download button but on a
// button we don't control. Wrapping the blob in a File (which does carry a
// name) before minting the object URL is what actually fixes that: Chromium
// browsers honor the File's name as the suggested filename for both direct
// saves and the embedded PDF viewer's own download control.
export async function previewablePdfUrl(res: Response, fallbackName: string): Promise<string> {
  const filename = filenameFromResponse(res, fallbackName)
  const blob = await res.blob()
  const file = new File([blob], filename, { type: 'application/pdf' })
  return URL.createObjectURL(file)
}
