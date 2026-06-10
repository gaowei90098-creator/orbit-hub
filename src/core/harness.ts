import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import type { Harness } from "./types.js";

// 1.2 Harness Profile —— 同源双渲染。
// 一份 profile（角色 / 协议 / 粒度 / 输出约定 + 任务契约）渲染成两种产物：
//   1) renderWorkerPrompt：worker 首条 prompt（Claude/Codex 共用，消除两份提示词的不对称）
//   2) renderHarnessFile：写进 worktree 的 CLAUDE.md / AGENTS.md，让协议全程生效（不只首条 prompt）
// installHarnessFile 负责把渲染结果写进 worktree，并用 git 机制（info/exclude 或
// skip-worktree）把 harness 文件挡在提交之外——否则 commitAgentWork 的 `git add -A`
// 会把它带进 Agent 分支、污染集成 diff。

// ----- 任务契约（与 Task 的四个契约字段对应） -----
export interface TaskContract {
  id: string | null;
  title: string;
  description: string;
  fileScope: string[]; // 允许修改的文件/目录范围（glob）；空 = 未限定
  doneWhen: string; // 完成标准
  verifyCommand: string; // 验证命令；跑通之前不许 update_task done
  interfaceRef: string; // 涉及的共享接口/契约说明
}

export interface HarnessProfile {
  role: string; // worker 角色一句话
  goal: string; // mission 目标
  task: TaskContract;
  protocol: string[]; // Orbit 协作协议条目（含硬规则）
  granularity: string[]; // 改动粒度/边界约定
  output: string[]; // 输出约定
  withOrbitProtocol: boolean; // false = 无 MCP 接入（如冲突修复现场），不渲染协作协议
}

export interface BuildProfileInput {
  goal: string;
  taskTitle: string;
  taskId: string | null;
  taskDescription?: string;
  fileScope?: string[];
  doneWhen?: string;
  verifyCommand?: string;
  interfaceRef?: string;
  /** 无 MCP 接入的运行（如集成冲突修复）传 false，跳过协作协议渲染。 */
  withOrbitProtocol?: boolean;
}

// MCP 工具名按 harness 装饰：Claude Code 看到的是 mcp__orbit__ 前缀，Codex 是裸名。
function tool(harness: Harness, name: string): string {
  return harness === "claude-code" ? `mcp__orbit__${name}` : name;
}

export function buildHarnessProfile(input: BuildProfileInput): HarnessProfile {
  const fileScope = input.fileScope ?? [];
  const verifyCommand = (input.verifyCommand ?? "").trim();
  const task: TaskContract = {
    id: input.taskId,
    title: input.taskTitle,
    description: input.taskDescription ?? "",
    fileScope,
    doneWhen: (input.doneWhen ?? "").trim(),
    verifyCommand,
    interfaceRef: (input.interfaceRef ?? "").trim(),
  };
  return {
    role: "你是通过 Orbit 协作枢纽接入的开发 Agent，与其他 Agent 并行开发同一个项目，要在当前目录里把分给你的任务完整实现出来。",
    goal: input.goal,
    task,
    protocol: [
      "改任何文件前先 {acquire_file_lock} 锁定该文件；若已被他人锁定，用 {send_message} 协调，绝不覆盖别人的修改。",
      "定义或改动会影响他人的接口/数据结构时：立即 {update_contract} 写入新约定，并用 {send_message} 广播给 \"all\"。这是最重要的一条协作规则。",
      "每完成一个关键步骤（如：数据模型完成 / 接口跑通 / 测试通过），调用 {update_task} 带一句 note 汇报进展（status 保持 in_progress）。操作员靠这些 note 了解你的进度，长时间不汇报会被视为停滞。",
      "子任务之间用 {get_messages} 查收消息——队友可能改了你依赖的接口。",
      "完成后 {release_file_lock} 释放所有锁。",
      verifyCommand
        ? `【硬规则】先运行验证命令 \`${verifyCommand}\` 且通过（退出码 0），才允许 {update_task} 标记 done；验证不通过就修到通过为止，并把验证结果写进 note。`
        : "【硬规则】标记 done 之前先自行验证（跑测试或运行验证命令），并把验证结果写进 {update_task} 的 note。",
    ],
    granularity: [
      fileScope.length > 0
        ? `只允许修改以下范围内的文件（fileScope）：${fileScope.join("、")}。范围外的文件只读；确需越界先用 {send_message} 说明并征得协调。`
        : "改动保持聚焦在你的任务上，不顺手重构无关代码。",
      "改动保持小步、可独立运行；不要引入与任务无关的依赖。",
    ],
    output: [
      "最后用简短中文总结：做了什么、改了哪些文件、验证命令的执行结果、如何运行。",
    ],
    withOrbitProtocol: input.withOrbitProtocol ?? true,
  };
}

// 把条目里的 {tool} 占位符替换为该 harness 的实际工具名。
function decorate(line: string, harness: Harness): string {
  return line.replace(/\{(\w+)\}/g, (_, name: string) => tool(harness, name));
}

function contractLines(task: TaskContract): string[] {
  const lines: string[] = [];
  if (task.fileScope.length > 0) lines.push(`- 文件范围（fileScope）：${task.fileScope.join("、")}`);
  if (task.doneWhen) lines.push(`- 完成标准（doneWhen）：${task.doneWhen}`);
  if (task.verifyCommand) lines.push(`- 验证命令（verifyCommand）：\`${task.verifyCommand}\``);
  if (task.interfaceRef) lines.push(`- 共享接口（interfaceRef）：${task.interfaceRef}`);
  return lines;
}

// ----- 渲染一：worker 首条 prompt（两个 driver 共用） -----
export function renderWorkerPrompt(profile: HarnessProfile, harness: Harness): string {
  const { task } = profile;
  const idLine = task.id
    ? `你在 Orbit 任务板上对应的任务：${task.title}（任务 id：${task.id}）`
    : `你要完成的任务：${task.title}`;
  const lines: string[] = [profile.role, "", `要实现的目标：${profile.goal}`, idLine];
  if (task.description) lines.push("", `任务说明：${task.description}`);
  const contract = contractLines(task);
  if (contract.length > 0) lines.push("", "任务契约：", ...contract);

  if (profile.withOrbitProtocol) {
    let n = 0;
    const step = (s: string): string => `${++n}. ${decorate(s, harness)}`;
    lines.push("", "请按以下步骤执行：");
    lines.push(step(`调用 {whoami} 确认已接入 Orbit。`));
    lines.push(
      step(
        task.id
          ? `调用 {claim_task} 领取任务 ${task.id}；若返回 already_claimed，说明已有人接手，直接结束。`
          : `调用 {list_tasks} 查看任务板，认领你该做的任务。`,
      ),
    );
    lines.push(step(`调用 {update_task} 把任务标记为 in_progress。`));
    lines.push(step(`调用 {get_contract} 读取共享约定（若有就遵循）。`));
    lines.push(step(`完整实现这个任务，期间遵守下面的协作协议。`));
    for (const p of profile.protocol) lines.push(step(p));
  }
  lines.push("", ...profile.granularity.map((g) => `- ${decorate(g, harness)}`));
  lines.push(...profile.output.map((o) => `- ${o}`));
  return lines.join("\n");
}

// ----- 渲染二：worktree 里的 harness 文件（CLAUDE.md / AGENTS.md） -----
const MARK_START = "<!-- orbit:harness:start -->";
const MARK_END = "<!-- orbit:harness:end -->";

export function renderHarnessFile(profile: HarnessProfile, harness: Harness): string {
  const { task } = profile;
  const lines: string[] = [
    MARK_START,
    "# Orbit Worker 工作协议（本节由 Orbit 自动注入，全程有效）",
    "",
    profile.role,
    "",
    `## 当前任务`,
    `- 目标：${profile.goal}`,
    `- 任务：${task.title}${task.id ? `（id：${task.id}）` : ""}`,
  ];
  lines.push(...contractLines(task));
  if (profile.withOrbitProtocol) {
    lines.push("", "## 协作协议（每一步都要遵守）");
    for (const p of profile.protocol) lines.push(`- ${decorate(p, harness)}`);
  }
  lines.push("", "## 改动边界");
  for (const g of profile.granularity) lines.push(`- ${decorate(g, harness)}`);
  lines.push("", "## 输出约定");
  for (const o of profile.output) lines.push(`- ${o}`);
  lines.push("", "注意：本文件是 Orbit 注入的本地工作协议，不要修改或提交它。", MARK_END, "");
  return lines.join("\n");
}

export function harnessFileName(harness: Harness): string {
  return harness === "codex" ? "AGENTS.md" : "CLAUDE.md";
}

// ----- 写入 worktree（带 git 排除，保证 harness 文件永不进入提交/diff） -----

function gitSoft(cwd: string, args: string[]): string | null {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

function isTracked(worktreePath: string, name: string): boolean {
  return gitSoft(worktreePath, ["ls-files", "--error-unmatch", name]) !== null;
}

// 未跟踪文件：写进该 worktree 专属的 info/exclude（不动仓库的 .gitignore）。
function addToWorktreeExclude(worktreePath: string, name: string): void {
  const rel = gitSoft(worktreePath, ["rev-parse", "--git-path", "info/exclude"]);
  if (!rel) return;
  const excludePath = path.isAbsolute(rel) ? rel : path.join(worktreePath, rel);
  fs.mkdirSync(path.dirname(excludePath), { recursive: true });
  const current = fs.existsSync(excludePath) ? fs.readFileSync(excludePath, "utf8") : "";
  const line = `/${name}`;
  if (!current.split("\n").includes(line)) {
    fs.writeFileSync(excludePath, `${current.trimEnd()}${current.trim() ? "\n" : ""}${line}\n`);
  }
}

export interface InstallHarnessResult {
  path: string;
  mode: "created" | "appended" | "replaced";
}

// 把渲染好的 harness 内容写进 worktree：
// - 文件不存在 → 直接创建，并加入 worktree 的 info/exclude（不进 git status / 提交）；
// - 已存在且含 Orbit 标记 → 替换标记段（resume 等重复安装幂等）；
// - 已存在（项目自带 CLAUDE.md/AGENTS.md）→ 追加 Orbit 段保留原内容；若该文件被 git 跟踪，
//   用 skip-worktree 让本地修改不进暂存区（git add -A 会跳过），集成 diff 保持干净。
export function installHarnessFile(worktreePath: string, harness: Harness, content: string): InstallHarnessResult {
  const name = harnessFileName(harness);
  const filePath = path.join(worktreePath, name);
  const exists = fs.existsSync(filePath);
  const existing = exists ? fs.readFileSync(filePath, "utf8") : "";
  const tracked = exists && isTracked(worktreePath, name);

  let next: string;
  let mode: InstallHarnessResult["mode"];
  const start = existing.indexOf(MARK_START);
  const end = existing.indexOf(MARK_END);
  if (start !== -1 && end !== -1) {
    next = `${existing.slice(0, start)}${content.trim()}${existing.slice(end + MARK_END.length)}`;
    mode = "replaced";
  } else if (existing.trim()) {
    next = `${existing.trimEnd()}\n\n${content.trim()}\n`;
    mode = "appended";
  } else {
    next = `${content.trim()}\n`;
    mode = "created";
  }
  fs.writeFileSync(filePath, next);

  if (tracked) {
    gitSoft(worktreePath, ["update-index", "--skip-worktree", name]);
  } else {
    addToWorktreeExclude(worktreePath, name);
  }
  return { path: filePath, mode };
}
