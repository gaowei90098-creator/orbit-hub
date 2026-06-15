/**
 * 运行时能力模型 —— 用于「确认每个接入 agent 的真实 agent 能力」。
 *
 * 注意区分：
 *   - `caps`（agents.ts 的 coding/analysis… 标签）是展示性分类，给路由/UI 看的。
 *   - 这里的 AgentCapability 描述派发时 agent **真正能做什么**：
 *     读/写文件、执行命令、多步自驱（agentic-loop）、接收技能注入（skills）。
 *
 * 能力来源：
 *   - stdio-plain：子进程在工作区 cwd 内运行，天然可读写/执行（codex/claude 为原生 CLI agentic）。
 *   - http：默认只能「聊天/描述」；开启 AgentHub 原生 executor 后由工具回环补齐全部能力。
 *   - skills：任何 agent 都能接收注入的技能（含 codex/claude）。
 */
import { getProviderManager } from '../providers/manager'
import { getAgenticConfig } from './config'
import { AGENTS, agentName } from '../hub/agents'

export type AgentCapability = 'fs-read' | 'fs-write' | 'exec' | 'agentic-loop' | 'skills'

export const ALL_CAPABILITIES: AgentCapability[] = ['fs-read', 'fs-write', 'exec', 'agentic-loop', 'skills']

/** codex/claude：stdio 直连时走各自 CLI 的原生 agentic */
const NATIVE_CLI_AGENTS = new Set(['codex', 'claude'])

export interface AgentCapabilityState {
  agentId: string
  name: string
  protocol: 'http' | 'stdio-plain'
  /** stdio 原生 CLI agentic（codex/claude） */
  nativeCli: boolean
  /** HTTP 上开启了 AgentHub 自带 executor */
  httpAgentic: boolean
  capabilities: AgentCapability[]
}

/** 由（协议 + 是否开启 HTTP executor）推导真实能力集合。 */
export function capabilitiesFor(protocol: 'http' | 'stdio-plain', httpAgentic: boolean): AgentCapability[] {
  const caps: AgentCapability[] = ['skills'] // 任何 agent 都能接收注入的技能
  if (protocol === 'stdio-plain' || httpAgentic) {
    caps.push('fs-read', 'fs-write', 'exec', 'agentic-loop')
  }
  return caps
}

/** 是否对该 agent 启用 AgentHub 原生 agentic 工具回环（仅对 HTTP 协议有意义）。 */
export function isHttpAgenticEnabled(agentId: string): boolean {
  return getAgenticConfig().isEnabled(agentId)
}

/**
 * 能力矩阵：以 manifest 已知 agent 兜底（未绑定者按 http/仅聊天展示），
 * 再用真实绑定协议覆盖。供 UI 能力矩阵与派发判定共用。
 */
export function getCapabilityMatrix(): AgentCapabilityState[] {
  const mgr = getProviderManager()
  const bindings = mgr.getBindings()
  const cfg = getAgenticConfig()
  const byId = new Map<string, AgentCapabilityState>()

  const put = (agentId: string, protocol: 'http' | 'stdio-plain') => {
    const httpAgentic = protocol === 'http' && cfg.isEnabled(agentId)
    byId.set(agentId, {
      agentId,
      name: agentName(agentId),
      protocol,
      nativeCli: protocol === 'stdio-plain' && NATIVE_CLI_AGENTS.has(agentId),
      httpAgentic,
      capabilities: capabilitiesFor(protocol, httpAgentic)
    })
  }

  for (const a of AGENTS) put(a.id, 'http')
  for (const b of bindings) put(b.agentId, b.protocol === 'stdio-plain' ? 'stdio-plain' : 'http')

  return Array.from(byId.values())
}
