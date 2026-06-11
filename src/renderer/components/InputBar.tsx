import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { useChatStore } from '../store/chat'
import { useAgentStore } from '../store/agents'
import { useUIStore } from '../store/ui'
import {
  Send, AtSign, Zap, Repeat, Loader2, Sparkles, Server, Wifi, WifiOff,
  Paperclip, Mic, Square, X, Hash, Command, ChevronUp
} from 'lucide-react'

interface SlashCommand {
  id: string
  label: string
  description: string
  icon: React.ReactNode
  action: 'mode' | 'clear' | 'thinking' | 'help'
  payload?: string
}

const SLASH_COMMANDS: SlashCommand[] = [
  { id: 'auto', label: 'auto', description: '智能分配到最合适的 Agent', icon: <Zap size={12} />, action: 'mode', payload: 'auto' },
  { id: 'broadcast', label: 'broadcast', description: '同时发给所有 Agent', icon: <Repeat size={12} />, action: 'mode', payload: 'broadcast' },
  { id: 'chain', label: 'chain', description: '链式传递,前一个输出给下一个', icon: <Sparkles size={12} />, action: 'mode', payload: 'chain' },
  { id: 'clear', label: 'clear', description: '清空当前会话的所有消息', icon: <X size={12} />, action: 'clear' },
  { id: 'thinking', label: 'thinking', description: '切换思考模式 (auto/off/enabled)', icon: <Sparkles size={12} />, action: 'thinking' },
  { id: 'help', label: 'help', description: '查看所有命令与快捷键', icon: <Command size={12} />, action: 'help' }
]

export function InputBar() {
  const [input, setInput] = useState('')
  const [showMentions, setShowMentions] = useState(false)
  const [showSlash, setShowSlash] = useState(false)
  const [mentionFilter, setMentionFilter] = useState('')
  const [slashFilter, setSlashFilter] = useState('')
  const [mentionIdx, setMentionIdx] = useState(0)
  const [slashIdx, setSlashIdx] = useState(0)
  const [cursorPos, setCursorPos] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const [attachedFiles, setAttachedFiles] = useState<{ name: string; size: number }[]>([])

  const inputRef = useRef<HTMLTextAreaElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)

  const {
    addMessage, setDispatchMode, dispatchMode, setIsProcessing, isProcessing,
    appendStreamDelta, finalizeStream, failStream, clearMessages
  } = useChatStore()
  const { agents } = useAgentStore()
  const { addNotification, thinkingOverride, setThinkingOverride } = useUIStore()

  useEffect(() => {
    if (!window.electronAPI?.hub.onStream) return
    const off = window.electronAPI.hub.onStream((event: any) => {
      if (event.kind === 'start') return
      if (event.kind === 'delta') {
        const msgs = useChatStore.getState().messages
        const last = [...msgs].reverse().find(m => m.agentId === event.agentId && (m.status === 'sending' || m.status === 'streaming'))
        if (last) appendStreamDelta(last.id, event.channel, event.text)
        return
      }
      if (event.kind === 'done') {
        const msgs = useChatStore.getState().messages
        const last = [...msgs].reverse().find(m => m.agentId === event.agentId && (m.status === 'sending' || m.status === 'streaming'))
        if (last) finalizeStream(last.id, event.content, event.summary)
      } else if (event.kind === 'error') {
        const msgs = useChatStore.getState().messages
        const last = [...msgs].reverse().find(m => m.agentId === event.agentId && (m.status === 'sending' || m.status === 'streaming'))
        if (last) failStream(last.id, event.error)
      } else {
        return
      }
      setIsProcessing(false)
    })
    return off
  }, [appendStreamDelta, finalizeStream, failStream, setIsProcessing])

  const handleInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value
    const pos = e.target.selectionStart || 0
    setInput(val)
    setCursorPos(pos)
    const before = val.slice(0, pos)

    const m = before.match(/@(\w*)$/)
    if (m) {
      setShowMentions(true)
      setMentionFilter(m[1].toLowerCase())
      setMentionIdx(0)
      setShowSlash(false)
    } else {
      setShowMentions(false)
      // Check slash at line start or after space
      const sm = before.match(/(^|\s)\/(\w*)$/)
      if (sm) {
        setShowSlash(true)
        setSlashFilter(sm[2].toLowerCase())
        setSlashIdx(0)
      } else {
        setShowSlash(false)
      }
    }
  }, [])

  const insertMention = (agentId: string) => {
    const before = input.slice(0, cursorPos)
    const at = before.lastIndexOf('@')
    setInput(input.slice(0, at) + '@' + agentId + ' ' + input.slice(cursorPos))
    setShowMentions(false)
    requestAnimationFrame(() => {
      if (inputRef.current) {
        const newPos = at + agentId.length + 2
        inputRef.current.focus()
        inputRef.current.setSelectionRange(newPos, newPos)
      }
    })
  }

  const filteredAgents = useMemo(() => {
    return agents.filter(a =>
      a.name.toLowerCase().includes(mentionFilter) ||
      a.id.toLowerCase().includes(mentionFilter)
    )
  }, [agents, mentionFilter])

  const filteredCommands = useMemo(() => {
    if (!slashFilter) return SLASH_COMMANDS
    return SLASH_COMMANDS.filter(c => c.label.toLowerCase().includes(slashFilter))
  }, [slashFilter])

  const executeSlash = (cmd: SlashCommand) => {
    setShowSlash(false)
    if (cmd.action === 'mode' && cmd.payload) {
      setDispatchMode(cmd.payload as any)
      addNotification('info', '已切换到 ' + cmd.label + ' 模式', 2000)
      setInput('')
    } else if (cmd.action === 'clear') {
      clearMessages()
      addNotification('success', '消息已清空', 2000)
      setInput('')
    } else if (cmd.action === 'thinking') {
      const next = thinkingOverride?.mode === 'off' ? 'auto' : 'off'
      setThinkingOverride({ ...(thinkingOverride || { level: 'medium' }), mode: next as any })
      addNotification('info', '思考模式: ' + next, 2000)
      setInput('')
    } else if (cmd.action === 'help') {
      addNotification('info', '可用命令: /auto /broadcast /chain /clear /thinking', 3000)
      setInput('')
    }
  }

  const handleSend = useCallback(async () => {
    const text = input.trim()
    if (!text || isProcessing) return

    const avail = agents.filter(a => a.status === 'idle' || a.status === 'busy')
    if (avail.length === 0) {
      addNotification('warning', '没有可用的 Provider。请在设置 → Providers 配置 API key。', 4000)
      return
    }

    setInput('')
    setAttachedFiles([])
    setShowMentions(false)
    setShowSlash(false)
    setIsProcessing(true)

    const m = text.match(/@(\w+)/)
    let targetAgent = m ? m[1] : undefined
    if (targetAgent && !agents.find(a => a.id === targetAgent)) {
      addNotification('error', '未找到 Agent: ' + targetAgent, 3000)
      targetAgent = undefined
    }
    const cleanText = text.replace(/@\w+\s*/g, '').trim() || text

    addMessage({ type: 'user', content: cleanText })
    const targets = targetAgent
      ? [targetAgent]
      : dispatchMode === 'broadcast'
        ? agents.map(a => a.id)
        : [agents[0]?.id].filter(Boolean)

    addNotification('info', '发送给 ' + targets.length + ' 个 Agent (' + dispatchMode + ')', 2000)

    try {
      await window.electronAPI?.hub.dispatch(cleanText, dispatchMode, targetAgent, { thinking: thinkingOverride })
    } catch (e: any) {
      const msgs = useChatStore.getState().messages
      const stuck = [...msgs].reverse().filter(m => m.agentId && m.status === 'streaming')
      for (const s of stuck) failStream(s.id, e.message || '发送失败')
      setIsProcessing(false)
      addNotification('error', '发送失败: ' + (e.message || '未知错误'), 3000)
    }
  }, [input, isProcessing, dispatchMode, agents, addMessage, addNotification, setDispatchMode, setIsProcessing, thinkingOverride, appendStreamDelta, finalizeStream, failStream, setThinkingOverride, clearMessages])

  const handleStop = useCallback(() => {
    if (!isProcessing) return
    const taskId = useChatStore.getState().currentTaskId
    if (taskId) {
      window.electronAPI?.hub.cancel(taskId).catch(() => {})
    }
    const msgs = useChatStore.getState().messages
    const stuck = [...msgs].reverse().filter(m => m.agentId && (m.status === 'streaming' || m.status === 'sending'))
    for (const s of stuck) {
      failStream(s.id, '已由用户中断')
    }
    setIsProcessing(false)
    addNotification('info', '已停止生成', 2000)
  }, [isProcessing, failStream, setIsProcessing, addNotification])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showMentions) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIdx(i => Math.min(filteredAgents.length - 1, i + 1)); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setMentionIdx(i => Math.max(0, i - 1)); return }
      if (e.key === 'Enter') { e.preventDefault(); if (filteredAgents[mentionIdx]) insertMention(filteredAgents[mentionIdx].id); return }
      if (e.key === 'Escape') { setShowMentions(false); e.preventDefault(); return }
    }
    if (showSlash) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSlashIdx(i => Math.min(filteredCommands.length - 1, i + 1)); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSlashIdx(i => Math.max(0, i - 1)); return }
      if (e.key === 'Enter') { e.preventDefault(); if (filteredCommands[slashIdx]) executeSlash(filteredCommands[slashIdx]); return }
      if (e.key === 'Escape') { setShowSlash(false); e.preventDefault(); return }
    }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      handleSend()
    } else if (e.key === 'Enter' && !e.shiftKey && !showMentions && !showSlash) {
      e.preventDefault()
      handleSend()
    }
  }

  // Auto-resize
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto'
      inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 180) + 'px'
    }
  }, [input])

  // Click outside closes popovers
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowMentions(false)
        setShowSlash(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  // Drag and drop
  const onDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true) }
  const onDragLeave = () => setIsDragging(false)
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const files = Array.from(e.dataTransfer.files).map(f => ({ name: f.name, size: f.size }))
    if (files.length > 0) {
      setAttachedFiles(prev => [...prev, ...files])
      addNotification('info', '已添加 ' + files.length + ' 个文件', 2000)
    }
  }

  const activeAgents = agents.filter(a => a.status === 'idle')
  const canSend = input.trim().length > 0 && !isProcessing

  const dispatchModeConfig: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
    auto: { label: '自动', icon: <Zap size={10} />, color: 'text-[#a5b4fc] bg-[#6366f1]/15 ring-[#6366f1]/30' },
    broadcast: { label: '广播', icon: <Repeat size={10} />, color: 'text-[#22d3ee] bg-[#06b6d4]/15 ring-[#06b6d4]/30' },
    chain: { label: '链式', icon: <Sparkles size={10} />, color: 'text-[#fbbf24] bg-[#f59e0b]/15 ring-[#f59e0b]/30' }
  }
  const mc = dispatchModeConfig[dispatchMode] || dispatchModeConfig.auto

  const cycleMode = () => {
    const modes: ('auto' | 'broadcast' | 'chain')[] = ['auto', 'broadcast', 'chain']
    const next = modes[(modes.indexOf(dispatchMode) + 1) % modes.length]
    setDispatchMode(next)
    addNotification('info', '调度模式: ' + dispatchModeConfig[next].label, 1500)
  }

  return (
    <div
      ref={wrapperRef}
      className='relative px-4 py-3'
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className='max-w-3xl mx-auto'>
        <div className='flex items-center gap-1.5 mb-2 flex-wrap'>
          <button
            onClick={cycleMode}
            className={'flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-semibold ring-1 transition-all hover:scale-105 active:scale-95 ' + mc.color}
            title='点击切换调度模式'
          >
            {mc.icon}
            {mc.label}
            <ChevronUp size={9} className='opacity-60' />
          </button>

          <span className='text-[10px] text-[#3f4758] hidden sm:inline'>Enter 发送 · Shift+Enter 换行</span>

          <div className='ml-auto flex items-center gap-2 text-[10px]'>
            {activeAgents.length === 0 ? (
              <span className='flex items-center gap-1 text-[#fbbf24]'>
                <WifiOff size={10} /> 无可用 Provider
              </span>
            ) : (
              <span className='flex items-center gap-1 text-[#4ade80]'>
                <span className='w-1.5 h-1.5 rounded-full bg-[#22c55e] animate-pulse-dot' />
                {activeAgents.length} 个 Agent 就绪
              </span>
            )}
            {isProcessing && (
              <span className='flex items-center gap-1 text-[#fbbf24]'>
                <Loader2 size={10} className='animate-spin' />
                生成中…
              </span>
            )}
          </div>
        </div>

        {attachedFiles.length > 0 && (
          <div className='flex gap-1.5 mb-2 flex-wrap'>
            {attachedFiles.map((f, i) => (
              <div key={i} className='flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-md bg-[#1a1f2e] border border-[#262d3d] text-[10px] animate-fade-in'>
                <Paperclip size={10} className='text-[#a5b4fc]' />
                <span className='text-[#e2e6ef] truncate max-w-[120px]'>{f.name}</span>
                <span className='text-[#5c6478]'>{Math.round(f.size / 1024)}KB</span>
                <button
                  onClick={() => setAttachedFiles(prev => prev.filter((_, j) => j !== i))}
                  className='p-0.5 rounded text-[#5c6478] hover:text-[#ef4444]'
                >
                  <X size={10} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className={[
          'relative flex items-end gap-2 px-3 py-2.5 rounded-2xl glass border transition-all duration-200',
          isDragging
            ? 'border-[#6366f1] bg-[#6366f1]/10 scale-[1.01] shadow-xl shadow-[#6366f1]/20'
            : 'border-[#1a1f2e] focus-within:border-[#6366f1]/50 focus-within:shadow-lg focus-within:shadow-[#6366f1]/10'
        ].join(' ')}>
          {isDragging && (
            <div className='absolute inset-0 flex items-center justify-center pointer-events-none rounded-2xl border-2 border-dashed border-[#6366f1] bg-[#6366f1]/5'>
              <div className='flex items-center gap-2 text-xs font-semibold text-[#a5b4fc]'>
                <Paperclip size={14} /> 释放以添加文件
              </div>
            </div>
          )}

          <button
            onClick={() => { setInput(p => p + '@'); requestAnimationFrame(() => inputRef.current?.focus()) }}
            className='p-1.5 rounded-md text-[#5c6478] hover:text-[#a5b4fc] hover:bg-[#6366f1]/10 transition-colors shrink-0 mb-0.5'
            title='提及 Agent (@)'
            disabled={isProcessing}
          >
            <AtSign size={15} />
          </button>

          <div className='flex-1 relative'>
            <textarea
              ref={inputRef}
              value={input}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              placeholder={isProcessing ? '正在生成中…' : '输入消息,Enter 发送,@ 提及 Agent, / 命令'}
              rows={1}
              disabled={isProcessing}
              className='w-full bg-transparent text-sm text-[#e2e6ef] placeholder-[#3f4758] resize-none outline-none leading-relaxed max-h-[180px] py-1 disabled:opacity-60'
            />

            {showMentions && filteredAgents.length > 0 && (
              <div className='absolute bottom-full left-0 right-0 mb-2 glass-strong rounded-xl border border-[#262d3d] shadow-2xl overflow-hidden animate-slide-bottom z-50'>
                <div className='px-3 py-1.5 text-[10px] text-[#5c6478] border-b border-[#1a1f2e] flex items-center gap-1'>
                  <AtSign size={10} /> 提及 Agent
                </div>
                <div className='max-h-[240px] overflow-y-auto p-1'>
                  {filteredAgents.map((agent, i) => (
                    <button
                      key={agent.id}
                      onClick={() => insertMention(agent.id)}
                      className={[
                        'w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs text-left transition-colors',
                        i === mentionIdx ? 'bg-[#6366f1]/15 text-[#e2e6ef]' : 'text-[#a0a8ba] hover:bg-[#1a1f2e]'
                      ].join(' ')}
                    >
                      <div
                        className='w-6 h-6 rounded-md flex items-center justify-center text-[10px] font-bold shrink-0'
                        style={{ background: agent.color + '20', color: agent.color, border: '1px solid ' + agent.color + '30' }}
                      >
                        {agent.name.charAt(0)}
                      </div>
                      <div className='flex-1 min-w-0'>
                        <div className='font-medium truncate'>{agent.name}</div>
                        <div className='text-[9px] text-[#5c6478] truncate'>{agent.capabilities.slice(0, 2).join(' · ')}</div>
                      </div>
                      <span className='text-[10px] text-[#3f4758] font-mono'>@{agent.id}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {showSlash && filteredCommands.length > 0 && (
              <div className='absolute bottom-full left-0 right-0 mb-2 glass-strong rounded-xl border border-[#262d3d] shadow-2xl overflow-hidden animate-slide-bottom z-50'>
                <div className='px-3 py-1.5 text-[10px] text-[#5c6478] border-b border-[#1a1f2e] flex items-center gap-1'>
                  <Hash size={10} /> 命令
                </div>
                <div className='max-h-[240px] overflow-y-auto p-1'>
                  {filteredCommands.map((cmd, i) => (
                    <button
                      key={cmd.id}
                      onClick={() => executeSlash(cmd)}
                      className={[
                        'w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs text-left transition-colors',
                        i === slashIdx ? 'bg-[#6366f1]/15 text-[#e2e6ef]' : 'text-[#a0a8ba] hover:bg-[#1a1f2e]'
                      ].join(' ')}
                    >
                      <span className={i === slashIdx ? 'text-[#a5b4fc]' : 'text-[#5c6478]'}>{cmd.icon}</span>
                      <span className='font-mono font-semibold text-[#a5b4fc]'>/{cmd.label}</span>
                      <span className='flex-1 text-[#5c6478] text-[10px] truncate'>{cmd.description}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <button
            className='p-1.5 rounded-md text-[#5c6478] hover:text-[#a0a8ba] hover:bg-[#1a1f2e] transition-colors shrink-0 mb-0.5'
            title='附件'
            disabled={isProcessing}
            onClick={() => addNotification('info', '拖放文件到输入框以添加', 2000)}
          >
            <Paperclip size={15} />
          </button>
          <button
            className='p-1.5 rounded-md text-[#5c6478] hover:text-[#a0a8ba] hover:bg-[#1a1f2e] transition-colors shrink-0 mb-0.5 hidden sm:inline-flex'
            title='语音输入 (即将推出)'
            disabled
          >
            <Mic size={15} />
          </button>

          {isProcessing ? (
            <button
              onClick={handleStop}
              className='p-2 rounded-xl bg-[#ef4444] text-white hover:bg-[#dc2626] transition-all shrink-0 active:scale-90 hover:scale-105 shadow-lg shadow-[#ef4444]/30'
              title='停止生成'
            >
              <Square size={14} fill='currentColor' />
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!canSend}
              className={[
                'p-2 rounded-xl shrink-0 transition-all',
                canSend
                  ? 'gradient-accent text-white shadow-lg shadow-[#6366f1]/30 hover:brightness-110 hover:scale-105 active:scale-90'
                  : 'bg-[#1a1f2e] text-[#3f4758] cursor-not-allowed'
              ].join(' ')}
              title='发送 (Enter)'
            >
              <Send size={14} />
            </button>
          )}
        </div>

        <div className='mt-1.5 flex items-center justify-between text-[9px] text-[#3f4758] px-1'>
          <span className='flex items-center gap-1'>
            <kbd className='kbd'>Enter</kbd> 发送
            <span className='mx-1'>·</span>
            <kbd className='kbd'>Shift</kbd>+<kbd className='kbd'>Enter</kbd> 换行
            <span className='mx-1 hidden sm:inline'>·</span>
            <span className='hidden sm:inline'><kbd className='kbd'>@</kbd> 提及 · <kbd className='kbd'>/</kbd> 命令</span>
          </span>
          <span className='text-[9px] font-mono'>{input.length} 字符</span>
        </div>
      </div>
    </div>
  )
}