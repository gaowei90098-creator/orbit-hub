import React from 'react'

interface BadgeProps {
  children: React.ReactNode
  variant?: 'default' | 'success' | 'warning' | 'error' | 'info' | 'accent'
  size?: 'sm' | 'md'
  dot?: boolean
  className?: string
}

const variants: Record<string, { bg: string; text: string; border: string; dot: string }> = {
  default: { bg: 'bg-[#1a1f2e]', text: 'text-[#a0a8ba]', border: 'border-[#262d3d]', dot: 'bg-[#5c6478]' },
  success: { bg: 'bg-[#22c55e]/10', text: 'text-[#4ade80]', border: 'border-[#22c55e]/25', dot: 'bg-[#22c55e]' },
  warning: { bg: 'bg-[#f59e0b]/10', text: 'text-[#fbbf24]', border: 'border-[#f59e0b]/25', dot: 'bg-[#f59e0b]' },
  error:   { bg: 'bg-[#ef4444]/10', text: 'text-[#f87171]', border: 'border-[#ef4444]/25', dot: 'bg-[#ef4444]' },
  info:    { bg: 'bg-[#06b6d4]/10', text: 'text-[#22d3ee]', border: 'border-[#06b6d4]/25', dot: 'bg-[#06b6d4]' },
  accent:  { bg: 'bg-[#6366f1]/12', text: 'text-[#a5b4fc]', border: 'border-[#6366f1]/30', dot: 'bg-[#6366f1]' }
}

export function Badge({ children, variant = 'default', size = 'sm', dot, className = '' }: BadgeProps) {
  const v = variants[variant] || variants.default
  const sz = size === 'md' ? 'px-2 py-0.5 text-[11px]' : 'px-1.5 py-0.5 text-[10px]'
  return (
    <span className={[
      'inline-flex items-center gap-1 rounded-md font-medium border',
      v.bg, v.text, v.border, sz, className
    ].join(' ')}>
      {dot && <span className={'w-1 h-1 rounded-full ' + v.dot} />}
      {children}
    </span>
  )
}