/**
 * AgentHub 原生 agentic 开关配置
 *
 * 记录哪些「HTTP 绑定」的 agent 开启了 AgentHub 自带的 agentic 工具回环
 * ——让纯 HTTP 聊天模型也能在工作区读写文件、跑命令，对齐 codex/claude。
 * stdio-plain 的 agent 走各自 CLI 原生 agentic，不在此登记。
 *
 * 落盘 key: `agentic.v1`，形状 { version: 1, httpEnabled: string[] }
 */
import { store } from '../store'

const STORAGE_KEY = 'agentic.v1'

interface PersistedShape {
  version: 1
  httpEnabled: string[]
}

const DEFAULT: PersistedShape = { version: 1, httpEnabled: [] }

class AgenticConfig {
  private read(): PersistedShape {
    const raw = store.get(STORAGE_KEY)
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.httpEnabled)) return { version: 1, httpEnabled: [] }
    return {
      version: 1,
      httpEnabled: raw.httpEnabled.filter((x: unknown): x is string => typeof x === 'string')
    }
  }

  private write(s: PersistedShape): void {
    store.set(STORAGE_KEY, s)
  }

  getEnabled(): string[] {
    return this.read().httpEnabled
  }

  isEnabled(agentId: string): boolean {
    return this.read().httpEnabled.includes(agentId)
  }

  setEnabled(agentId: string, on: boolean): string[] {
    const s = this.read()
    const has = s.httpEnabled.includes(agentId)
    if (on && !has) s.httpEnabled.push(agentId)
    else if (!on && has) s.httpEnabled = s.httpEnabled.filter(x => x !== agentId)
    this.write(s)
    return s.httpEnabled
  }
}

let instance: AgenticConfig | null = null

export function getAgenticConfig(): AgenticConfig {
  if (!instance) instance = new AgenticConfig()
  return instance
}

export { DEFAULT as AGENTIC_CONFIG_DEFAULT }
