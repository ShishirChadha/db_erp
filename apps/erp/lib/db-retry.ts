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
// `F extends () => any` + `Awaited<ReturnType<F>>` infers through the closure's
// static return type directly, rather than unifying against a plain
// `PromiseLike<T>` parameter -- postgrest-js's query builder overloads `.then()`
// (different shapes for `.maybeSingle()`/`.single()`/list results), which a
// bare `PromiseLike<T>` generic can fail to unify against, silently collapsing
// T to `unknown` at several `withRetry(() => query)` call sites (customers/
// vendors/invoices pages) after a postgrest-js version bump -- this shape is
// the standard fix for wrapping an arbitrary thenable/builder in a retry HOF.
export async function withRetry<F extends () => any>(fn: F, retries = 1, delayMs = 300): Promise<Awaited<ReturnType<F>>> {
  try {
    return await fn()
  } catch (err) {
    if (retries <= 0) throw err
    await new Promise((resolve) => setTimeout(resolve, delayMs))
    return withRetry(fn, retries - 1, delayMs)
  }
}
