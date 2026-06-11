import { EventEmitter } from "events"

export interface AgentAdapter {
  id: string
  name: string
  binary: string
  protocol: "stdio-ndjson" | "stdio-plain" | "http"
  mode: "interactive" | "oneshot"
  start(): Promise<void>
  stop(): Promise<void>
  send(prompt: string): void
  onOutput: ((chunk: string) => void) | null
  onError: ((err: Error) => void) | null
  status: "idle" | "busy" | "error"
}

export abstract class BaseAgentAdapter extends EventEmitter implements AgentAdapter {
  abstract id: string
  abstract name: string
  abstract binary: string
  abstract protocol: "stdio-ndjson" | "stdio-plain" | "http"
  abstract mode: "interactive" | "oneshot"

  status: "idle" | "busy" | "error" = "idle"
  onOutput: ((chunk: string) => void) | null = null
  onError: ((err: Error) => void) | null = null

  protected process: any = null
  protected buffer = ""
  protected startCount = 0

  abstract start(): Promise<void>
  abstract stop(): Promise<void>
  abstract send(prompt: string): void

  protected handleOutput(chunk: string): void {
    if (this.onOutput) this.onOutput(chunk)
  }

  protected handleError(err: Error): void {
    this.status = "error"
    if (this.onError) this.onError(err)
  }
}

/**
 * Provider-driven Adapter.
 * Real HTTP dispatch lives in Dispatcher/ProviderClient; this adapter exists for
 * backwards compatibility with the stdio AgentRegistry contract.
 */
export class HttpAgentAdapter implements AgentAdapter {
  id: string
  name: string
  binary = "provider"
  protocol: "http" = "http"
  mode: "oneshot" = "oneshot"
  status: "idle" | "busy" | "error" = "idle"
  onOutput: ((chunk: string) => void) | null = null
  onError: ((err: Error) => void) | null = null

  constructor(id: string, name: string) {
    this.id = id
    this.name = name
  }

  async start(): Promise<void> { this.status = "idle" }
  async stop(): Promise<void> { this.status = "idle" }
  send(_prompt: string): void { /* real dispatch happens through Dispatcher.dispatch() */ }
}
