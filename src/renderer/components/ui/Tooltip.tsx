import React, { useState, useRef, useEffect } from 'react'

interface TooltipProps {
  content: React.ReactNode
  children: React.ReactElement
  side?: 'top' | 'bottom' | 'left' | 'right'
  delay?: number
  disabled?: boolean
}

export function Tooltip({ content, children, side = 'top', delay = 300, disabled = false }: TooltipProps) {
  const [visible, setVisible] = useState(false)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const ref = useRef<HTMLDivElement>(null)
  const timer = useRef<any>(null)

  const show = () => {
    if (disabled) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      if (ref.current) {
        const r = ref.current.getBoundingClientRect()
        setPos({ x: r.left + r.width / 2, y: side === 'top' ? r.top : side === 'bottom' ? r.bottom : r.top + r.height / 2 })
      }
      setVisible(true)
    }, delay)
  }

  const hide = () => {
    if (timer.current) clearTimeout(timer.current)
    setVisible(false)
  }

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const placement = (() => {
    switch (side) {
      case 'top': return { left: pos.x, top: pos.y, transform: 'translate(-50%, calc(-100% - 8px))' }
      case 'bottom': return { left: pos.x, top: pos.y, transform: 'translate(-50%, 8px)' }
      case 'left': return { left: pos.x, top: pos.y, transform: 'translate(calc(-100% - 8px), -50%)' }
      case 'right': return { left: pos.x, top: pos.y, transform: 'translate(8px, -50%)' }
    }
  })()

  return (
    <>
      <span ref={ref} onMouseEnter={show} onMouseLeave={hide} onFocusCapture={show} onBlurCapture={hide} className="inline-flex">
        {children}
      </span>
      {visible && (
        <div
          role="tooltip"
          style={{ position: 'fixed', ...placement, zIndex: 9999 }}
          className="px-2 py-1 rounded-md text-[11px] font-medium text-[#e2e6ef] bg-[#0a0c12] border border-[#262d3d] shadow-xl pointer-events-none animate-fade-only whitespace-nowrap"
        >
          {content}
        </div>
      )}
    </>
  )
}