/**
 * 协议转换 & HTTP 客户端
 *
 * 支持：
 *   - chat_completions（OpenAI / DeepSeek / OpenRouter / 自定义）
 *   - messages（Anthropic 原生）
 *   - generate_content（Gemini）
 *
 * 思考字段处理：
 *   - OpenAI 兼容 → reasoning_effort
 *   - Anthropic → thinking: { type: 'enabled', budget_tokens }
 *   - Gemini → generationConfig.thinkingConfig（v1beta）
 */

import { AgentRouteBinding, ChatCompletionChunk, ChatCompletionMessage, ChatCompletionRequest, ChatCompletionResponse, ModelDefinition, ProviderDefinition, ThinkingConfig, ThinkingSummary } from './types'
import { THINKING_BUDGET_TOKENS } from './presets'

export interface StreamCallbacks {
  onContent?: (delta: string) => void
  onThinking?: (delta: string) => void
  onDone?: (final: { content: string; thinking?: ThinkingSummary; usage?: any }) => void
  onError?: (err: Error) => void
}

export interface CallOptions {
  messages: ChatCompletionMessage[]
  systemPrompt?: string
  /** 临时覆盖 thinking（来自 UI 切换） */
  thinkingOverride?: ThinkingConfig
  /** 临时覆盖 model（来自 UI 切换） */
  modelOverride?: string
  /** 临时覆盖 provider（来自 UI 切换） */
  providerOverride?: ProviderDefinition
  signal?: AbortSignal
}

export interface ResolvedCall {
  provider: ProviderDefinition
  model: ModelDefinition
  binding: AgentRouteBinding
  thinking: ThinkingConfig
  }

export class ProviderClient {
  constructor(private provider: ProviderDefinition, private model: ModelDefinition, private binding: AgentRouteBinding, private thinking: ThinkingConfig) {}

  /** 组装 Chat Completions 风格请求（统一抽象） */
  buildRequest(messages: ChatCompletionMessage[], systemPrompt?: string, thinking: ThinkingConfig = this.thinking): ChatCompletionRequest {
    const sys = systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []
    const req: ChatCompletionRequest = {
      model: this.model.id,
      messages: [...sys, ...messages],
      temperature: this.binding.temperature,
      max_tokens: this.binding.maxOutputTokens,
      stream: true,
      metadata: { agentId: this.binding.agentId, providerId: this.provider.id }
    }
    if (thinking.mode !== 'off' && this.model.supportsThinking) {
      req.reasoning_effort = thinking.level
    }
    return req
  }

  async stream(opts: CallOptions, cb: StreamCallbacks): Promise<void> {
    try {
      const provider = opts.providerOverride || this.provider
      const thinking = opts.thinkingOverride || this.thinking
      const model = this.model
      const messages = opts.messages

      if (provider.kind === 'anthropic') {
        await this.streamAnthropic(provider, model, messages, opts, thinking, cb, opts.signal)
      } else if (provider.kind === 'gemini') {
        await this.streamGemini(provider, model, messages, opts, thinking, cb, opts.signal)
      } else {
        await this.streamOpenAICompat(provider, model, messages, opts, thinking, cb, opts.signal)
      }
    } catch (e: any) {
      cb.onError?.(e)
    }
  }

  // ---- OpenAI 兼容（含 OpenAI / DeepSeek / OpenRouter / 自定义） ----
  private async streamOpenAICompat(provider: ProviderDefinition, model: ModelDefinition, messages: ChatCompletionMessage[], opts: CallOptions, thinking: ThinkingConfig, cb: StreamCallbacks, signal?: AbortSignal): Promise<void> {
    const url = `${provider.baseUrl.replace(/\/$/, '')}/chat/completions`
    const body = this.buildRequest(messages, opts.systemPrompt, thinking)
    const headers = this.headersFor(provider)
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal })
    if (!res.ok || !res.body) {
      const txt = await res.text().catch(() => '')
      throw new Error(`HTTP ${res.status} from ${provider.name}: ${txt.slice(0, 200)}`)
    }
    await this.readSse(res.body, (evt) => {
      if (!evt || evt === '[DONE]') return
      try {
        const chunk: ChatCompletionChunk = JSON.parse(evt)
        const delta = chunk.choices?.[0]?.delta
        if (delta?.content) cb.onContent?.(delta.content)
        if (delta?.reasoning_content) cb.onThinking?.(delta.reasoning_content)
      } catch {}
    })
    cb.onDone?.({ content: '', usage: undefined })
  }

  // ---- Anthropic Messages ----
  private async streamAnthropic(provider: ProviderDefinition, model: ModelDefinition, messages: ChatCompletionMessage[], opts: CallOptions, thinking: ThinkingConfig, cb: StreamCallbacks, signal?: AbortSignal): Promise<void> {
    const url = `${provider.baseUrl.replace(/\/$/, '')}/messages`
    const headers = this.headersFor(provider)
    const sysText = opts.systemPrompt || ''
    const supportsThinking = model.supportsThinking && provider.capabilities.nativeThinking
    const wantThink = thinking.mode !== 'off' && supportsThinking
    const budget = thinking.budgetTokens ?? THINKING_BUDGET_TOKENS[thinking.level] ?? THINKING_BUDGET_TOKENS.medium

    const body: any = {
      model: model.id,
      max_tokens: this.binding.maxOutputTokens ?? 8192,
      stream: true,
      messages: messages.map(m => ({ role: m.role, content: m.content }))
    }
    if (sysText) body.system = sysText
    if (wantThink) body.thinking = { type: 'enabled', budget_tokens: budget }
    if (this.binding.temperature !== undefined && !wantThink) body.temperature = this.binding.temperature

    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal })
    if (!res.ok || !res.body) {
      const txt = await res.text().catch(() => '')
      throw new Error(`Anthropic HTTP ${res.status}: ${txt.slice(0, 200)}`)
    }

    let content = ''
    let thinkingTxt = ''
    let thinkingStartedAt: number | null = null
    await this.readSse(res.body, (evt) => {
      if (!evt) return
      // anthropic event-stream: lines like "event: content_block_delta" then "data: {...}"
      const dataLine = evt.split('\n').find(l => l.startsWith('data: '))
      if (!dataLine) return
      const payload = dataLine.slice(6).trim()
      try {
        const obj = JSON.parse(payload)
        if (obj.type === 'content_block_start' && obj.content_block?.type === 'thinking') {
          thinkingStartedAt = Date.now()
        }
        if (obj.type === 'content_block_delta') {
          if (obj.delta?.type === 'thinking_delta' && obj.delta?.thinking) {
            thinkingTxt += obj.delta.thinking
            cb.onThinking?.(obj.delta.thinking)
          }
          if (obj.delta?.type === 'text_delta' && obj.delta?.text) {
            content += obj.delta.text
            cb.onContent?.(obj.delta.text)
          }
        }
        if (obj.type === 'message_stop') {
          // end
        }
      } catch {}
    })

    cb.onDone?.({
      content,
      thinking: thinkingTxt ? {
        enabled: true,
        level: thinking.level,
        budget,
        preview: thinkingTxt.slice(0, 280),
        durationMs: thinkingStartedAt ? Date.now() - thinkingStartedAt : undefined
      } : undefined
    })
  }

  // ---- Gemini generateContent (stream via SSE) ----
  private async streamGemini(provider: ProviderDefinition, model: ModelDefinition, messages: ChatCompletionMessage[], opts: CallOptions, thinking: ThinkingConfig, cb: StreamCallbacks, signal?: AbortSignal): Promise<void> {
    const url = `${provider.baseUrl.replace(/\/$/, '')}/models/${encodeURIComponent(model.id)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(provider.apiKey)}`
    const headers = this.headersFor(provider)
    const sysText = opts.systemPrompt
    const contents = messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }))
    const body: any = { contents }
    if (sysText) body.systemInstruction = { role: 'system', parts: [{ text: sysText }] }
    if (model.supportsThinking && thinking.mode !== 'off') {
      const budget = thinking.budgetTokens ?? THINKING_BUDGET_TOKENS[thinking.level] ?? THINKING_BUDGET_TOKENS.medium
      body.generationConfig = { thinkingConfig: { thinkingBudget: budget }, maxOutputTokens: this.binding.maxOutputTokens ?? 8192 }
    } else if (this.binding.maxOutputTokens) {
      body.generationConfig = { maxOutputTokens: this.binding.maxOutputTokens }
    }

    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal })
    if (!res.ok || !res.body) {
      const txt = await res.text().catch(() => '')
      throw new Error(`Gemini HTTP ${res.status}: ${txt.slice(0, 200)}`)
    }

    let content = ''
    let thinkingTxt = ''
    await this.readSse(res.body, (evt) => {
      if (!evt) return
      const dataLine = evt.split('\n').find(l => l.startsWith('data: '))
      if (!dataLine) return
      const payload = dataLine.slice(6).trim()
      try {
        const obj = JSON.parse(payload)
        const parts = obj.candidates?.[0]?.content?.parts || []
        for (const part of parts) {
          if (part.text && part.thought) {
            thinkingTxt += part.text
            cb.onThinking?.(part.text)
          } else if (part.text) {
            content += part.text
            cb.onContent?.(part.text)
          }
        }
      } catch {}
    })
    cb.onDone?.({
      content,
      thinking: thinkingTxt ? {
        enabled: true,
        level: thinking.level,
        preview: thinkingTxt.slice(0, 280)
      } : undefined
    })
  }

  private headersFor(p: ProviderDefinition): Record<string, string> {
    const h: Record<string, string> = { 'content-type': 'application/json', ...(p.customHeaders || {}) }
    if (p.kind === 'openai' || p.kind === 'openai-compatible' || p.kind === 'custom') { if (p.apiKey) { h['authorization'] = 'Bearer ' + p.apiKey } else { delete h['authorization'] } } else if (p.kind === 'anthropic') { if (p.apiKey) { h['x-api-key'] = p.apiKey } else { delete h['x-api-key'] } h['anthropic-version'] = '2023-06-01' }
    return h
  }

  private async readSse(body: ReadableStream<Uint8Array>, onEvent: (data: string) => void): Promise<void> {
    const reader = body.getReader()
    const decoder = new TextDecoder('utf-8')
    let buffer = ''
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let idx: number
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const evt = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 2)
        const dataLine = evt.split('\n').filter(l => l.startsWith('data: ')).join('\n')
        const cleaned = dataLine.replace(/^data: /gm, '').trim()
        onEvent(cleaned)
      }
    }
  }
}

export function buildProviderClient(resolved: ResolvedCall): ProviderClient {
  return new ProviderClient(resolved.provider, resolved.model, resolved.binding, resolved.thinking)
}
