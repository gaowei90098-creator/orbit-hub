import React from 'react'

interface SkeletonProps {
  className?: string
  variant?: 'text' | 'rect' | 'circle'
  width?: string | number
  height?: string | number
}

export function Skeleton({ className = '', variant = 'rect', width, height }: SkeletonProps) {
  const style: React.CSSProperties = {
    width: typeof width === 'number' ? width + 'px' : width,
    height: typeof height === 'number' ? height + 'px' : height
  }
  if (variant === 'circle') style.borderRadius = '9999px'
  else if (variant === 'text') { style.height = style.height || '0.75em'; style.borderRadius = '8px' }
  return <div className={'skeleton ' + className} style={style} />
}

export function SkeletonText({ lines = 3, className = '' }: { lines?: number; className?: string }) {
  const widths = ['100%', '95%', '70%', '85%', '60%']
  return (
    <div className={'space-y-2 ' + className}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} variant="text" width={widths[i % widths.length]} height={10} />
      ))}
    </div>
  )
}