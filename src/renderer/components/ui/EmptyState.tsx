import React from 'react'

interface EmptyStateProps {
  icon?: React.ReactNode
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
  size?: 'sm' | 'md' | 'lg'
}

export function EmptyState({ icon, title, description, action, className = '', size = 'md' }: EmptyStateProps) {
  const dims = size === 'sm' ? { wrap: 'w-10 h-10', icon: 20 } : size === 'lg' ? { wrap: 'w-20 h-20', icon: 40 } : { wrap: 'w-14 h-14', icon: 28 }
  return (
    <div className={'flex flex-col items-center justify-center text-center px-6 py-10 ' + className}>
      {icon && (
        <div className={'relative ' + dims.wrap + ' rounded-2xl bg-gradient-to-br from-[#ff9f0a]/20 to-[#f0566a]/10 border border-[#ff9f0a]/20 flex items-center justify-center mb-4 animate-scale-in'}>
          <div className="absolute inset-0 rounded-2xl bg-[#ff9f0a]/5 blur-xl" />
          <div className="relative text-[#ffc66b]">{icon}</div>
        </div>
      )}
      <h3 className="text-sm font-semibold text-[#ece4dc] mb-1 tracking-tight">{title}</h3>
      {description && <p className="text-xs text-[#75665a] leading-relaxed max-w-xs mb-4">{description}</p>}
      {action}
    </div>
  )
}