import * as http from "http"
import { EventEmitter } from "events"
import { URL } from "url"
import { getProviderManager } from "../providers/manager"
import { buildProviderClient, ProviderClient } from "../providers/client"
import { ChatCompletionMessage, ChatCompletionRequest, ChatCompletionResponse, ThinkingSummary } from "../providers/types"

export class LocalProxy extends EventEmitter {
  private server: http.Server | null = null
  private port: number

  constructor(port = 9528) {
    super()
    this.port = port
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => this.handle(req, res))
      this.server.on("error", reject)
      this.server.listen(this.port, "127.0.0.1", () => {
        console.log("[Proxy] Chat Completions proxy listening on http://127.0.0.1:" + this.port + "/v1")
        resolve()
      })
    })
  }

  stop(): void {
    if (this.server) {
      this.server.close()
      this.server = null
    }
  }

  getUrl(): string {
    return "http://127.0.0.1:" + this.port + "/v1"
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url || "/", "http://127.0.0.1:" + this.port)
    const cors = {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type,authorization,x-api-key,anthropic-version",
      "access-control-max-age": "86400"
    }
    if (req.method === "OPTIONS") {
      res.writeHead(204, cors)
      res.end()
      return
    }
    for (const k of Object.keys(cors)) res.setHeader(k, cors[k as keyof typeof cors])

    try {
      if (url.pathname === "/v1/models" && req.method === "GET") return this.listModels(res)
      if (url.pathname === "/v1/providers" && req.method === "GET") return this.listProviders(res)
      if (url.pathname === "/v1/chat/completions" && req.method === "POST") return this.chatCompletions(req, res, false)
      if (url.pathname === "/v1/chat/completions/no-stream" && req.method === "POST") return this.chatCompletions(req, res, true)
      if (url.pathname === "/v1/route" && req.method === "POST") return this.route(req, res)
      if (url.pathname === "/health") {
        res.writeHead(200, { "content-type": "application/json" })
        res.end(JSON.stringify({ ok: true, ts: Date.now() }))
        return
      }
      res.writeHead(404, { "content-type": "application/json" })
      res.end(JSON.stringify({ error: { message: "not found", path: url.pathname } }))
    } catch (e: any) {
      res.writeHead(500, { "content-type": "application/json" })
      res.end(JSON.stringify({ error: { message: e?.message || String(e) } }))
    }
  }

  private listModels(res: http.ServerResponse): void {
    const mgr = getProviderManager()
    const data: any[] = []
    for (const p of mgr.getProviders()) {
      for (const m of p.models) {
        data.push({
          id: p.id + "/" + m.id,
          object: "model",
          created: Date.now(),
          owned_by: p.id,
          permission: [],
          root: m.id,
          parent: null,
          capabilities: {
            provider: p.id,
            providerKind: p.kind,
            thinking: m.supportsThinking,
            tools: m.supportsTools,
            vision: m.supportsVision,
            contextWindow: m.contextWindow,
            agentBinding: (mgr.getBindings().find(b => b.providerId === p.id && b.modelId === m.id) || {}).agentId || null
          }
        })
      }
    }
    res.writeHead(200, { "content-type": "application/json" })
    res.end(JSON.stringify({ object: "list", data }))
  }

  private listProviders(res: http.ServerResponse): void {
    const mgr = getProviderManager()
    res.writeHead(200, { "content-type": "application/json" })
    res.end(JSON.stringify({
      object: "list",
      data: mgr.getProviders().map(p => ({
        id: p.id,
        name: p.name,
        kind: p.kind,
        baseUrl: p.baseUrl,
        enabled: p.enabled,
        hasKey: !!p.apiKey,
        health: p.health || null,
        modelCount: p.models.length,
        capabilities: p.capabilities,
        defaultThinking: p.defaultThinking
      }))
    }))
  }

  private async route(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const body = await readBody(req)
    let parsed: any
    try { parsed = JSON.parse(body) } catch { parsed = {} }
    const agentId = parsed.agentId
    if (!agentId) {
      res.writeHead(400, { "content-type": "application/json" })
      res.end(JSON.stringify({ error: { message: "agentId required" } }))
      return
    }
    const mgr = getProviderManager()
    const resolved = mgr.resolveBinding(agentId)
    if (!resolved) {
      res.writeHead(503, { "content-type": "application/json" })
      res.end(JSON.stringify({ error: { message: "no available provider for agent " + agentId } }))
      return
    }
    const messages: ChatCompletionMessage[] = parsed.messages || []
    if (messages.length === 0) {
      res.writeHead(400, { "content-type": "application/json" })
      res.end(JSON.stringify({ error: { message: "messages required" } }))
      return
    }
    const client = buildProviderClient(resolved)
    await this.doStream(res, resolved.binding.agentId, resolved.model.id, messages, parsed.systemPrompt, parsed.thinking, client, !!parsed.noStream)
  }

  private async chatCompletions(req: http.IncomingMessage, res: http.ServerResponse, forceNoStream: boolean): Promise<void> {
    const body = await readBody(req)
    let parsed: ChatCompletionRequest
    try { parsed = JSON.parse(body) } catch {
      res.writeHead(400, { "content-type": "application/json" })
      res.end(JSON.stringify({ error: { message: "invalid json" } }))
      return
    }
    if (!parsed.model || !Array.isArray(parsed.messages)) {
      res.writeHead(400, { "content-type": "application/json" })
      res.end(JSON.stringify({ error: { message: "model and messages required" } }))
      return
    }
    const mgr = getProviderManager()
    const { providerId, modelId, agentBinding } = parseModelRef(parsed.model, mgr)
    const provider = providerId ? mgr.getProvider(providerId) : null
    if (!provider) {
      const allModels = mgr.getProviders().map(p => p.id + '/' + p.models.map(m => m.id).join(',')).join('; ')
      res.writeHead(503, { "content-type": "application/json" })
      res.end(JSON.stringify({ error: { message: "unknown model: " + parsed.model + ". Available: " + allModels } }))
      return
    }
    const model = provider.models.find(m => m.id === modelId) || provider.models[0]
    if (!model) {
      res.writeHead(503, { "content-type": "application/json" })
      res.end(JSON.stringify({ error: { message: "model not found in provider" } }))
      return
    }
    const binding = agentBinding || mgr.getBindings().find(b => b.providerId === provider.id && b.modelId === model.id) || {
      agentId: "proxy-" + provider.id,
      providerId: provider.id,
      modelId: model.id,
      thinkingAllow: ["off", "auto", "enabled"],
      thinking: provider.defaultThinking,
      temperature: parsed.temperature,
      maxOutputTokens: parsed.max_tokens
    }

    const client = buildProviderClient({
      provider,
      model,
      binding: binding as any,
      thinking: (binding as any).thinking || provider.defaultThinking,
    })
    await this.doStream(res, binding.agentId, model.id, parsed.messages, undefined, undefined, client, forceNoStream)
  }

  private async doStream(
    res: http.ServerResponse,
    agentId: string,
    modelId: string,
    messages: ChatCompletionMessage[],
    systemPrompt: string | undefined,
    thinkingOverride: any,
    client: ProviderClient,
    forceNoStream = false
  ): Promise<void> {
    const start = Date.now()
    this.emit("request", { model: modelId, agentId })

    let content = ""
    let thinkingTxt = ""
    let usage: any = undefined

    try {
      if (!forceNoStream) {
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          "connection": "keep-alive"
        })
      }
      await client.stream(
        { messages, systemPrompt, thinkingOverride },
        {
          onContent: (delta) => {
            content += delta
            if (!forceNoStream) {
              res.write("data: " + JSON.stringify({
                id: "cmpl-" + Date.now(),
                object: "chat.completion.chunk",
                created: Math.floor(Date.now() / 1000),
                model: modelId,
                choices: [{ index: 0, delta: { content: delta }, finish_reason: null }]
              }) + "\n\n")
            }
          },
          onThinking: (delta) => {
            thinkingTxt += delta
            if (!forceNoStream) {
              res.write("data: " + JSON.stringify({
                id: "cmpl-" + Date.now(),
                object: "chat.completion.chunk",
                created: Math.floor(Date.now() / 1000),
                model: modelId,
                choices: [{ index: 0, delta: { reasoning_content: delta }, finish_reason: null }]
              }) + "\n\n")
            }
          },
          onDone: (final) => {
            usage = final.usage
            if (forceNoStream) {
              const resp: ChatCompletionResponse = {
                id: "cmpl-" + Date.now(),
                object: "chat.completion",
                created: Math.floor(Date.now() / 1000),
                model: modelId,
                choices: [{ index: 0, message: { role: "assistant", content, reasoning_content: thinkingTxt }, finish_reason: "stop" }],
                usage,
                thinking: final.thinking
              }
              res.writeHead(200, { "content-type": "application/json" })
              res.end(JSON.stringify(resp))
            } else {
              res.write("data: " + JSON.stringify({
                id: "cmpl-" + Date.now(),
                object: "chat.completion.chunk",
                created: Math.floor(Date.now() / 1000),
                model: modelId,
                choices: [{ index: 0, delta: {}, finish_reason: "stop" }]
              }) + "\n\n")
              res.write("data: [DONE]\n\n")
              res.end()
            }
            this.emit("response", { model: modelId, agentId, durationMs: Date.now() - start, tokens: usage })
          },
          onError: (err) => {
            this.emit("error", { model: modelId, agentId, error: err.message })
            if (!res.headersSent) {
              res.writeHead(502, { "content-type": "application/json" })
              res.end(JSON.stringify({ error: { message: err.message } }))
            } else {
              res.write("data: " + JSON.stringify({ error: { message: err.message } }) + "\n\n")
              res.end()
            }
          }
        }
      )
    } catch (e: any) {
      this.emit("error", { model: modelId, agentId, error: e.message })
      if (!res.headersSent) {
        res.writeHead(502, { "content-type": "application/json" })
        res.end(JSON.stringify({ error: { message: e.message } }))
      } else {
        res.end()
      }
    }
  }
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on("data", (c) => chunks.push(c))
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")))
    req.on("error", reject)
  })
}

function parseModelRef(modelRef: string, mgr: ReturnType<typeof getProviderManager>): { providerId: string | null; modelId: string; agentBinding: any | null } {
  if (modelRef.includes("/")) {
    const slashIdx = modelRef.indexOf("/")
    const providerId = modelRef.slice(0, slashIdx)
    const modelId = modelRef.slice(slashIdx + 1)
    const binding = mgr.getBindings().find(b => b.providerId === providerId && b.modelId === modelId) || null
    return { providerId, modelId, agentBinding: binding }
  }
  for (const p of mgr.getProviders()) {
    const m = p.models.find(mm => mm.id === modelRef)
    if (m) {
      const binding = mgr.getBindings().find(b => b.providerId === p.id && b.modelId === m.id) || null
      return { providerId: p.id, modelId: m.id, agentBinding: binding }
    }
  }
  return { providerId: null, modelId: modelRef, agentBinding: null }
}

let _instance: LocalProxy | null = null
export function getLocalProxy(): LocalProxy {
  if (!_instance) _instance = new LocalProxy()
  return _instance
}
