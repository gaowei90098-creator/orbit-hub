import path from "node:path";
import type { CoordinationCore } from "../core/core.js";
import type { AgentRun, DriverId, Harness, WorktreeDiff, WorktreeInfo } from "../core/types.js";
import { newId } from "../core/id.js";
import { inspectProject } from "../core/projects.js";
import {
  addWorktree,
  hasCommits,
  isGitRepo,
  listWorktrees,
  planWorktree,
  removeWorktree as gitRemoveWorktree,
  worktreeDiff,
} from "../core/worktrees.js";
import { buildHarnessProfile, installHarnessFile, renderHarnessFile } from "../core/harness.js";
import { ProcessManager, type ExitInfo } from "../drivers/process-manager.js";
import { getDriver, isDrivableHarness } from "../drivers/registry.js";
import type { AgentRunEvent, DriverSpec, StartRunInput } from "../drivers/types.js";

// C06/C07/H01 RunManager —— "两个 CLI 均可由 Orbit 启动和监控" 的编排核心。
// 用 DriverSpec（构造命令 + 解析输出）+ ProcessManager（进程生命周期）把一次运行落库为
// agent_run，并把统一事件经 EventBus 回流面板（沿用 dashboard 已监听的 worker_updated）。

// 1.3 默认值上调：15 分钟跑不完真实任务，默认 45 分钟（dashboard / env 可覆盖）。
const DEFAULT_TIMEOUT_MS = Number(process.env.ORBIT_WORKER_TIMEOUT_MS ?? String(45 * 60_000));

interface ActiveRun {
  input: StartRunInput; // 供 resume 重建命令（其 projectPath 已指向 worktree）
  driver: DriverSpec;
  terminal: boolean; // 是否已到达终态（done/failed/stopped）
  projectRoot: string; // 主仓库根（用于 worktree 的 git 操作）
  worktreePath: string | null; // 本次运行的独立工作区；降级直跑时为 null
  branch: string | null;
}

// D01 隔离决策结果。
type Isolation =
  | { mode: "isolated"; worktreePath: string; branch: string; baseCommit: string | null }
  | { mode: "direct" } // 非 git / 空仓库 / 显式关闭 → 在主仓库直接跑（保留第一阶段行为）
  | { mode: "error"; message: string }; // git 仓库但建工作区失败

export type DriverResolver = (harness: Harness) => DriverSpec | null;

export class RunManager {
  private readonly procs = new ProcessManager();
  private readonly active = new Map<string, ActiveRun>();
  private disposed = false; // stopAll 后置位：拒绝处理在途进程的收尾回调

  // resolveDriver 可注入：测试用假 DriverSpec 验证"在隔离工作区里跑"，无需真实 CLI。
  constructor(
    private readonly core: CoordinationCore,
    private readonly resolveDriver: DriverResolver = getDriver,
  ) {}

  // 列出所有运行记录（AgentRun 是旧 WorkerRun 的超集，dashboard 直接消费）。
  list(): AgentRun[] {
    return this.core.store.listAgentRuns();
  }

  get(runId: string): AgentRun | null {
    return this.core.store.getAgentRun(runId);
  }

  // 该 run 的子进程是否仍在运行（Coordinator 决定立即注入还是排队）。
  isRunning(runId: string): boolean {
    return this.procs.isRunning(runId);
  }

  // 启动一次运行：选 Driver → 建隔离工作区 → 落库(starting) → spawn → 流式解析 → 终态收口。
  start(input: StartRunInput): AgentRun {
    const runId = input.runId ?? newId("run");
    const resolved: StartRunInput = { ...input, runId };
    const projectRoot = path.resolve(resolved.projectPath);

    if (!isDrivableHarness(input.harness)) {
      return this.persistInitial(runId, resolved, projectRoot, null, null, null, "failed", "not_installed", `不支持的 harness：${input.harness}`);
    }
    const driver = this.resolveDriver(input.harness);
    if (!driver) {
      return this.persistInitial(runId, resolved, projectRoot, null, null, null, "failed", "not_installed", `无可用 Driver：${input.harness}`);
    }

    // D01：git 项目自动建独立 worktree+分支；非 git/空仓库降级直跑；建区失败则 run 失败。
    const iso = this.setupIsolation(resolved, projectRoot);
    if (iso.mode === "error") {
      return this.persistInitial(runId, resolved, projectRoot, null, null, null, "failed", "process", iso.message);
    }
    const worktreePath = iso.mode === "isolated" ? iso.worktreePath : null;
    const branch = iso.mode === "isolated" ? iso.branch : null;
    const baseCommit = iso.mode === "isolated" ? iso.baseCommit : null;

    // 子进程在 worktree 里跑（隔离）或主仓库（降级）：把 projectPath 指向实际 cwd。
    const spawnInput: StartRunInput = { ...resolved, projectPath: worktreePath ?? projectRoot, worktreePath, branch };

    // 1.2 Harness 全程生效：spawn 前往隔离 worktree 写入渲染好的 CLAUDE.md / AGENTS.md
    // （配 git 排除，不会进提交/集成 diff）。降级直跑（主仓库）不写，避免污染用户工作区。
    if (worktreePath) {
      try {
        const profile = buildHarnessProfile({
          goal: resolved.goal,
          taskTitle: resolved.taskTitle,
          taskId: resolved.taskId,
          taskDescription: resolved.taskDescription,
          fileScope: resolved.fileScope,
          doneWhen: resolved.doneWhen,
          verifyCommand: resolved.verifyCommand,
          interfaceRef: resolved.interfaceRef,
          withOrbitProtocol: resolved.harness === "codex" || Boolean(resolved.mcp),
        });
        installHarnessFile(worktreePath, resolved.harness, renderHarnessFile(profile, resolved.harness));
      } catch {
        // harness 文件写入失败不阻断启动：worker 仍有首条 prompt 兜底。
      }
    }

    const run = this.persistInitial(runId, resolved, projectRoot, worktreePath, branch, baseCommit, "starting", null, "");
    this.active.set(runId, { input: spawnInput, driver, terminal: false, projectRoot, worktreePath, branch });
    this.spawn(runId, driver.buildStart(spawnInput), spawnInput.timeoutMs ?? DEFAULT_TIMEOUT_MS, "正在启动…");
    return run;
  }

  // 决定本次运行的隔离方式（不持久化，纯决策 + 副作用建区）。
  private setupIsolation(input: StartRunInput, projectRoot: string): Isolation {
    if (input.isolate === false) return { mode: "direct" };
    // 非 git 仓库或空仓库（无 HEAD）无法 worktree add → 降级在主仓库直跑。
    if (!isGitRepo(projectRoot) || !hasCommits(projectRoot)) return { mode: "direct" };
    const label = input.taskTitle || input.taskId || "run";
    const plan = planWorktree(projectRoot, label, input.runId ?? newId("run"));
    try {
      const info = addWorktree({ projectRoot, worktreePath: plan.worktreePath, branch: plan.branch });
      // D03：记录起点 commit，diff 据此计算（不受主仓库 base 分支后续移动影响）。
      return { mode: "isolated", worktreePath: plan.worktreePath, branch: plan.branch, baseCommit: info.head };
    } catch (err) {
      return { mode: "error", message: `创建工作区失败：${(err as Error).message}` };
    }
  }

  // C05 会话恢复：在已捕获 sessionId 的运行上追加一条指令（同步接口变更/修复要求）。
  resume(runId: string, message: string): { ok: boolean; reason?: string } {
    const run = this.core.store.getAgentRun(runId);
    if (!run) return { ok: false, reason: "not_found" };
    if (this.procs.isRunning(runId)) return { ok: false, reason: "still_running" };
    if (!run.sessionId) return { ok: false, reason: "no_session" };
    const ctx = this.active.get(runId);
    if (!ctx) return { ok: false, reason: "no_context" };

    this.update(runId, { status: "running", lastActivity: "恢复会话，注入新指令…" });
    ctx.terminal = false;
    this.spawn(
      runId,
      ctx.driver.buildResume(run.sessionId, message, ctx.input),
      ctx.input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      "恢复会话中…",
    );
    return { ok: true };
  }

  // M2.2 链路：MCP adapter 注册后，把 agentId 绑定到 run，供 MessageRouter 路由。
  bind(runId: string, agentId: string): AgentRun | null {
    const run = this.core.store.getAgentRun(runId);
    if (!run) return null;
    this.update(runId, { agentId });
    return this.core.store.getAgentRun(runId);
  }

  // C07 中断：正常终止（SIGTERM→SIGKILL）。终态在 onExit 里收口为 stopped。
  stop(runId: string): AgentRun | null {
    const run = this.core.store.getAgentRun(runId);
    if (!run) return null;
    if (this.procs.isRunning(runId)) {
      this.procs.stop(runId);
    } else if (run.status === "running" || run.status === "starting") {
      this.finalize(runId, "stopped", null, "已停止");
    }
    return this.core.store.getAgentRun(runId);
  }

  stopAll(): void {
    this.disposed = true;
    this.procs.stopAll();
  }

  // ----- D01 工作区（第二阶段）-----

  // 列一个项目（主仓库）下的所有 worktree（含主工作区 + Orbit 创建的隔离区）。
  listProjectWorktrees(projectRoot: string): WorktreeInfo[] {
    return listWorktrees(path.resolve(projectRoot));
  }

  // run 的隔离工作区相对 base 分支的基础 diff 摘要（文件级统计，不含完整 patch）。
  diff(runId: string): { ok: true; diff: WorktreeDiff } | { ok: false; reason: string } {
    const run = this.core.store.getAgentRun(runId);
    if (!run) return { ok: false, reason: "not_found" };
    if (!run.worktreePath) return { ok: false, reason: "no_worktree" };
    return { ok: true, diff: worktreeDiff(run.worktreePath, this.resolveBase(run)) };
  }

  // 显式清理 run 的工作区+分支（保留 run 记录，仅清空 worktreePath）。
  removeWorktree(runId: string): { ok: true; run: AgentRun } | { ok: false; reason: string } {
    const run = this.core.store.getAgentRun(runId);
    if (!run) return { ok: false, reason: "not_found" };
    if (!run.worktreePath) return { ok: false, reason: "no_worktree" };
    if (this.procs.isRunning(runId)) return { ok: false, reason: "still_running" };
    try {
      gitRemoveWorktree(run.projectPath, run.worktreePath, run.branch);
    } catch (err) {
      return { ok: false, reason: `remove_failed: ${(err as Error).message}` };
    }
    this.update(runId, { worktreePath: null, lastActivity: "工作区已清理" });
    const updated = this.core.store.getAgentRun(runId);
    return updated ? { ok: true, run: updated } : { ok: false, reason: "not_found" };
  }

  // diff 的 base：优先 D03 起点 commit（精确、不受主仓库分支移动影响），
  // 否则项目目标分支，否则主仓库当前分支，再否则 HEAD。
  private resolveBase(run: AgentRun): string {
    if (run.baseCommit) return run.baseCommit;
    const project = run.projectId ? this.core.projects.get(run.projectId) : null;
    if (project?.targetBranch) return project.targetBranch;
    return inspectProject(run.projectPath).targetBranch ?? "HEAD";
  }

  // ----- 内部 -----

  private spawn(runId: string, spec: ReturnType<DriverSpec["buildStart"]>, timeoutMs: number, startActivity: string): void {
    const { pid } = this.procs.start(runId, {
      command: spec.command,
      args: spec.args,
      cwd: spec.cwd,
      env: spec.env,
      timeoutMs,
      onLine: (line) => this.onLine(runId, line),
      onExit: (info) => this.onExit(runId, info),
      onError: (err) => this.onError(runId, err),
    });
    this.update(runId, { status: "running", pid, lastActivity: startActivity });
  }

  private onLine(runId: string, line: string): void {
    if (this.disposed || this.core.closed) return;
    const ctx = this.active.get(runId);
    if (!ctx) return;
    let events: AgentRunEvent[];
    try {
      events = ctx.driver.parseLine(line);
    } catch {
      return;
    }
    for (const evt of events) this.applyEvent(runId, ctx, evt);
  }

  private applyEvent(runId: string, ctx: ActiveRun, evt: AgentRunEvent): void {
    const run = this.core.store.getAgentRun(runId);
    if (!run) return;
    switch (evt.kind) {
      case "session":
        if (!run.sessionId) this.update(runId, { sessionId: evt.sessionId });
        break;
      case "activity":
        this.update(runId, { lastActivity: evt.text });
        break;
      case "tool":
        // tool 事件主要给未来消费者；lastActivity 由配套的 activity 事件负责。
        break;
      case "text":
        if (evt.text.trim()) this.update(runId, { lastActivity: evt.text.trim().slice(0, 120) });
        break;
      case "cost":
        if (evt.costUsd > run.costUsd) this.update(runId, { costUsd: evt.costUsd });
        break;
      case "status":
        if (evt.status === "done") {
          this.finalize(runId, "done", null, evt.detail ?? "已完成");
        } else if (evt.status === "waiting_for_input") {
          this.update(runId, { status: "waiting_for_input", lastActivity: evt.detail ?? "等待输入" });
        } else {
          this.update(runId, { status: evt.status, lastActivity: evt.detail ?? run.lastActivity });
        }
        break;
      case "error":
        // 已 done 的不被随后的错误覆盖（典型：done 后因预算上限退出）。
        if (!ctx.terminal) this.finalize(runId, "failed", evt.code, evt.message);
        break;
    }
  }

  private onExit(runId: string, info: ExitInfo): void {
    if (this.disposed || this.core.closed) return;
    const ctx = this.active.get(runId);
    const run = this.core.store.getAgentRun(runId);
    if (!run) return;
    // 已收口（done/failed/stopped）则尊重既有终态——处理 "done 后非零退出" 的情况。
    // 但仍广播一次：此刻进程已真正退出（procs 已移除 key，isRunning=false），
    // 让等待"可安全 resume"的订阅者（Coordinator 的排队注入）得到通知。
    if (ctx?.terminal || run.status === "done" || run.status === "failed" || run.status === "stopped") {
      this.core.events.emit("worker_updated", run);
      return;
    }

    if (info.stopped) {
      this.finalize(runId, "stopped", null, "已停止");
    } else if (info.timedOut) {
      this.finalize(runId, "failed", "timeout", "执行超时已终止");
    } else if (info.code === 0) {
      this.finalize(runId, "done", null, "已完成");
    } else {
      this.finalize(runId, "failed", "process", info.stderrTail.slice(-400) || `进程退出码 ${info.code}`);
    }
  }

  private onError(runId: string, err: Error): void {
    if (this.disposed || this.core.closed) return;
    const ctx = this.active.get(runId);
    if (ctx?.terminal) return;
    this.finalize(runId, "failed", "process", `进程错误：${err.message}`);
  }

  private finalize(runId: string, status: "done" | "failed" | "stopped", errorCode: AgentRun["errorCode"], message: string): void {
    const ctx = this.active.get(runId);
    if (ctx) ctx.terminal = true;
    if (status === "failed") {
      this.update(runId, { status, errorCode, error: message, lastActivity: message.slice(0, 120) });
    } else {
      this.update(runId, { status, lastActivity: message });
    }
  }

  private persistInitial(
    runId: string,
    input: StartRunInput,
    projectRoot: string,
    worktreePath: string | null,
    branch: string | null,
    baseCommit: string | null,
    status: AgentRun["status"],
    errorCode: AgentRun["errorCode"],
    error: string,
  ): AgentRun {
    const now = Date.now();
    const driver: DriverId = input.harness === "codex" ? "codex" : "claude-code";
    const run: AgentRun = {
      id: runId,
      missionId: input.missionId,
      taskId: input.taskId,
      projectId: input.projectId,
      agentId: null,
      driver,
      harness: input.harness,
      sessionId: null,
      pid: null,
      worktreePath,
      branch,
      baseCommit,
      status,
      errorCode,
      costUsd: 0,
      lastActivity: status === "failed" ? error : "已创建",
      error,
      taskTitle: input.taskTitle,
      projectPath: projectRoot,
      startedAt: now,
      updatedAt: now,
    };
    this.core.store.insertAgentRun(run);
    // 沿用 dashboard 已监听的 worker_updated 事件（AgentRun 是 WorkerRun 超集），前端零改动。
    this.core.events.emit("worker_updated", run);
    return run;
  }

  private update(runId: string, fields: Parameters<typeof this.core.store.updateAgentRunFields>[1]): void {
    this.core.store.updateAgentRunFields(runId, fields, Date.now());
    const updated = this.core.store.getAgentRun(runId);
    if (updated) this.core.events.emit("worker_updated", updated);
  }
}
