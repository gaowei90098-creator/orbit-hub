import type { IntegrationDetail, Mission, Worker } from "../types";

// M3 斜杠命令：把控制台命令框的 `/命令` 接成真操作。
// 纯逻辑（命令解析 / mission 选择 / 只读渲染）放在这里以便单测；
// 有副作用的命令（integrate/cancel）由 CommandInput 调 actions 执行。

export type CommandKind = "readonly" | "action" | "pending";

export interface SlashCommandSpec {
  cmd: string;
  label: string; // 中文说明（提示与补全用）
  kind: CommandKind;
  needsMission: boolean; // 是否需要一个当前 mission 作为目标
}

// pending = 尚未接入（留给 M3 后续片：真后台委派 / 监督救援）。
export const SLASH_COMMAND_SPECS: SlashCommandSpec[] = [
  { cmd: "/status", label: "查看当前协作与各 Agent 进度", kind: "readonly", needsMission: true },
  { cmd: "/result", label: "查看最近集成结果与改动摘要", kind: "action", needsMission: true },
  { cmd: "/integrate", label: "把各 Agent 分支合并为集成候选", kind: "action", needsMission: true },
  { cmd: "/cancel", label: "取消当前协作并停掉在途 Agent", kind: "action", needsMission: true },
  { cmd: "/review", label: "（即将接入）发起代码审查后台任务", kind: "pending", needsMission: true },
  { cmd: "/rescue", label: "（即将接入）救援停滞的 Agent", kind: "pending", needsMission: true },
];

export const SLASH_COMMANDS: string[] = SLASH_COMMAND_SPECS.map((s) => s.cmd);

export interface ParsedCommand {
  cmd: string;
  args: string[];
  spec: SlashCommandSpec | null;
}

// 解析 `/cmd arg1 arg2` → 命令名（小写）+ 参数 + 规格。
export function parseCommand(raw: string): ParsedCommand {
  const parts = raw.trim().split(/\s+/);
  const cmd = (parts[0] ?? "").toLowerCase();
  const spec = SLASH_COMMAND_SPECS.find((s) => s.cmd === cmd) ?? null;
  return { cmd, args: parts.slice(1), spec };
}

const ARCHIVED = "archived";

// 命令默认作用于「最近一个未归档的 mission」——控制台头部显示的也是它。
export function pickLatestMission(missions: Mission[]): Mission | null {
  const active = missions.filter((m) => m.status !== ARCHIVED);
  const pool = active.length > 0 ? active : missions;
  if (pool.length === 0) return null;
  return pool.reduce((latest, m) => (m.createdAt >= latest.createdAt ? m : latest));
}

const WORKER_STATUS_LABEL: Record<string, string> = {
  starting: "启动中",
  running: "执行中",
  waiting_for_input: "等待输入",
  done: "已完成",
  failed: "失败",
  stopped: "已停止",
};

function workerStatusLabel(status: string): string {
  return WORKER_STATUS_LABEL[status] ?? status;
}

function workerLine(w: Worker): string {
  const activity = w.lastActivity?.trim() ? ` — ${w.lastActivity.trim()}` : "";
  return `· ${w.taskTitle || w.harness} [${workerStatusLabel(w.status)}]${activity}`;
}

// /status：当前 mission 状态 + 名下各 worker 一行摘要（纯文本，多行）。
export function renderStatus(mission: Mission | null, workers: Worker[]): string {
  if (!mission) return "还没有进行中的协作。输入一个目标即可启动。";
  const mine = workers.filter((w) => w.missionId === mission.id);
  const lines = [`目标：${mission.goal}`, `状态：${mission.state ?? mission.status}`];
  if (mine.length === 0) {
    lines.push("暂无执行中的 Agent（任务可能还在任务板等待认领）。");
  } else {
    const active = mine.filter((w) => ["starting", "running", "waiting_for_input"].includes(w.status)).length;
    lines.push(`Agent（${active}/${mine.length} 在跑）：`);
    for (const w of mine) lines.push(workerLine(w));
  }
  return lines.join("\n");
}

// /result：最近集成候选的结果 + 改动摘要（纯文本）。
export function renderResult(detail: IntegrationDetail | null): string {
  if (!detail) return "还没有集成结果。先用 /integrate 生成集成候选。";
  const { integration, diff } = detail;
  const lines = [`集成状态：${integration.status}`, `分支：${integration.branch} → ${integration.targetBranch}`];
  if (integration.mergedBranches.length > 0) lines.push(`已并入：${integration.mergedBranches.join(", ")}`);
  if (integration.conflicts.length > 0) lines.push(`冲突文件：${integration.conflicts.join(", ")}`);
  if (diff) {
    lines.push(`改动：${diff.filesChanged} 个文件 +${diff.insertions}/-${diff.deletions}`);
  }
  if (integration.resultCommit) lines.push(`已合入：${integration.resultCommit.slice(0, 8)}`);
  return lines.join("\n");
}
