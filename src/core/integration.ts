import { execFileSync } from "node:child_process";

// 第四阶段：集成分支与合并（D05/D06/D07/D08/D09/G07）。纯 git 操作，可用真实临时仓库单测。
// 安全约束（规格）：自动代码先进集成分支；未经批准不得合入目标分支；冲突不破坏原始分支。

// 让 Orbit 的自动提交/合并有稳定身份，且不污染用户的 git 全局配置。
const ORBIT_IDENTITY = ["-c", "user.name=Orbit", "-c", "user.email=orbit@local"];

function git(cwd: string, args: string[]): string {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (err) {
    const e = err as { stderr?: Buffer | string; message?: string };
    throw new Error((e.stderr ? String(e.stderr) : e.message ?? "").trim() || `git ${args.join(" ")} 失败`);
  }
}
function gitSoft(cwd: string, args: string[]): string | null {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

function conflictFiles(cwd: string): string[] {
  const out = gitSoft(cwd, ["diff", "--name-only", "--diff-filter=U"]) ?? "";
  return out.split("\n").filter((l) => l.trim());
}

export function branchTip(repo: string, ref: string): string | null {
  return gitSoft(repo, ["rev-parse", "--verify", ref]);
}

// D05：把一个 Agent worktree 的全部改动提交到它自己的分支。无改动则跳过（返回当前 HEAD）。
export function commitAgentWork(worktreePath: string, message: string): { committed: boolean; commit: string | null } {
  const dirty = gitSoft(worktreePath, ["status", "--porcelain"]);
  if (!dirty) return { committed: false, commit: gitSoft(worktreePath, ["rev-parse", "HEAD"]) };
  git(worktreePath, ["add", "-A"]);
  git(worktreePath, [...ORBIT_IDENTITY, "commit", "-m", message]);
  return { committed: true, commit: gitSoft(worktreePath, ["rev-parse", "HEAD"]) };
}

// D06：从目标分支建立独立集成分支 + worktree。返回起点 commit（= 目标分支当时的 tip）。
export function createIntegrationWorktree(
  projectRoot: string,
  targetBranch: string,
  integrationBranch: string,
  worktreePath: string,
): { baseCommit: string } {
  git(projectRoot, ["worktree", "add", "-b", integrationBranch, worktreePath, targetBranch]);
  return { baseCommit: gitSoft(worktreePath, ["rev-parse", "HEAD"]) ?? "" };
}

export type MergeOutcome = { ok: true; commit: string } | { ok: false; conflicts: string[] };

// D07/D08：把一个分支合并进集成 worktree 当前分支。冲突则中止合并（不破坏分支）并返回冲突文件。
export function mergeBranchInto(integrationWorktree: string, branch: string, message: string): MergeOutcome {
  try {
    git(integrationWorktree, [...ORBIT_IDENTITY, "merge", "--no-ff", "-m", message, branch]);
    return { ok: true, commit: gitSoft(integrationWorktree, ["rev-parse", "HEAD"]) ?? "" };
  } catch {
    const conflicts = conflictFiles(integrationWorktree);
    gitSoft(integrationWorktree, ["merge", "--abort"]);
    return { ok: false, conflicts };
  }
}

// G07：把集成分支合入目标分支（在主仓库）。失败/冲突时中止合并，目标分支不被破坏。
export function mergeIntoTarget(
  projectRoot: string,
  targetBranch: string,
  integrationBranch: string,
  message: string,
): { ok: true; resultCommit: string } | { ok: false; conflicts: string[] } {
  git(projectRoot, ["checkout", targetBranch]);
  try {
    git(projectRoot, [...ORBIT_IDENTITY, "merge", "--no-ff", "-m", message, integrationBranch]);
    return { ok: true, resultCommit: gitSoft(projectRoot, ["rev-parse", "HEAD"]) ?? "" };
  } catch {
    const conflicts = conflictFiles(projectRoot);
    gitSoft(projectRoot, ["merge", "--abort"]);
    return { ok: false, conflicts };
  }
}

// D09：把某分支硬回退到指定 commit（合入失败后恢复目标分支）。
export function resetHard(repo: string, toCommit: string): void {
  git(repo, ["reset", "--hard", toCommit]);
}
