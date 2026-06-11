import React, { useEffect, useRef } from 'react'
import { X } from 'lucide-react'

interface ModalProps {
  open: boolean
  onClose: () => void
  title?: string
  children: React.ReactNode
  width?: string
  footer?: React.ReactNode
  showClose?: boolean
  glass?: boolean
}

export function Modal({ open, onClose, title, children, width = 'max-w-lg', footer, showClose = true, glass = true }: ModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handleEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleEsc)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handleEsc)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      ref={overlayRef}
      onMouseDown={(e) => { if (e.target === overlayRef.current) onClose() }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-only"
      style={{ background: 'rgba(0, 0, 0, 0.65)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
    >
      <div
        ref={dialogRef}
        className={[width, 'w-full glass-strong rounded-2xl shadow-2xl overflow-hidden animate-scale-in flex flex-col max-h-[88vh]'].join(' ')}
        style={{ boxShadow: '0 24px 60px -12px rgba(0,0,0,0.6), 0 0 0 1px rgba(99,102,241,0.08)' }}
      >
        {(title || showClose) && (
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#1a1f2e] shrink-0">
            {title ? (
              <h2 className="text-sm font-semibold text-[#e2e6ef] tracking-tight">{title}</h2>
            ) : <span />}
            {showClose && (
              <button
                onClick={onClose}
                aria-label="Close"
                className="p-1.5 rounded-md text-[#5c6478] hover:text-[#e2e6ef] hover:bg-[#1a1f2e] transition-colors"
              >
                <X size={14} />
              </button>
            )}
          </div>
        )}
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
        {footer && <div className="shrink-0 border-t border-[#1a1f2e]">{footer}</div>}
      </div>
    </div>
  )
}