// The Google service-account private key travels through environment variables, where it is
// easily damaged when pasted (wrapping quotes kept, "\n" typed as text, line breaks turned into
// spaces, Windows line endings, or the whole key base64-encoded). A damaged key makes Google's
// library fail with "error:1E08010C:DECODER routines::unsupported". This rebuilds a clean PEM
// from any of those shapes so the same variable works locally and on Vercel.

const HEADER = '-----BEGIN PRIVATE KEY-----'
const FOOTER = '-----END PRIVATE KEY-----'

export function normalizeGooglePrivateKey(raw: string): string {
  let v = String(raw ?? '').trim()
  // wrapping quotes pasted along with the value
  while (v.length > 1 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) v = v.slice(1, -1).trim()

  // the whole PEM base64-encoded?
  if (!v.includes('BEGIN') && /^[A-Za-z0-9+/=\s]+$/.test(v)) {
    try {
      const decoded = Buffer.from(v.replace(/\s+/g, ''), 'base64').toString('utf8')
      if (decoded.includes('BEGIN')) v = decoded
    } catch { /* leave as is */ }
  }

  // typed-out line breaks: \n, \\n, \r\n as literal text
  v = v.replace(/(?:\\)+r?\\*n/g, '\n').replace(/\r/g, '')

  const begin = v.indexOf('-----BEGIN')
  const end = v.indexOf('-----END')
  if (begin < 0 || end < 0) return v // not a PEM we recognise: hand it over unchanged so the real error shows

  const label = (v.slice(begin).match(/-----BEGIN ([A-Z ]+)-----/) || [])[1] || 'PRIVATE KEY'
  const bodyStart = v.indexOf('-----', begin + 5) + 5
  const body = v.slice(bodyStart, end).replace(/[^A-Za-z0-9+/=]/g, '')
  const lines = body.match(/.{1,64}/g) || []
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`
}

/** Turn Google's cryptic client errors into something the owner can act on. */
export function friendlyGoogleError(message: string | undefined | null, fallback: string): string {
  const m = String(message ?? '')
  if (/DECODER routines|PEM routines|invalid private key|private key/i.test(m)) {
    return 'The Google private key (GA4_PRIVATE_KEY) set on this server is not a valid key. In Vercel, paste the private_key value from the service-account JSON file exactly, including the -----BEGIN PRIVATE KEY----- and -----END PRIVATE KEY----- lines, then redeploy.'
  }
  if (/invalid_grant|invalid_client|unauthorized_client/i.test(m)) {
    return 'Google rejected the service account sign-in. Check GA4_CLIENT_EMAIL and GA4_PRIVATE_KEY belong to the same service account.'
  }
  return m || fallback
}

export { HEADER as PEM_HEADER, FOOTER as PEM_FOOTER }
