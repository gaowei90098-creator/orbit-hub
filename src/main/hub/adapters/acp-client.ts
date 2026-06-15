/**
 * ACP（Agent Client Protocol）客户端 —— JSON-RPC 2.0 over stdio（NDJSON）。
 *
 * 统一接入支持 ACP 的本地 agent CLI（hermes acp / openclaw acp / opencode acp）：
 * 一套客户端即可拿到结构化活动（工具调用 / 文件改动 / 思考 / 正文），不靠脆弱的文本逆向。
 *
 * 生命周期：start()=spawn server + `initialize` 握手 → newSession(cwd)=`session/new` →
 * prompt(sessionId, text, handlers)=`session/prompt`，期间消费 `session/update` 通知，
 * 直到收到 prompt 响应里的 `stopReason`。cancel() 发 `session/cancel`。
 *
 * 第一阶段：clientCapabilities.fs=false（三个 agent 都自带文件/执行能力，由其自身在 cwd 内操作）；
 * 收到 `session/request_permission` 时自动放行（allow_once）。审批门禁对接 / client fs handler 留作后续。
 */
import { spawn, ChildProcess } from 'node:child_process'

export interface AcpActivityStep {
  id: string
  kind?: string
  tool?: string
  label?: string
  detail?: string
  output?: string
  status: 'running' | 'done' | 'error'
}

export interface MappedUpdate {
  content?: string
  thinking?: string
  steps?: AcpActivityStep[]
}

export interface AcpPromptHandlers {
  onChunk?: (text: string) => void
  onThought?: (text: string) => void
  onActivity?: (step: AcpActivityStep) => void
}

const STATUS_MAP: Record<string, 'running' | 'done' | 'error'> = {
  pending: 'running',
  in_progress: 'running',
  completed: 'done',
  failed: 'error'
}

function clip(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s
}

/** ContentBlock / 内容块数组 → 纯文本（ACP 文本块为 {type:'text', text}）。 */
export function acpBlockText(c: any): string {
  if (!c) return ''
  if (typeof c === 'string') return c
  if (Array.isArray(c)) return c.map(acpBlockText).join('')
  if (c.type === 'text') return c.text || ''
  return ''
}

/** tool_call(_update) 的 content[] → 摘要文本（content 块取文本；diff 块取路径 + 新内容预览）。 */
export function acpToolContent(content: any): string {
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const item of content) {
    if (!item) continue
    if (item.type === 'content') parts.push(acpBlockText(item.content))
    else if (item.type === 'diff') parts.push(`--- ${item.path}\n${clip(item.newText ?? '', 300)}`)
  }
  return clip(parts.filter(Boolean).join('\n'), 800)
}

/**
 * ACP `session/update` 的 `update` 对象 → AgentHub 活动模型（纯函数，便于单测）。
 * 复用既有活动步骤卡形状（与 claude-stream-json 的 ActivityStepLike 对齐）。
 * 未呈现的类型（plan / user_message_chunk / 其它）返回 null。
 */
export function mapAcpUpdate(update: any): MappedUpdate | null {
  if (!update || typeof update !== 'object') return null
  switch (update.sessionUpdate) {
    case 'agent_message_chunk': {
      const t = acpBlockText(update.content)
      return t ? { content: t } : null
    }
    case 'agent_thought_chunk': {
      const t = acpBlockText(update.content)
      return t ? { thinking: t } : null
    }
    case 'tool_call': {
      if (!update.toolCallId) return null
      const loc = Array.isArray(update.locations) && update.locations[0]?.path
      const detail = update.rawInput ? clip(safeJson(update.rawInput), 400) : (loc || '')
      return {
        steps: [{
          id: String(update.toolCallId),
          kind: 'tool',
          tool: update.kind || 'tool',
          label: update.title || update.kind || 'tool',
          detail: detail || undefined,
          status: STATUS_MAP[update.status] || 'running'
        }]
      }
    }
    case 'tool_call_update': {
      if (!update.toolCallId) return null
      const out = acpToolContent(update.content)
      return {
        steps: [{
          id: String(update.toolCallId),
          status: STATUS_MAP[update.status] || 'running',
          output: out || undefined
        }]
      }
    }
    default:
      return null
  }
}

function safeJson(v: any): string {
  try { return JSON.stringify(v) } catch { return String(v) }
}

type Pending = { resolve: (v: any) => void; reject: (e: any) => void }

/**
 * 一个 ACP server 子进程的 JSON-RPC 客户端。一个 AcpClient 实例对应一个常驻 server，
 * 跨多次 prompt 复用（session 每次 prompt 新建，第一阶段不复用会话记忆）。
 */
export class AcpClient {
  private proc: ChildProcess | null = null
  private nextId = 1
  private pending = new Map<number, Pending>()
  private buf = ''
  private decoder = new TextDecoder('utf-8')
  private initResult: any = null
  /** 当前活跃 prompt 的 update 处理器（按 sessionId） */
  private promptHandlers = new Map<string, AcpPromptHandlers>()
  /** server 崩溃 / 退出回调（adapter 用于把错误外显） */
  onCrash: ((e: Error) => void) | null = null

  constructor(
    private binary: string,
    private args: string[],
    private env?: Record<string, string>
  ) {}

  get running(): boolean { return !!this.proc }
  get agentCapabilities(): any { return this.initResult?.agentCapabilities ?? null }

  /** spawn server 并完成 initialize 握手。幂等：已启动则直接返回。 */
  async start(cwd?: string): Promise<void> {
    if (this.proc) return
    const proc = spawn(this.binary, this.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: cwd || undefined,
      env: { ...process.env, ...(this.env || {}) },
      windowsHide: true
    })
    this.proc = proc
    proc.stdout?.on('data', (d: Buffer) => this.onStdout(d))
    proc.stderr?.on('data', () => { /* server 端日志：忽略；崩溃由 exit 处理 */ })
    proc.on('error', (e: Error) => this.handleExit(e))
    proc.on('exit', (code) => this.handleExit(new Error(`ACP server '${this.binary}' 退出（code ${code}）`)))

    this.initResult = await this.request('initialize', {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
      clientInfo: { name: 'AgentHub', version: '0.5.0' }
    })
  }

  /** 新建会话，返回 sessionId。 */
  async newSession(cwd: string): Promise<string> {
    const res = await this.request('session/new', { cwd, mcpServers: [] })
    const sid = res?.sessionId
    if (!sid) throw new Error('ACP session/new 未返回 sessionId')
    return String(sid)
  }

  /** 发一轮 prompt，消费 session/update 直到 prompt 响应返回 stopReason。 */
  async prompt(sessionId: string, text: string, handlers: AcpPromptHandlers): Promise<string> {
    this.promptHandlers.set(sessionId, handlers)
    try {
      const res = await this.request('session/prompt', {
        sessionId,
        prompt: [{ type: 'text', text }]
      })
      return res?.stopReason || 'end_turn'
    } finally {
      this.promptHandlers.delete(sessionId)
    }
  }

  /** 中断当前轮（通知，无响应）。 */
  cancel(sessionId: string): void {
    this.notify('session/cancel', { sessionId })
  }

  stop(): void {
    const p = this.proc
    this.proc = null
    if (p?.pid) {
      try { p.kill() } catch { /* noop */ }
    }
  }

  /* ---------------- JSON-RPC 收发 ---------------- */

  private request(method: string, params: any): Promise<any> {
    if (!this.proc) return Promise.reject(new Error('ACP server 未启动'))
    const id = this.nextId++
    const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'
    return new Promise<any>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      try {
        this.proc!.stdin?.write(payload)
      } catch (e) {
        this.pending.delete(id)
        reject(e)
      }
    })
  }

  private notify(method: string, params: any): void {
    if (!this.proc) return
    try {
      this.proc.stdin?.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n')
    } catch { /* noop */ }
  }

  private respond(id: number | string, result: any): void {
    if (!this.proc) return
    try {
      this.proc.stdin?.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n')
    } catch { /* noop */ }
  }

  private onStdout(d: Buffer): void {
    this.buf += this.decoder.decode(d, { stream: true })
    let nl: number
    while ((nl = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, nl).trim()
      this.buf = this.buf.slice(nl + 1)
      if (line) this.handleMessage(line)
    }
  }

  /** 处理一条 JSON-RPC 消息（response / agent→client request / notification）。 */
  private handleMessage(line: string): void {
    let msg: any
    try { msg = JSON.parse(line) } catch { return } // 非 JSON 行（server 偶发日志）跳过
    if (!msg || typeof msg !== 'object') return

    // 1) response（带 id + result/error，无 method）
    if (msg.id !== undefined && msg.method === undefined) {
      const p = this.pending.get(msg.id)
      if (!p) return
      this.pending.delete(msg.id)
      if (msg.error) p.reject(new Error(msg.error?.message || 'ACP error ' + safeJson(msg.error)))
      else p.resolve(msg.result)
      return
    }

    // 2) agent→client request（带 id + method）：request_permission / fs/* 等
    if (msg.id !== undefined && typeof msg.method === 'string') {
      this.handleServerRequest(msg)
      return
    }

    // 3) notification（无 id）：session/update 等
    if (typeof msg.method === 'string') {
      this.handleNotification(msg)
    }
  }

  private handleServerRequest(msg: any): void {
    if (msg.method === 'session/request_permission') {
      // 第一阶段：自动放行（优先 allow_once，退而求其次取第一个 allow* 选项）。审批对接留作后续。
      const opts: any[] = Array.isArray(msg.params?.options) ? msg.params.options : []
      const pick = opts.find(o => o.kind === 'allow_once') || opts.find(o => o.kind === 'allow_always') || opts[0]
      this.respond(msg.id, pick ? { outcome: { outcome: 'selected', optionId: pick.optionId } } : { outcome: { outcome: 'cancelled' } })
      return
    }
    // 其余 server→client 请求（fs/terminal）：第一阶段未声明能力，理应不会收到；保守回错误避免挂起。
    if (this.proc) {
      try {
        this.proc.stdin?.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'method not supported by client' } }) + '\n')
      } catch { /* noop */ }
    }
  }

  private handleNotification(msg: any): void {
    if (msg.method !== 'session/update') return
    const sid = msg.params?.sessionId
    const handlers = sid ? this.promptHandlers.get(sid) : undefined
    if (!handlers) return
    const mapped = mapAcpUpdate(msg.params?.update)
    if (!mapped) return
    if (mapped.content && handlers.onChunk) handlers.onChunk(mapped.content)
    if (mapped.thinking && handlers.onThought) handlers.onThought(mapped.thinking)
    if (mapped.steps && handlers.onActivity) for (const s of mapped.steps) handlers.onActivity(s)
  }

  private handleExit(err: Error): void {
    this.proc = null
    this.initResult = null
    for (const [, p] of this.pending) p.reject(err)
    this.pending.clear()
    this.promptHandlers.clear()
    if (this.onCrash) this.onCrash(err)
  }
}
