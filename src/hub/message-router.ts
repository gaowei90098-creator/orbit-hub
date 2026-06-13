import type { CoordinationCore } from "../core/core.js";
import type { AgentRun, Message } from "../core/types.js";
import type { RunManager } from "./run-manager.js";
import { SUPERVISOR_SENDER } from "./supervisor.js";

const TERMINAL = new Set(["done", "failed", "stopped"]);

function formatMessage(m: Message): string {
  const prefix =
    m.kind === "sync" ? "[SYNC] " : m.kind === "question" ? "[QUESTION] " : m.kind === "conflict" ? "[CONFLICT] " : "";
  return `${prefix}${m.content}`;
}

interface Waiter {
  resolve: () => void;
  timer: ReturnType<typeof setTimeout>;
}

// M2.2 消息路由器：订阅 message_sent，把消息「主动推送」给目标 Agent 的运行进程。
// 两条通道：
//   ① 空闲/已退出 worker → resume 注入（保持会话上下文）
//   ② 在途 worker 调用 orbit_wait → 从长轮询直接返回（不杀进程、近实时）
// kind=sync/question 优先：在途时 stop run，等终态后 resume 注入。
// 普通 normal 消息：留在收件箱，worker 调用 get_messages 或 orbit_wait 自取。
export class MessageRouter {
  private readonly waiters = new Map<string, Waiter>(); // agentId → 挂起的 orbit_wait
  private readonly pendingInject = new Map<string, Message>(); // runId → 待注入消息（高优先级）
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly core: CoordinationCore,
    private readonly runs: RunManager,
  ) {}

  start(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.core.events.subscribe((e) => {
      if (this.core.closed) return;
      if (e.type === "message_sent") this.onMessageSent(e.payload as Message);
      else if (e.type === "worker_updated") this.onRunUpdated(e.payload as AgentRun);
    });
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    for (const { resolve, timer } of this.waiters.values()) {
      clearTimeout(timer);
      resolve();
    }
    this.waiters.clear();
  }

  // orbit_wait 长轮询：等到有未读消息（或超时）后返回。
  // 调用方拿到 Promise resolve 后再 drain inbox（messages.inbox 标记已读）。
  wait(agentId: string, timeoutMs: number): Promise<void> {
    if (this.core.store.unreadFor(agentId).length > 0) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.waiters.delete(agentId);
        resolve();
      }, timeoutMs);
      if (typeof (timer as ReturnType<typeof setTimeout>).unref === "function") {
        (timer as ReturnType<typeof setTimeout>).unref();
      }
      this.waiters.set(agentId, { resolve, timer });
    });
  }

  private onMessageSent(message: Message): void {
    // 监督循环的停滞告警是给人看的 UI 消息，不应被注入到各 worker 会话里。
    if (message.from === SUPERVISOR_SENDER) return;
    const recipients =
      message.to === "all"
        ? this.core.agents.list().map((a) => a.id).filter((id) => id !== message.from)
        : [message.to];

    for (const agentId of recipients) {
      const waiter = this.waiters.get(agentId);
      if (waiter) {
        clearTimeout(waiter.timer);
        this.waiters.delete(agentId);
        waiter.resolve();
        continue;
      }
      this.tryInject(agentId, message);
    }
  }

  private onRunUpdated(run: AgentRun): void {
    if (!TERMINAL.has(run.status)) return;
    if (this.runs.isRunning(run.id)) return;
    const message = this.pendingInject.get(run.id);
    if (message === undefined) return;
    this.pendingInject.delete(run.id);
    this.runs.resume(run.id, formatMessage(message));
  }

  private tryInject(agentId: string, message: Message): void {
    // 找到最近一次有 session 的 run（已完成的也可 resume，仿 coordinator 逻辑）。
    const run = this.core.store
      .listAgentRuns()
      .find((r) => r.agentId === agentId && r.sessionId);
    if (!run) return; // peer agent 或 worker 尚无 session：消息已入收件箱

    // M4 冲突：停掉在途 worker 并保持暂停——不注入、不自动恢复，等操作员裁决后再 /rescue
    // 或回复放行。把「事后集成冲突」提前为「事中阻断」。消息留在收件箱，恢复时可见。
    if (message.kind === "conflict") {
      if (this.runs.isRunning(run.id)) this.runs.stop(run.id);
      return;
    }

    const isHigh = message.kind === "sync" || message.kind === "question";
    if (!this.runs.isRunning(run.id)) {
      this.runs.resume(run.id, formatMessage(message));
    } else if (isHigh) {
      // 在途高优先级：stop 后在 onRunUpdated 里注入
      this.pendingInject.set(run.id, message);
      this.runs.stop(run.id);
    }
    // normal + 在途：留在收件箱，worker 主动取
  }
}
