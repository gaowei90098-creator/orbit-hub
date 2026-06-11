import { EventEmitter } from "events"
import { AgentRegistry } from "./registry"
import { EventPipeline } from "./pipeline"
import { KeywordRouter } from "./router"
import { getProviderManager } from "../providers/manager"
import { buildProviderClient } from "../providers/client"
import { ChatCompletionMessage, ThinkingConfig } from "../providers/types"

export type DispatchMode = "auto" | "broadcast" | "chain"

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

  private async sendToAgent(task: DispatchTask, agentId: string, text: string, opts: DispatchOptions): Promise<{ content: string }> {
    const mgr = getProviderManager()
    const resolved = mgr.resolveBinding(agentId)
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
    const map: Record<string, string> = {
      codex: "You are Codex, an expert software engineer focused on coding, debugging and refactoring. Be precise and produce working code.",
      claude: "You are Claude Code, an analytical assistant focused on writing, research and clear explanations.",
      hermes: "You are Hermes, a system automation agent specialised in tooling, configuration and command execution.",
      openclaw: "You are OpenClaw, an automation and deployment agent specialised in pipelines, scripts and runtime tasks."
    }
    return map[agentId] || "You are AgentHub agent " + agentId + ". Be concise and helpful."
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
}
