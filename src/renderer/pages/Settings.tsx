import React, { useEffect, useState } from 'react'
import { Modal } from '../components/ui/Modal'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { Tooltip } from '../components/ui/Tooltip'
import { StatusDot } from '../components/ui/StatusDot'
import { useUIStore } from '../store/ui'
import {
  Palette, Server, Brain, Network, Eye, EyeOff, RefreshCw,
  CheckCircle2, AlertTriangle, Loader2, Info, Sparkles,
  ChevronRight, KeyRound, Sun, Moon, Search, X
} from 'lucide-react'

interface Props { onClose: () => void }

const LEVEL_META: any = {
  minimal: { label: '最小', hint: '~1K tokens', color: '#75665a' },
  low: { label: '低', hint: '~4K tokens', color: '#06b6d4' },
  medium: { label: '中', hint: '~8K tokens', color: '#ff9f0a' },
  high: { label: '高', hint: '~16K tokens', color: '#f59e0b' },
  xhigh: { label: '极高', hint: '~32K tokens', color: '#ef4444' }
}

const BUDGET: any = { minimal: 1024, low: 4096, medium: 8192, high: 16384, xhigh: 32768 }

const TABS = [
  { id: 'providers', label: 'Providers', icon: Server, desc: 'API key 与模型接入' },
  { id: 'thinking', label: 'Thinking', icon: Brain, desc: '推理深度控制' },
  { id: 'routing', label: 'Routing', icon: Network, desc: '路由与回退链' },
  { id: 'general', label: 'General', icon: Palette, desc: '外观与偏好' }
]

export function SettingsModal({ onClose }: Props) {
  const { theme, setTheme, settingsTab, setSettingsTab, setProviderConfig, providerConfig, thinkingOverride, setThinkingOverride } = useUIStore()
  const [cfg, setCfg] = useState<any>(providerConfig)
  const [busy, setBusy] = useState(false)
  const [reveal, setReveal] = useState<Record<string, boolean>>({})
  const [pending, setPending] = useState<Record<string, string>>({})
  const [search, setSearch] = useState('')

  useEffect(() => { refresh() }, [])

  async function refresh() {
    const data = await window.electronAPI?.providers.get()
    if (data) { setCfg(data); setProviderConfig(data) }
  }

  async function setKey(providerId: string, key: string) {
    const next = { ...cfg, providers: cfg.providers.map((p: any) => p.id === providerId ? { ...p, apiKey: key, enabled: !!key || p.enabled } : p) }
    setCfg(next)
    await window.electronAPI?.providers.setKey(providerId, key)
    await refresh()
  }

  async function setEnabled(providerId: string, enabled: boolean) {
    const next = { ...cfg, providers: cfg.providers.map((p: any) => p.id === providerId ? { ...p, enabled } : p) }
    setCfg(next)
    await window.electronAPI?.providers.setEnabled(providerId, enabled)
  }

  async function checkHealth(providerId: string) {
    setBusy(true)
    try { await window.electronAPI?.providers.health(providerId) } finally { setBusy(false); await refresh() }
  }

  async function pickBinding(agentId: string, providerId: string, modelId: string) {
    const b = cfg.routing.bindings.find((x: any) => x.agentId === agentId)
    const next = { ...(b || { agentId, thinkingAllow: ['off','auto','enabled'], thinking: { mode: 'auto', level: 'medium', collapseInUI: true }, temperature: 0.3 }), providerId, modelId }
    await window.electronAPI?.routing.setBinding(next)
    await refresh()
  }

  async function pickBindingBackend(agentId: string, protocol: "http" | "stdio-plain", binary?: string) {
  const b = cfg.routing.bindings.find((x: any) => x.agentId === agentId)
  const next = { ...(b || { agentId, providerId: "", modelId: "", thinkingAllow: ["off","auto","enabled"], thinking: { mode: "auto", level: "medium", collapseInUI: true }, temperature: 0.3 }), protocol, binary: binary || "" }
  await window.electronAPI?.routing.setBinding(next)
  await refresh()
}

  async function updateBindingThinking(agentId: string, t: any) {
    await window.electronAPI?.routing.setBindingThinking(agentId, t)
    await refresh()
  }

  async function updateProviderThinking(providerId: string, t: any) {
    await window.electronAPI?.routing.setProviderThinking(providerId, t)
    await refresh()
  }

  async function updateFallback(chain: string[]) {
    await window.electronAPI?.routing.setFallback(chain)
    await refresh()
  }

  async function updateStrategy(s: string) {
    await window.electronAPI?.routing.setStrategy(s)
    await refresh()
  }

  const enabledCount = cfg?.providers?.filter((p: any) => p.enabled && p.apiKey)?.length || 0
  const totalCount = cfg?.providers?.length || 0
  const bindingCount = cfg?.routing?.bindings?.length || 0

  return (
    <Modal open={true} onClose={onClose} title="设置" width="max-w-5xl">
      <div className="flex h-[600px] -mt-4 animate-fade-only rounded-2xl glass-strong">
        <aside className="w-52 border-r border-[#261f1a] p-3 shrink-0">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-[#75665a] mb-2 px-2">设置</div>
          <nav className="space-y-0.5">
            {TABS.map(t => {
              const Icon = t.icon
              const isActive = settingsTab === t.id
              return (
                <button
                  key={t.id}
                  onClick={() => setSettingsTab(t.id as any)}
                  className={[
                    'group w-full flex items-start gap-2.5 px-2.5 py-2 rounded-lg text-left transition-all',
                    isActive
                      ? 'bg-gradient-to-r from-[#ff9f0a]/15 to-transparent ring-1 ring-[#ff9f0a]/25 text-[#ece4dc]'
                      : 'text-[#b3a294] hover:text-[#ece4dc] hover:bg-[#261f1a]'
                  ].join(' ')}
                >
                  <Icon size={13} className={'mt-0.5 shrink-0 ' + (isActive ? 'text-[#ffc66b]' : 'text-[#75665a] group-hover:text-[#b3a294]')} />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold mb-0.5">{t.label}</div>
                    <div className="text-[10px] text-[#75665a] truncate">{t.desc}</div>
                  </div>
                  {isActive && <ChevronRight size={11} className="text-[#ffc66b] mt-0.5" />}
                </button>
              )
            })}
          </nav>

          <div className="mt-6 px-2 space-y-2">
            <div className="text-[9px] text-[#51443a] uppercase tracking-wider">概览</div>
            <div className="rounded-lg bg-[#0f0b09] border border-[#261f1a] p-2.5 space-y-1.5">
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-[#75665a]">Provider</span>
                <span className="font-mono text-[#b3a294]">{enabledCount}/{totalCount}</span>
              </div>
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-[#75665a]">Agent 绑定</span>
                <span className="font-mono text-[#b3a294]">{bindingCount}</span>
              </div>
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-[#75665a]">版本</span>
                <span className="font-mono text-[#ffc66b]">0.2.0</span>
              </div>
            </div>
          </div>
        </aside>

        <main className="flex-1 overflow-y-auto" key={settingsTab}>
          {!cfg ? (
            <div className="flex items-center gap-2 text-xs text-[#75665a] p-5">
              <Loader2 size={12} className="animate-spin" /> 正在加载配置...
            </div>
          ) : (
            <div className="p-6 animate-fade-only">
              {settingsTab === 'providers' && (
                <ProvidersTab cfg={cfg} pending={pending} setPending={setPending} reveal={reveal} setReveal={setReveal}
                  setKey={setKey} setEnabled={setEnabled} checkHealth={checkHealth} busy={busy} refresh={refresh} search={search} setSearch={setSearch} />
              )}
              {settingsTab === 'thinking' && cfg && (
                <ThinkingTab cfg={cfg} thinkingOverride={thinkingOverride} setThinkingOverride={setThinkingOverride}
                  updateBindingThinking={updateBindingThinking} updateProviderThinking={updateProviderThinking} />
              )}
              {settingsTab === 'routing' && cfg && (
                <RoutingTab cfg={cfg} pickBinding={pickBinding} pickBindingBackend={pickBindingBackend} updateFallback={updateFallback} updateStrategy={updateStrategy} />
              )}
              {settingsTab === 'general' && (
                <GeneralTab theme={theme} setTheme={setTheme} />
              )}
            </div>
          )}
        </main>
      </div>

      <div className="flex items-center justify-between gap-2 px-6 py-3 border-t border-[#261f1a] bg-[#0f0b09]/40">
        <span className="text-[10px] text-[#75665a] flex items-center gap-1.5">
          <span className="w-1 h-1 rounded-full bg-[#22c55e] animate-pulse-dot" />
          配置自动保存
        </span>
        <div className="flex gap-2">
          <Button variant="secondary" size="md" onClick={onClose}>关闭</Button>
        </div>
      </div>
    </Modal>
  )
}

function ProvidersTab({ cfg, pending, setPending, reveal, setReveal, setKey, setEnabled, checkHealth, busy, refresh, search, setSearch }: any) {
  const enabledCount = cfg.providers.filter((p: any) => p.enabled && p.apiKey).length
  const filtered = cfg.providers.filter((p: any) => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q) || p.baseUrl?.toLowerCase().includes(q)
  })
  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-bold text-[#ece4dc] tracking-tight">模型 Provider</h3>
          <p className="text-[11px] text-[#75665a] mt-1 leading-relaxed max-w-md">
            连接 OpenAI、Anthropic、Google、DeepSeek、OpenRouter 或任何 OpenAI 兼容端点。<Badge variant={enabledCount > 0 ? 'success' : 'default'} className="ml-1">{enabledCount} 活跃</Badge>
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="relative">
            <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-[#51443a] pointer-events-none" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="搜索 Provider..."
              className="bg-[#0f0b09] text-[11px] text-[#ece4dc] placeholder-[#51443a] pl-7 pr-7 py-1.5 rounded-lg border border-[#261f1a] outline-none focus:border-[#ff9f0a]/40 w-44 transition-colors"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 text-[#75665a] hover:text-[#ece4dc]">
                <X size={10} />
              </button>
            )}
          </div>
          <Tooltip content="重新扫描所有 Provider 健康状态">
            <button onClick={refresh} disabled={busy} className="flex items-center gap-1 px-2 py-1.5 rounded-md text-[10px] text-[#75665a] hover:text-[#b3a294] hover:bg-[#261f1a] disabled:opacity-50 transition-colors">
              <RefreshCw size={11} className={busy ? 'animate-spin' : ''} /> 刷新
            </button>
          </Tooltip>
        </div>
      </div>

      <div className="space-y-2">
        {filtered.length === 0 ? (
          <div className="text-center text-[11px] text-[#75665a] py-8">没有匹配 "{search}" 的 Provider</div>
        ) : (
          filtered.map((p: any) => (
            <ProviderCard key={p.id} provider={p} pending={pending[p.id] !== undefined ? pending[p.id] : (p.apiKey || '')}
              setPending={(v: string) => setPending({ ...pending, [p.id]: v })}
              reveal={!!reveal[p.id]} setReveal={(v: boolean) => setReveal({ ...reveal, [p.id]: v })}
              onSave={() => setKey(p.id, pending[p.id] || '')} onToggle={(v: boolean) => setEnabled(p.id, v)} onHealth={() => checkHealth(p.id)} />
          ))
        )}
      </div>
    </div>
  )
}

function ProviderCard({ provider, pending, setPending, reveal, setReveal, onSave, onToggle, onHealth }: any) {
  const h = provider.health
  const HealthIcon = !h ? Info : h.reachable ? CheckCircle2 : AlertTriangle
  const healthColor = !h ? 'text-[#75665a]' : h.reachable ? 'text-[#22c55e]' : 'text-[#f59e0b]'
  const color = brandColor(provider.id)
  const isActive = provider.enabled && !!provider.apiKey
  return (
    <div className={[
      'rounded-2xl border bg-gradient-to-b from-[#0f0b09] to-[#0a0807] transition-all overflow-hidden',
      isActive ? 'border-[#362c25] hover:border-[#51443a]' : 'border-[#261f1a] opacity-80'
    ].join(' ')}>
      <div className="flex items-start gap-3 p-3.5">
        <div
          className="w-11 h-11 rounded-xl flex items-center justify-center text-base font-bold shrink-0"
          style={{
            background: 'linear-gradient(135deg, ' + color + '25 0%, ' + color + '08 100%)',
            color,
            border: '1px solid ' + color + '30',
            boxShadow: isActive ? ('0 0 12px ' + color + '20') : 'none'
          }}
        >
          {provider.name.charAt(0)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
            <span className="text-sm font-semibold text-[#ece4dc]">{provider.name}</span>
            {provider.builtIn && <Badge variant="default">内置</Badge>}
            <Badge variant="info">{provider.kind}</Badge>
            <HealthIcon size={12} className={healthColor + ' ml-auto'} />
          </div>
          <div className="text-[10px] text-[#75665a] font-mono truncate">{provider.baseUrl}</div>
          {h && (
            <div className={'text-[10px] mt-0.5 ' + healthColor}>
              {h.reachable ? ('可达 ' + h.latencyMs + ' ms') : ('错误: ' + (h.error || '不可达'))}
              <span className="text-[#51443a]"> · {timeAgo(h.lastCheck)}</span>
            </div>
          )}
        </div>
        <label className="flex items-center gap-1.5 cursor-pointer shrink-0 select-none">
          <span className="text-[10px] text-[#75665a]">{provider.enabled ? '已启用' : '已停用'}</span>
          <span className={'relative inline-flex w-8 h-4 rounded-full transition-colors ' + (provider.enabled ? 'bg-[#22c55e]/60' : 'bg-[#261f1a]')}>
            <span className={'absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ' + (provider.enabled ? 'left-[18px]' : 'left-0.5')} />
          </span>
          <input type="checkbox" checked={provider.enabled} onChange={(e) => onToggle(e.target.checked)} className="sr-only" />
        </label>
      </div>
      <div className="px-3.5 pb-3.5 flex gap-2 items-center">
        <div className="relative flex-1">
          <KeyRound size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#75665a] pointer-events-none" />
          <input
            type={reveal ? 'text' : 'password'}
            value={pending}
            placeholder={provider.apiKey ? '已配置 API key' : '粘贴 API key...'}
            onChange={(e) => setPending(e.target.value)}
            className="w-full bg-[#0f0b09] text-xs text-[#ece4dc] placeholder-[#51443a] pl-7 pr-3 py-1.5 rounded-lg border border-[#261f1a] outline-none focus:border-[#ff9f0a]/50 focus:ring-2 focus:ring-[#ff9f0a]/15 font-mono transition-all"
          />
        </div>
        <Tooltip content={reveal ? '隐藏' : '显示'}>
          <button onClick={() => setReveal(!reveal)} className="p-1.5 rounded-md text-[#75665a] hover:text-[#ece4dc] hover:bg-[#261f1a] transition-colors">
            {reveal ? <EyeOff size={12} /> : <Eye size={12} />}
          </button>
        </Tooltip>
        <Button variant="primary" size="sm" onClick={onSave} disabled={!pending.trim()}>保存</Button>
        <Tooltip content="健康检查">
          <button onClick={onHealth} disabled={!provider.apiKey} className="p-1.5 rounded-md text-[#75665a] hover:text-[#ffc66b] hover:bg-[#ff9f0a]/10 disabled:opacity-30 transition-colors">
            <RefreshCw size={12} />
          </button>
        </Tooltip>
      </div>
    </div>
  )
}

function ThinkingTab({ cfg, thinkingOverride, setThinkingOverride, updateBindingThinking, updateProviderThinking }: any) {
  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Sparkles size={14} className="text-[#f59e0b]" />
          <h3 className="text-sm font-bold text-[#ece4dc] tracking-tight">默认思考模式</h3>
        </div>
        <p className="text-[11px] text-[#75665a] leading-relaxed">应用于所有新对话。Per-Agent 覆盖会优先。</p>
        <div className="mt-3 p-4 rounded-2xl border border-[#261f1a] bg-gradient-to-br from-[#0f0b09] to-[#0a0807]">
          <ThinkingPicker value={thinkingOverride || { mode: 'auto', level: 'medium' }} onChange={(t: any) => setThinkingOverride(t)} showHint />
        </div>
      </div>

      <div>
        <div className="flex items-center gap-2 mb-1">
          <Brain size={14} className="text-[#f59e0b]" />
          <h3 className="text-sm font-bold text-[#ece4dc] tracking-tight">Per-Agent 覆盖</h3>
        </div>
        <p className="text-[11px] text-[#75665a] leading-relaxed">精细调控每个 Agent 的推理方式。</p>
        <div className="mt-3 space-y-2">
          {(cfg.routing.bindings || []).map((b: any) => {
            const p = cfg.providers.find((x: any) => x.id === b.providerId)
            const m = p?.models.find((x: any) => x.id === b.modelId)
            return (
              <div key={b.agentId} className="p-4 rounded-2xl border border-[#261f1a] bg-gradient-to-br from-[#0f0b09] to-[#0a0807] hover:border-[#362c25] transition-colors">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-md bg-[#f59e0b]/15 flex items-center justify-center text-[10px] font-bold text-[#fbbf24] border border-[#f59e0b]/30">
                      {b.agentId.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div className="text-[11px] font-semibold text-[#ece4dc]">{b.agentId}</div>
                      <div className="text-[10px] text-[#75665a]">{p?.name} / {m?.label || b.modelId}</div>
                    </div>
                  </div>
                  {!m?.supportsThinking && <Badge variant="warning">无思考</Badge>}
                </div>
                <ThinkingPicker value={b.thinking} onChange={(t: any) => updateBindingThinking(b.agentId, t)} />
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function ThinkingPicker({ value, onChange, showHint }: any) {
  const v = value || { mode: 'off', level: 'medium' }
  return (
    <div className="space-y-2.5">
      <div>
        <div className="text-[9px] uppercase tracking-wider text-[#75665a] mb-1">模式</div>
        <div className="grid grid-cols-3 gap-1">
          {(['off', 'auto', 'enabled'] as const).map(m => {
            const isActive = v.mode === m
            return (
              <button key={m} onClick={() => onChange({ ...v, mode: m })}
                className={[
                  'py-1.5 rounded-md text-[11px] font-medium transition-all',
                  isActive
                    ? 'bg-gradient-to-b from-[#f59e0b] to-[#f59e0b]/80 text-[#0f0b09] shadow-md shadow-[#f59e0b]/30'
                    : 'bg-[#261f1a] text-[#b3a294] hover:bg-[#362c25] border border-[#362c25]'
                ].join(' ')}>
                {m === 'off' ? '关闭' : m === 'auto' ? '自动' : '强制开启'}
              </button>
            )
          })}
        </div>
      </div>
      <div>
        <div className="text-[9px] uppercase tracking-wider text-[#75665a] mb-1">深度</div>
        <div className="grid grid-cols-5 gap-1">
          {(['minimal','low','medium','high','xhigh'] as const).map((l: any) => {
            const cfg = LEVEL_META[l]
            const isActive = v.level === l
            const disabled = v.mode === 'off'
            return (
              <button key={l} onClick={() => onChange({ ...v, level: l })} disabled={disabled}
                className={[
                  'py-1.5 rounded text-[10px] transition-all border',
                  isActive
                    ? 'shadow-md'
                    : disabled
                      ? 'bg-[#261f1a] text-[#51443a] cursor-not-allowed border-[#261f1a]'
                      : 'bg-[#261f1a] text-[#b3a294] hover:bg-[#362c25] border-[#362c25]'
                ].join(' ')}
                style={isActive ? {
                  background: 'linear-gradient(180deg, ' + cfg.color + '20 0%, ' + cfg.color + '08 100%)',
                  color: cfg.color,
                  borderColor: cfg.color + '60',
                  boxShadow: '0 0 12px ' + cfg.color + '20'
                } : undefined}>
                <div className="font-semibold">{cfg.label}</div>
                <div className="text-[8px] opacity-70">{cfg.hint}</div>
              </button>
            )
          })}
        </div>
      </div>
      {showHint && v.mode !== 'off' && (
        <div className="flex items-center gap-1.5 text-[10px] text-[#b3a294]">
          <Info size={10} className="text-[#ff9f0a]" />
          生效预算: <span className="font-mono text-[#fbbf24]">{BUDGET[v.level]}</span> tokens
        </div>
      )}
    </div>
  )
}

function RoutingTab({ cfg, pickBinding, pickBindingBackend, updateFallback, updateStrategy }: any) {
  const providers = (cfg.providers || []).filter((p: any) => p.enabled && p.apiKey)
  const fallback = cfg.routing.fallbackChain || []
  const strategies: Array<{ id: string; label: string; desc: string; icon: any }> = [
    { id: 'single', label: '单点', desc: '一个提示词只发给一个 Agent', icon: Network },
    { id: 'load-balance', label: '负载均衡', desc: '轮询健康 Agent', icon: RefreshCw },
    { id: 'cost-aware', label: '成本优先', desc: '优先用便宜的模型', icon: Sparkles }
  ]
  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Network size={14} className="text-[#ff9f0a]" />
          <h3 className="text-sm font-bold text-[#ece4dc] tracking-tight">路由策略</h3>
        </div>
        <p className="text-[11px] text-[#75665a] leading-relaxed max-w-lg">决定消息如何分发给可用的 Agent 和 Provider。</p>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {strategies.map(s => {
            const Icon = s.icon
            const isActive = cfg.routing.strategy === s.id
            return (
              <button key={s.id} onClick={() => updateStrategy(s.id)}
                className={[
                  'p-3 rounded-xl text-left transition-all border',
                  isActive
                    ? 'bg-gradient-to-br from-[#ff9f0a]/20 to-[#ff9f0a]/5 border-[#ff9f0a]/50 shadow-md shadow-[#ff9f0a]/10'
                    : 'bg-[#0f0b09] border-[#261f1a] text-[#b3a294] hover:bg-[#261f1a] hover:border-[#362c25]'
                ].join(' ')}>
                <div className="flex items-center gap-1.5 mb-1">
                  <Icon size={12} className={isActive ? 'text-[#ffc66b]' : 'text-[#75665a]'} />
                  <span className={'text-[11px] font-semibold ' + (isActive ? 'text-[#ece4dc]' : '')}>{s.label}</span>
                </div>
                <div className="text-[10px] text-[#75665a] leading-relaxed">{s.desc}</div>
              </button>
            )
          })}
        </div>
      </div>

      <div>
        <div className="flex items-center gap-2 mb-1">
          <RefreshCw size={14} className="text-[#06b6d4]" />
          <h3 className="text-sm font-bold text-[#ece4dc] tracking-tight">回退链</h3>
        </div>
        <p className="text-[11px] text-[#75665a] leading-relaxed">当主 Provider 不可用时,按顺序尝试这些 Provider。</p>
        <div className="mt-3 p-3 rounded-2xl border border-[#261f1a] bg-[#0f0b09] space-y-2">
          <div className="flex flex-wrap gap-1.5 min-h-[28px]">
            {fallback.length === 0 && (
              <span className="text-[11px] text-[#75665a] italic flex items-center gap-1.5">
                <Info size={11} /> 尚未配置回退链
              </span>
            )}
            {fallback.map((id: string, i: number) => (
              <span key={id} className="inline-flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-md bg-[#261f1a] border border-[#362c25] text-[11px] text-[#ece4dc]">
                <span className="text-[9px] text-[#51443a] font-mono">{i + 1}</span>
                {cfg.providers.find((p: any) => p.id === id)?.name || id}
                <button onClick={() => updateFallback(fallback.filter((x: string) => x !== id))} className="ml-0.5 p-0.5 text-[#75665a] hover:text-[#ef4444] transition-colors">
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
          {providers.filter((p: any) => !fallback.includes(p.id)).length > 0 && (
            <div className="pt-2 border-t border-[#261f1a]">
              <div className="text-[9px] uppercase tracking-wider text-[#75665a] mb-1.5">添加到回退链</div>
              <div className="flex flex-wrap gap-1">
                {providers.filter((p: any) => !fallback.includes(p.id)).map((p: any) => (
                  <button key={p.id} onClick={() => updateFallback([...fallback, p.id])}
                    className="px-2 py-1 rounded text-[10px] bg-[#261f1a] text-[#b3a294] hover:bg-[#362c25] hover:text-[#ece4dc] transition-colors border border-[#362c25]">
                    + {p.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div>
        <div className="flex items-center gap-2 mb-1">
          <Server size={14} className="text-[#22c55e]" />
          <h3 className="text-sm font-bold text-[#ece4dc] tracking-tight">活跃绑定</h3>
        </div>
        <p className="text-[11px] text-[#75665a] leading-relaxed">为每个 Agent 选择 Provider 和模型。</p>
        <div className="mt-3 space-y-2">
          {cfg.routing.bindings.map((b: any) => (
            <BindingRow key={b.agentId} binding={b} cfg={cfg} providers={providers} onPick={pickBinding} onPickBackend={pickBindingBackend} />
          ))}
        </div>
      </div>

      <div className="p-4 rounded-2xl border border-[#261f1a] bg-gradient-to-br from-[#0f0b09] to-[#0a0807]">
        <div className="flex items-start gap-2.5">
          <div className="w-8 h-8 rounded-lg gradient-accent flex items-center justify-center shrink-0">
            <Network size={14} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[11px] font-semibold text-[#ece4dc]">本地 Chat Completions 代理</div>
            <div className="text-[10px] text-[#75665a] mt-0.5 leading-relaxed">其他工具可以指向 AgentHub 作为它们的 provider。</div>
            <div className="mt-2 space-y-1">
              <div className="flex items-center gap-2 text-[10px]">
                <Badge variant="accent">POST</Badge>
                <code className="text-[#ffc66b] font-mono">http://127.0.0.1:9528/v1/chat/completions</code>
              </div>
              <div className="flex items-center gap-2 text-[10px]">
                <Badge variant="accent">GET</Badge>
                <code className="text-[#ffc66b] font-mono">http://127.0.0.1:9528/v1/models</code>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function BindingRow({ binding, cfg, providers, onPick, onPickBackend }: any) {
  const currentProvider = providers.find((p: any) => p.id === binding.providerId)
 const protocol = (binding as any).protocol || "http"
 const binary = (binding as any).binary || ""
 const isStdio = protocol === "stdio-plain"
 const stdioSupported = binding.agentId === "codex"
 const toggleProtocol = (next: "http" | "stdio-plain") => onPickBackend(binding.agentId, next, binary)
 const updateBinary = (v: string) => onPickBackend(binding.agentId, "stdio-plain", v)
  return (
    <div className="p-4 rounded-2xl border border-[#261f1a] bg-gradient-to-br from-[#0f0b09] to-[#0a0807] hover:border-[#362c25] transition-colors">
      <div className="flex items-center gap-1.5 mb-2">
<span className="text-[9px] text-[#75665a] uppercase tracking-wider mr-1">Backend</span>
<button onClick={() => toggleProtocol("http")} className={["px-2 py-0.5 rounded text-[10px] border transition-colors", protocol === "http" ? "gradient-accent text-white border-transparent" : "bg-[#261f1a] text-[#b3a294] border-[#362c25] hover:border-[#51443a]"].join(" ")}>HTTP (LLM)</button>
<button onClick={() => toggleProtocol("stdio-plain")} disabled={!stdioSupported} title={stdioSupported ? "" : "当前仅 codex 支持 stdio"} className={["px-2 py-0.5 rounded text-[10px] border transition-colors", isStdio ? "gradient-accent text-white border-transparent" : "bg-[#261f1a] text-[#b3a294] border-[#362c25] hover:border-[#51443a] disabled:opacity-40 disabled:cursor-not-allowed"].join(" ")}>StdIO (本地 CLI)</button>
</div>
 {isStdio && (
<div className="mb-3 flex items-center gap-2">
<span className="text-[9px] text-[#75665a] uppercase tracking-wider">binary</span>
<input type="text" value={binary} onChange={e => updateBinary(e.target.value)} placeholder="codex 二进制绝对路径 (留空走 PATH)" className="bg-[#0f0b09] text-[10px] text-[#ece4dc] placeholder-[#51443a] px-2 py-1 rounded border border-[#261f1a] outline-none focus:border-[#ff9f0a]/40 flex-1 font-mono" />
</div>
 )}
<div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-[#ff9f0a]/15 flex items-center justify-center text-[10px] font-bold text-[#ffc66b] border border-[#ff9f0a]/30">
            {binding.agentId.charAt(0).toUpperCase()}
          </div>
          <div>
            <div className="text-[11px] font-semibold text-[#ece4dc]">{binding.agentId}</div>
            <div className="text-[10px] text-[#75665a]">当前 {currentProvider?.name || '?'} / {binding.modelId}</div>
          </div>
        </div>
      </div>
      <div className="space-y-1.5">
        {providers.length === 0 && (
          <div className="text-[10px] text-[#75665a] italic flex items-center gap-1.5">
            <Info size={11} /> 没有活跃 Provider,请先在 Providers 选项卡配置
          </div>
        )}
        {providers.map((p: any) => (
          <div key={p.id} className="flex items-start gap-2 text-[11px]">
            <div
              className="w-5 h-5 rounded flex items-center justify-center text-[9px] font-bold shrink-0 mt-0.5"
              style={{
                background: brandColor(p.id) + '20',
                color: brandColor(p.id),
                border: '1px solid ' + brandColor(p.id) + '30'
              }}
            >
              {p.name.charAt(0)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[10px] text-[#75665a] mb-1">{p.name}</div>
              <div className="flex flex-wrap gap-1">
                {(p.models || []).map((m: any) => {
                  const isSelected = binding.providerId === p.id && binding.modelId === m.id
                  return (
                    <button key={m.id} onClick={() => onPick(binding.agentId, p.id, m.id)}
                      className={[
                        'px-2 py-0.5 rounded text-[10px] transition-all border',
                        isSelected
                          ? 'gradient-accent text-white border-transparent shadow-sm shadow-[#ff9f0a]/30'
                          : 'bg-[#261f1a] text-[#b3a294] hover:bg-[#362c25] hover:text-[#ece4dc] border-[#362c25]'
                      ].join(' ')}>
                      {m.label || m.id}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function GeneralTab({ theme, setTheme }: any) {
  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Palette size={14} className="text-[#ff9f0a]" />
          <h3 className="text-sm font-bold text-[#ece4dc] tracking-tight">外观</h3>
        </div>
        <p className="text-[11px] text-[#75665a] leading-relaxed">选择适合你工作节奏的主题。</p>
        <div className="mt-3 p-4 rounded-2xl border border-[#261f1a] bg-gradient-to-br from-[#0f0b09] to-[#0a0807]">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs font-medium text-[#ece4dc]">主题</div>
              <div className="text-[10px] text-[#75665a] mt-0.5">影响所有面板和组件的配色</div>
            </div>
            <div className="flex gap-1 p-0.5 rounded-lg bg-[#0f0b09] border border-[#261f1a]">
              <button onClick={() => setTheme('dark')} className={[
                'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs transition-all',
                theme === 'dark' ? 'bg-gradient-to-b from-[#ff9f0a] to-[#e8900a] text-white shadow-md' : 'text-[#75665a] hover:text-[#ece4dc]'
              ].join(' ')}>
                <Moon size={11} /> 深色
              </button>
              <button onClick={() => setTheme('light')} className={[
                'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs transition-all',
                theme === 'light' ? 'bg-gradient-to-b from-[#ff9f0a] to-[#e8900a] text-white shadow-md' : 'text-[#75665a] hover:text-[#ece4dc]'
              ].join(' ')}>
                <Sun size={11} /> 浅色
              </button>
            </div>
          </div>
        </div>
      </div>

      <div>
        <div className="flex items-center gap-2 mb-1">
          <Info size={14} className="text-[#06b6d4]" />
          <h3 className="text-sm font-bold text-[#ece4dc] tracking-tight">关于</h3>
        </div>
        <div className="mt-3 p-4 rounded-2xl border border-[#261f1a] bg-gradient-to-br from-[#0f0b09] to-[#0a0807] text-[11px] space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-[#75665a]">版本</span>
            <span className="text-[#ece4dc] font-mono">0.2.0</span>
          </div>
          <div className="flex justify-between items-start">
            <span className="text-[#75665a]">Provider 系统</span>
            <span className="text-[#b3a294] text-right">OpenAI · Anthropic · Gemini<br />DeepSeek · OpenRouter · 自定义</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-[#75665a]">本地代理</span>
            <code className="text-[#ffc66b] font-mono text-[10px]">127.0.0.1:9528/v1</code>
          </div>
        </div>
      </div>
    </div>
  )
}

function brandColor(id: string) {
  return ({ openai: '#10a37f', anthropic: '#d97706', gemini: '#4285f4', deepseek: '#ff9f0a', openrouter: '#a855f7', custom: '#22c55e' } as any)[id] || '#ff9f0a'
}

function timeAgo(ts: number) {
  if (!ts) return '从未'
  const diff = Date.now() - ts
  if (diff < 60000) return Math.floor(diff / 1000) + ' 秒前'
  if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前'
  return Math.floor(diff / 3600000) + ' 小时前'
}
