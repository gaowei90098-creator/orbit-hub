// Domain types shared across the coordination core, hub REST layer, and MCP adapter.
// The coordination model is aligned with MPAC (Multi-Principal Agent Coordination):
// agents belong to principals + roles, declare INTENTS before acting, overlapping
// intents raise first-class CONFLICTS, and a human resolves them (governance). A
// shared CONTRACT (API + design spec) is the shared state both sides build against.

export type Harness = "claude-code" | "codex" | "gemini" | "opencode" | "other";

export type AgentStatus = "online" | "offline";

export interface Agent {
  id: string;
  name: string;
  harness: Harness;
  status: AgentStatus;
  currentTaskId: string | null;
  registeredAt: number;
  lastSeen: number;
  role: string | null; // 角色: "前端" | "后端" | 自定义 | null
  principal: string; // 归属方(人/团队), 多 principal 协作用; 默认 "本机"
}

export type MessageTarget = string; // an agent id, or the literal "all" for broadcast
export const BROADCAST: MessageTarget = "all";

export interface Message {
  id: string;
  from: string; // agent id
  to: MessageTarget; // agent id or "all"
  content: string;
  ts: number;
}

export type TaskStatus = "todo" | "claimed" | "in_progress" | "done";

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  assignee: string | null; // agent id
  dependsOn: string[]; // task ids
  files: string[]; // files this task is expected to touch (advisory)
  note: string;
  // ----- 1.2 Task contract（任务契约）：lead 拆分时填满，worker 据此自我约束 -----
  fileScope: string[]; // 允许修改的文件/目录范围（glob），改动必须落在范围内
  doneWhen: string; // 完成标准（可人工核对的自然语言）
  verifyCommand: string; // 验证命令；跑通之前不许 update_task done（空 = 无强制验证）
  interfaceRef: string; // 涉及的共享接口/契约说明（与他人对接的部分）
  createdBy: string | null; // agent id
  createdAt: number;
  updatedAt: number;
}

export interface FileLock {
  path: string;
  holder: string; // agent id
  note: string;
  acquiredAt: number;
}

export interface Note {
  id: string;
  agentId: string;
  content: string;
  ts: number;
}

// ----- MPAC: Intent layer (declare before acting) -----
export type IntentStatus = "announced" | "committed" | "withdrawn";
export interface Intent {
  id: string;
  agentId: string;
  summary: string; // 自然语言: "给 User 类型加 email 字段"
  resources: string[]; // 要动的文件/契约段落
  status: IntentStatus;
  createdAt: number;
  updatedAt: number;
}

// ----- MPAC: Conflict layer (first-class structured conflict) -----
export type ConflictKind = "file" | "contract";
export type ConflictStatus = "open" | "resolved" | "dismissed";
export interface Conflict {
  id: string;
  kind: ConflictKind;
  resource: string; // 争用的文件/契约段
  intentIds: string[];
  agentIds: string[];
  status: ConflictStatus;
  resolution: string; // 仲裁说明
  resolvedBy: string | null; // operator/agent id
  createdAt: number;
  resolvedAt: number | null;
}

// ----- MPAC: shared state — the contract both sides build against -----
export interface Contract {
  apiContract: string; // 接口契约 (markdown/结构化文本)
  designSpec: string; // 设计规范 / 设计 token
  version: number; // 乐观并发
  updatedBy: string | null; // agent id
  updatedAt: number;
}

// ----- Mission: a user-facing collaboration run -----
export type MissionStatus = "active" | "archived";

// B06 Mission 生命周期状态机（第三阶段）。完整骨架按规格第六节定义；本阶段只真正驱动
// draft→planning→preparing_workspaces→running↔synchronization_required（+ paused/cancelled），
// 集成/验证等后段为占位，留第四阶段接管。status(active/archived) 保留为粗粒度，向后兼容。
export type MissionState =
  | "draft"
  | "planning"
  | "awaiting_plan_approval"
  | "preparing_workspaces"
  | "running"
  | "synchronization_required"
  | "validating_agents"
  | "integrating"
  | "resolving_conflicts"
  | "validating_integration"
  | "awaiting_final_approval"
  | "merging"
  | "completed"
  | "paused"
  | "cancelled"
  | "failed";

export interface WorktreePlan {
  agentId: string;
  agentName: string;
  path: string;
  branch: string;
  command: string;
}
export interface Mission {
  id: string;
  projectId: string | null; // 绑定 Project (A04); 旧数据为 null
  goal: string;
  projectPath: string;
  status: MissionStatus;
  state: MissionState; // B06 细粒度状态机；旧数据默认 "draft"
  taskIds: string[];
  worktrees: WorktreePlan[];
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
}

// ----- Project: A04 本地 Git 项目, 所有协作数据绑定 projectId -----
export interface ProjectCommands {
  install?: string;
  build?: string;
  lint?: string;
  test?: string;
}
export interface Project {
  id: string;
  name: string;
  rootPath: string;
  repositoryUrl: string | null;
  targetBranch: string | null;
  isGitRepo: boolean;
  commands: ProjectCommands;
  createdAt: number;
  updatedAt: number;
}

// ----- 驱动运行记录 (C04): 这些是落库的领域类型, 放在 core 层供 store 使用,
// drivers 层从这里 import (drivers 依赖 core, 不反向)。 -----
export type DriverId = "claude-code" | "codex";
export type RunStatus = "starting" | "running" | "waiting_for_input" | "done" | "failed" | "stopped";
export type RunErrorCode =
  | "not_installed"
  | "auth"
  | "quota"
  | "rate_limit"
  | "timeout"
  | "tool"
  | "test"
  | "process"
  | "unknown";

export interface AgentRun {
  id: string;
  missionId: string | null;
  taskId: string | null;
  projectId: string | null;
  agentId: string | null;
  driver: DriverId;
  harness: Harness;
  sessionId: string | null;
  pid: number | null;
  worktreePath: string | null;
  branch: string | null;
  baseCommit: string | null; // D03：worktree 创建时的起点 commit，用于精确 diff
  status: RunStatus;
  errorCode: RunErrorCode | null;
  costUsd: number;
  lastActivity: string;
  error: string;
  taskTitle: string;
  projectPath: string;
  startedAt: number;
  updatedAt: number;
}

// ----- 第四阶段：集成、验证、审批 -----

// G02/G03 验证运行（一次命令执行的报告）。
export type ValidationScope = "agent" | "integration";
export interface ValidationRun {
  id: string;
  missionId: string;
  taskId: string | null; // agent 范围时关联任务
  scope: ValidationScope;
  command: string;
  exitCode: number | null;
  output: string; // stdout+stderr 尾部（截断），G04 报告
  ok: boolean; // exitCode === 0
  startedAt: number;
  finishedAt: number;
}

// D06 集成运行：把各 Agent 分支合并到独立 integration 分支的一次过程。
export type IntegrationStatus =
  | "merging" // 正在合并各分支
  | "conflict" // D08：合并冲突，已中止
  | "validating" // G03：跑集成验证
  | "ready" // 候选就绪，待审批（G06 可查 diff）
  | "failed" // 验证失败
  | "merged" // G07：已合入目标分支
  | "rolled_back"; // D09：合入失败已回滚
export interface IntegrationRun {
  id: string;
  missionId: string;
  branch: string; // 集成分支名
  worktreePath: string; // 集成 worktree
  targetBranch: string;
  baseCommit: string; // 集成分支起点（= 目标分支当时的 commit）
  resultCommit: string | null; // 合入目标分支后的结果 commit
  mergedBranches: string[]; // 已成功并入的 Agent 分支
  conflicts: string[]; // D08：冲突文件清单（status=conflict 时）
  status: IntegrationStatus;
  validationRunIds: string[];
  createdAt: number;
  updatedAt: number;
}

// B08 人工审批节点。
export type ApprovalStage = "plan" | "integration" | "final";
export type ApprovalDecision = "approved" | "rejected";
export interface Approval {
  id: string;
  missionId: string;
  stage: ApprovalStage;
  decision: ApprovalDecision;
  approvedBy: string | null;
  note: string;
  createdAt: number;
}

// ----- D01 工作区隔离（第二阶段） -----

// `git worktree list --porcelain` 的一条记录。
export interface WorktreeInfo {
  path: string;
  branch: string | null; // 短名（去掉 refs/heads/）
  head: string | null; // commit sha
  locked: boolean;
}

// 一个改动文件的统计（来自 git diff --numstat）。
export interface WorktreeDiffFile {
  path: string;
  added: number | null; // 二进制文件为 null
  deleted: number | null;
  binary: boolean;
}

// run 的 worktree 相对 base 分支的基础 diff 摘要（不含完整 patch 内容）。
export interface WorktreeDiff {
  base: string;
  files: WorktreeDiffFile[];
  untracked: string[]; // 未追踪的新文件
  filesChanged: number;
  insertions: number;
  deletions: number;
}

// ----- Operation result shapes (discriminated unions for model-friendly handling) -----

export interface ClaimSuccess {
  ok: true;
  task: Task;
}
export interface ClaimFailure {
  ok: false;
  reason: "not_found" | "already_claimed" | "blocked";
  task?: Task;
  heldBy?: Agent | null;
  blockedBy?: Task[]; // unfinished dependencies
}
export type ClaimResult = ClaimSuccess | ClaimFailure;

export interface LockConflict {
  path: string;
  heldBy: Agent | null;
}
export interface AcquireLocksResult {
  granted: string[];
  conflicts: LockConflict[];
}

// Declaring an intent may raise conflicts against other agents' active intents.
export interface DeclareIntentResult {
  intent: Intent;
  conflicts: Conflict[]; // conflicts triggered by this declaration (empty = clear)
}

// ----- Events emitted on every mutation (consumed by the SSE stream) -----

export type HubEventType =
  | "agent_registered"
  | "agent_updated"
  | "agent_offline"
  | "message_sent"
  | "task_created"
  | "task_updated"
  | "lock_changed"
  | "note_added"
  | "intent_announced"
  | "intent_updated"
  | "conflict_opened"
  | "conflict_updated"
  | "contract_updated"
  | "mission_created"
  | "mission_updated"
  | "project_created"
  | "project_updated"
  | "agent_run_updated"
  | "worker_updated"
  | "integration_updated"
  | "validation_recorded"
  | "approval_recorded";

export interface HubEvent {
  type: HubEventType;
  ts: number;
  payload: unknown;
}

// Full point-in-time snapshot (dashboard initial load + list_* tools).
export interface Snapshot {
  agents: Agent[];
  tasks: Task[];
  locks: FileLock[];
  messages: Message[]; // most recent first, capped
  notes: Note[];
  intents: Intent[];
  conflicts: Conflict[];
  contract: Contract;
  missions: Mission[];
  projects: Project[];
  agentRuns: AgentRun[];
}
