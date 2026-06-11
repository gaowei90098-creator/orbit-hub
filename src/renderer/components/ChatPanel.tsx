import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react'
import { useChatStore, ChatMessage } from '../store/chat'
import { useAgentStore } from '../store/agents'
import { useUIStore } from '../store/ui'
import {
  Bot, User, AlertCircle, Loader2, Copy, RotateCcw, Trash2, ChevronRight,
  Check, Sparkles, Code2, FileSearch, Languages, GitBranch, ArrowDown,
  ChevronDown, Brain
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { StatusDot, statusLabel } from './ui/StatusDot'
import { Tooltip } from './ui/Tooltip'
import { EmptyState } from './ui/EmptyState'

function timeAgo(date: Date): string {
  const diff = Date.now() - new Date(date).getTime()
  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前'
  if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前'
  if (diff < 7 * 86400000) return Math.floor(diff / 86400000) + ' 天前'
  return new Date(date).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

function formatTime(date: Date): string {
  return new Date(date).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const onClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    }).catch(() => {})
  }
  return (
    <Tooltip content={copied ? '已复制' : '复制代码'}>
      <button
        onClick={onClick}
        className='p-1 rounded text-[#5c6478] hover:text-[#e2e6ef] hover:bg-[#262d3d] transition-colors'
        aria-label='Copy code'
      >
        {copied ? <Check size={11} /> : <Copy size={11} />}
      </button>
    </Tooltip>
  )
}

function ThinkingBlock({ content, summary, defaultOpen = false }: { content: string; summary?: { preview?: string; durationMs?: number; level?: string }; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className='thinking-block my-2 cursor-pointer select-none' onClick={() => setOpen(o => !o)}>
      <div className='flex items-center gap-1.5'>
        <Brain size={11} className='text-[#f59e0b]' />
        <span className='thinking-label'>思考过程</span>
        {summary?.level && <span className='text-[9px] text-[#5c6478] uppercase tracking-wider'>{summary.level}</span>}
        {summary?.durationMs != null && <span className='text-[9px] text-[#5c6478]'>· {(summary.durationMs / 1000).toFixed(1)}s</span>}
        <ChevronDown size={10} className={['ml-auto text-[#5c6478] transition-transform', open ? 'rotate-180' : ''].join(' ')} />
      </div>
      {open && (
        <div className='mt-1 text-xs text-[#a0a8ba] whitespace-pre-wrap leading-relaxed'>
          {summary?.preview && !content ? summary.preview : content}
        </div>
      )}
    </div>
  )
}

function CodeBlock({ className, children, ...props }: any) {
  const code = String(Array.isArray(children) ? children.join('') : children).replace(/\n$/, '')
  const lang = (className || '').replace('language-', '') || 'text'
  return (
    <div className='relative group/code my-2 rounded-lg overflow-hidden border border-[#1a1f2e] shadow-sm'>
      <div className='flex items-center justify-between px-3 py-1.5 bg-gradient-to-b from-[#1a1f2e] to-[#0f1117] border-b border-[#1a1f2e]'>
        <span className='flex items-center gap-1.5 text-[10px] text-[#5c6478] font-mono'>
          <Code2 size={10} />
          {lang}
        </span>
        <CopyButton text={code} />
      </div>
      <pre className='!mt-0 !rounded-t-none !border-0 overflow-x-auto'>
        <code className={className} {...props}>{children}</code>
      </pre>
    </div>
  )
}

function AgentAvatar({ agent, size = 28, streaming = false }: { agent: any; size?: number; streaming?: boolean }) {
  const initial = (agent?.name || '?').charAt(0)
  const color = agent?.color || '#6366f1'
  return (
    <div className='relative shrink-0'>
      <div
        className='rounded-xl flex items-center justify-center font-bold transition-all'
        style={{
          width: size,
          height: size,
          fontSize: size * 0.42,
          background: 'linear-gradient(135deg, ' + color + '25 0%, ' + color + '10 100%)',
          color,
          border: '1px solid ' + color + '30',
          boxShadow: streaming ? ('0 0 16px ' + color + '40') : ('0 0 8px ' + color + '15')
        }}
      >
        {initial}
      </div>
      {streaming && (
        <span
          className='absolute inset-0 rounded-xl animate-pulse-glow pointer-events-none'
          style={{ color }}
        />
      )}
    </div>
  )
}

function MessageActions({ message, onCopy, onResend, onDelete }: { message: ChatMessage; onCopy: () => void; onResend?: () => void; onDelete: () => void }) {
  return (
    <div className='flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity'>
      <Tooltip content='复制'>
        <button onClick={onCopy} className='p-1 rounded text-[#5c6478] hover:text-[#e2e6ef] hover:bg-[#1a1f2e] transition-colors'>
          <Copy size={11} />
        </button>
      </Tooltip>
      {onResend && (
        <Tooltip content='重新发送'>
          <button onClick={onResend} className='p-1 rounded text-[#5c6478] hover:text-[#a5b4fc] hover:bg-[#6366f1]/10 transition-colors'>
            <RotateCcw size={11} />
          </button>
        </Tooltip>
      )}
      <Tooltip content='删除'>
        <button onClick={onDelete} className='p-1 rounded text-[#5c6478] hover:text-[#ef4444] hover:bg-[#ef4444]/10 transition-colors'>
          <Trash2 size={11} />
        </button>
      </Tooltip>
    </div>
  )
}

interface MessageBubbleProps {
  message: ChatMessage
  showHeader: boolean
  onCopy: () => void
  onResend?: () => void
  onDelete: () => void
}

function MessageBubble({ message, showHeader, onCopy, onResend, onDelete }: MessageBubbleProps) {
  const isUser = message.type === 'user'
  const isSystem = message.type === 'system'
  const isError = message.type === 'error'
  const isStreaming = message.status === 'streaming' || message.status === 'sending'
  const agent = useAgentStore.getState().getAgent(message.agentId || '')

  const displayContent = isStreaming && message.streamingContent != null
    ? message.streamingContent
    : message.content

  if (isSystem) {
    return (
      <div className='flex justify-center py-2 animate-fade-only'>
        <span className='text-[10px] text-[#5c6478] bg-[#1a1f2e]/50 backdrop-blur-sm px-2.5 py-1 rounded-full border border-[#262d3d]/50'>
          {message.content}
        </span>
      </div>
    )
  }

  if (isUser) {
    return (
      <div className='group flex gap-2.5 px-4 py-2 animate-fade-in flex-row-reverse'>
        <div className='shrink-0 mt-0.5'>
          <div className='w-7 h-7 rounded-xl flex items-center justify-center bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] shadow-md shadow-[#6366f1]/20'>
            <User size={14} className='text-white' />
          </div>
        </div>
        <div className='flex flex-col items-end max-w-[80%]'>
          {showHeader && (
            <div className='flex items-center gap-2 mb-1'>
              <span className='text-[11px] font-medium text-[#a0a8ba]'>你</span>
              <span className='text-[9px] text-[#3f4758]' title={formatTime(message.timestamp)}>
                {timeAgo(message.timestamp)}
              </span>
            </div>
          )}
          <div className='relative'>
            <div
              className='px-3.5 py-2 rounded-2xl rounded-tr-md text-sm text-white leading-relaxed whitespace-pre-wrap break-words max-w-full'
              style={{
                background: 'linear-gradient(135deg, #6366f1 0%, #7c3aed 100%)',
                boxShadow: '0 4px 12px -2px rgba(99, 102, 241, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.1)'
              }}
            >
              {displayContent}
              {isStreaming && <span className='inline-block w-1.5 h-3.5 ml-1 bg-white/80 align-middle animate-cursor' />}
            </div>
            <div className='absolute -top-2 -right-2'>
              <MessageActions message={message} onCopy={onCopy} onResend={onResend} onDelete={onDelete} />
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className='group flex gap-2.5 px-4 py-2 animate-fade-in'>
      {showHeader ? (
        <AgentAvatar agent={agent} streaming={isStreaming} />
      ) : (
        <div className='w-7 shrink-0' />
      )}
      <div className='flex-1 min-w-0 max-w-[90%]'>
        {showHeader && (
          <div className='flex items-center gap-2 mb-1'>
            <span className='text-[11px] font-semibold text-[#e2e6ef]'>{message.agentName || (isError ? '错误' : 'Agent')}</span>
            {agent && (
              <span className='flex items-center gap-1 text-[9px] text-[#5c6478]'>
                <StatusDot status={agent.status} size={6} />
                {statusLabel(agent.status)}
              </span>
            )}
            <span className='text-[9px] text-[#3f4758]' title={formatTime(message.timestamp)}>
              {timeAgo(message.timestamp)}
            </span>
            {isStreaming && (
              <span className='flex items-center gap-1 text-[9px] text-[#a5b4fc]'>
                <span className='w-1 h-1 rounded-full bg-[#6366f1] animate-pulse-dot' />
                正在输入
              </span>
            )}
            <div className='ml-auto'>
              <MessageActions message={message} onCopy={onCopy} onResend={onResend} onDelete={onDelete} />
            </div>
          </div>
        )}

        {(message.thinkingContent || message.thinking) && (
          <ThinkingBlock
            content={message.thinkingContent || ''}
            summary={message.thinking}
            defaultOpen={!message.thinking?.preview}
          />
        )}

        {isError ? (
          <div className='flex items-start gap-2 px-3 py-2 rounded-lg bg-[#ef4444]/10 border border-[#ef4444]/30'>
            <AlertCircle size={14} className='text-[#ef4444] shrink-0 mt-0.5' />
            <span className='text-xs text-[#fca5a5]'>{displayContent}</span>
          </div>
        ) : (
          <div className={'prose-chat ' + (isStreaming ? 'animate-fade-only' : '')}>
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                code({ className, children, ...props }: any) {
                  const isInline = !className
                  if (isInline) return <code className='inline-code' {...props}>{children}</code>
                  return <CodeBlock className={className} {...props}>{children}</CodeBlock>
                },
                p({ children }: any) { return <p>{children}</p> },
                ul({ children }: any) { return <ul>{children}</ul> },
                ol({ children }: any) { return <ol>{children}</ol> },
                a({ href, children }: any) { return <a href={href} target='_blank' rel='noopener noreferrer'>{children}</a> }
              }}
            >
              {displayContent || (isStreaming ? '' : '(空响应)')}
            </ReactMarkdown>
            {isStreaming && (
              <span className='inline-flex items-center gap-1 ml-0.5 align-middle'>
                <span className='w-1.5 h-3.5 bg-[#6366f1] animate-cursor' />
                <span className='thinking-wave ml-1'>
                  <span /><span /><span />
                </span>
              </span>
            )}
          </div>
        )}

        {!showHeader && (
          <div className='opacity-0 group-hover:opacity-100 transition-opacity mt-0.5'>
            <MessageActions message={message} onCopy={onCopy} onResend={onResend} onDelete={onDelete} />
          </div>
        )}
      </div>
    </div>
  )
}

function WelcomeFeature({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className='group flex flex-col items-start p-3 rounded-xl bg-gradient-to-br from-[#1a1f2e] to-[#0f1117] border border-[#262d3d] hover:border-[#6366f1]/40 text-left transition-all hover:-translate-y-0.5 hover:shadow-lg hover:shadow-[#6366f1]/10'>
      <div className='flex items-center gap-1.5 mb-1.5'>
        <span className='text-[#a5b4fc] group-hover:text-[#c7d2fe] transition-colors'>{icon}</span>
        <span className='text-xs font-semibold text-[#e2e6ef]'>{title}</span>
        <ChevronRight size={11} className='ml-auto text-[#3f4758] group-hover:text-[#a5b4fc] group-hover:translate-x-0.5 transition-all' />
      </div>
      <span className='text-[10px] text-[#5c6478] leading-relaxed'>{desc}</span>
    </div>
  )
}

export function ChatPanel() {
  const { messages, isProcessing, deleteMessage, resendMessage } = useChatStore()
  const { addNotification } = useUIStore()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, autoScroll])

  const onScroll = useCallback(() => {
    if (!scrollRef.current) return
    const el = scrollRef.current
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    setAutoScroll(atBottom)
  }, [])

  const scrollToBottom = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
      setAutoScroll(true)
    }
  }

  const handleCopy = (msg: ChatMessage) => {
    const text = msg.streamingContent != null ? msg.streamingContent : msg.content
    navigator.clipboard.writeText(text).then(() => {
      addNotification('success', '已复制到剪贴板', 2000)
    }).catch(() => {
      addNotification('error', '复制失败', 2000)
    })
  }

  const handleResend = (msg: ChatMessage) => {
    const newId = resendMessage(msg.id)
    if (newId) addNotification('info', '已重新发送', 2000)
  }

  const handleDelete = (msg: ChatMessage) => {
    deleteMessage(msg.id)
  }

  const suggestions = [
    { icon: <Code2 size={12} />, title: '代码开发', desc: '让 Codex 帮你写代码、debug、重构' },
    { icon: <FileSearch size={12} />, title: '分析写作', desc: '让 Claude 分析数据、写文档' },
    { icon: <GitBranch size={12} />, title: '自动部署', desc: '让 OpenClaw 运行部署任务' },
    { icon: <Languages size={12} />, title: '系统管理', desc: '让 Hermes 管理系统配置' }
  ]

  if (messages.length === 0) {
    return (
      <div className='flex-1 flex items-center justify-center overflow-y-auto'>
        <div className='text-center max-w-2xl w-full px-6 py-8'>
          <div className='relative inline-block mb-5'>
            <div className='absolute inset-0 bg-[#6366f1]/20 blur-2xl rounded-full animate-pulse-dot' />
            <div className='relative w-16 h-16 rounded-2xl gradient-accent flex items-center justify-center mx-auto shadow-2xl shadow-[#6366f1]/40 animate-bounce-in'>
              <Sparkles size={28} className='text-white' />
            </div>
          </div>
          <h2 className='text-lg font-bold text-[#e2e6ef] mb-1.5 tracking-tight'>欢迎使用 AgentHub</h2>
          <p className='text-xs text-[#5c6478] leading-relaxed mb-6 max-w-md mx-auto'>
            多 Agent 协同工作台。在下方输入消息，<kbd className='kbd mx-0.5'>@agent</kbd> 指定 Agent，或 <kbd className='kbd mx-0.5'>/broadcast</kbd> 开启广播模式。
          </p>
          <div className='grid grid-cols-2 gap-2.5 max-w-lg mx-auto'>
            {suggestions.map((s, i) => (
              <div key={i} className='animate-slide-bottom' style={{ animationDelay: (i * 60) + 'ms' }}>
                <WelcomeFeature icon={s.icon} title={s.title} desc={s.desc} />
              </div>
            ))}
          </div>
          <div className='mt-6 flex items-center justify-center gap-3 text-[10px] text-[#3f4758]'>
            <span className='flex items-center gap-1'><kbd className='kbd'>Ctrl</kbd> + <kbd className='kbd'>Enter</kbd> 发送</span>
            <span className='w-1 h-1 rounded-full bg-[#3f4758]' />
            <span className='flex items-center gap-1'><kbd className='kbd'>@</kbd> 提及 Agent</span>
            <span className='w-1 h-1 rounded-full bg-[#3f4758]' />
            <span className='flex items-center gap-1'><kbd className='kbd'>/</kbd> 命令</span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className='flex-1 flex flex-col min-h-0 relative'>
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className='flex-1 overflow-y-auto py-3'
      >
        <div className='max-w-3xl mx-auto'>
          {messages.map((msg, idx) => {
            const prev = messages[idx - 1]
            const showHeader = !prev ||
              prev.type !== msg.type ||
              prev.agentId !== msg.agentId ||
              (msg.timestamp.getTime() - prev.timestamp.getTime() > 5 * 60000)
            return (
              <MessageBubble
                key={msg.id}
                message={msg}
                showHeader={showHeader}
                onCopy={() => handleCopy(msg)}
                onResend={msg.type === 'user' ? () => handleResend(msg) : undefined}
                onDelete={() => handleDelete(msg)}
              />
            )
          })}
          {isProcessing && messages[messages.length - 1]?.status !== 'streaming' && (
            <div className='flex gap-2.5 px-4 py-2 animate-fade-in'>
              <div className='w-7 h-7 rounded-xl bg-[#6366f1]/15 flex items-center justify-center border border-[#6366f1]/30'>
                <Loader2 size={14} className='animate-spin text-[#a5b4fc]' />
              </div>
              <div className='flex items-center gap-2 px-2 py-1'>
                <span className='text-[11px] text-[#5c6478]'>Agent 正在思考</span>
                <span className='thinking-wave'>
                  <span /><span /><span />
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
      {!autoScroll && (
        <button
          onClick={scrollToBottom}
          className='absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1 px-2.5 py-1.5 rounded-full glass-strong border border-[#262d3d] text-[11px] text-[#e2e6ef] shadow-lg hover:bg-[#1a1f2e] animate-slide-bottom z-10'
        >
          <ArrowDown size={11} /> 跳到底部
        </button>
      )}
    </div>
  )
}
