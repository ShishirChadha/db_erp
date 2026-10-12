'use client'

import { useEffect } from 'react'

// GoTrue sends password-recovery links back to its configured site URL (the
// apex domain) with the session in the hash -- not to /reset-password, since
// that path isn't on its redirect allow-list. Forward any page that receives
// such a hash to the reset form, keeping the hash so the session survives.
export function RecoveryRedirect() {
  useEffect(() => {
    const { hash, pathname } = window.location
    if (pathname !== '/reset-password' && /[#&]type=recovery(&|$)/.test(hash) && hash.includes('access_token')) {
      window.location.replace(`/reset-password${hash}`)
    }
  }, [])
  return null
}
