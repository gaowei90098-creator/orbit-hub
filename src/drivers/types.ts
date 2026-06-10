// 驱动层契约（第一阶段：C01/C02/C04/C06/C07/H01/A01/A02）。
//
// 设计取舍：规格里的 AgentDriver 接口（start/resume/interrupt/stop/stream）是"生命周期"
// 契约。我们把它拆成两层，让供应商相关的部分保持纯函数、可单测：
//   1) DriverSpec —— 纯粹的供应商适配器：detect() + 构造启动/恢复命令 + 解析输出行。
//      不持有进程、不做副作用，所以可以脱离真实 CLI 单测命令构造与解析。
//   2) RunManager（run-manager.ts）—— 用 DriverSpec + ProcessManager 实现 start/resume/
//      interrupt/stop/list 的完整生命周期，把统一事件落库并经 SSE 回流面板。
// 这样 "两个 CLI 均可由 Orbit 启动和监控" 的逻辑集中在 RunManager，而 Claude/Codex 的
// 差异被收敛进各自的 DriverSpec。

import type { AgentRun, DriverId, Harness, RunErrorCode, RunStatus } from "../core/types.js";

// 持久化领域类型（DriverId/RunStatus/RunErrorCode/AgentRun）定义在 core/types.ts，
// 这里 re-export 方便 drivers 内部使用。
export type { AgentRun, DriverId, RunErrorCode, RunStatus };

// ----- A01/A02 环境与登录检测 -----
// loggedIn 三态：true=已登录, false=确定未登录, null=无法判定(只跑官方命令, 不读凭证内容)。
export interface AgentEnvironment {
  harness: DriverId;
  available: boolean; // 二进制是否可执行
  binPath: string | null;
  version: string | null;
  loggedIn: boolean | null;
  // 给操作员看的人话：缺失时如何安装、未登录时跑哪条命令登录。
  hint: string;
}

// ----- C06 统一事件格式 -----
// 两个 Driver 的原始 JSON 都被 parseLine 翻译成这组判别联合；UI/RunManager 不直接
// 依赖任何供应商的原始字段。
export type AgentRunEvent =
  | { kind: "session"; sessionId: string } // 捕获到会话 id（供 C05 恢复）
  | { kind: "status"; status: RunStatus; detail?: string }
  | { kind: "activity"; text: string } // 一句话"最近动作"（文本或工具名）
  | { kind: "tool"; name: string } // 工具调用
  | { kind: "text"; text: string } // 助手文本片段
  | { kind: "cost"; costUsd: number } // 供应商自报用量（H07：不自行估算）
  | { kind: "error"; code: RunErrorCode; message: string };

// ----- 启动一次运行的输入 -----
export interface StartRunInput {
  runId?: string; // 不传则由 RunManager 生成
  harness: Harness; // 选择 Driver
  missionId: string | null;
  taskId: string | null;
  projectId: string | null;
  taskTitle: string;
  goal: string;
  // 1.2 Task contract：从任务带入，渲染进 worker 的 prompt 与 harness 文件。
  taskDescription?: string;
  fileScope?: string[];
  doneWhen?: string;
  verifyCommand?: string;
  interfaceRef?: string;
  projectPath: string; // 主仓库根目录；隔离开启时子进程实际 cwd 为自动创建的 worktree
  branch?: string | null;
  worktreePath?: string | null;
  // D01 工作区隔离（第二阶段）：默认 true。git 项目会自动 worktree add 一个独立工作区+分支；
  // 非 git / 空仓库自动降级为在主仓库直接跑。传 false 可强制不隔离。
  isolate?: boolean;
  // 让 worker 连回 Orbit 的 MCP 启动参数（复用现有 cli mcp 适配器）。
  mcp?: { command: string; args: string[] } | null;
  // 可选覆盖；不传则用 Driver/环境默认值。
  prompt?: string;
  model?: string;
  allowedTools?: string[];
  timeoutMs?: number;
  budgetUsd?: number;
}

// Driver 构造出的进程启动规格（纯数据，由 ProcessManager 真正 spawn）。
export interface SpawnSpec {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}

// 落库的运行记录 AgentRun（对应 agent_runs 表 + C04）定义在 core/types.ts，本文件顶部已 re-export。

// 供应商适配器（纯函数 + detect）。
export interface DriverSpec {
  readonly id: DriverId;
  readonly harness: Harness;
  // A01/A02：探测本机该 CLI 的可用性/版本/登录态（只跑官方命令）。
  detect(): Promise<AgentEnvironment>;
  // 构造首次启动该 CLI 的进程规格。
  buildStart(input: StartRunInput): SpawnSpec;
  // 构造"在已有会话上追加一条指令"的进程规格（C05 会话恢复）。
  buildResume(sessionId: string, message: string, input: StartRunInput): SpawnSpec;
  // 把一行供应商 stdout（通常是 JSONL）翻译成统一事件；非 JSON / 无关行返回 []。
  parseLine(line: string): AgentRunEvent[];
}
