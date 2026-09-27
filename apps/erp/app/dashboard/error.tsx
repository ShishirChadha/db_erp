'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { isChunkLoadError, selfHealChunkError } from '@/lib/chunk-error'

export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    if (isChunkLoadError(error)) {
      selfHealChunkError()
    }
  }, [error])

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-4">
      <div className="max-w-sm space-y-3 text-center">
        <h2 className="text-lg font-semibold">Something went wrong</h2>
        <p className="text-sm text-muted-foreground">
          {isChunkLoadError(error)
            ? 'A new version of the app was published while this page was open. Reloading...'
            : 'This page ran into an error loading. You can try again, or reload the page.'}
        </p>
        <div className="flex justify-center gap-2 pt-1">
          <Button variant="outline" onClick={() => window.location.reload()}>Reload page</Button>
          <Button onClick={() => reset()}>Try again</Button>
        </div>
      </div>
    </div>
  )
}
