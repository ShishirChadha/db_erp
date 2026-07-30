// Shared server-side pagination helper for list API routes. Pagination is opt-in via
// a `page` query param -- callers that don't pass it (existing search widgets like
// SearchableItemSelect, RMA's unit picker, etc.) keep getting the full unbounded
// result exactly as before, so this never breaks an existing consumer. A caller that
// does pass `page` gets `{ data, total }` instead of a bare array.
export interface Pagination {
  page: number
  limit: number
  from: number
  to: number
}

export function parsePagination(searchParams: URLSearchParams, defaultLimit = 25): Pagination | null {
  const pageParam = searchParams.get('page')
  if (!pageParam) return null
  const page = Math.max(1, parseInt(pageParam, 10) || 1)
  const limit = Math.max(1, parseInt(searchParams.get('limit') || String(defaultLimit), 10))
  return { page, limit, from: (page - 1) * limit, to: page * limit - 1 }
}
