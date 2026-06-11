import React from 'react'

interface KbdProps {
  children: React.ReactNode
  className?: string
}

export function Kbd({ children, className = '' }: KbdProps) {
  return <kbd className={'kbd ' + className}>{children}</kbd>
}

export function KbdGroup({ keys, separator = '+' }: { keys: React.ReactNode[]; separator?: string }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {keys.map((k, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span className="text-[#3f4758] text-[10px] mx-0.5">{separator}</span>}
          <Kbd>{k}</Kbd>
        </React.Fragment>
      ))}
    </span>
  )
}