import type { CoordinationCore } from "../core/core.js";
import type { AgentRun, Contract, Mission, MissionState } from "../core/types.js";
import type { RunManager } from "./run-manager.js";

// E02/E04 阶段同步（第三阶段）。完成标准：接口变更可以自动注入另一 Agent。
//
// 工作方式：订阅契约更新事件 → 把最新契约「主动注入」同一 mission 下其他 Agent 的会话
// （C05 resume），不依赖 Agent 主动读收件箱。注入有一个硬约束——resume 要求目标进程已停，
// 所以「目标 Agent 还在忙」时把消息排队（pending），等它到达终态后再注入（阶段式同步）。
// mission 状态机随之 running ↔ synchronization_required。

// 运行期被视为「活跃」的 mission 状态（值得接收同步注入）。
const ACTIVE_STATES: ReadonlySet<MissionState> = new Set<MissionState>([
  "preparing_workspaces",
  "running",
  "synchronization_required",
  "validating_agents",
  "integrating",
  "resolving_conflicts",
  "validating_integration",
]);

const TERMINAL_RUN_STATUSES = new Set(["done", "failed", "stopped"]);

function truncate(s: string, max: number): string {
  const t = s.trim();
  return t.length <= max ? t : `${t.slice(0, max)}…（已截断）`;
}

// 把契约整理成给另一 Agent 的同步指令。
export function buildSyncMessage(c: Contract): string {
  const parts = [`【接口契约已更新 · v${c.version}】`];
  if (c.apiContract.trim()) parts.push(`API / 接口契约：\n${truncate(c.apiContract, 1500)}`);
  if (c.designSpec.trim()) parts.push(`设计规范：\n${truncate(c.designSpec, 800)}`);
  parts.push("请据此同步你的实现：核对受影响的接口与类型，必要时更新代码，不要继续依赖旧约定。");
  return parts.join("\n\n");
}

export interface SyncResult {
  injected: string[]; // 立即注入（进程已停）的 runId
  queued: string[]; // 排队（进程在跑，待终态后注入）的 runId
}

export class Coordinator {
  private readonly pending = new Map<string, string>(); // runId -> 待注入消息（保留最新一条）
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly core: CoordinationCore,
    private readonly runs: RunManager,
  ) {}

  start(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.core.events.subscribe((e) => {
      if (this.core.closed) return;
      if (e.type === "contract_updated") this.onContractUpdated(e.payload as Contract);
      else if (e.type === "worker_updated") this.onRunUpdated(e.payload as AgentRun);
    });
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  // 契约更新 → 注入所有活跃 mission 的其他 Agent。
  private onContractUpdated(contract: Contract): void {
    const message = buildSyncMessage(contract);
    for (const mission of this.activeMissions()) this.syncMission(mission.id, message);
  }

  // 把同步消息注入一个 mission 下、除 exceptRunId 外、所有有 session 的 run。
  // 在跑的排队（等终态再注入），已停的立即 resume。可被事件自动触发，也可显式调用。
  syncMission(missionId: string, message: string, exceptRunId?: string): SyncResult {
    const targets = this.core.store
      .listAgentRuns()
      .filter((r) => r.missionId === missionId && r.sessionId && r.id !== exceptRunId);
    const injected: string[] = [];
    const queued: string[] = [];
    for (const r of targets) {
      if (this.runs.isRunning(r.id)) {
        this.pending.set(r.id, message);
        queued.push(r.id);
      } else if (this.runs.resume(r.id, message).ok) {
        injected.push(r.id);
      } else {
        // 暂时无法注入（如尚无 session）→ 排队，待其下次到达终态再试。
        this.pending.set(r.id, message);
        queued.push(r.id);
      }
    }
    if (targets.length > 0) {
      this.core.missions.transition(missionId, "synchronization_required");
      // 没有排队项（全部已立即注入）→ 同步即时完成，回到 running。
      if (queued.length === 0) this.core.missions.transition(missionId, "running");
    }
    return { injected, queued };
  }

  // run 到达终态 → 若有排队的注入，此时进程已停，执行注入。
  private onRunUpdated(run: AgentRun): void {
    if (!TERMINAL_RUN_STATUSES.has(run.status)) return;
    const message = this.pending.get(run.id);
    if (message === undefined) return;
    if (this.runs.isRunning(run.id)) return; // 进程尚未真正退出，等下一次终态事件
    this.pending.delete(run.id);
    this.runs.resume(run.id, message);
    if (run.missionId) this.settleMission(run.missionId);
  }

  // 该 mission 不再有排队注入时，从 synchronization_required 回到 running。
  private settleMission(missionId: string): void {
    const stillPending = this.core.store
      .listAgentRuns()
      .some((r) => r.missionId === missionId && this.pending.has(r.id));
    if (!stillPending) this.core.missions.transition(missionId, "running");
  }

  private activeMissions(): Mission[] {
    return this.core.missions.list().filter((m) => ACTIVE_STATES.has(m.state));
  }
}
