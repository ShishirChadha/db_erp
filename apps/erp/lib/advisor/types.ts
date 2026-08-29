import { SessionUser } from '@/lib/auth/session'

// A resolver either answers (AdvisorResult) or declines (null), letting the router
// fall through to the next one in priority order. Resolvers never throw for "not
// found" -- that's a normal null, not an error; they may still throw for a genuine
// backend failure, which the API route turns into a 500.
export type ResolverName = 'record' | 'metric' | 'process' | 'locate' | 'fallback'

export interface AdvisorCard {
  kind: ResolverName
  title: string
  subtitle?: string
  lines: { label: string; value: string }[]
  href?: string
  sourceLabel: string // shown as a small chip under the answer, e.g. "Reports -> KPIs"
}

export interface AdvisorResult {
  resolver: ResolverName
  card: AdvisorCard
}

export interface ResolverContext {
  user: SessionUser
  text: string // the raw question, lowercased is the resolver's own job
}
