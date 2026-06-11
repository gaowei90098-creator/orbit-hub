import { BaseAgentAdapter } from './base'
import { spawn, ChildProcess } from 'child_process'

export class OpenClawAdapter extends BaseAgentAdapter {
  id = 'openclaw'
  name = 'OpenClaw'
  binary = ''
  protocol: 'stdio-plain' = 'stdio-plain'
  mode: 'interactive' = 'interactive'

  private proc: ChildProcess | null = null

  constructor() {
    super()
    this.binary = process.env.OPENCLAW_PATH || 'openclaw'
  }

  async start(): Promise<void> {
    try {
      this.proc = spawn(this.binary, [], {
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: true,
        env: { ...process.env }
      })
      this.proc.stdout?.on('data', (data: Buffer) => { this.handleOutput(data.toString()) })
      this.proc.stderr?.on('data', (data: Buffer) => {
        if (data.toString().includes('error')) this.handleError(new Error(data.toString()))
      })
      this.proc.on('exit', () => { this.proc = null })
      this.status = 'idle'
    } catch (e: any) {
      this.status = 'error'
      this.handleError(e)
    }
  }

  async stop(): Promise<void> {
    if (this.proc) { this.proc.kill(); this.proc = null }
    this.status = 'idle'
  }

  send(prompt: string): void {
    if (this.proc?.stdin?.writable) this.proc.stdin.write(prompt + '\n')
  }
}
