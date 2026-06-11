/**
 * ProviderManager
 *
 * 职责：
 *   1. 加载/持久化 ProvidersConfig（JSON 存储）
 *   2. 暴露增删改查 / 启用切换 / 健康检查
 *   3. 提供按 Agent 路由解析的统一入口：resolveBinding(agentId)
 */

import { EventEmitter } from 'events'
import { store } from '../store'
import {
  ProvidersConfig,
  ProviderDefinition,
  AgentRouteBinding,
  ThinkingConfig,
  ProviderKind
} from './types'
import { BUILTIN_PROVIDERS, THINKING_BUDGET_TOKENS } from './presets'

const STORAGE_KEY = 'providers.config.v1'

function defaultConfig(): ProvidersConfig {
  return {
    providers: BUILTIN_PROVIDERS.map(p => ({ ...p, models: p.models.map(m => ({ ...m })) })),
    routing: {
      bindings: defaultBindings(),
      fallbackChain: [],
      strategy: 'single'
    },
    activeBindingId: null
  }
}

/**
 * 默认 4 个 Agent 路由，绑定到对应预设的旗舰模型
 * 用户在 Settings 里可任意修改
 */
function defaultBindings(): AgentRouteBinding[] {
  return [
    {
      agentId: 'codex',
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      thinkingAllow: ['off', 'auto', 'enabled'],
      thinking: { mode: 'auto', level: 'medium', budgetTokens: THINKING_BUDGET_TOKENS.medium, collapseInUI: true },
      temperature: 0.2,
      maxOutputTokens: 8192
    },
    {
      agentId: 'claude',
      providerId: 'openai',
      modelId: 'gpt-4o',
      thinkingAllow: ['off', 'auto', 'enabled'],
      thinking: { mode: 'auto', level: 'medium', collapseInUI: true },
      temperature: 0.4,
      maxOutputTokens: 8192
    },
    {
      agentId: 'openclaw',
      providerId: 'deepseek',
      modelId: 'deepseek-chat',
      thinkingAllow: ['off', 'auto', 'enabled'],
      thinking: { mode: 'off', level: 'low', collapseInUI: true },
      temperature: 0.1,
      maxOutputTokens: 4096
    },
    {
      agentId: 'hermes',
      providerId: 'gemini',
      modelId: 'gemini-2.5-flash',
      thinkingAllow: ['off', 'auto', 'enabled'],
      thinking: { mode: 'auto', level: 'low', budgetTokens: THINKING_BUDGET_TOKENS.low, collapseInUI: true },
      temperature: 0.3,
      maxOutputTokens: 8192
    }
  ]
}

export class ProviderManager extends EventEmitter {
  private cfg: ProvidersConfig

  constructor() {
    super()
    this.cfg = this.load()
  }

  private load(): ProvidersConfig {
    try {
      const raw = store.get(STORAGE_KEY)
      if (raw) {
        const merged = this.mergeWithBuiltins(raw)
        return merged
      }
    } catch (e) {
      console.warn('[Providers] load failed, fallback to defaults:', e)
    }
    return defaultConfig()
  }

  /** 把存储的 config 与最新的内置 Provider 合并（新增内置不丢、删除的清理） */
  private mergeWithBuiltins(stored: ProvidersConfig): ProvidersConfig {
    const defaults = defaultConfig()
    const storedProviders = new Map(stored.providers.map(p => [p.id, p]))

    const providers = defaults.providers.map(def => {
      const saved = storedProviders.get(def.id)
      if (!saved) return def
      // apiKey 必须从已存配置恢复
      return {
        ...def,
        apiKey: saved.apiKey || '',
        enabled: saved.enabled ?? def.enabled,
        baseUrl: saved.baseUrl || def.baseUrl,
        customHeaders: saved.customHeaders || def.customHeaders,
        note: saved.note || def.note,
        defaultThinking: saved.defaultThinking || def.defaultThinking,
        models: saved.models && saved.models.length > 0 ? saved.models : def.models
      }
    })

    // 用户自定义的非内置 Provider 也要保留
    for (const sp of stored.providers) {
      if (!sp.builtIn && !providers.find(p => p.id === sp.id)) {
        providers.push(sp)
      }
    }

    const storedBindings = stored.routing?.bindings?.length ? stored.routing.bindings : defaults.routing.bindings

    return {
      providers,
      routing: {
        bindings: storedBindings,
        fallbackChain: stored.routing?.fallbackChain || defaults.routing.fallbackChain,
        strategy: stored.routing?.strategy || defaults.routing.strategy
      },
      activeBindingId: stored.activeBindingId ?? defaults.activeBindingId
    }
  }

  private save(): void {
    store.set(STORAGE_KEY, this.cfg)
    this.emit('config:changed', this.cfg)
  }

  // ---- 查询 ----
  getConfig(): ProvidersConfig {
    return JSON.parse(JSON.stringify(this.cfg))
  }

  getProviders(): ProviderDefinition[] {
    return this.cfg.providers
  }

  getEnabledProviders(): ProviderDefinition[] {
    return this.cfg.providers.filter(p => p.enabled && p.apiKey)
  }

  getProvider(id: string): ProviderDefinition | undefined {
    return this.cfg.providers.find(p => p.id === id)
  }

  getBindings(): AgentRouteBinding[] {
    return this.cfg.routing.bindings
  }

  getBinding(agentId: string): AgentRouteBinding | undefined {
    return this.cfg.routing.bindings.find(b => b.agentId === agentId)
  }

  /** 解析 Agent → (Provider, Model, Thinking) 完整配置，处理 Provider 不可用回退 */
  resolveBinding(agentId: string): { provider: ProviderDefinition; model: import('./types').ModelDefinition; binding: AgentRouteBinding; thinking: ThinkingConfig } | null {
    const binding = this.getBinding(agentId)
    if (!binding) return null
    let provider = this.getProvider(binding.providerId)
    if (!provider || !provider.enabled || !provider.apiKey) {
      // 走回退链
      for (const fb of this.cfg.routing.fallbackChain) {
        const p = this.getProvider(fb)
        if (p && p.enabled && p.apiKey) {
          provider = p
          break
        }
      }
    }
    if (!provider) return null
    const model = provider.models.find(m => m.id === binding.modelId) || provider.models[0]
    if (!model) return null
    return { provider, model, binding, thinking: binding.thinking }
  }

  // ---- 修改 ----
  upsertProvider(p: ProviderDefinition): void {
    const idx = this.cfg.providers.findIndex(x => x.id === p.id)
    if (idx >= 0) this.cfg.providers[idx] = p
    else this.cfg.providers.push(p)
    this.save()
  }

  deleteProvider(id: string): boolean {
    const target = this.getProvider(id)
    if (!target || target.builtIn) return false
    this.cfg.providers = this.cfg.providers.filter(p => p.id !== id)
    // 清理路由
    this.cfg.routing.bindings = this.cfg.routing.bindings.filter(b => b.providerId !== id)
    this.cfg.routing.fallbackChain = this.cfg.routing.fallbackChain.filter(x => x !== id)
    this.save()
    return true
  }

  setProviderEnabled(id: string, enabled: boolean): void {
    const p = this.getProvider(id)
    if (!p) return
    p.enabled = enabled
    this.save()
  }

  setProviderApiKey(id: string, key: string): void {
    const p = this.getProvider(id)
    if (!p) return
    p.apiKey = key
    if (key && !p.enabled) p.enabled = true
    this.save()
  }

  upsertBinding(b: AgentRouteBinding): void {
    const idx = this.cfg.routing.bindings.findIndex(x => x.agentId === b.agentId)
    if (idx >= 0) this.cfg.routing.bindings[idx] = b
    else this.cfg.routing.bindings.push(b)
    this.save()
  }

  removeBinding(agentId: string): void {
    this.cfg.routing.bindings = this.cfg.routing.bindings.filter(b => b.agentId !== agentId)
    this.save()
  }

  setFallbackChain(chain: string[]): void {
    this.cfg.routing.fallbackChain = chain
    this.save()
  }

  setStrategy(s: ProvidersConfig['routing']['strategy']): void {
    this.cfg.routing.strategy = s
    this.save()
  }

  setActiveBinding(agentId: string | null): void {
    this.cfg.activeBindingId = agentId
    this.save()
  }

  setProviderThinking(providerId: string, t: ThinkingConfig): void {
    const p = this.getProvider(providerId)
    if (!p) return
    p.defaultThinking = t
    this.save()
  }

  setBindingThinking(agentId: string, t: ThinkingConfig): void {
    const b = this.getBinding(agentId)
    if (!b) return
    b.thinking = t
    this.save()
  }

  // ---- 健康检查 ----
  async checkProviderHealth(id: string): Promise<import('./types').ProviderHealth> {
    const p = this.getProvider(id)
    if (!p) return { reachable: false, lastCheck: Date.now(), error: 'Provider not found' }
    if (!p.apiKey) {
      const h = { reachable: false, lastCheck: Date.now(), error: '未配置 API Key' }
      p.health = h
      this.save()
      return h
    }
    const start = Date.now()
    try {
      const url = this.healthUrl(p)
      const headers = this.buildHeaders(p)
      const res = await fetch(url, { method: 'GET', headers, signal: AbortSignal.timeout(8000) })
      const latencyMs = Date.now() - start
      const h = {
        reachable: res.status < 500,
        lastCheck: Date.now(),
        latencyMs,
        error: res.status >= 400 ? `HTTP ${res.status}` : undefined
      }
      p.health = h
      this.save()
      return h
    } catch (e: any) {
      const h = { reachable: false, lastCheck: Date.now(), latencyMs: Date.now() - start, error: e?.message || String(e) }
      p.health = h
      this.save()
      return h
    }
  }

  private healthUrl(p: ProviderDefinition): string {
    switch (p.kind) {
      case 'openai':
      case 'openai-compatible':
      case 'custom':
        return `${p.baseUrl.replace(/\/$/, '')}/models`
      case 'anthropic':
        return `${p.baseUrl.replace(/\/$/, '')}/models`
      case 'gemini':
        return `${p.baseUrl.replace(/\/$/, '')}/models?key=${encodeURIComponent(p.apiKey)}`
    }
  }

  buildHeaders(p: ProviderDefinition): Record<string, string> {
    const headers: Record<string, string> = { 'content-type': 'application/json', ...(p.customHeaders || {}) }
    switch (p.kind) {
      case 'openai':
      case 'openai-compatible':
      case 'custom':
        headers['authorization'] = `Bearer ${p.apiKey}`
        break
      case 'anthropic':
        headers['x-api-key'] = p.apiKey
        headers['anthropic-version'] = '2023-06-01'
        break
      case 'gemini':
        // gemini 通过 query string 鉴权，不放 header
        break
    }
    return headers
  }
}

let _instance: ProviderManager | null = null
export function getProviderManager(): ProviderManager {
  if (!_instance) _instance = new ProviderManager()
  return _instance
}
