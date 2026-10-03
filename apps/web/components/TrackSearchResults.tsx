'use client'

import { useEffect, useRef } from 'react'
import { track } from '@/lib/analytics'

// GA4 `search` + `view_search_results` for the /search page.
//
// Both are sent: `search` is GA4's recommended event for the act of searching,
// `view_search_results` for landing on the results. Keeping them separate is
// what lets "searched" and "saw results" be told apart if an empty-result page
// ever becomes its own problem.
//
// `search_term` is a custom parameter. To report on it in the ERP it must be
// registered as an event-scoped custom dimension in GA4 Admin → Custom
// definitions; until then GA4 collects it but cannot break it out.
export function TrackSearchResults({ term, resultsCount }: { term: string; resultsCount: number }) {
  const sentFor = useRef<string | null>(null)
  useEffect(() => {
    if (!term) return
    if (sentFor.current === term) return
    sentFor.current = term
    track({ name: 'search', params: { search_term: term, results_count: resultsCount } })
    track({ name: 'view_search_results', params: { search_term: term, results_count: resultsCount } })
  }, [term, resultsCount])
  return null
}
