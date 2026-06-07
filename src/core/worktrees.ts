import path from "node:path";
import { execFileSync } from "node:child_process";
import type { WorktreeDiff, WorktreeDiffFile, WorktreeInfo } from "./types.js";

// D01 工作区隔离（第二阶段：真实执行 git worktree）。
// 每个 run 在独立的 worktree + 分支里跑，互不干扰，主仓库不被污染。
// 纯函数 + 同步 git 调用：可用真实临时仓库单测，不依赖 store/events。
// 决策（已与用户对齐）：run 结束保留 worktree 供 review/合并；提供显式 remove；含基础 diff。

// 跑一条 git 命令取 stdout；失败抛出带 stderr 的友好错误。
function git(root: string, args: string[]): string {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (err) {
    const e = err as { stderr?: Buffer | string; message?: string };
    const detail = (e.stderr ? String(e.stderr) : e.message ?? "").trim();
    throw new Error(detail || `git ${args.join(" ")} 失败`);
  }
}

// 软调用：失败返回 null（用于探测类命令，不抛）。
function gitSoft(root: string, args: string[]): string | null {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

export function isGitRepo(root: string): boolean {
  return gitSoft(root, ["rev-parse", "--is-inside-work-tree"]) === "true";
}

// 仓库是否已有至少一个提交（空仓库无法 git worktree add）。
export function hasCommits(root: string): boolean {
  return gitSoft(root, ["rev-parse", "--verify", "HEAD"]) != null;
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

export interface WorktreePlan {
  worktreePath: string;
  branch: string;
}

// 规划一个独立 worktree 的路径与分支名：集中在兄弟目录 <projectName>-orbit/ 下，
// 不污染父目录、也不落在主仓库内部。runId 短尾保证多 run 同 task 不撞分支。
export function planWorktree(root: string, label: string, runId: string): WorktreePlan {
  const resolved = path.resolve(root);
  const parent = path.dirname(resolved);
  const projectName = path.basename(resolved);
  const shortId = (runId.replace(/^run[_-]?/i, "") || runId).slice(-6);
  const labelSlug = slug(label);
  const seg = labelSlug ? `${labelSlug}-${shortId}` : `run-${shortId}`;
  return {
    branch: `orbit/${seg}`,
    worktreePath: path.join(parent, `${projectName}-orbit`, seg),
  };
}

export interface AddWorktreeInput {
  projectRoot: string;
  worktreePath: string;
  branch: string;
  /** 从哪个分支/commit 切出；不传则从当前 HEAD。 */
  baseRef?: string | null;
}

// git worktree add -b <branch> <path> [<baseRef>]：创建独立工作区并切到新分支。
export function addWorktree(input: AddWorktreeInput): WorktreeInfo {
  const { projectRoot, worktreePath, branch, baseRef } = input;
  const args = ["worktree", "add", "-b", branch, worktreePath];
  if (baseRef) args.push(baseRef);
  git(projectRoot, args);
  const head = gitSoft(worktreePath, ["rev-parse", "HEAD"]);
  return { path: path.resolve(worktreePath), branch, head, locked: false };
}

// 移除一个 worktree 并删除其分支（保留-供-review 流程结束后的显式清理）。
export function removeWorktree(
  projectRoot: string,
  worktreePath: string,
  branch?: string | null,
  opts: { force?: boolean } = {},
): void {
  const args = ["worktree", "remove"];
  if (opts.force !== false) args.push("--force"); // 默认强制：worker 可能留下未提交改动
  args.push(worktreePath);
  git(projectRoot, args);
  if (branch) {
    // 分支删除失败不致命（可能已被合并/删除）。
    gitSoft(projectRoot, ["branch", "-D", branch]);
  }
}

export function pruneWorktrees(projectRoot: string): void {
  gitSoft(projectRoot, ["worktree", "prune"]);
}

// 解析 `git worktree list --porcelain`：以空行分隔的记录块。
export function listWorktrees(projectRoot: string): WorktreeInfo[] {
  const out = gitSoft(projectRoot, ["worktree", "list", "--porcelain"]);
  if (!out) return [];
  const blocks = out.split(/\n\s*\n/);
  const infos: WorktreeInfo[] = [];
  for (const block of blocks) {
    let wtPath: string | null = null;
    let head: string | null = null;
    let branch: string | null = null;
    let locked = false;
    for (const line of block.split("\n")) {
      if (line.startsWith("worktree ")) wtPath = line.slice("worktree ".length).trim();
      else if (line.startsWith("HEAD ")) head = line.slice("HEAD ".length).trim();
      else if (line.startsWith("branch ")) branch = line.slice("branch ".length).trim().replace(/^refs\/heads\//, "");
      else if (line === "locked" || line.startsWith("locked ")) locked = true;
    }
    if (wtPath) infos.push({ path: wtPath, branch, head, locked });
  }
  return infos;
}

// 解析 numstat 行：`<added>\t<deleted>\t<path>`；二进制文件 added/deleted 为 "-"。
function parseNumstat(out: string): WorktreeDiffFile[] {
  if (!out) return [];
  const files: WorktreeDiffFile[] = [];
  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    if (parts.length < 3) continue;
    const added = parts[0] === "-" ? null : Number(parts[0]);
    const deleted = parts[1] === "-" ? null : Number(parts[1]);
    files.push({ path: parts.slice(2).join("\t"), added, deleted, binary: parts[0] === "-" });
  }
  return files;
}

// 基础 diff 摘要：worktree 相对 base 的改动（已追踪：含已提交+未提交）+ 未追踪新文件。
// `git diff <base>` 比较 base 与当前工作目录，天然覆盖"worker 改了文件、不论是否 commit"。
export function worktreeDiff(worktreePath: string, base: string): WorktreeDiff {
  const numstat = gitSoft(worktreePath, ["diff", "--numstat", base, "--"]) ?? "";
  const files = parseNumstat(numstat);
  const untrackedOut = gitSoft(worktreePath, ["ls-files", "--others", "--exclude-standard"]) ?? "";
  const untracked = untrackedOut ? untrackedOut.split("\n").filter((l) => l.trim()) : [];
  const insertions = files.reduce((sum, f) => sum + (f.added ?? 0), 0);
  const deletions = files.reduce((sum, f) => sum + (f.deleted ?? 0), 0);
  return {
    base,
    files,
    untracked,
    filesChanged: files.length + untracked.length,
    insertions,
    deletions,
  };
}
