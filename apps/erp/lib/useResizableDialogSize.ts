'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

// Drag-to-resize (bottom-right corner handle) for a large form dialog -- same
// mousedown/mousemove/mouseup pattern as useResizablePaneWidth, applied to both
// width and height instead of a single pane edge. Persisted to localStorage per
// storageKey so a resized window stays that size next time it's opened.
export function useResizableDialogSize(
  storageKey: string,
  defaultWidth = 768,
  defaultHeight = 640,
  min = { width: 420, height: 320 },
) {
  const clampSize = (w: number, h: number) => ({
    width: Math.max(min.width, Math.min(w, window.innerWidth - 32)),
    height: Math.max(min.height, Math.min(h, window.innerHeight - 32)),
  })

  const [size, setSize] = useState(() => {
    if (typeof window === 'undefined') return { width: defaultWidth, height: defaultHeight }
    try {
      const stored = window.localStorage.getItem(storageKey)
      const parsed = stored ? JSON.parse(stored) : null
      if (parsed?.width && parsed?.height) return clampSize(parsed.width, parsed.height)
    } catch { /* ignore */ }
    return clampSize(defaultWidth, defaultHeight)
  })
  const [isResizing, setIsResizing] = useState(false)
  const start = useRef({ x: 0, y: 0, width: size.width, height: size.height })

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    start.current = { x: e.clientX, y: e.clientY, width: size.width, height: size.height }
    setIsResizing(true)
    document.body.style.cursor = 'nwse-resize'
    document.body.style.userSelect = 'none'
  }, [size.width, size.height])

  useEffect(() => {
    if (!isResizing) return
    const handleMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - start.current.x
      const dy = e.clientY - start.current.y
      setSize(clampSize(start.current.width + dx, start.current.height + dy))
    }
    const handleMouseUp = () => {
      setIsResizing(false)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      setSize((s) => {
        try { window.localStorage.setItem(storageKey, JSON.stringify(s)) } catch { /* ignore */ }
        return s
      })
    }
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isResizing, storageKey])

  return { width: size.width, height: size.height, isResizing, handleMouseDown }
}
