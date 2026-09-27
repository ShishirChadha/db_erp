// A new deploy rotates every content-hashed chunk filename. A tab left open
// from before the deploy still holds the old chunk URLs -- opening a
// next/dynamic dialog then throws "Failed to fetch dynamically imported
// module" / a ChunkLoadError, which (with no boundary) used to propagate to
// Next's bare root error UI: a white screen the user could only describe as
// the app just breaking. One self-heal reload recovers a stale tab
// automatically; the sessionStorage guard stops a genuinely broken deploy
// from reloading forever.
const CHUNK_ERROR_PATTERN = /ChunkLoadError|Loading chunk \d+ failed|Failed to fetch dynamically imported module|error loading dynamically imported module/i

export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error)
  return CHUNK_ERROR_PATTERN.test(message)
}

const RELOAD_GUARD_KEY = 'erp:chunk-reload-attempted'

// Reloads at most once per tab session -- if the reloaded page throws the same
// error again, this returns false and the caller should show the normal error
// UI instead of looping.
export function selfHealChunkError(): boolean {
  if (typeof window === 'undefined') return false
  try {
    if (window.sessionStorage.getItem(RELOAD_GUARD_KEY)) return false
    window.sessionStorage.setItem(RELOAD_GUARD_KEY, '1')
  } catch {
    // Private-mode/blocked storage -- fall through to reload anyway, worst
    // case is a single extra reload with no loop protection.
  }
  window.location.reload()
  return true
}
