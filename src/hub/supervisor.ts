import type { CoordinationCore } from "../core/core.js";
import type { AgentRun } from "../core/types.js";
import type { RunManager } from "./run-manager.js";
import { selectRescueTargets, buildRescuePrompt, RESCUE_STALL_MS } from "./rescue.js";

// M3.2c 监督循环（旧 P6）：Lead Planner 之上的后端看护。周期扫所有在途 worker，
// 把 /rescue 的停滞判定自动化——发现卡住的 worker 就发系统消息告警进时间线
// （即使没有 dashboard 打开也生效）；可选自动救援（等价自动 /rescue）。
// 设计成可控时钟：核心是纯方法 scan(now)，setInterval 只是定时调它，便于单测。

// 监督告警的发送者 id（前端 timeline 特判渲染为「Orbit 监督」）。
export const SUPERVISOR_SENDER = "orbit-supervisor";

const DEFAULT_INTERVAL_MS = 60_000;

export interface SupervisorOptions {
  stallMs?: number; // 停滞阈值，默认对齐 /rescue
  autoRescue?: boolean; // true 时告警同时自动 resume 注入（默认仅告警）
}

function minutesIdle(run: AgentRun, now: number): number {
  return Math.max(1, Math.round((now - run.updatedAt) / 60_000));
}

// 针对一个停滞 worker 生成告警文案。
export function buildStallAlert(run: AgentRun, now: number): string {
  const who = run.taskTitle || run.harness;
  if (run.status === "waiting_for_input") return `⏳ ${who} 在等待输入、已停滞。可用 /rescue 唤醒，或 @它 直接回复。`;
  if (run.status === "failed") return `❌ ${who} 执行失败${run.error ? `（${run.error.slice(0, 80)}）` : ""}。可用 /rescue 重试。`;
  return `⚠️ ${who} 已约 ${minutesIdle(run, now)} 分钟无活动、可能卡住。可用 /rescue 唤醒。`;
}

export class Supervisor {
  private timer: ReturnType<typeof setInterval> | null = null;
  // runId → 上次告警时的 run.updatedAt：同一段停滞只告警一次；worker 有新活动后再停滞会重新告警。
  private readonly warned = new Map<string, number>();
  private readonly stallMs: number;
  private readonly autoRescue: boolean;

  constructor(
    private readonly core: CoordinationCore,
    private readonly runs: RunManager,
    options: SupervisorOptions = {},
  ) {
    this.stallMs = options.stallMs ?? RESCUE_STALL_MS;
    this.autoRescue = options.autoRescue ?? false;
  }

  start(intervalMs: number = DEFAULT_INTERVAL_MS): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (this.core.closed) return;
      this.scan(Date.now());
    }, intervalMs);
    if (typeof this.timer.unref === "function") this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  // 扫一遍在途 worker，对新出现的停滞发告警（去重），返回本次新告警的 run。纯粹靠传入的 now 驱动。
  scan(now: number): AgentRun[] {
    if (this.core.closed) return [];
    const stalled = selectRescueTargets(this.runs.list(), now, this.stallMs);
    const fresh: AgentRun[] = [];
    const liveIds = new Set<string>();
    for (const run of stalled) {
      liveIds.add(run.id);
      // 同一段停滞（updatedAt 未变）只告警一次。
      if (this.warned.get(run.id) === run.updatedAt) continue;
      this.warned.set(run.id, run.updatedAt);
      this.core.messages.send(SUPERVISOR_SENDER, "all", buildStallAlert(run, now), {
        missionId: run.missionId,
        kind: "normal",
      });
      if (this.autoRescue) this.runs.resume(run.id, buildRescuePrompt());
      fresh.push(run);
    }
    // 已不再停滞的 run 从去重表移除，使其恢复后再停滞时能重新告警。
    for (const id of [...this.warned.keys()]) if (!liveIds.has(id)) this.warned.delete(id);
    return fresh;
  }
}
