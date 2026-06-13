import React, { useState, useMemo } from 'react'
import { useChatStore, DispatchMode } from '../store/chat'
import { useAgentStore } from '../store/agents'
import {
  Radio, GitBranch, GitMerge, Bot, Activity, Zap, Keyboard,
  ChevronDown, Search
} from 'lucide-react'
import { StatusDot, statusLabel } from './ui/StatusDot'
import { Kbd, KbdGroup } from './ui/Kbd'
import { Tooltip } from './ui/Tooltip'
import { EmptyState } from './ui/EmptyState'

const modeConfig: Record<DispatchMode, { icon: any; label: string; desc: string; color: string; tint: string }> = {
  auto: { icon: Zap, label: '自动调度', desc: '根据关键词自动匹配最合适的 Agent', color: '#ff9f0a', tint: 'from-[#ff9f0a]/15 to-transparent' },
  broadcast: { icon: GitMerge, label: '广播模式', desc: '同时发给所有 Agent 并汇总最佳答案', color: '#06b6d4', tint: 'from-[#06b6d4]/15 to-transparent' },
  chain: { icon: GitBranch, label: '链式调度', desc: '按顺序依次处理,前一个输出给下一个', color: '#f59e0b', tint: 'from-[#f59e0b]/15 to-transparent' }
}

function Section({ icon, title, action, children, count }: { icon: React.ReactNode; title: string; action?: React.ReactNode; children: React.ReactNode; count?: number }) {
  const [open, setOpen] = useState(true)
  return (
    <div className='border-b border-[#261f1a]'>
      <button
        onClick={() => setOpen(o => !o)}
        className='w-full flex items-center gap-1.5 px-3 py-2.5 hover:bg-[#261f1a]/40 transition-colors'
      >
        <span className='text-[#ff9f0a]'>{icon}</span>
        <span className='text-[10px] font-semibold uppercase tracking-wider text-[#75655a]'>{title}</span>
        {count != null && <span className='text-[9px] text-[#51443a] bg-[#261f1a] px-1.5 rounded'>{count}</span>}
        <div className='ml-auto flex items-center gap-1.5'>
          {action}
          <ChevronDown size={11} className={['text-[#75655a] transition-transform', open ? '' : '-rotate-90'].join(' ')} />
        </div>
      </button>
      {open && <div className='px-3 pb-3'>{children}</div>}
    </div>
  )
}

export function ContextPanel() {
  const { dispatchMode, setDispatchMode, isProcessing, messages } = useChatStore()
  const { agents } = useAgentStore()

  const activeTasks = useMemo(() => messages.filter(m => m.status === 'streaming' || m.status === 'sending').length, [messages])
  const lastMessage = messages[messages.length - 1]

  return (
    <aside className='w-60 bg-[#0a0807]/80 border-l border-[#261f1a] flex flex-col shrink-0 overflow-hidden backdrop-blur-sm animate-slide-right'>
      <Section icon={<Radio size={11} />} title='调度模式'>
        <div className='space-y-1.5'>
          {(Object.entries(modeConfig) as [DispatchMode, typeof modeConfig['auto']][]).map(([mode, config]) => {
            const Icon = config.icon
            const isActive = dispatchMode === mode
            return (
              <button
                key={mode}
                disabled={isProcessing}
                onClick={() => setDispatchMode(mode)}
                className={[
                  'group relative w-full flex items-start gap-2.5 px-2.5 py-2 rounded-lg text-left transition-all border overflow-hidden',
                  isActive
                    ? 'border-transparent text-[#ece4dc]'
                    : 'border-transparent text-[#75655a] hover:text-[#ece4dc] hover:bg-[#261f1a] disabled:opacity-50',
                  isProcessing ? 'cursor-not-allowed' : 'cursor-pointer'
                ].join(' ')}
                style={isActive ? { background: 'linear-gradient(135deg, ' + config.color + '20 0%, ' + config.color + '05 100%)', borderColor: config.color + '40' } : undefined}
              >
                {isActive && (
                  <span className='absolute left-0 top-0 bottom-0 w-0.5' style={{ background: config.color }} />
                )}
                <Icon size={13} className='mt-0.5 shrink-0' style={{ color: isActive ? config.color : undefined }} />
                <div className='flex-1 min-w-0'>
                  <div className='text-xs font-semibold mb-0.5'>{config.label}</div>
                  <div className='text-[10px] text-[#75655a] leading-relaxed'>{config.desc}</div>
                </div>
              </button>
            )
          })}
        </div>
      </Section>

      <Section
        icon={<Activity size={11} />}
        title='活跃任务'
        count={activeTasks}
        action={isProcessing && <span className='flex items-center gap-1 text-[9px] text-[#fbbf24]'><span className='w-1 h-1 rounded-full bg-[#f59e0b] animate-pulse-dot' />运行中</span>}
      >
        {isProcessing ? (
          <div className='space-y-1.5'>
            <div className='flex items-center gap-2 px-2.5 py-2 rounded-lg bg-[#ff9f0a]/8 border border-[#ff9f0a]/20'>
              <div className='flex-1'>
                <div className='text-[10px] font-semibold text-[#ffc66b] mb-1'>等待响应</div>
                <div className='h-1 bg-[#261f1a] rounded-full overflow-hidden'>
                  <div className='h-full w-1/3 gradient-accent rounded-full' style={{ animation: 'progressBar 1.6s ease-in-out infinite' }} />
                </div>
              </div>
            </div>
            {lastMessage && (
              <div className='text-[9px] text-[#75655a] px-1 truncate'>
                最新: {lastMessage.agentName || lastMessage.type}
              </div>
            )}
          </div>
        ) : (
          <div className='text-[10px] text-[#75655a] text-center py-3'>暂无活跃任务</div>
        )}
      </Section>

      <Section icon={<Bot size={11} />} title='Agent 状态' count={agents.length}>
        <div className='space-y-0.5'>
          {agents.length === 0 ? (
            <EmptyState icon={<Bot size={18} />} title='没有 Agent' size='sm' />
          ) : (
            agents.map(agent => {
              const isOnline = agent.status !== 'offline' && agent.status !== 'error'
              return (
                <div
                  key={agent.id}
                  className={[
                    'group flex items-center gap-2 px-2 py-1.5 rounded-md text-[11px] transition-colors',
                    isOnline ? 'hover:bg-[#261f1a]' : 'opacity-60'
                  ].join(' ')}
                >
                  <div
                    className='w-5 h-5 rounded-md flex items-center justify-center text-[9px] font-bold shrink-0'
                    style={{
                      background: agent.color + '20',
                      color: agent.color,
                      border: '1px solid ' + agent.color + '30'
                    }}
                  >
                    {agent.name.charAt(0)}
                  </div>
                  <span className='text-[#ece4dc] flex-1 truncate'>{agent.name}</span>
                  <StatusDot status={agent.status} size={6} withGlow={agent.status === 'busy'} />
                  <span className={[
                    'text-[9px] font-medium',
                    agent.status === 'idle' ? 'text-[#4ade80]' :
                    agent.status === 'busy' ? 'text-[#fbbf24]' :
                    agent.status === 'error' ? 'text-[#f87171]' : 'text-[#75655a]'
                  ].join(' ')}>
                    {statusLabel(agent.status)}
                  </span>
                </div>
              )
            })
          )}
        </div>
      </Section>

      <Section icon={<Keyboard size={11} />} title='快捷键'>
        <div className='space-y-1.5 text-[10px]'>
          {[
            { keys: ['Enter'], label: '发送消息' },
            { keys: ['Shift', 'Enter'], label: '换行' },
            { keys: ['@'], label: '提及 Agent' },
            { keys: ['/'], label: '运行命令' },
            { keys: ['Ctrl', 'K'], label: '命令面板' },
            { keys: ['Ctrl', '\\'], label: '切换侧栏' },
            { keys: ['Ctrl', '/'], label: '切换上下文' },
            { keys: ['Esc'], label: '关闭弹窗' }
          ].map((s, i) => (
            <div key={i} className='flex items-center justify-between'>
              <span className='text-[#b3a294]'>{s.label}</span>
              <KbdGroup keys={s.keys} />
            </div>
          ))}
        </div>
      </Section>
    </aside>
  )
}