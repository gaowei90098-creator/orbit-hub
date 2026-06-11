import { BaseAgentAdapter } from './base'
import { spawn, ChildProcess } from 'child_process'

export class ClaudeAdapter extends BaseAgentAdapter {
  id = 'claude'
  name = 'Claude Code'
  binary = ''
  protocol: 'stdio-ndjson' = 'stdio-ndjson'
  mode: 'oneshot' = 'oneshot'

  private proc: ChildProcess | null = null

  constructor() {
    super()
    this.binary = process.env.CLAUDE_PATH || 'claude'
  }

  async start(): Promise<void> {
    try {
      this.proc = spawn(this.binary, ['--print'], {
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
        const text = data.toString()
        if (text.includes('error') || text.includes('Error')) {
          this.handleError(new Error(text))
        }
      })

      this.proc.on('exit', (code) => {
        if (code !== 0) this.handleError(new Error('Exit code ' + code))
        this.proc = null
      })

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
    if (this.proc?.stdin?.writable) {
      this.proc.stdin.write(JSON.stringify({ role: 'user', content: prompt }) + '\n')
    }
  }
}
