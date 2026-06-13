import React from 'react'
import { Tooltip } from './Tooltip'

interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: React.ReactNode
  tooltip?: React.ReactNode
  variant?: 'ghost' | 'solid' | 'subtle' | 'accent'
  size?: 'sm' | 'md' | 'lg'
  active?: boolean
}

const variants: Record<string, string> = {
  ghost: 'text-[#75665a] hover:text-[#ece4dc] hover:bg-[#261f1a]',
  solid: 'text-[#ece4dc] bg-[#261f1a] hover:bg-[#362c25] border border-[#362c25]',
  subtle: 'text-[#b3a294] hover:text-[#ece4dc] hover:bg-[#261f1a]/60',
  accent: 'text-white gradient-accent hover:brightness-110 hover-glow shadow-lg shadow-[#ff9f0a]/20'
}

const sizes: Record<string, string> = {
  sm: 'w-6 h-6',
  md: 'w-7 h-7',
  lg: 'w-9 h-9'
}

export function IconButton({ icon, tooltip, variant = 'ghost', size = 'md', active = false, className = '', ...props }: IconButtonProps) {
  const btn = (
    <button
      className={[
        'inline-flex items-center justify-center rounded-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed',
        sizes[size],
        active ? 'text-[#ffc66b] bg-[#ff9f0a]/15 ring-1 ring-[#ff9f0a]/30' : variants[variant],
        className
      ].join(' ')}
      {...props}
    >
      {icon}
    </button>
  )
  if (tooltip) return <Tooltip content={tooltip}><span>{btn}</span></Tooltip>
  return btn
}