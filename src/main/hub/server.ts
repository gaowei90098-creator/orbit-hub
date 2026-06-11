import { EventEmitter } from 'events'
import { AgentRegistry } from './registry'

// @ts-ignore - Electron main process has require
const WebSocket = require('ws')

interface ClientInfo {
  ws: any
  id: string
  connectedAt: Date
}

export class HubServer extends EventEmitter {
  private wss: any = null
  private clients: Map<string, ClientInfo> = new Map()
  private port: number

  constructor(private registry: AgentRegistry, port = 9527) {
    super()
    this.port = port
  }

  start(): void {
    this.wss = new WebSocket.WebSocketServer({ port: this.port })
    this.wss.on('connection', (ws: any) => this.handleConnection(ws))
    console.log('[Hub] WebSocket server started on ws://localhost:' + this.port)
  }

  stop(): void {
    if (this.wss) { this.wss.close(); this.clients.clear() }
  }

  private handleConnection(ws: any): void {
    const clientId = 'client-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6)
    const client: ClientInfo = { ws, id: clientId, connectedAt: new Date() }
    this.clients.set(clientId, client)

    this.send(ws, {
      type: 'hub:connected',
      clientId,
      agents: this.registry.getAll().map((a: any) => ({ id: a.id, name: a.name, status: a.status, capabilities: a.capabilities }))
    })

    ws.on('message', (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString())
        this.emit('client:message', { clientId, message: msg })
      } catch {}
    })

    ws.on('close', () => this.clients.delete(clientId))
    this.emit('client:connected', client)
  }

  broadcast(type: string, payload: any): void {
    const message = JSON.stringify({ type, payload, timestamp: new Date().toISOString() })
    for (const [, client] of this.clients) {
      if (client.ws.readyState === WebSocket.WebSocket.OPEN) {
        client.ws.send(message)
      }
    }
  }

  private send(ws: any, data: any): void {
    if (ws.readyState === WebSocket.WebSocket.OPEN) {
      ws.send(JSON.stringify(data))
    }
  }

  getClientCount(): number { return this.clients.size }
  getUrl(): string { return 'ws://localhost:' + this.port }
}
