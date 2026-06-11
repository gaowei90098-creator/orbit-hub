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
  ghost: 'text-[#5c6478] hover:text-[#e2e6ef] hover:bg-[#1a1f2e]',
  solid: 'text-[#e2e6ef] bg-[#1a1f2e] hover:bg-[#262d3d] border border-[#262d3d]',
  subtle: 'text-[#a0a8ba] hover:text-[#e2e6ef] hover:bg-[#1a1f2e]/60',
  accent: 'text-white gradient-accent hover:brightness-110 hover-glow shadow-lg shadow-[#6366f1]/20'
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
        'inline-flex items-center justify-center rounded-md transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed',
        sizes[size],
        active ? 'text-[#a5b4fc] bg-[#6366f1]/15 ring-1 ring-[#6366f1]/30' : variants[variant],
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