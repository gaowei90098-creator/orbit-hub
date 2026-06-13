import React from 'react'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle' | 'gradient'
  size?: 'sm' | 'md' | 'lg'
  iconOnly?: boolean
  loading?: boolean
}

const variants: Record<string, string> = {
  primary: 'bg-[#ff9f0a] text-white hover:bg-[#e8900a] shadow-md shadow-[#ff9f0a]/20 hover:shadow-[#ff9f0a]/40',
  gradient: 'gradient-accent text-white hover:brightness-110 shadow-md shadow-[#ff9f0a]/25 hover:shadow-[#ff9f0a]/50 hover-glow',
  secondary: 'bg-[#261f1a] text-[#ece4dc] border border-[#362c25] hover:bg-[#362c25] hover:border-[#51443a]',
  ghost: 'text-[#b3a294] hover:text-[#ece4dc] hover:bg-[#261f1a]',
  subtle: 'text-[#b3a294] bg-[#261f1a]/40 hover:bg-[#261f1a] hover:text-[#ece4dc]',
  danger: 'gradient-danger text-white hover:brightness-110 shadow-md shadow-[#ef4444]/25'
}

const sizes: Record<string, string> = {
  sm: 'h-7 px-2.5 text-xs gap-1.5',
  md: 'h-8 px-3 text-xs gap-2',
  lg: 'h-10 px-4 text-sm gap-2'
}

export function Button({ variant = 'primary', size = 'md', iconOnly, loading, className = '', children, disabled, ...props }: ButtonProps) {
  const base = 'inline-flex items-center justify-center rounded-lg font-medium select-none whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff9f0a]/40 focus-visible:ring-offset-1 focus-visible:ring-offset-[#120e0b]'
  const variantClass = variants[variant] || variants.primary
  const sizeClass = sizes[size] || sizes.md
  const iconSize = size === 'sm' ? 'h-3 w-3' : size === 'lg' ? 'h-4 w-4' : 'h-3.5 w-3.5'
  const finalIconOnly = iconOnly || (React.Children.count(children) === 1 && React.isValidElement(children))
  const paddingClass = finalIconOnly ? (size === 'sm' ? 'w-7 px-0' : size === 'lg' ? 'w-10 px-0' : 'w-8 px-0') : ''
  const stateClass = (disabled || loading) ? 'opacity-50 cursor-not-allowed pointer-events-none' : 'hover:-translate-y-px'

  return (
    <button
      className={[base, variantClass, sizeClass, paddingClass, stateClass, className].join(' ')}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <span className={iconSize + ' rounded-full border-2 border-current border-r-transparent animate-spin'} />
      ) : children}
    </button>
  )
}