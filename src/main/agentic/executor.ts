/**
 * AgentHub 原生 agentic 工具回环（HTTP 路径）。
 *
 * 把「读/写/列文件、执行命令」做成工具喂给 provider 模型，按 finishReason==='tool_calls'
 * 执行工具、回灌 role:'tool' 结果、循环，直到模型收尾或达上限/取消。每步发 activity 事件，
 * 复用既有步骤卡 UI，让纯 HTTP 模型也呈现「真在工作区动手」的全链路。
 *
 * provider 覆盖：openai-compatible / anthropic / gemini 三种线格式的工具下发与 tool_call
 * 回灌均已在 client.ts 实现，故三者都能触发 tool_calls 并进入回环。模型若不调用工具则
 * loop 第一轮即收尾（等价纯聊天，零回归）。
 */
import { buildProviderClient, ResolvedCall } from '../providers/client'
import { ChatCompletionMessage, ThinkingConfig } from '../providers/types'
import { AGENTIC_TOOLS, executeTool, ToolContext } from './tools'

export interface AgenticActivityStep {
  id: string
  kind?: string
  tool?: string
  label?: string
  detail?: string
  output?: string
  status: string
}

export interface AgenticEmit {
  delta: (channel: 'content' | 'thinking', text: string) => void
  activity: (step: AgenticActivityStep) => void
}

export interface RunAgenticParams {
  /** 用户任务文本（原始） */
  userText: string
  /** 系统提示（dispatcher 已拼入技能注入块 + 工作区 bootstrap 项目上下文） */
  systemPrompt: string
  resolved: ResolvedCall
  thinking: ThinkingConfig
  /** 工作区根目录；null = 无工作区（降级只读，禁止写/执行） */
  root: string | null
  isCancelled: () => boolean
  emit: AgenticEmit
  maxRounds?: number
}

const DEFAULT_MAX_ROUNDS = 8

function labelFor(name: string, args: any): string {
  if (name === 'fs_read') return 'Read · ' + (args.path ?? '')
  if (name === 'fs_write') return 'Write · ' + (args.path ?? '')
  if (name === 'fs_list') return 'List · ' + (args.path ?? '.')
  if (name === 'exec') return 'Bash · ' + String(args.command ?? '').slice(0, 60)
  return name
}

function summarizeArgs(name: string, args: any): string {
  if (name === 'fs_write') return (args.path ?? '') + ' (' + (typeof args.content === 'string' ? args.content.length : 0) + ' chars)'
  if (name === 'exec') return args.command ?? ''
  return args.path ?? ''
}

export async function runAgenticHttp(p: RunAgenticParams): Promise<{ content: string; usage?: any; error?: string }> {
  const client = buildProviderClient(p.resolved)
  const ctx: ToolContext = { root: p.root || process.cwd(), readOnly: !p.root }
  const messages: ChatCompletionMessage[] = [{ role: 'user', content: p.userText }]
  const maxRounds = p.maxRounds ?? DEFAULT_MAX_ROUNDS
  let fullContent = ''
  let lastUsage: any = undefined
  let stepSeq = 0

  for (let round = 0; round < maxRounds; round++) {
    if (p.isCancelled()) break
    let roundContent = ''
    let toolCalls: any[] | undefined
    let finishReason: string | undefined
    try {
      await new Promise<void>((resolve, reject) => {
        client.stream(
          { messages, systemPrompt: p.systemPrompt, thinkingOverride: p.thinking, tools: AGENTIC_TOOLS, toolChoice: 'auto' },
          {
            onContent: (delta) => { roundContent += delta; p.emit.delta('content', delta) },
            onThinking: (delta) => { p.emit.delta('thinking', delta) },
            onDone: (final) => { finishReason = final.finishReason; toolCalls = final.toolCalls; if (final.usage) lastUsage = final.usage; resolve() },
            onError: (err) => reject(err)
          }
        )
      })
    } catch (e: any) {
      return { content: fullContent, usage: lastUsage, error: e?.message || String(e) }
    }
    fullContent += roundContent
    if (p.isCancelled()) break

    if (finishReason === 'tool_calls' && toolCalls && toolCalls.length) {
      messages.push({
        role: 'assistant',
        content: roundContent,
        tool_calls: toolCalls.map(tc => ({ id: tc.id, type: 'function', function: { name: tc.function?.name, arguments: tc.function?.arguments || '{}' } }))
      })
      for (const tc of toolCalls) {
        if (p.isCancelled()) break
        const name = tc.function?.name || 'unknown'
        let parsed: any = {}
        try { parsed = JSON.parse(tc.function?.arguments || '{}') } catch { parsed = {} }
        const stepId = 'tool-' + (++stepSeq)
        const label = labelFor(name, parsed)
        const detail = summarizeArgs(name, parsed)
        p.emit.activity({ id: stepId, kind: 'tool', tool: name, label, detail, status: 'running' })
        const result = await executeTool(name, parsed, ctx)
        p.emit.activity({ id: stepId, kind: 'tool', tool: name, label, detail, output: result.output, status: result.ok ? 'done' : 'error' })
        messages.push({ role: 'tool', tool_call_id: tc.id, content: result.output })
      }
      continue
    }
    break
  }

  return { content: fullContent, usage: lastUsage }
}
