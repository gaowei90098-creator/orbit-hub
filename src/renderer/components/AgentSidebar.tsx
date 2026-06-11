import React, { useState, useMemo } from 'react'
import { useAgentStore, AgentState } from '../store/agents'
import { useChatStore } from '../store/chat'
import { useUIStore } from '../store/ui'
import { Plus, Search, MessageSquare, Pencil, Trash2, Check, X, Bot, Layers } from 'lucide-react'
import { StatusDot, statusLabel } from './ui/StatusDot'
import { EmptyState } from './ui/EmptyState'
import { Tooltip } from './ui/Tooltip'
import { StatsPanel } from './StatsPanel'

function AgentAvatar({ agent, size = 32 }: { agent: AgentState; size?: number }) {
  const initial = agent.name.charAt(0)
  const isOffline = agent.status === 'offline' || agent.status === 'error'
  return (
    <div
      className='relative shrink-0 rounded-xl flex items-center justify-center font-bold tracking-tight'
      style={{
        width: size,
        height: size,
        fontSize: size * 0.42,
        background: isOffline
          ? 'linear-gradient(135deg, #1a1f2e 0%, #262d3d 100%)'
          : 'linear-gradient(135deg, ' + agent.color + '25 0%, ' + agent.color + '10 100%)',
        color: isOffline ? '#5c6478' : agent.color,
        border: '1px solid ' + (isOffline ? '#262d3d' : agent.color + '30'),
        boxShadow: isOffline ? 'none' : '0 0 16px ' + agent.color + '15, inset 0 1px 0 rgba(255,255,255,0.04)'
      }}
    >
      <span style={{ textShadow: isOffline ? 'none' : '0 0 12px ' + agent.color + '80' }}>{initial}</span>
      <div className='absolute -bottom-0.5 -right-0.5 p-0.5 rounded-full bg-[#0b0d14]'>
        <StatusDot status={agent.status} size={8} withGlow />
      </div>
    </div>
  )
}

function AgentCard({ agent }: { agent: AgentState }) {
  const isOnline = agent.status !== 'offline' && agent.status !== 'error'
  return (
    <div
      className={[
        'group relative flex items-start gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer transition-all duration-200',
        'hover:bg-[#1a1f2e] hover:translate-x-0.5',
        !isOnline ? 'opacity-60' : ''
      ].join(' ')}
      title={!isOnline ? (agent.name + ' 当前离线') : undefined}
    >
      <AgentAvatar agent={agent} size={32} />
      <div className='flex-1 min-w-0'>
        <div className='flex items-center justify-between gap-1.5 mb-0.5'>
          <span className='text-xs font-semibold text-[#e2e6ef] truncate'>{agent.name}</span>
          <span className={[
            'text-[9px] font-medium shrink-0',
            agent.status === 'idle' ? 'text-[#4ade80]' :
            agent.status === 'busy' ? 'text-[#fbbf24]' :
            agent.status === 'error' ? 'text-[#f87171]' : 'text-[#5c6478]'
          ].join(' ')}>
            {statusLabel(agent.status)}
          </span>
        </div>
        {agent.capabilities.length > 0 && (
          <div className='flex gap-1 flex-wrap mt-1'>
            {agent.capabilities.slice(0, 3).map(cap => (
              <span
                key={cap}
                className='text-[9px] px-1.5 py-px rounded bg-[#1a1f2e] text-[#5c6478] border border-[#262d3d]/60 group-hover:border-[#262d3d] transition-colors'
              >
                {cap}
              </span>
            ))}
            {agent.capabilities.length > 3 && (
              <span className='text-[9px] text-[#3f4758]'>+{agent.capabilities.length - 3}</span>
            )}
          </div>
        )}
      </div>
      {isOnline && (
        <div className='absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-0 rounded-full bg-gradient-to-b from-[#6366f1] to-[#8b5cf6] group-hover:h-6 transition-all duration-200' />
      )}
    </div>
  )
}

function SessionItem({
  id, title, messageCount, isActive, onSelect, onRename, onDelete
}: {
  id: string
  title: string
  messageCount: number
  isActive: boolean
  onSelect: () => void
  onRename: (newTitle: string) => void
  onDelete: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(title)

  if (editing) {
    return (
      <div className='flex items-center gap-1 px-2 py-1.5 rounded-md bg-[#1a1f2e] ring-1 ring-[#6366f1]/40'>
        <MessageSquare size={11} className='text-[#6366f1] shrink-0' />
        <input
          autoFocus
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && draft.trim()) { onRename(draft.trim()); setEditing(false) }
            if (e.key === 'Escape') { setDraft(title); setEditing(false) }
          }}
          className='flex-1 min-w-0 bg-transparent text-[11px] text-[#e2e6ef] outline-none'
        />
        <button
          onClick={() => { if (draft.trim()) { onRename(draft.trim()); setEditing(false) } }}
          className='text-[#22c55e] hover:text-[#4ade80] p-0.5'
        >
          <Check size={11} />
        </button>
        <button
          onClick={() => { setDraft(title); setEditing(false) }}
          className='text-[#5c6478] hover:text-[#e2e6ef] p-0.5'
        >
          <X size={11} />
        </button>
      </div>
    )
  }

  return (
    <div className='group relative'>
      <button
        onClick={onSelect}
        className={[
          'w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-[11px] transition-all',
          isActive
            ? 'bg-gradient-to-r from-[#6366f1]/15 to-transparent text-[#e2e6ef] ring-1 ring-[#6366f1]/20'
            : 'text-[#a0a8ba] hover:text-[#e2e6ef] hover:bg-[#1a1f2e]'
        ].join(' ')}
      >
        <MessageSquare size={11} className={isActive ? 'text-[#a5b4fc] shrink-0' : 'shrink-0'} />
        <span className='truncate flex-1 text-left'>{title || 'New chat'}</span>
        {messageCount > 0 && (
          <span className={[
            'shrink-0 text-[9px] font-mono px-1 rounded',
            isActive ? 'bg-[#6366f1]/30 text-[#c7d2fe]' : 'bg-[#1a1f2e] text-[#5c6478]'
          ].join(' ')}>
            {messageCount}
          </span>
        )}
      </button>
      <div
        className='absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity px-0.5'
        style={{ background: isActive ? 'rgba(99,102,241,0.15)' : '#1a1f2e', borderRadius: 4 }}
      >
        <Tooltip content='重命名'>
          <button
            onClick={(e) => { e.stopPropagation(); setEditing(true) }}
            className='p-1 rounded text-[#5c6478] hover:text-[#e2e6ef]'
          >
            <Pencil size={10} />
          </button>
        </Tooltip>
        <Tooltip content='删除'>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete() }}
            className='p-1 rounded text-[#5c6478] hover:text-[#ef4444]'
          >
            <Trash2 size={10} />
          </button>
        </Tooltip>
      </div>
    </div>
  )
}

export function AgentSidebar() {
  const { agents } = useAgentStore()
  const {
    sessions, activeSession, createSession, switchSession,
    renameSession, deleteSession
  } = useChatStore()
  const { addNotification } = useUIStore()
  const [search, setSearch] = useState('')

  const onlineCount = useMemo(() => agents.filter(a => a.status === 'idle' || a.status === 'busy').length, [agents])
  const filteredSessions = useMemo(() => {
    if (!search.trim()) return sessions
    const q = search.toLowerCase()
    return sessions.filter(s => s.title.toLowerCase().includes(q))
  }, [sessions, search])

  const handleDelete = (id: string) => {
    if (sessions.length === 1) {
      addNotification('warning', '至少需要保留一个会话')
      return
    }
    deleteSession(id)
    addNotification('success', '会话已删除')
  }

  return (
    <aside className='w-60 bg-[#0a0c12]/80 border-r border-[#1a1f2e] flex flex-col shrink-0 animate-slide-left backdrop-blur-sm'>
      <div className='p-3 border-b border-[#1a1f2e]'>
        <div className='flex items-center justify-between mb-2.5'>
          <div className='flex items-center gap-1.5'>
            <Bot size={12} className='text-[#6366f1]' />
            <span className='text-[10px] font-semibold uppercase tracking-wider text-[#5c6478]'>Agents</span>
          </div>
          <div className='flex items-center gap-1'>
            <span className='text-[10px] text-[#5c6478]'>{onlineCount}/{agents.length}</span>
            <span
              className='w-1 h-1 rounded-full bg-[#22c55e] animate-pulse-dot'
              style={{ display: onlineCount > 0 ? 'block' : 'none' }}
            />
          </div>
        </div>
        <div className='space-y-0.5'>
          {agents.length === 0 ? (
            <EmptyState icon={<Bot size={18} />} title='未配置 Agent' description='在设置中添加模型 Provider' size='sm' />
          ) : (
            agents.map(agent => <AgentCard key={agent.id} agent={agent} />)
          )}
        </div>
      </div>

      <StatsPanel />

      <div className='flex-1 flex flex-col p-3 overflow-hidden'>
        <div className='flex items-center justify-between mb-2'>
          <div className='flex items-center gap-1.5'>
            <MessageSquare size={12} className='text-[#6366f1]' />
            <span className='text-[10px] font-semibold uppercase tracking-wider text-[#5c6478]'>会话</span>
            <span className='text-[10px] text-[#3f4758]'>{sessions.length}</span>
          </div>
          <Tooltip content='新建会话'>
            <button
              onClick={() => { createSession() }}
              className='p-1 rounded-md text-[#5c6478] hover:text-[#a5b4fc] hover:bg-[#6366f1]/10 transition-colors'
            >
              <Plus size={12} />
            </button>
          </Tooltip>
        </div>

        {sessions.length > 3 && (
          <div className='relative mb-2'>
            <Search size={11} className='absolute left-2 top-1/2 -translate-y-1/2 text-[#3f4758] pointer-events-none' />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder='搜索会话…'
              className='w-full bg-[#0a0c12] text-[11px] text-[#e2e6ef] placeholder-[#3f4758] pl-7 pr-2 py-1.5 rounded-md border border-[#1a1f2e] outline-none focus:border-[#6366f1]/40 transition-colors'
            />
          </div>
        )}

        <div className='flex-1 overflow-y-auto -mx-1 px-1 space-y-0.5'>
          {filteredSessions.length === 0 ? (
            search ? (
              <div className='text-[11px] text-[#5c6478] text-center py-4'>没有匹配 "{search}" 的会话</div>
            ) : null
          ) : (
            filteredSessions.map(session => (
              <SessionItem
                key={session.id}
                id={session.id}
                title={session.title}
                messageCount={session.messageCount}
                isActive={session.id === activeSession}
                onSelect={() => switchSession(session.id)}
                onRename={(t) => renameSession(session.id, t)}
                onDelete={() => handleDelete(session.id)}
              />
            ))
          )}
        </div>
      </div>

      <div className='p-3 border-t border-[#1a1f2e]'>
        <div className='flex items-center gap-1.5 text-[10px] text-[#3f4758]'>
          <Layers size={10} />
          <span>AgentHub v0.2.0</span>
          <span className='ml-auto text-[9px] text-[#3f4758]'>Ctrl+K</span>
        </div>
      </div>
    </aside>
  )
}
