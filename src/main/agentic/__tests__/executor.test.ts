import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * runAgenticHttp 回环单测 — mock provider client + tools，断言：
 *   首轮 finishReason='tool_calls' → 执行工具 → 回灌 → 次轮收尾；内容累积；activity 步骤；取消即停。
 */

const h = vi.hoisted(() => ({
  streamCalls: 0,
  script: [] as Array<(cb: any) => void>,
  toolCalls: 0
}))

vi.mock('../../providers/client', () => ({
  buildProviderClient: () => ({
    stream: (_req: any, cb: any) => { const step = h.script[h.streamCalls]; h.streamCalls++; step?.(cb) }
  })
}))

vi.mock('../tools', () => ({
  AGENTIC_TOOLS: [],
  executeTool: async () => { h.toolCalls++; return { ok: true, output: 'TOOL_OUTPUT' } }
}))

beforeEach(() => { h.streamCalls = 0; h.script = []; h.toolCalls = 0 })

describe('runAgenticHttp', () => {
  it('tool_calls → 执行工具 → 回灌 → 次轮收尾', async () => {
    const { runAgenticHttp } = await import('../executor')
    h.script = [
      (cb) => { cb.onContent('A'); cb.onDone({ finishReason: 'tool_calls', toolCalls: [{ id: 't1', function: { name: 'fs_read', arguments: '{"path":"a.txt"}' } }], usage: { total_tokens: 3 } }) },
      (cb) => { cb.onContent('B'); cb.onDone({ finishReason: 'stop', usage: { total_tokens: 5 } }) }
    ]
    const activities: any[] = []
    let content = ''
    const res = await runAgenticHttp({
      userText: 'do it', systemPrompt: 'sys', resolved: {} as any, thinking: {} as any, root: null,
      isCancelled: () => false,
      emit: { delta: (_c, t) => { content += t }, activity: (s) => activities.push(s) }
    })
    expect(h.streamCalls).toBe(2)        // 进入了第二轮
    expect(h.toolCalls).toBe(1)          // 工具被执行一次
    expect(res.content).toBe('AB')       // 两轮内容累积
    expect(content).toBe('AB')           // delta 累积一致
    expect(activities.map(a => a.status)).toEqual(['running', 'done'])
    expect(activities[1].output).toBe('TOOL_OUTPUT')
  })

  it('开始即取消 → 不发起任何请求', async () => {
    const { runAgenticHttp } = await import('../executor')
    h.script = [(cb) => { cb.onContent('X'); cb.onDone({ finishReason: 'stop' }) }]
    const res = await runAgenticHttp({
      userText: 'x', systemPrompt: 's', resolved: {} as any, thinking: {} as any, root: null,
      isCancelled: () => true,
      emit: { delta: () => {}, activity: () => {} }
    })
    expect(h.streamCalls).toBe(0)
    expect(res.content).toBe('')
  })

  it('模型不调用工具 → 第一轮即收尾（等价纯聊天）', async () => {
    const { runAgenticHttp } = await import('../executor')
    h.script = [(cb) => { cb.onContent('hello'); cb.onDone({ finishReason: 'stop' }) }]
    const res = await runAgenticHttp({
      userText: 'hi', systemPrompt: 's', resolved: {} as any, thinking: {} as any, root: null,
      isCancelled: () => false,
      emit: { delta: () => {}, activity: () => {} }
    })
    expect(h.streamCalls).toBe(1)
    expect(h.toolCalls).toBe(0)
    expect(res.content).toBe('hello')
  })
})
