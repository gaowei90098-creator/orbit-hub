import React, { useEffect, useState, useMemo } from 'react'
import { AgentSidebar } from './components/AgentSidebar'
import { ChatPanel } from './components/ChatPanel'
import { ContextPanel } from './components/ContextPanel'
import { InputBar } from './components/InputBar'
import { ToastContainer } from './components/ui/Toast'
import { OnboardingOverlay } from './pages/Onboarding'
import { SettingsModal } from './pages/Settings'
import { WorkspaceSelector } from './components/WorkspaceSelector'
import { TaskBoard } from './components/TaskBoard'
import { IconButton } from './components/ui/IconButton'
import { CommandPalette, CommandItem } from './components/ui/CommandPalette'
import { KbdGroup } from './components/ui/Kbd'
import { useAgentStore } from './store/agents'
import { useUIStore } from './store/ui'
import { useChatStore } from './store/chat'
import { useTaskStore } from './store/tasks'
import { useWorkspaceStore } from './store/workspaces'
import {
  Keyboard, PanelLeft, PanelRight, Settings, Zap, MessageSquare, Columns,
  Plus, Search, X
} from 'lucide-react'

export default function App() {
  const {
    sidebarOpen, contextPanelOpen, toggleSidebar, toggleContextPanel,
    onboardingDone, setOnboardingDone, settingsOpen, setSettingsOpen,
    commandPaletteOpen, setCommandPaletteOpen
  } = useUIStore()
  const { setAgents } = useAgentStore()
  const { clearMessages, createSession } = useChatStore()
  const { addTask, updateTask, updateTaskStatus, deleteTask, tasks } = useTaskStore()
  const { workspaces, activeWorkspaceId } = useWorkspaceStore()

  const [hubStatus, setHubStatus] = useState<any>(null)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [activeView, setActiveView] = useState<'chat' | 'tasks'>('chat')

  useEffect(() => {
    window.electronAPI?.hub.getStatus().then((status: any) => {
      setHubStatus(status)
      if (status?.agents) setAgents(status.agents)
    }).catch(() => {})

    useTaskStore.getState().loadTasks()
    window.electronAPI?.store.get('onboardingDone').then((done: any) => {
      if (!done) setShowOnboarding(true)
    }).catch(() => setShowOnboarding(true))
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setCommandPaletteOpen(!commandPaletteOpen)
      } else if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
        e.preventDefault()
        toggleSidebar()
      } else if ((e.metaKey || e.ctrlKey) && e.key === '/') {
        e.preventDefault()
        toggleContextPanel()
      } else if (e.key === 'Escape' && commandPaletteOpen) {
        setCommandPaletteOpen(false)
      } else if (e.key === '?' && e.shiftKey) {
        e.preventDefault()
        setCommandPaletteOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [commandPaletteOpen, setCommandPaletteOpen, toggleSidebar, toggleContextPanel])

  useEffect(() => {
    if (!window.electronAPI?.app?.onDeepLink) return
    const off = window.electronAPI.app.onDeepLink((link) => {
      if (link.action === 'tasks' || link.action === 'board') {
        setActiveView('tasks')
      } else if (link.action === 'chat' || link.action === 'open') {
        setActiveView('chat')
        if (link.params.agent) {
          window.dispatchEvent(new CustomEvent('agenthub:focus-agent', { detail: link.params.agent }))
        }
        if (link.params.workspace) {
          window.dispatchEvent(new CustomEvent('agenthub:focus-workspace', { detail: link.params.workspace }))
        }
      } else if (link.action === 'settings') {
        setSettingsOpen(true)
      }
    })
    return off
  }, [setSettingsOpen])

  const handleOnboardingComplete = () => {
    setShowOnboarding(false)
    setOnboardingDone(true)
    window.electronAPI?.store.set('onboardingDone', true)
  }

  const activeWs = workspaces.find(w => w.id === activeWorkspaceId)
  const isHubOnline = hubStatus?.running

  const commands: CommandItem[] = useMemo(() => [
    { id: 'view.chat', label: '切换到对话视图', icon: <MessageSquare size={14} />, group: '视图', action: () => setActiveView('chat') },
    { id: 'view.tasks', label: '切换到任务看板', icon: <Columns size={14} />, group: '视图', action: () => setActiveView('tasks') },
    { id: 'view.sidebar', label: sidebarOpen ? '隐藏 Agent 侧栏' : '显示 Agent 侧栏', icon: <PanelLeft size={14} />, group: '视图', action: toggleSidebar },
    { id: 'view.context', label: contextPanelOpen ? '隐藏上下文面板' : '显示上下文面板', icon: <PanelRight size={14} />, group: '视图', action: toggleContextPanel },
    { id: 'session.new', label: '新建会话', icon: <Plus size={14} />, group: '会话', action: () => createSession() },
    { id: 'session.clear', label: '清空当前消息', icon: <X size={14} />, group: '会话', action: () => clearMessages() },
    { id: 'task.new', label: '新建任务', icon: <Plus size={14} />, group: '任务', action: () => setActiveView('tasks') },
    { id: 'open.settings', label: '打开设置', icon: <Settings size={14} />, group: '系统', action: () => setSettingsOpen(true) }
  ], [sidebarOpen, contextPanelOpen, createSession, clearMessages, setSettingsOpen, setActiveView, toggleSidebar, toggleContextPanel])

  return (
    <div className='relative flex h-screen flex-col bg-[#0b0d14] text-white select-none bg-noise bg-aurora-soft'>
      <header className='relative z-30 flex items-center justify-between h-12 px-3 glass-strong border-b border-[#1a1f2e] shrink-0'>
        <div className='flex items-center gap-3'>
          <div className='flex items-center gap-2 pr-3 border-r border-[#1a1f2e]'>
            <div className='relative w-7 h-7 rounded-lg gradient-accent flex items-center justify-center shadow-lg shadow-[#6366f1]/30'>
              <Zap size={15} className='text-white' fill='currentColor' />
              <span className='absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-[#22c55e] border-2 border-[#0a0c12] animate-pulse-dot' />
            </div>
            <div className='flex flex-col leading-none'>
              <span className='text-[13px] font-bold text-[#e2e6ef] tracking-tight'>AgentHub</span>
              <span className='text-[9px] text-[#5c6478] font-medium mt-0.5'>v0.2.0 · 多 Agent 协同</span>
            </div>
          </div>

          {activeWs && (
            <div className='w-44'><WorkspaceSelector /></div>
          )}

          {hubStatus && (
            <div className={[
              'flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-medium',
              isHubOnline ? 'bg-[#22c55e]/10 text-[#4ade80]' : 'bg-[#ef4444]/10 text-[#f87171]'
            ].join(' ')}>
              <span className={['w-1.5 h-1.5 rounded-full', isHubOnline ? 'bg-[#22c55e] animate-pulse-glow' : 'bg-[#ef4444]'].join(' ')} />
              {isHubOnline ? 'Hub 已连接' : 'Hub 离线'}
            </div>
          )}

          <nav className='flex items-center gap-0.5 ml-2 p-0.5 rounded-lg bg-[#0a0c12] border border-[#1a1f2e]'>
            <button
              onClick={() => setActiveView('chat')}
              className={[
                'flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-all',
                activeView === 'chat'
                  ? 'bg-[#6366f1]/15 text-[#a5b4fc] shadow-sm'
                  : 'text-[#5c6478] hover:text-[#e2e6ef] hover:bg-[#1a1f2e]'
              ].join(' ')}
            >
              <MessageSquare size={11} />
              对话
            </button>
            <button
              onClick={() => setActiveView('tasks')}
              className={[
                'flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-all',
                activeView === 'tasks'
                  ? 'bg-[#6366f1]/15 text-[#a5b4fc] shadow-sm'
                  : 'text-[#5c6478] hover:text-[#e2e6ef] hover:bg-[#1a1f2e]'
              ].join(' ')}
            >
              <Columns size={11} />
              任务
              {tasks.length > 0 && <span className='ml-0.5 px-1 rounded bg-[#6366f1]/30 text-[9px] font-mono'>{tasks.length}</span>}
            </button>
          </nav>
        </div>

        <div className='flex items-center gap-1.5'>
          <button
            onClick={() => setCommandPaletteOpen(true)}
            className='flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-[#0a0c12] hover:bg-[#1a1f2e] border border-[#1a1f2e] text-[11px] text-[#5c6478] hover:text-[#a0a8ba] transition-all group'
            title='命令面板 (Ctrl+K)'
          >
            <Search size={12} />
            <span>搜索或运行命令…</span>
            <KbdGroup keys={['Ctrl', 'K']} />
          </button>

          <div className='w-px h-5 bg-[#1a1f2e] mx-0.5' />

          <IconButton
            icon={<PanelLeft size={15} />}
            tooltip={sidebarOpen ? '隐藏侧栏' : '显示侧栏'}
            active={sidebarOpen}
            onClick={toggleSidebar}
            variant='ghost'
          />
          <IconButton
            icon={<PanelRight size={15} />}
            tooltip={contextPanelOpen ? '隐藏上下文' : '显示上下文'}
            active={contextPanelOpen}
            onClick={toggleContextPanel}
            variant='ghost'
          />
          <IconButton
            icon={<Keyboard size={15} />}
            tooltip='快捷键'
            onClick={() => setCommandPaletteOpen(true)}
            variant='ghost'
          />
          <IconButton
            icon={<Settings size={15} />}
            tooltip='设置'
            onClick={() => setSettingsOpen(!settingsOpen)}
            variant='ghost'
          />
        </div>
      </header>

      <div className='flex flex-1 overflow-hidden relative z-10'>
        {sidebarOpen && <AgentSidebar />}
        <div className='flex-1 flex flex-col min-w-0 relative' key={activeView}>
          <div className='animate-fade-only flex-1 flex flex-col min-h-0'>
          {activeView === 'tasks' ? (
            <TaskBoard
              tasks={tasks}
              onAddTask={() => { addTask({ title: '新任务', description: '', status: 'todo', priority: 'medium', tags: [] }) }}
              onAddTaskWithData={(data) => addTask(data)}
              onUpdateTask={(task) => updateTask(task)}
              onStatusChange={(id, status) => updateTaskStatus(id, status)}
              onDeleteTask={(id) => deleteTask(id)}
            />
          ) : (
            <>
              <ChatPanel />
              <InputBar />
            </>
          )}
          </div>
        </div>
        {contextPanelOpen && <ContextPanel />}
      </div>

      <CommandPalette
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        commands={commands}
      />

      <ToastContainer />
      {showOnboarding && <OnboardingOverlay onComplete={handleOnboardingComplete} />}
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}
