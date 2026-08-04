'use client'

import { useState, useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'

// Drag-to-resize table header cell. Width is in-memory only (not persisted).
export const ResizableHeader = ({
  label,
  width,
  onResize,
  className,
  onSort,
  sortIndicator,
  stickyTop,
}: {
  label: string
  width: number
  onResize: (w: number) => void
  className?: string
  onSort?: () => void
  sortIndicator?: string
  // When set, the header sticks to this offset (px) from the top of the nearest
  // scrolling ancestor -- used to keep column headers visible below a sticky toolbar.
  stickyTop?: number
}) => {
  const startX = useRef(0)
  const startWidth = useRef(width)
  const [isResizing, setIsResizing] = useState(false)

  const handleMouseDown = (e: React.MouseEvent) => {
    startX.current = e.clientX
    startWidth.current = width
    setIsResizing(true)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  useEffect(() => {
    if (!isResizing) return
    const handleMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - startX.current
      onResize(Math.max(60, startWidth.current + dx))
    }
    const handleMouseUp = () => {
      setIsResizing(false)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isResizing, onResize])

  return (
    <th
      className={cn(className, 'relative', stickyTop !== undefined && 'sticky z-20 bg-white')}
      style={stickyTop !== undefined ? { width, top: stickyTop } : { width }}
    >
      {onSort ? (
        <span className="cursor-pointer select-none" onClick={onSort}>
          {label}{sortIndicator || ''}
        </span>
      ) : (
        label
      )}
      <div
        onMouseDown={handleMouseDown}
        className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-blue-200"
      />
    </th>
  )
}
