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
  mergeBranchInto,
  mergeIntoTarget,
  resetHard,
} from "../core/integration.js";

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

export class IntegrationManager {
  constructor(
    private readonly core: CoordinationCore,
    private readonly runValidation: ValidationRunner = defaultRunValidation,
  ) {}

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

    // D07/D08：按顺序合并各 Agent 分支；冲突即中止并报告（不破坏集成分支）。
    const merged: string[] = [];
    for (const r of runs) {
      const outcome = mergeBranchInto(worktreePath, r.branch!, `[orbit] merge ${r.branch} into ${branch}`);
      if (!outcome.ok) {
        this.core.store.updateIntegrationRunFields(integration.id, { status: "conflict", conflicts: outcome.conflicts, mergedBranches: merged }, Date.now());
        this.advance(missionId, ["resolving_conflicts"]);
        return { ok: false, reason: "merge_conflict", integration: this.getIntegration(missionId) };
      }
      merged.push(r.branch!);
    }
    this.core.store.updateIntegrationRunFields(integration.id, { status: "validating", mergedBranches: merged }, Date.now());
    this.advance(missionId, ["validating_integration"]);

    // G01/G03/G04：在集成 worktree 跑项目配置的验证命令，落 ValidationRun 报告。
    const project = mission.projectId ? this.core.projects.get(mission.projectId) : null;
    const { allPassed, validationIds } = this.runIntegrationValidation(missionId, worktreePath, project?.commands ?? {});

    if (!allPassed) {
      this.core.store.updateIntegrationRunFields(integration.id, { status: "failed", validationRunIds: validationIds }, Date.now());
      this.emitIntegration(this.getIntegration(missionId)!);
      return { ok: false, reason: "validation_failed", integration: this.getIntegration(missionId) };
    }
    // 候选就绪，等待人工审批（B08）。
    this.core.store.updateIntegrationRunFields(integration.id, { status: "ready", validationRunIds: validationIds }, Date.now());
    this.advance(missionId, ["awaiting_final_approval"]);
    const ready = this.getIntegration(missionId)!;
    this.emitIntegration(ready);
    return { ok: true, integration: ready };
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
