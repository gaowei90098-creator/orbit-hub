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
          ? 'linear-gradient(135deg, #261f1a 0%, #362c25 100%)'
          : 'linear-gradient(135deg, ' + agent.color + '25 0%, ' + agent.color + '10 100%)',
        color: isOffline ? '#75655a' : agent.color,
        border: '1px solid ' + (isOffline ? '#362c25' : agent.color + '30'),
        boxShadow: isOffline ? 'none' : '0 0 16px ' + agent.color + '15, inset 0 1px 0 rgba(255,255,255,0.04)'
      }}
    >
      <span style={{ textShadow: isOffline ? 'none' : '0 0 12px ' + agent.color + '80' }}>{initial}</span>
      <div className='absolute -bottom-0.5 -right-0.5 p-0.5 rounded-full bg-[#120e0b]'>
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
        'hover:bg-white/[0.06] hover:translate-x-0.5',
        !isOnline ? 'opacity-60' : ''
      ].join(' ')}
      title={!isOnline ? (agent.name + ' 当前离线') : undefined}
    >
      <AgentAvatar agent={agent} size={32} />
      <div className='flex-1 min-w-0'>
        <div className='flex items-center justify-between gap-1.5 mb-0.5'>
          <span className='text-xs font-semibold text-[#ece4dc] truncate'>{agent.name}</span>
          <span className={[
            'text-[9px] font-medium shrink-0',
            agent.status === 'idle' ? 'text-[#4ade80]' :
            agent.status === 'busy' ? 'text-[#fbbf24]' :
            agent.status === 'error' ? 'text-[#f87171]' : 'text-[#75655a]'
          ].join(' ')}>
            {statusLabel(agent.status)}
          </span>
        </div>
        {agent.capabilities.length > 0 && (
          <div className='flex gap-1 flex-wrap mt-1'>
            {agent.capabilities.slice(0, 3).map(cap => (
              <span
                key={cap}
                className='text-[9px] px-1.5 py-px rounded bg-[#261f1a] text-[#75655a] border border-[#362c25]/60 group-hover:border-[#362c25] transition-colors'
              >
                {cap}
              </span>
            ))}
            {agent.capabilities.length > 3 && (
              <span className='text-[9px] text-[#51443a]'>+{agent.capabilities.length - 3}</span>
            )}
          </div>
        )}
      </div>
      {isOnline && (
        <div className='absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-0 rounded-full bg-gradient-to-b from-[#ff9f0a] to-[#ff7a3d] group-hover:h-6 transition-all duration-200' />
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
      <div className='flex items-center gap-1 px-2 py-1.5 rounded-md bg-[#261f1a] ring-1 ring-[#ff9f0a]/40'>
        <MessageSquare size={11} className='text-[#ff9f0a] shrink-0' />
        <input
          autoFocus
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && draft.trim()) { onRename(draft.trim()); setEditing(false) }
            if (e.key === 'Escape') { setDraft(title); setEditing(false) }
          }}
          className='flex-1 min-w-0 bg-transparent text-[11px] text-[#ece4dc] outline-none'
        />
        <button
          onClick={() => { if (draft.trim()) { onRename(draft.trim()); setEditing(false) } }}
          className='text-[#22c55e] hover:text-[#4ade80] p-0.5'
        >
          <Check size={11} />
        </button>
        <button
          onClick={() => { setDraft(title); setEditing(false) }}
          className='text-[#75655a] hover:text-[#ece4dc] p-0.5'
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
          'w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-[11px] transition-all',
          isActive
            ? 'pill-selected'
            : 'text-[#b3a294] hover:text-[#ece4dc] hover:bg-white/[0.06]'
        ].join(' ')}
      >
        <MessageSquare size={11} className={isActive ? 'text-white shrink-0' : 'shrink-0'} />
        <span className='truncate flex-1 text-left'>{title || 'New chat'}</span>
        {messageCount > 0 && (
          <span className={[
            'shrink-0 text-[9px] font-mono px-1 rounded',
            isActive ? 'bg-white/[0.15] text-white' : 'bg-[#261f1a] text-[#75655a]'
          ].join(' ')}>
            {messageCount}
          </span>
        )}
      </button>
      <div
        className='absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity px-0.5'
        style={{ background: isActive ? 'rgba(255,255,255,0.1)' : '#261f1a', borderRadius: 4 }}
      >
        <Tooltip content='重命名'>
          <button
            onClick={(e) => { e.stopPropagation(); setEditing(true) }}
            className='p-1 rounded text-[#75655a] hover:text-[#ece4dc]'
          >
            <Pencil size={10} />
          </button>
        </Tooltip>
        <Tooltip content='删除'>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete() }}
            className='p-1 rounded text-[#75655a] hover:text-[#ef4444]'
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
    <aside className='w-60 glass border-r border-white/[0.06] flex flex-col shrink-0 animate-slide-left'>
      <div className='p-3 border-b border-white/[0.06]'>
        <div className='flex items-center justify-between mb-2.5'>
          <div className='flex items-center gap-1.5'>
            <Bot size={12} className='text-[#ff9f0a]' />
            <span className='text-[10px] font-semibold uppercase tracking-wider text-[#75655a]'>Agents</span>
          </div>
          <div className='flex items-center gap-1'>
            <span className='text-[10px] text-[#75655a]'>{onlineCount}/{agents.length}</span>
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
            <MessageSquare size={12} className='text-[#ff9f0a]' />
            <span className='text-[10px] font-semibold uppercase tracking-wider text-[#75655a]'>会话</span>
            <span className='text-[10px] text-[#51443a]'>{sessions.length}</span>
          </div>
          <Tooltip content='新建会话'>
            <button
              onClick={() => { createSession() }}
              className='p-1 rounded-md text-[#75655a] hover:text-[#ffc66b] hover:bg-[#ff9f0a]/10 transition-colors'
            >
              <Plus size={12} />
            </button>
          </Tooltip>
        </div>

        {sessions.length > 3 && (
          <div className='relative mb-2'>
            <Search size={11} className='absolute left-2 top-1/2 -translate-y-1/2 text-[#51443a] pointer-events-none' />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder='搜索会话…'
              className='w-full bg-white/[0.05] text-[11px] text-[#ece4dc] placeholder-[#51443a] pl-7 pr-2 py-1.5 rounded-md border border-white/[0.06] outline-none focus:border-[#ff9f0a]/40 transition-colors'
            />
          </div>
        )}

        <div className='flex-1 overflow-y-auto -mx-1 px-1 space-y-0.5'>
          {filteredSessions.length === 0 ? (
            search ? (
              <div className='text-[11px] text-[#75655a] text-center py-4'>没有匹配 "{search}" 的会话</div>
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

      <div className='p-3 border-t border-white/[0.06]'>
        <div className='flex items-center gap-1.5 text-[10px] text-[#51443a]'>
          <Layers size={10} />
          <span>AgentHub v0.2.0</span>
          <span className='ml-auto text-[9px] text-[#51443a]'>Ctrl+K</span>
        </div>
      </div>
    </aside>
  )
}
