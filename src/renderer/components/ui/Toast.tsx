import React, { useState, useEffect } from 'react'
import { useUIStore } from '../../store/ui'
import { X, CheckCircle2, AlertCircle, Info, AlertTriangle } from 'lucide-react'

const styles: Record<string, { icon: any; accent: string; soft: string; border: string }> = {
  success: { icon: CheckCircle2,  accent: '#22c55e', soft: 'rgba(34, 197, 94, 0.10)',  border: 'rgba(34, 197, 94, 0.30)' },
  error:   { icon: AlertCircle,   accent: '#ef4444', soft: 'rgba(239, 68, 68, 0.10)',  border: 'rgba(239, 68, 68, 0.30)' },
  info:    { icon: Info,          accent: '#6366f1', soft: 'rgba(99, 102, 241, 0.12)', border: 'rgba(99, 102, 241, 0.30)' },
  warning: { icon: AlertTriangle, accent: '#f59e0b', soft: 'rgba(245, 158, 11, 0.10)', border: 'rgba(245, 158, 11, 0.30)' }
}

interface ToastProps {
  id: string
  type: keyof typeof styles
  message: string
  onClose: () => void
  duration?: number
}

function Toast({ id, type, message, onClose, duration = 4000 }: ToastProps) {
  const s = styles[type] || styles.info
  const Icon = s.icon
  const [closing, setClosing] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setClosing(true), duration - 240)
    const t2 = setTimeout(onClose, duration)
    return () => { clearTimeout(t); clearTimeout(t2) }
  }, [duration, onClose])

  return (
    <div
      className={[
        'relative overflow-hidden flex items-start gap-2.5 pl-3 pr-2 py-2.5 rounded-xl border min-w-[260px] max-w-[380px] shadow-2xl glass-strong',
        closing ? 'animate-fade-only opacity-0' : 'animate-slide-bottom'
      ].join(' ')}
      style={{ borderColor: s.border, background: `linear-gradient(180deg, ${s.soft} 0%, rgba(10, 12, 18, 0.85) 100%)` }}
    >
      <span className="absolute left-0 top-0 bottom-0 w-0.5" style={{ background: s.accent }} />
      <Icon size={14} className="shrink-0 mt-0.5" style={{ color: s.accent }} />
      <span className="flex-1 text-xs text-[#e2e6ef] leading-relaxed">{message}</span>
      <button
        onClick={() => { setClosing(true); setTimeout(onClose, 200) }}
        className="text-[#5c6478] hover:text-[#e2e6ef] p-0.5 rounded transition-colors"
        aria-label="Dismiss"
      >
        <X size={12} />
      </button>
      <span
        className="absolute bottom-0 left-0 h-0.5"
        style={{
          background: s.accent,
          animation: `toast-progress ${duration}ms linear forwards`,
          width: '100%'
        }}
      />
      <style>{`@keyframes toast-progress { from { transform: scaleX(1); transform-origin: left; } to { transform: scaleX(0); transform-origin: left; } }`}</style>
    </div>
  )
}

export function ToastContainer() {
  const { notifications, removeNotification } = useUIStore()
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      {notifications.map(n => (
        <div key={n.id} className="pointer-events-auto">
          <Toast
            id={n.id}
            type={n.type as any}
            message={n.message}
            onClose={() => removeNotification(n.id)}
          />
        </div>
      ))}
    </div>
  )
}