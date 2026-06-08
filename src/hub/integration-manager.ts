import path from "node:path";
import { execFileSync } from "node:child_process";
import type { CoordinationCore } from "../core/core.js";
import type { Approval, AgentRun, IntegrationRun, Mission, ProjectCommands, ValidationRun, WorktreeDiff } from "../core/types.js";
import { newId } from "../core/id.js";
import { inspectProject } from "../core/projects.js";
import { worktreeDiff } from "../core/worktrees.js";
import {
  branchTip,
  commitAgentWork,
  createIntegrationWorktree,
  finalizeConflictMerge,
  listConflictFiles,
  mergeBranchInto,
  mergeBranchKeepConflicts,
  mergeIntoTarget,
  resetHard,
} from "../core/integration.js";
import type { RunManager } from "./run-manager.js";

// 第四阶段：集成、验证、最终 Diff、人工审批的编排（D05/D06/D07/D08/D09 + G02/G03/G04/G06/G07 + B08）。
// 完成标准：生成可审查的集成候选版本；审批通过后才真实合入目标分支（失败回滚）。

// 跑一条验证命令并返回退出码 + 输出尾部。可注入（测试用确定性假命令，不依赖真实 build/test）。
export type ValidationRunner = (command: string, cwd: string) => { exitCode: number; output: string };

const OUTPUT_TAIL_CAP = 4_000;
function tail(s: string): string {
  return s.length <= OUTPUT_TAIL_CAP ? s : s.slice(-OUTPUT_TAIL_CAP);
}

const defaultRunValidation: ValidationRunner = (command, cwd) => {
  try {
    const out = execFileSync("sh", ["-c", command], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 10 * 60_000 });
    return { exitCode: 0, output: tail(out) };
  } catch (err) {
    const e = err as { status?: number | null; stdout?: string; stderr?: string; message?: string };
    return { exitCode: e.status ?? 1, output: tail(`${e.stdout ?? ""}${e.stderr ?? ""}` || e.message || "命令执行失败") };
  }
};

export type IntegrationResult =
  | { ok: true; integration: IntegrationRun }
  | { ok: false; reason: string; integration: IntegrationRun | null };

// 派给 Agent 的冲突解决指令。让 Agent 只解决标记 + git add，由 Orbit 完成提交（更可控）。
function buildConflictFixPrompt(conflicts: string[]): string {
  return [
    "你正在 Orbit 的集成工作区里解决一次 git 合并冲突。",
    "当前目录下以下文件带有冲突标记（<<<<<<<、=======、>>>>>>>）：",
    ...conflicts.map((f) => `  - ${f}`),
    "",
    "请完成：",
    "1) 编辑这些文件，合理融合双方改动，删除所有冲突标记；",
    "2) 运行 git add -A 把解决后的文件加入暂存区；",
    "3) 不要执行 git commit，也不要改动其它文件——Orbit 会替你完成提交。",
  ].join("\n");
}

// 派回修复的最大尝试次数（防 Agent 改不好导致无限派回）。
const MAX_FIX_ATTEMPTS = 3;
const TERMINAL_RUN_STATUSES = new Set(["done", "failed", "stopped"]);

interface FixState {
  runId: string;
  branch: string; // 正在派 Agent 解决冲突的那个 Agent 分支
  attempts: number;
}

export class IntegrationManager {
  private unsubscribe: (() => void) | null = null;
  // missionId -> 当前进行中的冲突修复运行状态。
  private readonly fixes = new Map<string, FixState>();

  constructor(
    private readonly core: CoordinationCore,
    private readonly runValidation: ValidationRunner = defaultRunValidation,
    private readonly runs?: RunManager,
  ) {}

  // 订阅 worker_updated：派回的修复 run 到达终态后，自动收口并续跑集成。
  start(): void {
    if (this.unsubscribe || !this.runs) return;
    this.unsubscribe = this.core.events.subscribe((e) => {
      if (this.core.closed) return;
      if (e.type === "worker_updated") this.onRunUpdated(e.payload as AgentRun);
    });
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  getIntegration(missionId: string): IntegrationRun | null {
    return this.core.store.getLatestIntegrationByMission(missionId);
  }
  validations(missionId: string): ValidationRun[] {
    return this.core.store.listValidationRunsByMission(missionId);
  }
  approvals(missionId: string): Approval[] {
    return this.core.store.listApprovalsByMission(missionId);
  }

  // G06：集成分支相对目标分支的最终 Diff 摘要。
  diff(missionId: string): WorktreeDiff | null {
    const integ = this.getIntegration(missionId);
    if (!integ) return null;
    return worktreeDiff(integ.worktreePath, integ.targetBranch);
  }

  // 产出集成候选：提交各 Agent 分支 → 建集成分支 → 顺序合并 → 集成验证 → 落库。
  integrate(missionId: string): IntegrationResult {
    const mission = this.core.missions.get(missionId);
    if (!mission) return { ok: false, reason: "mission_not_found", integration: null };

    const runs = this.core.store
      .listAgentRuns()
      .filter((r) => r.missionId === missionId && r.branch && r.worktreePath && r.status === "done")
      .sort((a, b) => a.startedAt - b.startedAt); // D07（简化）：按启动先后合并
    const firstRun = runs[0];
    if (!firstRun) return { ok: false, reason: "no_completed_branches", integration: null };

    const projectRoot = firstRun.projectPath;
    const targetBranch = this.resolveTargetBranch(mission, projectRoot);

    // D05：先把每个 Agent worktree 的改动提交到它自己的分支（否则分支无内容可合并）。
    for (const r of runs) commitAgentWork(r.worktreePath!, `[orbit] ${r.taskTitle || r.branch} (run ${r.id})`);

    // D06：从目标分支建独立集成分支 + worktree。
    const short = (missionId.replace(/^mission[_-]?/i, "") || missionId).slice(-6);
    const branch = `orbit/integration-${short}`;
    const worktreePath = path.join(path.dirname(projectRoot), `${path.basename(projectRoot)}-orbit`, `integration-${short}`);
    let baseCommit: string;
    try {
      baseCommit = createIntegrationWorktree(projectRoot, targetBranch, branch, worktreePath).baseCommit;
    } catch (err) {
      return { ok: false, reason: `create_integration_failed: ${(err as Error).message}`, integration: null };
    }

    const now = Date.now();
    const integration: IntegrationRun = {
      id: newId("integ"),
      missionId,
      branch,
      worktreePath,
      targetBranch,
      baseCommit,
      resultCommit: null,
      mergedBranches: [],
      conflicts: [],
      status: "merging",
      validationRunIds: [],
      createdAt: now,
      updatedAt: now,
    };
    this.core.store.insertIntegrationRun(integration);
    this.emitIntegration(integration);
    this.advance(missionId, ["running", "validating_agents", "integrating"]);

    // D07/D08 + G01/G03/G04：合并各分支 + 验证（抽成 mergeAndValidate 以便派回修复后续跑）。
    return this.mergeAndValidate(missionId);
  }

  // 合并所有尚未合并的 Agent 分支 + 跑集成验证。integrate() 和派回修复后的续跑都复用它。
  private mergeAndValidate(missionId: string): IntegrationResult {
    const integ = this.getIntegration(missionId);
    if (!integ) return { ok: false, reason: "no_integration", integration: null };
    const mission = this.core.missions.get(missionId);
    const merged = [...integ.mergedBranches];

    // D07/D08：按顺序合并各 Agent 分支；冲突即中止并报告（不破坏集成分支）。
    for (const r of this.doneRuns(missionId)) {
      if (merged.includes(r.branch!)) continue;
      const outcome = mergeBranchInto(integ.worktreePath, r.branch!, `[orbit] merge ${r.branch} into ${integ.branch}`);
      if (!outcome.ok) {
        this.core.store.updateIntegrationRunFields(integ.id, { status: "conflict", conflicts: outcome.conflicts, mergedBranches: merged }, Date.now());
        this.advance(missionId, ["resolving_conflicts"]);
        this.emitIntegration(this.getIntegration(missionId)!);
        return { ok: false, reason: "merge_conflict", integration: this.getIntegration(missionId) };
      }
      merged.push(r.branch!);
    }
    this.core.store.updateIntegrationRunFields(integ.id, { status: "validating", conflicts: [], mergedBranches: merged }, Date.now());
    this.advance(missionId, ["validating_integration"]);

    // G01/G03/G04：在集成 worktree 跑项目配置的验证命令，落 ValidationRun 报告。
    const project = mission?.projectId ? this.core.projects.get(mission.projectId) : null;
    const { allPassed, validationIds } = this.runIntegrationValidation(missionId, integ.worktreePath, project?.commands ?? {});
    if (!allPassed) {
      this.core.store.updateIntegrationRunFields(integ.id, { status: "failed", validationRunIds: validationIds }, Date.now());
      this.emitIntegration(this.getIntegration(missionId)!);
      return { ok: false, reason: "validation_failed", integration: this.getIntegration(missionId) };
    }
    // 候选就绪，等待人工审批（B08）。
    this.core.store.updateIntegrationRunFields(integ.id, { status: "ready", validationRunIds: validationIds }, Date.now());
    this.advance(missionId, ["awaiting_final_approval"]);
    const ready = this.getIntegration(missionId)!;
    this.emitIntegration(ready);
    return { ok: true, integration: ready };
  }

  // 该 mission 下已完成、有独立分支和工作区的 Agent run（按启动先后，决定合并顺序）。
  // 派回修复 run（isolate:false，branch 为 null）天然被 r.branch 过滤掉。
  private doneRuns(missionId: string): AgentRun[] {
    return this.core.store
      .listAgentRuns()
      .filter((r) => r.missionId === missionId && r.branch && r.worktreePath && r.status === "done")
      .sort((a, b) => a.startedAt - b.startedAt);
  }

  // B08 + G07：记录批准，并（按用户决策）真实合入目标分支；失败安全回滚（D09）。
  approve(missionId: string, by: string | null, note = ""): { ok: boolean; reason?: string; approval?: Approval; resultCommit?: string } {
    const integ = this.getIntegration(missionId);
    if (!integ) return { ok: false, reason: "no_integration" };
    if (integ.status !== "ready") return { ok: false, reason: `not_ready: ${integ.status}` };

    const approval = this.recordApproval(missionId, "approved", by, note);
    this.advance(missionId, ["merging"]);

    // G07：合入目标分支。先记录目标分支当前 commit 用于失败回滚。
    const projectRoot = this.runsRoot(missionId) ?? path.dirname(integ.worktreePath);
    const preMergeCommit = branchTip(projectRoot, integ.targetBranch);
    const result = mergeIntoTarget(projectRoot, integ.targetBranch, integ.branch, `[orbit] integrate mission ${missionId}`);
    if (!result.ok) {
      // D09：回滚目标分支到合入前状态，标记 rolled_back。
      if (preMergeCommit) resetHard(projectRoot, preMergeCommit);
      this.core.store.updateIntegrationRunFields(integ.id, { status: "rolled_back", conflicts: result.conflicts }, Date.now());
      this.advance(missionId, ["failed"]);
      this.emitIntegration(this.getIntegration(missionId)!);
      return { ok: false, reason: "merge_into_target_conflict", approval };
    }
    this.core.store.updateIntegrationRunFields(integ.id, { status: "merged", resultCommit: result.resultCommit }, Date.now());
    this.advance(missionId, ["completed"]);
    this.emitIntegration(this.getIntegration(missionId)!);
    return { ok: true, approval, resultCommit: result.resultCommit };
  }

  // B08：驳回集成候选（不合入）。mission 置 failed，可后续修复后重新集成。
  reject(missionId: string, by: string | null, note = ""): { ok: boolean; reason?: string; approval?: Approval } {
    const integ = this.getIntegration(missionId);
    if (!integ) return { ok: false, reason: "no_integration" };
    const approval = this.recordApproval(missionId, "rejected", by, note);
    this.advance(missionId, ["cancelled"]); // 用户否决候选 → 取消（非"失败"）
    return { ok: true, approval };
  }

  // ----- 集成冲突自动派回修复（闭环）-----

  // 把当前冲突分支在集成 worktree 重制冲突（保留标记），起一个 Agent 去现场解决。
  // Agent 完成后由 onRunUpdated → onFixDone 自动收口并续跑合并 + 验证。
  dispatchConflictFix(missionId: string): { ok: boolean; reason?: string; runId?: string } {
    if (!this.runs) return { ok: false, reason: "runs_unavailable" };
    const integ = this.getIntegration(missionId);
    if (!integ) return { ok: false, reason: "no_integration" };
    if (integ.status !== "conflict") return { ok: false, reason: `not_in_conflict: ${integ.status}` };

    const attempts = this.fixes.get(missionId)?.attempts ?? 0;
    if (attempts >= MAX_FIX_ATTEMPTS) return { ok: false, reason: "max_attempts" };

    // 下一个待合并分支 = 第一个不在 mergedBranches 里的 done 分支。
    const next = this.doneRuns(missionId).find((r) => !integ.mergedBranches.includes(r.branch!));
    if (!next) return { ok: false, reason: "no_conflict_branch" };

    // 在集成 worktree 重制冲突，保留标记给 Agent 解决。
    const outcome = mergeBranchKeepConflicts(integ.worktreePath, next.branch!, `[orbit] merge ${next.branch} into ${integ.branch}`);
    if (outcome.ok) {
      // 罕见：此刻不再冲突，直接记入并续跑。
      this.core.store.updateIntegrationRunFields(integ.id, { status: "merging", mergedBranches: [...integ.mergedBranches, next.branch!] }, Date.now());
      const r = this.mergeAndValidate(missionId);
      return { ok: r.ok, reason: r.ok ? undefined : r.reason };
    }

    const mission = this.core.missions.get(missionId);
    const run = this.runs.start({
      harness: next.harness,
      missionId,
      taskId: null,
      projectId: mission?.projectId ?? null,
      taskTitle: `解决集成冲突：${next.branch}`,
      goal: buildConflictFixPrompt(outcome.conflicts),
      projectPath: integ.worktreePath,
      isolate: false, // 关键：直接在集成 worktree 现场解决，不另建隔离区
    });
    this.fixes.set(missionId, { runId: run.id, branch: next.branch!, attempts: attempts + 1 });
    return { ok: true, runId: run.id };
  }

  // 修复 run 到达终态 → 收口。done 则尝试完成 merge 并续跑；失败/未解决则留在 conflict。
  private onRunUpdated(run: AgentRun): void {
    if (!run.missionId) return;
    const fix = this.fixes.get(run.missionId);
    if (!fix || fix.runId !== run.id) return;
    if (!TERMINAL_RUN_STATUSES.has(run.status)) return;
    if (this.runs?.isRunning(run.id)) return; // 进程尚未真正退出，等下次终态事件
    if (run.status !== "done") {
      // 修复进程失败/被停 → 留在 conflict，保留 attempts，等用户再派或人工裁决。
      return;
    }
    this.onFixDone(run.missionId, fix);
  }

  private onFixDone(missionId: string, fix: FixState): void {
    const integ = this.getIntegration(missionId);
    if (!integ) {
      this.fixes.delete(missionId);
      return;
    }
    const fin = finalizeConflictMerge(integ.worktreePath, `[orbit] resolve conflict in ${fix.branch}`);
    if (!fin.ok) {
      // Agent 没解决干净：留在 conflict（保留 attempts 以受上限约束），等再派或裁决。
      this.core.store.updateIntegrationRunFields(integ.id, { status: "conflict", conflicts: listConflictFiles(integ.worktreePath) }, Date.now());
      this.advance(missionId, ["resolving_conflicts"]);
      this.emitIntegration(this.getIntegration(missionId)!);
      return;
    }
    // 冲突分支已合并：记入 mergedBranches，清理本次 fix，续跑剩余合并 + 验证。
    this.core.store.updateIntegrationRunFields(integ.id, { status: "merging", conflicts: [], mergedBranches: [...integ.mergedBranches, fix.branch] }, Date.now());
    this.fixes.delete(missionId);
    this.mergeAndValidate(missionId);
  }

  // ----- 内部 -----

  private runIntegrationValidation(missionId: string, cwd: string, commands: ProjectCommands): { allPassed: boolean; validationIds: string[] } {
    const steps = (["install", "build", "lint", "test"] as const).map((k) => commands[k]).filter((c): c is string => Boolean(c && c.trim()));
    const validationIds: string[] = [];
    let allPassed = true;
    for (const command of steps) {
      const startedAt = Date.now();
      const { exitCode, output } = this.runValidation(command, cwd);
      const vr: ValidationRun = {
        id: newId("val"),
        missionId,
        taskId: null,
        scope: "integration",
        command,
        exitCode,
        output,
        ok: exitCode === 0,
        startedAt,
        finishedAt: Date.now(),
      };
      this.core.store.insertValidationRun(vr);
      this.core.events.emit("validation_recorded", vr);
      validationIds.push(vr.id);
      if (exitCode !== 0) {
        allPassed = false;
        break; // 一步失败即停（G03：所有必需检查通过才能审批）
      }
    }
    return { allPassed, validationIds };
  }

  private recordApproval(missionId: string, decision: "approved" | "rejected", by: string | null, note: string): Approval {
    const approval: Approval = { id: newId("appr"), missionId, stage: "final", decision, approvedBy: by, note, createdAt: Date.now() };
    this.core.store.insertApproval(approval);
    this.core.events.emit("approval_recorded", approval);
    return approval;
  }

  private resolveTargetBranch(mission: Mission, projectRoot: string): string {
    const project = mission.projectId ? this.core.projects.get(mission.projectId) : null;
    return project?.targetBranch ?? inspectProject(projectRoot).targetBranch ?? "main";
  }

  private runsRoot(missionId: string): string | null {
    const r = this.core.store.listAgentRuns().find((x) => x.missionId === missionId && x.projectPath);
    return r ? r.projectPath : null;
  }

  // 依次推进 mission 状态机（非法步被忽略，以最终为准）。
  private advance(missionId: string, states: Mission["state"][]): void {
    for (const to of states) this.core.missions.transition(missionId, to);
  }

  private emitIntegration(integ: IntegrationRun): void {
    this.core.events.emit("integration_updated", integ);
  }
}

export type { AgentRun };
