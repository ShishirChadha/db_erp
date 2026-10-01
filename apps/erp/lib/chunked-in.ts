import { withRetry } from '@/lib/db-retry'

// Max ids per request. The real constraint is total URL length, not the id
// count: the self-hosted stack fronts PostgREST with Envoy, whose listener sets
// per_connection_buffer_limit_bytes: 32768, and Cloudflare adds ~7KB of
// forwarding headers on top -- so the usable request line is ~24KB. Measured
// against the live stack, a `.in()` filter of UUIDs starts returning HTTP 400
// between 600 ids (22,288 bytes, OK) and 700 ids (25,988 bytes, rejected).
//
// 300 keeps us at roughly half the ceiling, which leaves room for longer
// select lists and for non-UUID keys (an invoice number or SKU code can be
// longer than a 36-char UUID).
//
// This limit is new: self-hosted Supabase v0.8.2 replaced Kong with Envoy, and
// Kong's equivalent buffer was far larger, so the same queries passed against
// hosted Supabase. See docs/decisions.md.
const DEFAULT_CHUNK_SIZE = 300

// Runs a `.in()` query in URL-length-safe batches and concatenates the rows.
//
// `fn` is a factory taking one batch of ids, so each batch is a fresh request
// (and so withRetry can re-issue it). Batches run concurrently -- the id lists
// here are page-sized at worst, a few batches, not hundreds.
//
// Throws if any batch returns a Postgrest error, deliberately: the bug this
// exists to fix was /api/stock destructuring only `{ data }` from an
// over-long request, discarding the 400 and answering 200 with repair-job
// numbers silently missing from every row. A query that cannot be satisfied
// must fail loudly rather than quietly return a short result that reads as
// "there is no data" -- callers cannot tell those two apart.
export async function chunkedIn<T>(
  ids: readonly string[],
  fn: (chunk: string[]) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  chunkSize: number = DEFAULT_CHUNK_SIZE
): Promise<{ data: T[] }> {
  if (ids.length === 0) return { data: [] }

  const chunks: string[][] = []
  for (let i = 0; i < ids.length; i += chunkSize) chunks.push(ids.slice(i, i + chunkSize) as string[])

  const results = await Promise.all(
    chunks.map(chunk => withRetry(() => fn(chunk)))
  )

  const data: T[] = []
  for (const res of results) {
    if (res.error) {
      throw new Error(
        `chunkedIn: batch failed (${ids.length} ids in ${chunks.length} batches of ${chunkSize}): ${res.error.message}`
      )
    }
    if (res.data) data.push(...res.data)
  }
  return { data }
}
