'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

// Drag-to-resize the left list pane of a master-detail split, mirroring
// components/ResizableHeader.tsx's mousedown/mousemove/mouseup pattern (same
// approach, applied to a pane divider instead of a table column edge). Width is
// persisted to localStorage per storageKey so it survives a refresh, same as
// StockView's own column-visibility preference already does.
export function useResizablePaneWidth(storageKey: string, defaultWidth = 340, min = 240, max = 640) {
  const [width, setWidth] = useState(() => {
    if (typeof window === 'undefined') return defaultWidth
    try {
      const stored = window.localStorage.getItem(storageKey)
      const parsed = stored ? Number(stored) : NaN
      return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : defaultWidth
    } catch {
      return defaultWidth
    }
  })
  const [isResizing, setIsResizing] = useState(false)
  const startX = useRef(0)
  const startWidth = useRef(width)

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    startX.current = e.clientX
    startWidth.current = width
    setIsResizing(true)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [width])

  useEffect(() => {
    if (!isResizing) return
    const handleMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - startX.current
      setWidth(Math.min(max, Math.max(min, startWidth.current + dx)))
    }
    const handleMouseUp = () => {
      setIsResizing(false)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      setWidth((w) => {
        try { window.localStorage.setItem(storageKey, String(w)) } catch { /* ignore */ }
        return w
      })
    }
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isResizing, min, max, storageKey])

  return { width, isResizing, handleMouseDown }
}
