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
          'bg-[#0a0c12] hover:bg-[#1a1f2e] border',
          open ? 'border-[#6366f1]/50 shadow-md shadow-[#6366f1]/10' : 'border-[#1a1f2e] hover:border-[#262d3d]'
        ].join(' ')}
      >
        <Briefcase size={11} className='text-[#a5b4fc] shrink-0' />
        <span className='text-[11px] font-semibold text-[#e2e6ef] truncate flex-1'>{activeWs?.name || '选择工作区'}</span>
        <ChevronDown size={11} className={['text-[#5c6478] transition-transform shrink-0', open ? 'rotate-180' : ''].join(' ')} />
      </button>
      {open && (
        <div className='absolute top-full left-0 right-0 mt-1.5 z-50 glass-strong rounded-xl border border-[#262d3d] shadow-2xl overflow-hidden animate-slide-bottom'>
          {workspaces.length > 3 && (
            <div className='p-2 border-b border-[#1a1f2e]'>
              <div className='relative'>
                <Search size={11} className='absolute left-2 top-1/2 -translate-y-1/2 text-[#3f4758] pointer-events-none' />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder='搜索工作区…'
                  className='w-full bg-[#0a0c12] text-[11px] text-[#e2e6ef] placeholder-[#3f4758] pl-7 pr-2 py-1.5 rounded-md border border-[#1a1f2e] outline-none focus:border-[#6366f1]/40'
                />
              </div>
            </div>
          )}
          <div className='max-h-[280px] overflow-y-auto p-1'>
            {filteredWs.length === 0 ? (
              <div className='text-[11px] text-[#5c6478] text-center py-4'>没有匹配的工作区</div>
            ) : (
              filteredWs.map(ws => (
                <div
                  key={ws.id}
                  className={[
                    'group flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer text-xs transition-colors',
                    ws.id === activeWorkspaceId
                      ? 'bg-gradient-to-r from-[#6366f1]/15 to-transparent text-[#e2e6ef]'
                      : 'text-[#a0a8ba] hover:bg-[#1a1f2e] hover:text-[#e2e6ef]'
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
                      className='flex-1 bg-[#0a0c12] text-xs text-[#e2e6ef] px-1.5 py-0.5 rounded border border-[#6366f1]/40 outline-none'
                    />
                  ) : (
                    <>
                      <Briefcase size={11} className={ws.id === activeWorkspaceId ? 'text-[#a5b4fc] shrink-0' : 'shrink-0'} />
                      <span className='truncate flex-1'>{ws.name}</span>
                      <span className='text-[9px] text-[#5c6478] font-mono'>{ws.stats.messageCount}</span>
                      {ws.id === activeWorkspaceId && <Check size={10} className='text-[#22c55e]' />}
                      <div className='flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity'>
                        <button
                          onClick={(e) => { e.stopPropagation(); setEditingId(ws.id); setName(ws.name) }}
                          className='p-0.5 rounded text-[#5c6478] hover:text-[#a5b4fc]'
                          title='重命名'
                        >
                          <Edit2 size={9} />
                        </button>
                        {workspaces.length > 1 && (
                          <button
                            onClick={(e) => { e.stopPropagation(); if (confirm('删除工作区「' + ws.name + '」?')) deleteWorkspace(ws.id) }}
                            className='p-0.5 rounded text-[#5c6478] hover:text-[#ef4444]'
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
          <div className='border-t border-[#1a1f2e] p-1'>
            {creating ? (
              <div className='flex items-center gap-1.5 px-1.5 py-1'>
                <Plus size={11} className='text-[#a5b4fc] shrink-0' />
                <input
                  ref={inputRef}
                  value={name}
                  onChange={e => setName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') submitCreate(); if (e.key === 'Escape') { setCreating(false); setName('') } }}
                  placeholder='工作区名称…'
                  className='flex-1 bg-[#0a0c12] text-xs text-[#e2e6ef] placeholder-[#3f4758] px-2 py-1 rounded border border-[#262d3d] outline-none focus:border-[#6366f1]/40'
                />
                <button onClick={submitCreate} disabled={!name.trim()} className='text-[10px] text-[#22c55e] hover:text-[#4ade80] disabled:opacity-40'>创建</button>
                <button onClick={() => { setCreating(false); setName('') }} className='text-[10px] text-[#5c6478] hover:text-[#e2e6ef]'>取消</button>
              </div>
            ) : (
              <button
                onClick={() => setCreating(true)}
                className='w-full flex items-center gap-2 px-2 py-1.5 text-xs text-[#5c6478] hover:text-[#a5b4fc] hover:bg-[#6366f1]/10 rounded-md transition-colors'
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