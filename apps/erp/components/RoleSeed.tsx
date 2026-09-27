'use client'

import { useEffect } from 'react'
import { useRole, type RoleSnapshot } from '@/lib/auth/useRole'

// Hands the role/permissions data app/dashboard/layout.tsx already resolved
// server-side (no network call to Supabase Auth) into RoleProvider's context,
// so its own client-side fallback fetch never has to run on a normal
// dashboard load. Runs from an effect, not during render -- calling a setState
// owned by an ancestor (RoleProvider) directly in this component's render
// body would be an unsupported cross-component update; an effect is the
// correct way to push data up into context. React fires child effects before
// parent effects on mount, which is what makes RoleProvider's own effect see
// hydratedFromServer already set and skip its fetch.
export function RoleSeed({ snapshot }: { snapshot: RoleSnapshot }) {
  const { hydrate } = useRole()

  useEffect(() => {
    hydrate(snapshot)
    // Intentionally run once -- this layout (and therefore this component)
    // persists across client-side navigations within /dashboard/**; it isn't
    // remounted per page, so there's nothing to re-sync on snapshot identity
    // changes within one session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return null
}
