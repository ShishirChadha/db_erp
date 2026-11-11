'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

type Mode = 'replace' | 'push'

// Syncs one filter/search value to a URL query param so the browser's Back
// button undoes it one step at a time, instead of every list page's filters
// living in plain useState with zero history entries (the bug this fixes --
// see docs/decisions.md / the plan this was built from). `commit(v, 'push')`
// for an instant-apply control (dropdown/checkbox/stat-card click) creates
// one history entry per click; `commit(v, 'replace')` with `debounceMs` set
// settles continuous typing silently and only pushes once typing stops, so a
// whole typed term collapses into a single undoable step instead of one per
// keystroke.
export function useUrlState(
  key: string,
  defaultValue: string,
  opts?: { debounceMs?: number }
): [string, (next: string, mode?: Mode) => void] {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const debounceMs = opts?.debounceMs ?? 0
  const paramValue = searchParams.get(key)

  const [value, setValue] = useState(() => paramValue ?? defaultValue)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Picks up Back/Forward/refresh -- searchParams changes identity whenever
  // the URL changes via navigation (but not synchronously within our own
  // commit() below, so this doesn't fight with local typing state).
  useEffect(() => {
    setValue(paramValue ?? defaultValue)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramValue])

  const commit = useCallback((next: string, mode: Mode = 'push') => {
    if (timer.current) clearTimeout(timer.current)

    const write = (m: Mode) => {
      const params = new URLSearchParams(searchParams.toString())
      if (next && next !== defaultValue) params.set(key, next)
      else params.delete(key)
      const qs = params.toString()
      router[m](qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    }

    if (mode === 'replace' && debounceMs > 0) {
      // Deliberately untouched until the timer fires -- neither the URL nor
      // the returned `value` update per keystroke. Callers drive an expensive
      // fetch off the returned value, so updating it (or the URL, which would
      // feed back into it via the sync-from-URL effect above) on every
      // keystroke would fire that fetch on every keystroke too, defeating the
      // whole point of debouncing. Once typing settles, both land together as
      // one history step.
      timer.current = setTimeout(() => {
        setValue(next)
        write('push')
      }, debounceMs)
    } else {
      setValue(next)
      write(mode)
    }
  }, [key, defaultValue, debounceMs, pathname, router, searchParams])

  return [value, commit]
}
