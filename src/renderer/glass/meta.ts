/* ============================================================
   AgentHub 玻璃拟态 UI — Agent 元数据与共享常量
   （与 design_handoff_glass_ui/app/store.jsx 的 AGENT_META 一致）
   ============================================================ */

export interface AgentMeta {
  name: string
  nameZh: string
  icon: string
  /** hermes 黑线稿需要浅色磨砂底 */
  tileLight?: boolean
  /** CSS 变量形式 */
  color: string
  /** 图标主色（光晕/高亮） */
  colorRaw: string
  caps: string[]
  desc: string
}

export const AGENT_META: Record<string, AgentMeta> = {
  codex: {
    name: 'Codex CLI', nameZh: '代码工程', icon: 'icons/codex.png',
    color: 'var(--ag-codex)', colorRaw: '#7b87fa',
    caps: ['coding', 'debug', 'refactor', 'api'], desc: '精确编码 · 调试 · 重构'
  },
  claude: {
    name: 'Claude Code', nameZh: '分析写作', icon: 'icons/claude.png',
    color: 'var(--ag-claude)', colorRaw: '#d97757',
    caps: ['analysis', 'writing', 'translation', 'research'], desc: '分析 · 写作 · 研究'
  },
  hermes: {
    name: 'Hermes', nameZh: '系统自动化', icon: 'icons/hermes.png', tileLight: true,
    color: 'var(--ag-hermes)', colorRaw: '#aab4c4',
    caps: ['tools', 'system', 'automation'], desc: '工具链 · 系统配置 · 命令执行'
  },
  openclaw: {
    name: 'OpenClaw', nameZh: '部署流水线', icon: 'icons/openclaw.png',
    color: 'var(--ag-openclaw)', colorRaw: '#e04540',
    caps: ['automation', 'deploy', 'pipeline', 'script'], desc: '流水线 · 部署 · 脚本任务'
  },
  marvis: {
    name: 'Marvis', nameZh: '腾讯智能体', icon: 'icons/marvis.png', tileLight: true,
    color: 'var(--ag-marvis)', colorRaw: '#4f8ef7',
    caps: ['knowledge', 'browser', 'android', 'office'], desc: '知识库 · 浏览器自动化 · 云手机'
  },
  'minimax-code': {
    name: 'MiniMax Code', nameZh: '编码智能体', icon: 'icons/minimax-code.png',
    color: 'var(--ag-mmcode)', colorRaw: '#6db8f5',
    caps: ['coding', 'agentic', 'tools', 'review'], desc: '编码 Agent · OpenCode 内核'
  }
}

export const AGENT_IDS = Object.keys(AGENT_META)

export type AgentUIStatus = 'idle' | 'busy' | 'error' | 'off'

export const STATUS_ZH: Record<AgentUIStatus, string> = {
  idle: '空闲', busy: '运行中', error: '异常', off: '未启用'
}

export type DispatchMode = 'auto' | 'broadcast' | 'chain'

export const MODE_ZH: Record<string, string> = { auto: '智能路由', broadcast: '广播', chain: '链式' }

export type TaskUIStatus = 'running' | 'completed' | 'failed' | 'cancelled'

export const TASK_ST: Record<TaskUIStatus, { zh: string; color: string }> = {
  running: { zh: '运行中', color: 'var(--st-busy)' },
  completed: { zh: '已完成', color: 'var(--st-idle)' },
  failed: { zh: '失败', color: 'var(--st-error)' },
  cancelled: { zh: '已取消', color: 'var(--tx-3)' }
}

/* ---------- 渲染层数据形状（镜像 src/main/providers/types.ts） ---------- */

export interface ModelDef { id: string; label: string }

export interface ProviderDef {
  id: string
  name: string
  kind: string
  baseUrl: string
  apiKey: string
  enabled: boolean
  builtIn: boolean
  models: ModelDef[]
  health?: { reachable: boolean; latencyMs?: number; error?: string } | null
}

export interface BindingDef {
  agentId: string
  providerId: string
  modelId: string
  thinkingAllow?: string[]
  thinking: { mode: 'off' | 'auto' | 'enabled'; level: string; budgetTokens?: number; collapseInUI?: boolean }
  temperature?: number
  maxOutputTokens?: number
  protocol?: 'http' | 'stdio-plain'
  binary?: string
  args?: string
}

/** StdIO 模式各 Agent 的默认 oneshot 参数（与主进程 adapter 默认一致，仅用于 UI 提示） */
export const DEFAULT_STDIO_ARGS: Record<string, string> = {
  codex: 'exec --skip-git-repo-check -',
  claude: '--print',
  hermes: '（无参数，prompt 走 stdin）',
  openclaw: 'crestodian --message {prompt}',
  marvis: '（Marvis 暂无官方 CLI，建议用 HTTP 绑定）',
  'minimax-code': 'run {prompt}'
}

export interface TaskItem {
  id: string
  text: string
  mode: DispatchMode
  status: TaskUIStatus
  agents: string[]
  durationMs: number | null
  createdAt: string
  results?: Record<string, string>
  errors?: Record<string, string>
}

export interface ReplyState {
  agentId: string
  thinking: string
  text: string
  done: boolean
  cancelled?: boolean
  error?: string
}

export interface ChatMessage {
  id: string
  role: 'user'
  text: string
  mode: DispatchMode
  taskId: string
  replies: ReplyState[]
}

export const fmtDur = (ms: number | null): string =>
  ms == null ? '–' : ms >= 1000 ? (ms / 1000).toFixed(1) + 's' : ms + 'ms'

export const nowHHMM = (): string => new Date().toTimeString().slice(0, 5)
