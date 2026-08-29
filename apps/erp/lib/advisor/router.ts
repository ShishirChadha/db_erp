// The intent router: tries each resolver in priority order (record -> metric ->
// process -> locate -> fallback) and returns the first hit. This is the whole
// "intelligence" of DB in Phase 1 -- no model, no ranking beyond "first match wins",
// deliberately: every one of these is a retrieval problem, and a wrong regex match
// is far easier to debug and fix than a wrong model guess.
import { resolveRecord } from './resolvers/record'
import { resolveMetric } from './resolvers/metric'
import { resolveProcess } from './resolvers/process'
import { resolveLocate } from './resolvers/locate'
import { resolveFallback } from './resolvers/fallback'
import type { AdvisorResult, ResolverContext } from './types'

const RESOLVERS = [resolveRecord, resolveMetric, resolveProcess, resolveLocate] as const

export async function route(ctx: ResolverContext): Promise<AdvisorResult | null> {
  for (const resolver of RESOLVERS) {
    try {
      const result = await resolver(ctx)
      if (result) return result
    } catch (err) {
      // A broken query in one resolver (a bad column, a transient DB error) should
      // fall through to the next resolver, not 500 the whole request -- the router's
      // job is to keep trying, same as a null "no match" would.
      console.error(`[advisor] resolver failed, falling through: ${resolver.name}`, err)
    }
  }
  try {
    return await resolveFallback(ctx)
  } catch (err) {
    console.error('[advisor] fallback resolver failed', err)
    return null
  }
}
