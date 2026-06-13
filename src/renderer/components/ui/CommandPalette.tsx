import React, { useState, useEffect, useRef, useMemo } from 'react'
import { Search, CornerDownLeft, ArrowUp, ArrowDown, X } from 'lucide-react'
import { Kbd } from './Kbd'

export interface CommandItem {
  id: string
  label: string
  description?: string
  icon?: React.ReactNode
  shortcut?: string[]
  group?: string
  action: () => void
  keywords?: string[]
  disabled?: boolean
}

interface CommandPaletteProps {
  open: boolean
  onClose: () => void
  commands: CommandItem[]
  placeholder?: string
}

export function CommandPalette({ open, onClose, commands, placeholder = 'Type a command or search…' }: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [activeIdx, setActiveIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return commands
    return commands.filter(c => {
      const hay = (c.label + ' ' + (c.description || '') + ' ' + (c.keywords?.join(' ') || '')).toLowerCase()
      return hay.includes(q)
    })
  }, [query, commands])

  const grouped = useMemo(() => {
    const map = new Map<string, CommandItem[]>()
    filtered.forEach(c => {
      const g = c.group || 'Actions'
      if (!map.has(g)) map.set(g, [])
      map.get(g)!.push(c)
    })
    return Array.from(map.entries())
  }, [filtered])

  useEffect(() => { setActiveIdx(0) }, [query, open])

  useEffect(() => {
    if (open) {
      setQuery('')
      setActiveIdx(0)
      setTimeout(() => inputRef.current?.focus(), 30)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose() }
      else if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveIdx(i => Math.min(filtered.length - 1, i + 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIdx(i => Math.max(0, i - 1))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const cmd = filtered[activeIdx]
        if (cmd && !cmd.disabled) { cmd.action(); onClose() }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, filtered, activeIdx, onClose])

  if (!open) return null

  let runningIdx = -1

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh] animate-fade-only"
      onClick={onClose}
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)' }}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="w-[560px] max-w-[92vw] glass-strong rounded-2xl shadow-2xl overflow-hidden animate-scale-in"
        style={{ boxShadow: '0 24px 60px -12px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,159,10,0.1)' }}
      >
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-[#261f1a]">
          <Search size={16} className="text-[#75665a] shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={placeholder}
            className="flex-1 bg-transparent text-sm text-[#ece4dc] placeholder-[#51443a] outline-none"
          />
          <button onClick={onClose} className="text-[#75665a] hover:text-[#ece4dc] p-1 rounded-lg hover:bg-[#261f1a]">
            <X size={14} />
          </button>
        </div>

        <div ref={listRef} className="max-h-[55vh] overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <div className="px-3 py-12 text-center text-[#75665a] text-xs">
              No commands found for &ldquo;{query}&rdquo;
            </div>
          ) : (
            grouped.map(([group, items]) => (
              <div key={group} className="mb-1">
                <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#51443a]">
                  {group}
                </div>
                <div className="space-y-0.5">
                  {items.map(c => {
                    runningIdx++
                    const isActive = runningIdx === activeIdx
                    const currentIdx = runningIdx
                    return (
                      <button
                        key={c.id}
                        onMouseEnter={() => setActiveIdx(currentIdx)}
                        onClick={() => { if (!c.disabled) { c.action(); onClose() } }}
                        disabled={c.disabled}
                        className={[
                          'w-full flex items-center gap-3 px-2.5 py-2 rounded-lg text-left transition-colors',
                          isActive ? 'bg-[#ff9f0a]/15 text-[#ece4dc]' : 'text-[#b3a294] hover:bg-[#261f1a]',
                          c.disabled ? 'opacity-40 cursor-not-allowed' : ''
                        ].join(' ')}
                      >
                        {c.icon && <span className={isActive ? 'text-[#ffc66b]' : 'text-[#75665a]'}>{c.icon}</span>}
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium truncate">{c.label}</div>
                          {c.description && <div className="text-[10px] text-[#75665a] truncate">{c.description}</div>}
                        </div>
                        {c.shortcut && c.shortcut.length > 0 && (
                          <span className="flex items-center gap-0.5 shrink-0">
                            {c.shortcut.map((k, i) => <Kbd key={i}>{k}</Kbd>)}
                          </span>
                        )}
                        {isActive && !c.shortcut && <CornerDownLeft size={12} className="text-[#ffc66b]" />}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="flex items-center gap-3 px-3 py-2 border-t border-[#261f1a] bg-[#0f0b09]/60 text-[10px] text-[#75665a]">
          <span className="flex items-center gap-1"><Kbd><ArrowUp size={9} /></Kbd><Kbd><ArrowDown size={9} /></Kbd> navigate</span>
          <span className="flex items-center gap-1"><Kbd><CornerDownLeft size={9} /></Kbd> select</span>
          <span className="ml-auto flex items-center gap-1"><Kbd>esc</Kbd> close</span>
        </div>
      </div>
    </div>
  )
}