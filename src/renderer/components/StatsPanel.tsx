import React from 'react'
import { useWorkspaceStore } from '../store/workspaces'
import { useChatStore } from '../store/chat'
import { useTaskStore } from '../store/tasks'
import { useAgentStore } from '../store/agents'
import { MessageSquare, CheckSquare, Activity, Cpu, BarChart3 } from 'lucide-react'

export function StatsPanel() {
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const activeId = useWorkspaceStore((s) => s.activeWorkspaceId)
  const activeWs = workspaces.find(w => w.id === activeId)
  const { sessions, activeSession, messages } = useChatStore()
  const { tasks } = useTaskStore()
  const { agents } = useAgentStore()

  if (!activeWs) return null

  const currentSession = sessions.find(s => s.id === activeSession)
  const sessionMessages = messages.length
  const completedTasks = tasks.filter(t => t.status === 'done').length
  const onlineAgents = agents.filter(a => a.status === 'idle' || a.status === 'busy').length
  const totalMessages = sessions.reduce((sum, s) => sum + s.messageCount, 0)

  const items = [
    {
      icon: MessageSquare,
      label: '消息',
      value: totalMessages,
      sub: currentSession ? '本会话 ' + sessionMessages : '',
      color: '#ff9f0a',
      gradient: 'from-[#ff9f0a]/15 to-[#ff9f0a]/0'
    },
    {
      icon: CheckSquare,
      label: '任务',
      value: completedTasks + '/' + tasks.length,
      sub: tasks.length > 0 ? Math.round((completedTasks / tasks.length) * 100) + '%' : '',
      color: '#22c55e',
      gradient: 'from-[#22c55e]/15 to-[#22c55e]/0'
    },
    {
      icon: Cpu,
      label: 'Agent',
      value: onlineAgents + '/' + agents.length,
      sub: onlineAgents > 0 ? '在线' : '离线',
      color: '#06b6d4',
      gradient: 'from-[#06b6d4]/15 to-[#06b6d4]/0'
    },
    {
      icon: Activity,
      label: '活跃',
      value: activeWs.stats.lastActive ? '活跃' : '空闲',
      sub: '',
      color: '#f59e0b',
      gradient: 'from-[#f59e0b]/15 to-[#f59e0b]/0'
    }
  ]

  return (
    <div className='px-3 py-2.5 border-b border-[#261f1a]'>
      <div className='flex items-center gap-1.5 mb-2'>
        <BarChart3 size={11} className='text-[#ff9f0a]' />
        <span className='text-[10px] font-semibold uppercase tracking-wider text-[#75655a]'>工作区统计</span>
      </div>
      <div className='grid grid-cols-2 gap-1.5'>
        {items.map((item, i) => {
          const Icon = item.icon
          return (
            <div
              key={i}
              className='group relative flex flex-col gap-0.5 px-2 py-1.5 rounded-lg bg-[#0a0807] border border-[#261f1a] overflow-hidden hover:border-[#362c25] transition-colors'
            >
              <div className={'absolute inset-0 bg-gradient-to-br ' + item.gradient + ' opacity-0 group-hover:opacity-100 transition-opacity'} />
              <div className='relative flex items-center gap-1.5'>
                <Icon size={11} style={{ color: item.color }} />
                <span className='text-[9px] text-[#75655a] uppercase tracking-wider'>{item.label}</span>
              </div>
              <div className='relative flex items-baseline gap-1'>
                <span className='text-base font-bold text-[#ece4dc] font-mono leading-none'>{item.value}</span>
                {item.sub && <span className='text-[9px] text-[#75655a]'>{item.sub}</span>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}