import React from 'react'

interface StatusDotProps {
  status: 'idle' | 'busy' | 'error' | 'offline'
  size?: number
  withRing?: boolean
  withGlow?: boolean
  pulse?: boolean
}

const colors: Record<string, { core: string; ring: string; glow: string; label: string }> = {
  idle:    { core: '#22c55e', ring: 'rgba(34, 197, 94, 0.25)',  glow: 'rgba(34, 197, 94, 0.5)',  label: '就绪' },
  busy:    { core: '#f59e0b', ring: 'rgba(245, 158, 11, 0.25)', glow: 'rgba(245, 158, 11, 0.5)', label: '忙碌' },
  error:   { core: '#ef4444', ring: 'rgba(239, 68, 68, 0.25)',  glow: 'rgba(239, 68, 68, 0.5)',  label: '错误' },
  offline: { core: '#5c6478', ring: 'rgba(92, 100, 120, 0.2)',  glow: 'rgba(92, 100, 120, 0.3)', label: '离线' }
}

export function StatusDot({ status, size = 8, withRing = false, withGlow = false, pulse }: StatusDotProps) {
  const c = colors[status] || colors.offline
  const shouldPulse = pulse ?? (status === 'busy' || status === 'idle')
  return (
    <span
      className={'relative inline-flex items-center justify-center ' + (shouldPulse ? 'animate-pulse-dot' : '')}
      style={{ width: size, height: size }}
      aria-label={c.label}
    >
      {withRing && (
        <span
          className="absolute inset-0 rounded-full"
          style={{ background: c.ring, transform: 'scale(1.8)' }}
        />
      )}
      <span
        className="relative rounded-full"
        style={{
          width: size,
          height: size,
          background: c.core,
          boxShadow: withGlow ? `0 0 ${size}px ${c.glow}` : undefined
        }}
      />
    </span>
  )
}

export function statusLabel(s: 'idle' | 'busy' | 'error' | 'offline') {
  return colors[s]?.label || s
}