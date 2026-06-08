// Client-side mirror of the hub's domain shapes (only the fields the UI reads).
export interface Agent {
  id: string;
  name: string;
  harness: string;
  status: "online" | "offline";
  currentTaskId: string | null;
  lastSeen: number;
  role: string | null;
  principal: string;
}

export type TaskStatus = "todo" | "claimed" | "in_progress" | "done";

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  assignee: string | null;
  dependsOn: string[];
  files: string[];
  updatedAt: number;
}

export interface Message {
  id: string;
  from: string;
  to: string;
  content: string;
  ts: number;
}

export interface FileLock {
  path: string;
  holder: string;
  note: string;
  acquiredAt: number;
}

export interface Note {
  id: string;
  agentId: string;
  content: string;
  ts: number;
}

export type IntentStatus = "announced" | "committed" | "withdrawn";
export interface Intent {
  id: string;
  agentId: string;
  summary: string;
  resources: string[];
  status: IntentStatus;
  createdAt: number;
  updatedAt: number;
}

export type ConflictStatus = "open" | "resolved" | "dismissed";
export interface Conflict {
  id: string;
  kind: "file" | "contract";
  resource: string;
  intentIds: string[];
  agentIds: string[];
  status: ConflictStatus;
  resolution: string;
  resolvedBy: string | null;
  createdAt: number;
  resolvedAt: number | null;
}

export interface Contract {
  apiContract: string;
  designSpec: string;
  version: number;
  updatedBy: string | null;
  updatedAt: number;
}

export interface WorktreePlan {
  agentId: string;
  agentName: string;
  path: string;
  branch: string;
  command: string;
}

export interface Mission {
  id: string;
  goal: string;
  projectPath: string;
  status: "active" | "archived";
  // 第三阶段 B06 状态机（可选，向后兼容）。
  state?:
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
  taskIds: string[];
  worktrees: WorktreePlan[];
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
}

export type WorkerStatus = "starting" | "running" | "waiting_for_input" | "done" | "failed" | "stopped";
export interface Worker {
  id: string;
  missionId: string | null;
  taskId: string | null;
  taskTitle: string;
  harness: string;
  status: WorkerStatus;
  projectPath: string;
  lastActivity: string;
  error: string;
  costUsd: number;
  startedAt: number;
  updatedAt: number;
  // 第一阶段新增（AgentRun 超集字段，向后兼容、可选）
  driver?: string;
  sessionId?: string | null;
  errorCode?: string | null;
  branch?: string | null;
  worktreePath?: string | null;
  baseCommit?: string | null; // 第二阶段 D03
  projectId?: string | null;
  agentId?: string | null;
}

export interface Snapshot {
  agents: Agent[];
  tasks: Task[];
  locks: FileLock[];
  messages: Message[];
  notes: Note[];
  intents: Intent[];
  conflicts: Conflict[];
  contract: Contract;
  missions: Mission[];
}

export interface TaskDraft {
  title: string;
  description: string;
  area: "frontend" | "backend" | "general";
  files: string[];
}

export interface MissionPlan {
  template: string;
  templateLabel: string;
  tasks: TaskDraft[];
}

export interface TemplateInfo {
  id: string;
  label: string;
}

export interface ConnectInfo {
  hubUrl: string;
  tokenRequired: boolean;
  claudeCommand: string;
  codexToml: string;
}

export interface InstallResult {
  ok: boolean;
  path: string;
  action: "created" | "updated";
}
