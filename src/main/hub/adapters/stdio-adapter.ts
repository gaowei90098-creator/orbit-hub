import { BaseAgentAdapter } from './agent-adapter'
import { spawn, exec, execSync, ChildProcess } from 'child_process'
import { existsSync } from 'fs'
import { homedir } from 'os'

/**
 * 通用本地 CLI 直连适配器 — oneshot
 *
 * 每次 send() spawn 一次子进程：
 *   - execArgs 含 "{prompt}" 占位符 → prompt 替换后作为命令行参数传入
 *   - 否则（默认）prompt 写入 stdin 并关闭 —— 免转义，适配大多数 CLI
 * stdout 实时回流为流式输出（流式 UTF-8 解码，避免多字节字符被分块截断），
 * 进程退出即任务完成；stderr 按 UTF-8 → GBK 智能解码（Windows cmd 错误是 GBK）。
 * 登录态/模型/沙箱等继承各 CLI 自己的本机配置。
 *
 * dispatcher 的 stdio 轮询依赖 `proc` 字段名与 mode='oneshot'，勿改名。
 */
export class StdioAgentAdapter extends BaseAgentAdapter {
  id: string
  name: string
  binary = ''
  protocol = 'stdio-plain' as const
  mode = 'oneshot' as const
  /** oneshot 参数；可被路由绑定的 args 覆盖 */
  execArgs: string[]

  protected proc: ChildProcess | null = null
  private errChunks: Buffer[] = []
  private errBytes = 0
  private outDecoder: TextDecoder | null = null

  constructor(id: string, name: string, defaultBinary: string, defaultArgs: string[]) {
    super()
    this.id = id
    this.name = name
    this.binary = defaultBinary
    this.execArgs = defaultArgs
  }

  /** oneshot：start 仅做预检（fail fast），真正 spawn 发生在 send() */
  async start(): Promise<void> {
    if (this.binary && /[\\/]/.test(this.binary)) {
      // 完整路径：检查文件存在
      if (!existsSync(this.binary)) {
        this.status = 'error'
        throw new Error(this.name + ' 二进制不存在: ' + this.binary + '（请在 设置→路由→StdIO 修改路径或留空自动探测）')
      }
    } else if (this.binary) {
      // 裸命令：用 where/which 预检 PATH，避免 shell 报 GBK 乱码错误
      try {
        execSync((process.platform === 'win32' ? 'where ' : 'which ') + this.binary,
          { timeout: 2000, encoding: 'utf-8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
      } catch {
        this.status = 'error'
        throw new Error('未检测到 ' + this.name + ' CLI（PATH 中没有 "' + this.binary + '"）。请先安装该 CLI，或在 设置→路由→StdIO 填写完整二进制路径。')
      }
    }
    this.status = 'idle'
    this.startCount++
  }

  send(prompt: string): void {
    this.buffer = ''
    this.errChunks = []
    this.errBytes = 0
    this.outDecoder = new TextDecoder('utf-8')
    const viaArg = this.execArgs.some(a => a.includes('{prompt}'))
    // .exe 全路径可直接 spawn；.cmd/.bat/裸命令需经 shell
    const useShell = !/\.exe$/i.test(this.binary)
    const cmd = useShell && this.binary.includes(' ') ? `"${this.binary}"` : this.binary
    const args = viaArg
      ? this.execArgs.map(a => a.replace('{prompt}', useShell
          ? '"' + prompt.replace(/\r?\n/g, ' ').replace(/"/g, '\\"') + '"'
          : prompt))
      : this.execArgs

    this.proc = spawn(cmd, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: useShell,
      cwd: homedir(),
      env: { ...process.env },
      windowsHide: true
    })
    this.status = 'busy'

    this.proc.stdout?.on('data', (d: Buffer) => {
      const text = this.outDecoder ? this.outDecoder.decode(d, { stream: true }) : d.toString()
      if (!text) return
      this.buffer += text
      this.handleOutput(text)
    })
    this.proc.stderr?.on('data', (d: Buffer) => {
      this.errChunks.push(d)
      this.errBytes += d.length
      while (this.errBytes > 16384 && this.errChunks.length > 1) {
        this.errBytes -= this.errChunks[0].length
        this.errChunks.shift()
      }
    })
    this.proc.on('error', (e: Error) => {
      this.proc = null
      this.handleError(e)
    })
    this.proc.on('exit', (code) => {
      const failed = code !== 0 && code !== null
      this.proc = null
      this.status = 'idle'
      if (failed) {
        const detail = this.decodeStderr().trim().slice(-500)
        this.handleError(new Error(this.name + ' 退出码 ' + code + (detail ? '：' + detail : '')))
      }
    })

    try {
      if (!viaArg) this.proc.stdin?.write(prompt)
      this.proc.stdin?.end()
    } catch (e: any) {
      this.handleError(e)
    }
  }

  /** stderr 解码：先 UTF-8，出现替换符则按 GBK 重解（Windows 中文 cmd 错误信息） */
  private decodeStderr(): string {
    if (this.errChunks.length === 0) return ''
    const raw = Buffer.concat(this.errChunks)
    let text = raw.toString('utf8')
    if (text.includes('�')) {
      try { text = new TextDecoder('gbk').decode(raw) } catch { /* 编码不支持则保留 utf8 结果 */ }
    }
    return text
  }

  async stop(): Promise<void> {
    const p = this.proc
    this.proc = null
    if (p?.pid) {
      if (process.platform === 'win32') {
        // 杀整棵进程树（CLI 可能派生子进程）
        try { exec(`taskkill /pid ${p.pid} /t /f`, { windowsHide: true }) } catch { /* noop */ }
      } else {
        try { p.kill('SIGKILL') } catch { /* noop */ }
      }
    }
    this.status = 'idle'
  }
}
