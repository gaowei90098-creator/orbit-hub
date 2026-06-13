import React, { useState, useRef, useEffect } from 'react'
import { useWorkspaceStore } from '../store/workspaces'
import { FolderKanban, Plus, Check, ChevronDown, Search, Trash2, Edit2, Briefcase } from 'lucide-react'
import { Tooltip } from './ui/Tooltip'

export function WorkspaceSelector() {
  const { workspaces, activeWorkspaceId, setActiveWorkspace, createWorkspace, deleteWorkspace, renameWorkspace } = useWorkspaceStore()
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [search, setSearch] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const activeWs = workspaces.find(w => w.id === activeWorkspaceId)

  useEffect(() => {
    if (creating || editingId) {
      setTimeout(() => inputRef.current?.focus(), 30)
    }
  }, [creating, editingId])

  useEffect(() => {
    if (!open) { setCreating(false); setEditingId(null); setName(''); setSearch('') }
  }, [open])

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  const filteredWs = workspaces.filter(w => w.name.toLowerCase().includes(search.toLowerCase()))

  const submitCreate = () => {
    if (!name.trim()) return
    createWorkspace(name.trim())
    setName('')
    setCreating(false)
    setOpen(false)
  }

  const submitRename = () => {
    if (editingId && name.trim()) {
      renameWorkspace(editingId, name.trim())
      setEditingId(null)
      setName('')
    }
  }

  return (
    <div ref={ref} className='relative'>
      <button
        onClick={() => setOpen(o => !o)}
        className={[
          'w-full flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-left transition-all',
          'bg-[#0a0807] hover:bg-[#261f1a] border',
          open ? 'border-[#ff9f0a]/50 shadow-md shadow-[#ff9f0a]/10' : 'border-[#261f1a] hover:border-[#362c25]'
        ].join(' ')}
      >
        <Briefcase size={11} className='text-[#ffc66b] shrink-0' />
        <span className='text-[11px] font-semibold text-[#ece4dc] truncate flex-1'>{activeWs?.name || '选择工作区'}</span>
        <ChevronDown size={11} className={['text-[#75655a] transition-transform shrink-0', open ? 'rotate-180' : ''].join(' ')} />
      </button>
      {open && (
        <div className='absolute top-full left-0 right-0 mt-1.5 z-50 glass-strong rounded-xl border border-[#362c25] shadow-2xl overflow-hidden animate-slide-bottom'>
          {workspaces.length > 3 && (
            <div className='p-2 border-b border-[#261f1a]'>
              <div className='relative'>
                <Search size={11} className='absolute left-2 top-1/2 -translate-y-1/2 text-[#51443a] pointer-events-none' />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder='搜索工作区…'
                  className='w-full bg-[#0a0807] text-[11px] text-[#ece4dc] placeholder-[#51443a] pl-7 pr-2 py-1.5 rounded-md border border-[#261f1a] outline-none focus:border-[#ff9f0a]/40'
                />
              </div>
            </div>
          )}
          <div className='max-h-[280px] overflow-y-auto p-1'>
            {filteredWs.length === 0 ? (
              <div className='text-[11px] text-[#75655a] text-center py-4'>没有匹配的工作区</div>
            ) : (
              filteredWs.map(ws => (
                <div
                  key={ws.id}
                  className={[
                    'group flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer text-xs transition-colors',
                    ws.id === activeWorkspaceId
                      ? 'bg-gradient-to-r from-[#ff9f0a]/15 to-transparent text-[#ece4dc]'
                      : 'text-[#b3a294] hover:bg-[#261f1a] hover:text-[#ece4dc]'
                  ].join(' ')}
                  onClick={() => { if (!editingId) { setActiveWorkspace(ws.id); setOpen(false) } }}
                >
                  {editingId === ws.id ? (
                    <input
                      ref={inputRef}
                      value={name}
                      onChange={e => setName(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') submitRename(); if (e.key === 'Escape') { setEditingId(null); setName('') } }}
                      onClick={e => e.stopPropagation()}
                      className='flex-1 bg-[#0a0807] text-xs text-[#ece4dc] px-1.5 py-0.5 rounded border border-[#ff9f0a]/40 outline-none'
                    />
                  ) : (
                    <>
                      <Briefcase size={11} className={ws.id === activeWorkspaceId ? 'text-[#ffc66b] shrink-0' : 'shrink-0'} />
                      <span className='truncate flex-1'>{ws.name}</span>
                      <span className='text-[9px] text-[#75655a] font-mono'>{ws.stats.messageCount}</span>
                      {ws.id === activeWorkspaceId && <Check size={10} className='text-[#22c55e]' />}
                      <div className='flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity'>
                        <button
                          onClick={(e) => { e.stopPropagation(); setEditingId(ws.id); setName(ws.name) }}
                          className='p-0.5 rounded text-[#75655a] hover:text-[#ffc66b]'
                          title='重命名'
                        >
                          <Edit2 size={9} />
                        </button>
                        {workspaces.length > 1 && (
                          <button
                            onClick={(e) => { e.stopPropagation(); if (confirm('删除工作区「' + ws.name + '」?')) deleteWorkspace(ws.id) }}
                            className='p-0.5 rounded text-[#75655a] hover:text-[#ef4444]'
                            title='删除'
                          >
                            <Trash2 size={9} />
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </div>
              ))
            )}
          </div>
          <div className='border-t border-[#261f1a] p-1'>
            {creating ? (
              <div className='flex items-center gap-1.5 px-1.5 py-1'>
                <Plus size={11} className='text-[#ffc66b] shrink-0' />
                <input
                  ref={inputRef}
                  value={name}
                  onChange={e => setName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') submitCreate(); if (e.key === 'Escape') { setCreating(false); setName('') } }}
                  placeholder='工作区名称…'
                  className='flex-1 bg-[#0a0807] text-xs text-[#ece4dc] placeholder-[#51443a] px-2 py-1 rounded border border-[#362c25] outline-none focus:border-[#ff9f0a]/40'
                />
                <button onClick={submitCreate} disabled={!name.trim()} className='text-[10px] text-[#22c55e] hover:text-[#4ade80] disabled:opacity-40'>创建</button>
                <button onClick={() => { setCreating(false); setName('') }} className='text-[10px] text-[#75655a] hover:text-[#ece4dc]'>取消</button>
              </div>
            ) : (
              <button
                onClick={() => setCreating(true)}
                className='w-full flex items-center gap-2 px-2 py-1.5 text-xs text-[#75655a] hover:text-[#ffc66b] hover:bg-[#ff9f0a]/10 rounded-md transition-colors'
              >
                <Plus size={11} /> 新建工作区
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}