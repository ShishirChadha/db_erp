import dns from 'node:dns/promises'
import net from 'node:net'

// Safe outbound fetching for the competitor analyser. The owner types a URL and
// the SERVER fetches it, so without these checks that feature could be pointed
// at internal services (localhost, cloud metadata, the home network). Rules:
// https only, default port only, no credentials, every address the name resolves
// to must be public, redirects are re-checked hop by hop and may not leave the
// site, with a hard timeout and a response-size cap.
//
// Known limit: the name is resolved once for the check and again by fetch(), so a
// hostile DNS server could in theory answer differently the second time
// (DNS rebinding). The feature is owner-only and fetched pages are never shown
// raw, which keeps the exposure low; pinning the resolved IP needs a custom
// dispatcher and is a possible later hardening.

export const BOT_USER_AGENT = 'DigitalBluezSEO/1.0 (+https://www.digitalbluez.com)'

function ipv4ToParts(ip: string): number[] | null {
  const parts = ip.split('.').map(Number)
  return parts.length === 4 && parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? parts : null
}

function isPublicIpv4(ip: string): boolean {
  const p = ipv4ToParts(ip)
  if (!p) return false
  const [a, b, c] = p
  if (a === 0 || a === 10 || a === 127) return false // this-network, private, loopback
  if (a === 100 && b >= 64 && b <= 127) return false // carrier-grade NAT
  if (a === 169 && b === 254) return false // link-local (cloud metadata lives here)
  if (a === 172 && b >= 16 && b <= 31) return false
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false
  if (a === 192 && b === 168) return false
  if (a === 198 && (b === 18 || b === 19)) return false
  if (a === 198 && b === 51 && c === 100) return false
  if (a === 203 && b === 0 && c === 113) return false
  if (a >= 224) return false // multicast + reserved + broadcast
  return true
}

export function isPublicIp(ip: string): boolean {
  const v = net.isIP(ip)
  if (v === 4) return isPublicIpv4(ip)
  if (v !== 6) return false
  const s = ip.toLowerCase()
  if (s === '::' || s === '::1') return false
  const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped) return isPublicIpv4(mapped[1])
  const mappedHex = s.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
  if (mappedHex) {
    const hi = parseInt(mappedHex[1], 16)
    const lo = parseInt(mappedHex[2], 16)
    return isPublicIpv4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`)
  }
  if (/^f[cd]/.test(s)) return false // unique local fc00::/7
  if (/^fe[89ab]/.test(s)) return false // link-local fe80::/10
  if (s.startsWith('ff')) return false // multicast
  if (s.startsWith('64:ff9b:')) return false // NAT64
  if (s.startsWith('2001:db8')) return false // documentation
  if (s.startsWith('2002:')) return false // 6to4 (embeds an IPv4)
  return true
}

type Resolver = (hostname: string) => Promise<{ address: string }[]>
const defaultResolver: Resolver = (h) => dns.lookup(h, { all: true })

export async function assertPublicHttps(input: string, resolve: Resolver = defaultResolver): Promise<URL> {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new Error('That is not a valid web address')
  }
  if (url.protocol !== 'https:') throw new Error('Only https:// addresses can be analysed')
  if (url.username || url.password) throw new Error('Addresses with a username or password are not allowed')
  if (url.port && url.port !== '443') throw new Error('Only the standard https port is allowed')
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new Error('Internal addresses are not allowed')
  }
  if (net.isIP(host)) {
    if (!isPublicIp(host)) throw new Error('Private or internal addresses are not allowed')
    return url
  }
  if (!host.includes('.')) throw new Error('Internal addresses are not allowed')
  let addresses: { address: string }[]
  try {
    addresses = await resolve(host)
  } catch {
    throw new Error('Could not find that website (DNS lookup failed)')
  }
  if (addresses.length === 0 || addresses.some((a) => !isPublicIp(a.address))) {
    throw new Error('That address resolves to a private or internal network and is not allowed')
  }
  return url
}

// "www.example.com" and "example.com" are the same site for redirect purposes.
export const siteKey = (hostname: string) => hostname.toLowerCase().replace(/^www\./, '')

export interface GuardedResponse {
  status: number
  contentType: string
  body: string
  finalUrl: string
  truncated: boolean
  /** The server redirected somewhere other than this site (not followed). */
  offsiteRedirect: string | null
}

export interface GuardedFetchOptions {
  timeoutMs?: number
  maxBytes?: number
  maxRedirects?: number
  resolve?: Resolver
  fetchImpl?: typeof fetch
}

export async function guardedFetch(input: string, opts: GuardedFetchOptions = {}): Promise<GuardedResponse> {
  const { timeoutMs = 6000, maxBytes = 1_500_000, maxRedirects = 3, resolve = defaultResolver, fetchImpl = fetch } = opts
  let url = await assertPublicHttps(input, resolve)
  const origin = siteKey(url.hostname)

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const res = await fetchImpl(url.toString(), {
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'user-agent': BOT_USER_AGENT, accept: 'text/html,application/xhtml+xml,application/xml,text/plain;q=0.9,*/*;q=0.5' },
    })

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location')
      if (!loc) return { status: res.status, contentType: '', body: '', finalUrl: url.toString(), truncated: false, offsiteRedirect: null }
      const next = new URL(loc, url)
      if (siteKey(next.hostname) !== origin) {
        return { status: res.status, contentType: '', body: '', finalUrl: url.toString(), truncated: false, offsiteRedirect: next.toString() }
      }
      url = await assertPublicHttps(next.toString(), resolve) // re-check the new hop
      continue
    }

    // Read at most maxBytes -- never trust a server to keep a response small.
    let body = ''
    let truncated = false
    if (res.body) {
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let received = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        // Cut exactly at the cap, even when one chunk would overshoot it.
        const room = maxBytes - received
        if (value.byteLength > room) {
          body += decoder.decode(value.subarray(0, room), { stream: true })
          truncated = true
          await reader.cancel().catch(() => undefined)
          break
        }
        received += value.byteLength
        body += decoder.decode(value, { stream: true })
        if (received >= maxBytes) {
          truncated = true
          await reader.cancel().catch(() => undefined)
          break
        }
      }
    }
    return { status: res.status, contentType: res.headers.get('content-type') ?? '', body, finalUrl: url.toString(), truncated, offsiteRedirect: null }
  }
  throw new Error('Too many redirects')
}
