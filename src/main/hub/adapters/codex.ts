import { BaseAgentAdapter } from './base'
import { spawn, ChildProcess } from 'child_process'

export class CodexAdapter extends BaseAgentAdapter {
  id = 'codex'
  name = 'Codex CLI'
  binary = ''
  protocol: 'stdio-plain' = 'stdio-plain'
  mode: 'interactive' = 'interactive'

  private proc: ChildProcess | null = null

  constructor() {
    super()
    this.binary = process.env.CODEX_PATH || 'codex'
  }

  async start(): Promise<void> {
    try {
      this.proc = spawn(this.binary, [], {
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: true,
        env: { ...process.env }
      })

      this.proc.stdout?.on('data', (data: Buffer) => {
        const text = data.toString()
        this.buffer += text
        this.handleOutput(text)
      })

      this.proc.stderr?.on('data', (data: Buffer) => {
        if (data.toString().includes('error') || data.toString().includes('Error')) {
          this.handleError(new Error(data.toString()))
        }
      })

      this.proc.on('exit', (code) => {
        if (code !== 0 && this.status !== 'error') {
          this.handleError(new Error('Process exited with code ' + code))
        }
        this.proc = null
      })

      this.status = 'idle'
      this.startCount++
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
    if (this.proc?.stdin?.writable) {
      this.proc.stdin.write(prompt + '\n')
    }
  }
}
