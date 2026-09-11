// A raw network-level failure on an individual outbound Supabase call (surfaces as
// `TypeError: fetch failed`, thrown before any HTTP response comes back -- not a
// Postgrest {data, error} result) is rare but real: confirmed reproducible against
// this app's own dev server while investigating the Stock/Sales "unable to fetch"
// reports. Routes that fan out several concurrent Supabase queries via Promise.all
// (/api/stock, /api/sales -- see their search/enrichment lookups) multiply the
// chance that any single request in the batch hits this, and Promise.all fails the
// whole batch on the first rejection, surfacing to the browser as "unable to fetch"
// even though every query itself was fine. One retry after a short delay is enough
// to ride out the transient failure without masking a real, persistent error (a
// genuinely broken query still fails after the retry). `fn` must be a factory (not
// an already-created query builder) so retrying actually re-issues the request.
export async function withRetry<T>(fn: () => PromiseLike<T>, retries = 1, delayMs = 300): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (retries <= 0) throw err
    await new Promise((resolve) => setTimeout(resolve, delayMs))
    return withRetry(fn, retries - 1, delayMs)
  }
}
