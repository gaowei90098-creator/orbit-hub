import React, { useState, useEffect } from 'react'
import { Zap, Check, ArrowRight, ArrowLeft, GitBranch, Repeat, Sparkles, Bot, Keyboard, Wand2, X } from 'lucide-react'
import { Kbd, KbdGroup } from '../components/ui/Kbd'

const steps = [
  {
    title: '欢迎使用 AgentHub',
    subtitle: '多 Agent 协同桌面工作台',
    content: (
      <div className='text-center py-2'>
        <div className='relative inline-block mb-5'>
          <div className='absolute inset-0 bg-[#ff9f0a]/30 blur-2xl rounded-full animate-pulse-dot' />
          <div className='relative w-20 h-20 rounded-2xl gradient-accent flex items-center justify-center mx-auto shadow-2xl shadow-[#ff9f0a]/40 animate-bounce-in'>
            <Zap size={36} className='text-white' fill='currentColor' />
          </div>
        </div>
        <p className='text-sm text-[#b3a294] leading-relaxed'>
          AgentHub 让多个 AI Agent 在同一工作台中协同工作。<br />
          像管理一个团队一样管理你的 Agent。
        </p>
      </div>
    )
  },
  {
    title: '认识你的 Agent',
    subtitle: '4 个预置 Agent,各有所长',
    content: (
      <div className='space-y-2'>
        {[
          { name: 'Codex CLI', color: '#22c55e', desc: '代码开发、调试、重构', glow: 'agent-glow-codex' },
          { name: 'Claude Code', color: '#8b5cf6', desc: '分析、写作、翻译、研究', glow: 'agent-glow-claude' },
          { name: 'OpenClaw', color: '#06b6d4', desc: '自动化、部署、脚本', glow: 'agent-glow-openclaw' },
          { name: 'Hermes', color: '#f59e0b', desc: '工具调用、系统管理', glow: 'agent-glow-hermes' }
        ].map((agent, i) => (
          <div
            key={agent.name}
            className={'flex items-center gap-3 px-3 py-2.5 rounded-lg bg-[#0f0b09] border border-[#362c25] hover:border-[#51443a] transition-all hover:-translate-x-0.5 animate-slide-right ' + agent.glow}
            style={{ animationDelay: (i * 80) + 'ms' }}
          >
            <div
              className='w-9 h-9 rounded-lg flex items-center justify-center text-sm font-bold shrink-0'
              style={{
                background: 'linear-gradient(135deg, ' + agent.color + '25 0%, ' + agent.color + '10 100%)',
                color: agent.color,
                border: '1px solid ' + agent.color + '30'
              }}
            >
              {agent.name.charAt(0)}
            </div>
            <div className='flex-1 min-w-0'>
              <div className='text-sm font-semibold text-[#ece4dc]'>{agent.name}</div>
              <div className='text-[10px] text-[#75665a]'>{agent.desc}</div>
            </div>
            <span className='text-[9px] text-[#51443a] font-mono shrink-0'>ready</span>
          </div>
        ))}
      </div>
    )
  },
  {
    title: '三种调度模式',
    subtitle: '按需分配任务给 Agent',
    content: (
      <div className='space-y-2'>
        {[
          { mode: 'auto', name: '自动调度', desc: '根据关键词自动匹配最合适的 Agent', icon: Zap, color: '#ff9f0a' },
          { mode: 'broadcast', name: '广播模式', desc: '同时发给所有 Agent,汇总最佳答案', icon: Repeat, color: '#06b6d4' },
          { mode: 'chain', name: '链式调度', desc: '按顺序依次处理,前一个输出给下一个', icon: GitBranch, color: '#f59e0b' }
        ].map((m, i) => {
          const Icon = m.icon
          return (
            <div
              key={m.mode}
              className='flex items-start gap-3 px-3 py-2.5 rounded-lg bg-[#0f0b09] border border-[#362c25] hover:border-[#51443a] transition-all hover:-translate-x-0.5 animate-slide-right'
              style={{ animationDelay: (i * 80) + 'ms' }}
            >
              <div
                className='w-9 h-9 rounded-lg flex items-center justify-center shrink-0'
                style={{
                  background: 'linear-gradient(135deg, ' + m.color + '25 0%, ' + m.color + '10 100%)',
                  border: '1px solid ' + m.color + '30',
                  boxShadow: '0 0 12px ' + m.color + '20'
                }}
              >
                <Icon size={16} style={{ color: m.color }} />
              </div>
              <div className='flex-1 min-w-0'>
                <div className='text-sm font-semibold text-[#ece4dc]'>{m.name}</div>
                <div className='text-[10px] text-[#75665a] leading-relaxed'>{m.desc}</div>
              </div>
            </div>
          )
        })}
      </div>
    )
  },
  {
    title: '键盘快捷键',
    subtitle: '让工作流飞起来',
    content: (
      <div className='space-y-2.5'>
        {[
          { keys: ['Enter'], label: '发送消息' },
          { keys: ['Shift', 'Enter'], label: '换行' },
          { keys: ['@'], label: '提及 Agent' },
          { keys: ['/'], label: '运行命令' },
          { keys: ['Ctrl', 'K'], label: '打开命令面板' },
          { keys: ['Ctrl', '\\'], label: '切换侧栏' },
          { keys: ['Esc'], label: '关闭弹窗' }
        ].map((s, i) => (
          <div key={i} className='flex items-center justify-between px-1 animate-slide-right' style={{ animationDelay: (i * 50) + 'ms' }}>
            <span className='text-xs text-[#b3a294]'>{s.label}</span>
            <KbdGroup keys={s.keys} />
          </div>
        ))}
      </div>
    )
  },
  {
    title: '一切就绪',
    subtitle: '开始你的 AgentHub 之旅',
    content: (
      <div className='text-center py-2'>
        <div className='relative inline-block mb-4'>
          <div className='absolute inset-0 bg-[#22c55e]/30 blur-2xl rounded-full animate-pulse-dot' />
          <div className='relative w-16 h-16 rounded-full bg-gradient-to-br from-[#22c55e]/30 to-[#10b981]/15 border border-[#22c55e]/40 flex items-center justify-center mx-auto animate-bounce-in'>
            <Check size={32} className='text-[#4ade80]' />
          </div>
        </div>
        <p className='text-sm text-[#b3a294] leading-relaxed mb-4'>
          输入消息即可与 Agent 对话。<br />
          使用 <Kbd>@</Kbd> 提及 Agent,<br />
          或 <Kbd>/</Kbd> 命令切换模式。
        </p>
        <div className='flex items-center justify-center gap-3 text-[10px] text-[#51443a]'>
          <span className='flex items-center gap-1'><Kbd>Enter</Kbd> 发送</span>
          <span className='w-1 h-1 rounded-full bg-[#51443a]' />
          <span className='flex items-center gap-1'><Kbd>@</Kbd> 提及</span>
        </div>
      </div>
    )
  }
]

interface OnboardingOverlayProps {
  onComplete: () => void
}

export function OnboardingOverlay({ onComplete }: OnboardingOverlayProps) {
  const [step, setStep] = useState(0)
  const current = steps[step]
  const isLast = step === steps.length - 1
  const isFirst = step === 0

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onComplete()
      else if (e.key === 'ArrowRight' || e.key === 'Enter') {
        if (isLast) onComplete()
        else setStep(s => s + 1)
      } else if (e.key === 'ArrowLeft' && !isFirst) {
        setStep(s => s - 1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [step, isLast, isFirst, onComplete])

  return (
    <div
      className='fixed inset-0 z-50 flex items-center justify-center animate-fade-only'
      style={{ background: 'rgba(0, 0, 0, 0.7)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' }}
    >
      <div className='w-[460px] max-w-[92vw] glass-strong rounded-2xl shadow-2xl overflow-hidden animate-scale-in'
        style={{ boxShadow: '0 24px 60px -12px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,159,10,0.1)' }}
      >
        <div className='flex items-center justify-between px-5 pt-4 pb-2'>
          <div className='flex items-center gap-1.5 text-[10px] text-[#75665a] font-medium'>
            <Wand2 size={11} className='text-[#ffc66b]' />
            快速上手
          </div>
          <button onClick={onComplete} className='p-1 rounded-md text-[#75665a] hover:text-[#ece4dc] hover:bg-[#261f1a]'>
            <X size={13} />
          </button>
        </div>

        <div className='flex gap-1.5 px-5 pb-3'>
          {steps.map((_, i) => (
            <div
              key={i}
              className={['h-1 flex-1 rounded-full transition-all duration-500', i <= step ? 'gradient-accent' : 'bg-[#261f1a]'].join(' ')}
            />
          ))}
        </div>

        <div className='px-6 pb-2'>
          <div className='text-center mb-3'>
            <h2 className='text-base font-bold text-[#ece4dc] tracking-tight'>{current.title}</h2>
            <p className='text-[10px] text-[#75665a] mt-0.5'>{current.subtitle}</p>
          </div>
          <div className='py-2 min-h-[260px] flex flex-col justify-center' key={step}>
            {current.content}
          </div>
        </div>

        <div className='flex items-center justify-between px-5 py-3 border-t border-[#261f1a] bg-[#0f0b09]/60'>
          <span className='text-[10px] text-[#75665a] font-mono'>{step + 1} / {steps.length}</span>
          <div className='flex items-center gap-1.5'>
            {!isLast && (
              <button onClick={onComplete} className='px-2 py-1 text-[10px] text-[#75665a] hover:text-[#ece4dc] transition-colors'>
                跳过
              </button>
            )}
            {!isFirst && (
              <button
                onClick={() => setStep(s => s - 1)}
                className='flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[11px] text-[#b3a294] hover:text-[#ece4dc] hover:bg-[#261f1a] transition-colors'
              >
                <ArrowLeft size={11} /> 上一步
              </button>
            )}
            <button
              onClick={() => isLast ? onComplete() : setStep(s => s + 1)}
              className='flex items-center gap-1 px-3 py-1.5 rounded-md text-[11px] font-semibold gradient-accent text-white shadow-md shadow-[#ff9f0a]/30 hover:brightness-110 active:scale-95 transition-all'
            >
              {isLast ? '开始使用' : '下一步'}
              <ArrowRight size={11} />
            </button>
          </div>
        </div>

        <div className='px-5 pb-3 pt-1 flex items-center justify-center gap-3 text-[9px] text-[#51443a]'>
          <span className='flex items-center gap-1'><Kbd>←</Kbd> <Kbd>→</Kbd> 切换步骤</span>
          <span className='w-1 h-1 rounded-full bg-[#51443a]' />
          <span className='flex items-center gap-1'><Kbd>esc</Kbd> 跳过</span>
        </div>
      </div>
    </div>
  )
}