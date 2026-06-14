import { EventEmitter } from "events"
import { AgentRegistry } from "./registry"
import { EventPipeline } from "./pipeline"
import { KeywordRouter } from "./router"
import { getProviderManager } from "../providers/manager"
import { buildProviderClient } from "../providers/client"
import { agentSystemPrompt } from "./agents"
import { decompositionPrompt, parsePlan, synthesisPrompt, verifyPrompt, parseVerdict, retryPrompt, ORCHESTRATOR_LEAD_SYSTEM } from "./orchestrator"
import { ChatCompletionMessage, ThinkingConfig } from "../providers/types"

export type DispatchMode = "auto" | "broadcast" | "chain" | "orchestrate"

export interface DispatchTask {
  id: string
  text: string
  mode: DispatchMode
  targetAgent?: string
  status: "pending" | "running" | "completed" | "failed" | "cancelled"
  results: Map<string, string>
  thinking: Map<string, string>
  errors: Map<string, string>
  usage: Map<string, { prompt_tokens: number; completion_tokens: number; total_tokens: number }>
  thinkingSummary: Map<string, { enabled: boolean; level?: string; budget?: number; preview?: string }>
  error?: string
  createdAt: Date
}

export interface DispatchOptions {
  thinking?: ThinkingConfig
  systemPrompt?: string
}

export type StreamEvent =
  | { kind: "start"; taskId: string; agentId: string; providerId: string; modelId: string; mode: "content" | "thinking" }
  | { kind: "delta"; taskId: string; agentId: string; providerId: string; modelId: string; channel: "content" | "thinking"; text: string }
  | { kind: "done"; taskId: string; agentId: string; providerId: string; modelId: string; content: string; thinking?: string; summary?: { level?: string; budget?: number; preview?: string }; durationMs: number; usage?: any }
  | { kind: "error"; taskId: string; agentId: string; providerId?: string; modelId?: string; error: string }
  // 编排模式（Orchestrator）
  | { kind: "orchestrate:plan"; taskId: string; leadAgentId?: string; subtasks: Array<{ id: string; title: string; detail?: string; agentId?: string }> }
  | { kind: "orchestrate:subtask"; taskId: string; subtaskId: string; agentId?: string; status: "pending" | "running" | "done" | "error"; content?: string }
  | { kind: "orchestrate:verdict"; taskId: string; subtaskId: string; pass: boolean; note?: string; attempt: number }
  | { kind: "orchestrate:synthesizing"; taskId: string }
  | { kind: "orchestrate:final"; taskId: string; content: string }
  | { kind: "orchestrate:error"; taskId: string; error: string }

export class Dispatcher extends EventEmitter {
  private tasks: Map<string, DispatchTask> = new Map()
  private taskCounter = 0

  constructor(
    private registry: AgentRegistry,
    private pipeline: EventPipeline
  ) {
    super()
  }

  emit(event: string | symbol, ...args: any[]): boolean {
    return super.emit(event, ...args)
  }

  on(event: "stream", listener: (e: StreamEvent) => void): this
  on(event: string, listener: (...args: any[]) => void): this
  on(event: string | symbol, listener: (...args: any[]) => void): this {
    return super.on(event, listener)
  }

  off(event: string | symbol, listener: (...args: any[]) => void): this {
    return super.off(event, listener)
  }

  /**
   * Dispatch a prompt. Returns the task object; results stream via "stream" events.
   * No demo / mock fallback: if no provider is bound the call fails immediately.
   */
  async dispatch(text: string, mode: DispatchMode = "auto", targetAgent?: string, opts: DispatchOptions = {}): Promise<DispatchTask> {
    const taskId = "task-" + (++this.taskCounter)
    const task: DispatchTask = {
      id: taskId,
      text,
      mode,
      targetAgent,
      status: "pending",
      results: new Map(),
      thinking: new Map(),
      errors: new Map(),
      usage: new Map(),
      thinkingSummary: new Map(),
      createdAt: new Date()
    }
    this.tasks.set(task.id, task)

    task.status = "running"
    try {
      if (mode === "orchestrate") {
        await this.runOrchestrate(task, text, opts)
      } else {
        const targets = this.resolveTargets(task, mode, targetAgent)
        if (targets.length === 0) throw new Error("No available provider for the requested routing. Open Settings -> Providers to configure API keys.")

        if (mode === "chain") {
          let currentText = text
          for (const t of targets) {
            const res = await this.sendToAgent(task, t.agentId, currentText, opts)
            if ((task as any).status === "cancelled") break
            currentText = res.content
          }
        } else {
          await Promise.all(targets.map(t => this.sendToAgent(task, t.agentId, text, opts)))
        }

        if ((task as any).status !== "cancelled") task.status = task.errors.size === targets.length && targets.length > 0 ? "failed" : "completed"
      }
    } catch (e: any) {
      task.status = "failed"
      task.error = e.message
    }
    return task
  }

  private resolveTargets(task: DispatchTask, mode: DispatchMode, targetAgent?: string): Array<{ agentId: string }> {
    const mgr = getProviderManager()
    const bindings = mgr.getBindings()
    if (targetAgent) {
      const b = bindings.find(x => x.agentId === targetAgent)
      return b ? [{ agentId: targetAgent }] : []
    }
    if (mode === "broadcast") {
      return bindings.map(b => ({ agentId: b.agentId }))
    }
    // auto: route by keyword
    const router = new KeywordRouter()
    const routed = router.route(task.text, this.registry.getAll().map(a => ({
      id: a.id,
      name: a.name,
      status: a.status,
      mode: a.mode,
      protocol: a.protocol,
      adapter: a.adapter,
      capabilities: a.capabilities,
      lastActive: a.lastActive,
      errorCount: a.errorCount
    })))
    if (routed && bindings.find(b => b.agentId === routed)) return [{ agentId: routed }]
    return bindings.length > 0 ? [{ agentId: bindings[0].agentId }] : []
  }

  /**
   * 编排模式：lead agent 分解任务 → 各 agent 并行执行子任务 → lead 汇总。
   * 复用 sendToAgent 执行；额外发 orchestrate:* 事件供 UI 渲染（其内部 start/delta/done 事件
   * 渲染层在编排消息上忽略，只用 orchestrate:* 驱动 OrchestrateView）。
   */
  private async runOrchestrate(task: DispatchTask, text: string, opts: DispatchOptions): Promise<void> {
    const mgr = getProviderManager()
    const bindings = mgr.getBindings()
    if (bindings.length === 0) throw new Error("No agent bound. Open Settings -> Routing to bind an agent.")

    const router = new KeywordRouter()
    const available = this.registry.getAll().map(a => ({
      id: a.id, name: a.name, status: a.status, mode: a.mode, protocol: a.protocol,
      adapter: a.adapter, capabilities: a.capabilities, lastActive: a.lastActive, errorCount: a.errorCount
    }))
    const bound = new Set(bindings.map(b => b.agentId))
    const routed = router.route(text, available)
    const leadId = (routed && bound.has(routed)) ? routed : bindings[0].agentId

    try {
      this.emit("stream", { kind: "orchestrate:plan", taskId: task.id, leadAgentId: leadId, subtasks: [] })

      // 1. 分解
      const planRes = await this.sendToAgent(task, leadId, decompositionPrompt(text), { ...opts, systemPrompt: ORCHESTRATOR_LEAD_SYSTEM })
      let plan = parsePlan(planRes.content)
      if (!plan || plan.subtasks.length === 0) {
        plan = { subtasks: [{ id: "1", title: text.slice(0, 40), detail: text }] }
      }
      // 指派：lead 未指定或不可用时按 routeScores 选可用 agent，兜底用 lead
      for (const st of plan.subtasks) {
        if (!st.agentId || !bound.has(st.agentId)) {
          const scored = router.routeScores(st.detail || st.title, available).filter(s => bound.has(s.id))
          st.agentId = scored[0]?.id || leadId
        }
      }
      this.emit("stream", {
        kind: "orchestrate:plan", taskId: task.id, leadAgentId: leadId,
        subtasks: plan.subtasks.map(s => ({ id: s.id, title: s.title, detail: s.detail, agentId: s.agentId }))
      })

      // 2. 并行执行子任务（O3：测试 agent 校验 + 有界回环修复，最多 2 次尝试）
      const MAX_ATTEMPTS = 2
      const parts = await Promise.all(plan.subtasks.map(async (st) => {
        if ((task as any).status === "cancelled") return { title: st.title, agentId: st.agentId, content: "", error: "cancelled" }
        let content = ""
        let lastNote: string | undefined
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
          if ((task as any).status === "cancelled") break
          this.emit("stream", { kind: "orchestrate:subtask", taskId: task.id, subtaskId: st.id, agentId: st.agentId, status: "running" })
          try {
            const prompt = attempt === 1 ? (st.detail || st.title) : retryPrompt(st.detail || st.title, lastNote)
            const r = await this.sendToAgent(task, st.agentId!, prompt, opts)
            content = r.content
            this.emit("stream", { kind: "orchestrate:subtask", taskId: task.id, subtaskId: st.id, agentId: st.agentId, status: "done", content })
            // 校验：用 lead 作为 verify agent
            const verifyRaw = (await this.sendToAgent(task, leadId, verifyPrompt(st.title, st.detail, content), { ...opts, systemPrompt: ORCHESTRATOR_LEAD_SYSTEM })).content
            const v = parseVerdict(verifyRaw)
            this.emit("stream", { kind: "orchestrate:verdict", taskId: task.id, subtaskId: st.id, pass: v.pass, note: v.note, attempt })
            if (v.pass) return { title: st.title, agentId: st.agentId, content }
            lastNote = v.note
            if (attempt >= MAX_ATTEMPTS) return { title: st.title, agentId: st.agentId, content, error: "校验未通过: " + (v.note || "结果不达标") }
          } catch (e: any) {
            const err = e?.message || String(e)
            this.emit("stream", { kind: "orchestrate:subtask", taskId: task.id, subtaskId: st.id, agentId: st.agentId, status: "error", content: err })
            return { title: st.title, agentId: st.agentId, content: "", error: err }
          }
        }
        return { title: st.title, agentId: st.agentId, content }
      }))

      if ((task as any).status === "cancelled") return

      // 3. lead 汇总
      this.emit("stream", { kind: "orchestrate:synthesizing", taskId: task.id })
      const synth = await this.sendToAgent(task, leadId, synthesisPrompt(text, parts), { ...opts, systemPrompt: ORCHESTRATOR_LEAD_SYSTEM })
      this.emit("stream", { kind: "orchestrate:final", taskId: task.id, content: synth.content })
      task.results.set("orchestrate", synth.content)
      task.status = "completed"
    } catch (e: any) {
      this.emit("stream", { kind: "orchestrate:error", taskId: task.id, error: e?.message || String(e) })
      throw e
    }
  }

  private async sendToAgent(task: DispatchTask, agentId: string, text: string, opts: DispatchOptions): Promise<{ content: string }> {
    const mgr = getProviderManager()
    const resolved = mgr.resolveBinding(agentId)
 // stdio routing: 若 registry 注册的是 stdio adapter(非 http),则走本地 CLI 子进程
 const agentInfo = this.registry.get(agentId)
 if (agentInfo && (agentInfo.adapter as any).protocol && (agentInfo.adapter as any).protocol !== 'http') {
 const binding = mgr.getBinding(agentId)
 return this.sendToAgentStdio(task, agentId, text, opts, resolved, agentInfo.adapter, binding)
 }
    if (!resolved) {
      const err = "No available provider for agent " + agentId
      task.errors.set(agentId, err)
      this.emit("stream", { kind: "error", taskId: task.id, agentId, error: err })
      return { content: "" }
    }
    this.registry.setStatus(agentId, "busy")
    const messages: ChatCompletionMessage[] = [{ role: "user", content: text }]
    const client = buildProviderClient(resolved)
    const systemPrompt = opts.systemPrompt || this.systemPromptFor(agentId)
    const thinking = opts.thinking || resolved.thinking

    let content = ""
    let thinkingTxt = ""
    let summary: any = undefined
    let usage: any = undefined
    const start = Date.now()
    this.emit("stream", {
      kind: "start",
      taskId: task.id,
      agentId,
      providerId: resolved.provider.id,
      modelId: resolved.model.id,
      mode: "content"
    })

    try {
      await this.pipeline.process(text, agentId)
      await new Promise<void>((resolve, reject) => {
        client.stream(
          { messages, systemPrompt, thinkingOverride: thinking },
          {
            onContent: (delta) => {
              content += delta
              this.emit("stream", { kind: "delta", taskId: task.id, agentId, providerId: resolved.provider.id, modelId: resolved.model.id, channel: "content", text: delta })
            },
            onThinking: (delta) => {
              thinkingTxt += delta
              this.emit("stream", { kind: "delta", taskId: task.id, agentId, providerId: resolved.provider.id, modelId: resolved.model.id, channel: "thinking", text: delta })
            },
            onDone: (final) => {
              summary = final.thinking
              usage = final.usage
              resolve()
            },
            onError: (err) => reject(err)
          }
        )
      })
      task.results.set(agentId, content)
      task.thinking.set(agentId, thinkingTxt)
      if (summary) task.thinkingSummary.set(agentId, summary)
      this.emit("stream", {
        kind: "done",
        taskId: task.id,
        agentId,
        providerId: resolved.provider.id,
        modelId: resolved.model.id,
        content,
        thinking: thinkingTxt,
        summary,
        usage,
        durationMs: Date.now() - start
      })
      task.usage.set(agentId, usage)
      return { content }
    } catch (e: any) {
      task.errors.set(agentId, e.message)
      this.emit("stream", { kind: "error", taskId: task.id, agentId, providerId: resolved.provider.id, modelId: resolved.model.id, error: e.message })
      return { content: "" }
    } finally {
      this.registry.setStatus(agentId, "idle")
    }
  }

  private systemPromptFor(agentId: string): string {
    return agentSystemPrompt(agentId)
  }

  cancel(taskId: string): boolean {
    const task = this.tasks.get(taskId)
    if (task && task.status === "running") {
      task.status = "cancelled"
      return true
    }
    return false
  }

  getTask(taskId: string): DispatchTask | undefined {
    return this.tasks.get(taskId)
  }

  getRecentTasks(limit = 20): DispatchTask[] {
    return Array.from(this.tasks.values())
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit)
  }

  /** Stdio路径: 通过本地 CLI 子进程向 agent 发 prompt, 收集 stdout 作为 stream 内容.
   * oneshot 适配器（codex exec / claude --print）以进程退出为完成信号;
   * interactive 适配器保留输出静默判定; 任务被取消时 kill 子进程.
   * 注意: stdio 不依赖 HTTP provider, resolved 可为 null.
   */
  private async sendToAgentStdio(task: DispatchTask, agentId: string, text: string, _opts: DispatchOptions, resolved: any, adapter: any, binding?: any): Promise<{ content: string }> {
    this.registry.setStatus(agentId, "busy")
    let content = ""
    // stdio 直连本地 CLI：用绑定自身的 provider/model 做标注（而非 HTTP 回退结果，
    // 否则本地任务会被错标成 fallbackChain 里某个 HTTP provider）
    const providerId = binding?.providerId ?? resolved?.provider?.id ?? "local-cli"
    const modelId = binding?.modelId ?? resolved?.model?.id ?? "stdio"
    this.emit("stream", { kind: "start", taskId: task.id, agentId, providerId, modelId, mode: "content" })
    const start = Date.now()
    const TIMEOUT_MS = 5 * 60 * 1000           // 硬超时
    const POLL_MS = 200
    // 启动后这么久仍无任何输出且进程未退出 → 判为卡死（GUI/交互式二进制，参见 #1 Marvis）
    const STARTUP_SILENCE_MS = 60 * 1000
    // 已产生输出后静默这么久且进程未退出 → 兜底视为已完成（应对输出完却不退出的 CLI）
    const IDLE_AFTER_OUTPUT_MS = 45 * 1000
    const procField = "proc" // 适配器内部的子进程字段
    const self = this
    let settled = false
    let spawnedOnce = false
    const cleanup = () => {
      adapter.onOutput = null
      adapter.onError = null
    }
    try {
      await this.pipeline.process(text, agentId)
      await new Promise<void>((resolveP, rejectP) => {
        let lastOutputAt = Date.now()
        const onChunk = (chunk: string) => {
          content += chunk
          lastOutputAt = Date.now()
          self.emit("stream", { kind: "delta", taskId: task.id, agentId, providerId, modelId, channel: "content", text: chunk })
        }
        const onErr = (err: Error) => {
          if (settled) return
          settled = true
          clearInterval(poll)
          cleanup()
          rejectP(err)
        }
        adapter.onOutput = onChunk
        adapter.onError = onErr
        adapter.start().then(() => {
          try {
            adapter.send(text)
            spawnedOnce = true
          } catch (e) { onErr(e as Error) }
        }).catch(onErr)
        const poll = setInterval(() => {
          if (settled) return
          const proc = adapter[procField]
          const idle = Date.now() - lastOutputAt
          const elapsed = Date.now() - start
          const hasOutput = content.length > 0
          const procGone = spawnedOnce && !proc                                   // 进程退出 = oneshot 正常完成
          const quietDone = hasOutput && idle > IDLE_AFTER_OUTPUT_MS               // 有输出后久静默 → 兜底完成
          const stalledNoOutput = spawnedOnce && !hasOutput && elapsed > STARTUP_SILENCE_MS // 始终无输出 → 卡死
          const timedOut = elapsed > TIMEOUT_MS
          const cancelled = (task as any).status === "cancelled"
          if (procGone || quietDone || stalledNoOutput || timedOut || cancelled) {
            settled = true
            clearInterval(poll)
            cleanup()
            if (cancelled || timedOut || stalledNoOutput) {
              try { adapter.stop() } catch { /* noop */ }
            }
            // 卡死 / 超时 → 显式报错，绝不把卡住的 banner/动画当作“完成”静默返回
            if (stalledNoOutput) {
              rejectP(new Error(`本地 CLI 启动 ${Math.round(STARTUP_SILENCE_MS / 1000)}s 无任何输出，疑似无法用于非交互直连（GUI/REPL）。建议改用 HTTP 绑定。`))
              return
            }
            if (timedOut) {
              rejectP(new Error("本地 CLI 执行超时（5 分钟）" + (hasOutput ? "，仅收到部分输出" : "")))
              return
            }
            resolveP()  // procGone / quietDone / cancelled → 用已收集内容完成
          }
        }, POLL_MS)
      })
      task.results.set(agentId, content)
      this.emit("stream", { kind: "done", taskId: task.id, agentId, providerId, modelId, content, durationMs: Date.now() - start })
      return { content }
    } catch (e: any) {
      task.errors.set(agentId, e.message)
      this.emit("stream", { kind: "error", taskId: task.id, agentId, providerId, modelId, error: e.message })
      return { content: "" }
    } finally {
      try { await adapter.stop() } catch { /* noop */ }
      this.registry.setStatus(agentId, "idle")
    }
  }
}
