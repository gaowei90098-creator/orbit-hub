// M1 时间线事件归并：把分散在多张表/多条 SSE 事件（任务、消息、worker、契约、冲突、mission）
// 按时间序合成一条统一流。纯函数、无运行时依赖（类型 import 在编译期擦除），既给控制台时间线用，
// 也是后续 P7 的复用资产。决策项（需操作员动手）单独抽出，供顶部高亮卡渲染。

import type { Agent, Conflict, Contract, FileLock, Message, Mission, Task, Worker } from "../types";

export type EventKind = "mission" | "task" | "message" | "worker" | "contract" | "conflict";
export type Tone = "neutral" | "info" | "success" | "warning" | "danger";

// 一条时间线事件。icon 是 lucide 图标名（在组件里映射），不在数据层引 JSX。
export interface TimelineEvent {
  id: string;
  ts: number;
  kind: EventKind;
  icon: string;
  title: string;
  detail: string;
  tone: Tone;
  agentId?: string | null;
}

export type DecisionKind = "worker_waiting" | "conflict" | "assignee_offline" | "task_stalled";

// 需要操作员决策/介入的项，优先级高于普通事件。
export interface DecisionItem {
  id: string;
  kind: DecisionKind;
  title: string;
  detail: string;
  tone: Tone;
  taskId?: string | null;
  runId?: string | null;
  conflictId?: string | null;
}

export interface TimelineInput {
  tasks: Task[];
  messages: Message[];
  workers: Worker[];
  conflicts: Conflict[];
  contract: Contract;
  missions: Mission[];
  agents: Agent[];
  locks: FileLock[];
  now: number;
}

export const STALL_AFTER_MS = 5 * 60_000;

const TASK_STATUS_LABEL: Record<Task["status"], string> = {
  todo: "待认领",
  claimed: "已领取",
  in_progress: "进行中",
  done: "已完成",
};

const TASK_STATUS_TONE: Record<Task["status"], Tone> = {
  todo: "neutral",
  claimed: "warning",
  in_progress: "info",
  done: "success",
};

const WORKER_STATUS_LABEL: Record<Worker["status"], string> = {
  starting: "启动中",
  running: "执行中",
  waiting_for_input: "等待输入",
  done: "已完成",
  failed: "失败",
  stopped: "已停止",
};

const WORKER_STATUS_TONE: Record<Worker["status"], Tone> = {
  starting: "neutral",
  running: "info",
  waiting_for_input: "warning",
  done: "success",
  failed: "danger",
  stopped: "neutral",
};

function agentName(agents: Agent[], id: string | null | undefined): string {
  if (!id) return "未分配";
  if (id === "all") return "全体";
  if (id === "orbit-supervisor") return "Orbit 监督"; // M3.2c 监督循环的系统告警发送者
  const a = agents.find((x) => x.id === id);
  if (!a) return id;
  if (a.role) return `${a.role}助手`;
  return a.name;
}

function truncate(s: string, max: number): string {
  const t = s.trim();
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

// 合并所有来源为时间线事件，按时间倒序（最新在前）。limit 控制返回条数。
export function buildTimeline(input: TimelineInput, limit = 60): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  for (const task of input.tasks) {
    events.push({
      id: `task-${task.id}-${task.updatedAt}`,
      ts: task.updatedAt,
      kind: "task",
      icon: "clipboard-list",
      title: `任务「${truncate(task.title, 40)}」${TASK_STATUS_LABEL[task.status]}`,
      detail: task.note
        ? `${agentName(input.agents, task.assignee)} · ${truncate(task.note, 60)}`
        : agentName(input.agents, task.assignee),
      tone: TASK_STATUS_TONE[task.status],
      agentId: task.assignee,
    });
  }

  for (const message of input.messages) {
    // sync（接口同步）/ question（提问）/ conflict（冲突）类消息在时间线上加前缀与色调，便于一眼识别协调动作。
    const kindPrefix =
      message.kind === "sync"
        ? "接口同步 · "
        : message.kind === "question"
          ? "提问 · "
          : message.kind === "conflict"
            ? "冲突 · "
            : "";
    const tone: Tone =
      message.kind === "sync"
        ? "info"
        : message.kind === "question"
          ? "warning"
          : message.kind === "conflict"
            ? "danger"
            : "neutral";
    events.push({
      id: `msg-${message.id}`,
      ts: message.ts,
      kind: "message",
      icon: "message-square",
      title: `${kindPrefix}${agentName(input.agents, message.from)} → ${agentName(input.agents, message.to)}`,
      detail: truncate(message.content, 80),
      tone,
      agentId: message.from,
    });
  }

  for (const worker of input.workers) {
    const failed = worker.status === "failed";
    events.push({
      id: `worker-${worker.id}-${worker.updatedAt}`,
      ts: worker.updatedAt,
      kind: "worker",
      icon: "bot",
      title: `${truncate(worker.taskTitle, 40)} · ${WORKER_STATUS_LABEL[worker.status]}`,
      detail: truncate(failed ? worker.error : worker.lastActivity, 80) || "—",
      tone: WORKER_STATUS_TONE[worker.status],
      agentId: worker.agentId ?? null,
    });
  }

  if (input.contract.version > 0) {
    events.push({
      id: `contract-${input.contract.version}`,
      ts: input.contract.updatedAt,
      kind: "contract",
      icon: "file-text",
      title: `共享约定更新 · v${input.contract.version}`,
      detail: truncate(input.contract.apiContract || input.contract.designSpec || "接口/设计约定已更新", 80),
      tone: "info",
      agentId: input.contract.updatedBy,
    });
  }

  for (const conflict of input.conflicts) {
    events.push({
      id: `conflict-${conflict.id}-${conflict.status}`,
      ts: conflict.status === "open" ? conflict.createdAt : conflict.resolvedAt ?? conflict.createdAt,
      kind: "conflict",
      icon: "alert-triangle",
      title: conflict.kind === "file" ? "文件冲突" : "约定冲突",
      detail: `${truncate(conflict.resource, 60)} · ${conflict.status === "open" ? "待裁决" : "已处理"}`,
      tone: conflict.status === "open" ? "danger" : "neutral",
    });
  }

  for (const mission of input.missions) {
    events.push({
      id: `mission-${mission.id}-${mission.updatedAt}`,
      ts: mission.createdAt,
      kind: "mission",
      icon: "rocket",
      title: `启动协作：${truncate(mission.goal, 50)}`,
      detail: `${mission.taskIds.length} 个任务${mission.state ? ` · ${mission.state}` : ""}`,
      tone: "info",
    });
  }

  return events.sort((a, b) => b.ts - a.ts).slice(0, limit);
}

// 抽出需要操作员决策的项：worker 等输入、开放冲突、负责人离线、任务停滞。
export function detectDecisions(input: TimelineInput): DecisionItem[] {
  const decisions: DecisionItem[] = [];
  const agentById = new Map(input.agents.map((a) => [a.id, a]));
  const activeTasks = input.tasks.filter((t) => t.status !== "done");

  for (const worker of input.workers) {
    if (worker.status !== "waiting_for_input") continue;
    decisions.push({
      id: `dec-wait-${worker.id}`,
      kind: "worker_waiting",
      title: "worker 在等你回复",
      detail: `${truncate(worker.taskTitle, 50)} · ${truncate(worker.lastActivity, 50)}`,
      tone: "warning",
      runId: worker.id,
      taskId: worker.taskId,
    });
  }

  for (const conflict of input.conflicts) {
    if (conflict.status !== "open") continue;
    decisions.push({
      id: `dec-conflict-${conflict.id}`,
      kind: "conflict",
      title: conflict.kind === "file" ? "文件冲突待裁决" : "约定冲突待裁决",
      detail: truncate(conflict.resource, 60),
      tone: "danger",
      conflictId: conflict.id,
    });
  }

  const runningTaskIds = new Set(
    input.workers
      .filter((w) => w.status === "starting" || w.status === "running" || w.status === "waiting_for_input")
      .map((w) => w.taskId)
      .filter((id): id is string => Boolean(id)),
  );

  for (const task of activeTasks) {
    const assignee = task.assignee ? agentById.get(task.assignee) : null;
    if (assignee?.status === "offline") {
      decisions.push({
        id: `dec-offline-${task.id}`,
        kind: "assignee_offline",
        title: "负责人离线",
        detail: truncate(task.title, 60),
        tone: "warning",
        taskId: task.id,
      });
      continue;
    }
    // 上面已对 offline 负责人 continue，这里 assignee 必在线或不存在。
    const stalled =
      (task.status === "claimed" || task.status === "in_progress") &&
      Boolean(task.assignee) &&
      !runningTaskIds.has(task.id) &&
      input.now - task.updatedAt > STALL_AFTER_MS;
    if (stalled) {
      const mins = Math.max(1, Math.floor((input.now - task.updatedAt) / 60_000));
      decisions.push({
        id: `dec-stall-${task.id}`,
        kind: "task_stalled",
        title: `任务停滞超过 ${mins} 分钟`,
        detail: `${truncate(task.title, 50)} · 外部 Agent 不会自动开工，可派 Agent 接管或回会话催办`,
        tone: "warning",
        taskId: task.id,
      });
    }
  }

  return decisions;
}
