import { spawn } from "node:child_process";
import { z } from "zod";
import type { Agent } from "../core/types.js";
import { claudeWorkerEnv } from "../drivers/claude-driver.js";
import type { MissionPlan, TaskDraft } from "./task-planner.js";

// 1.1 Lead Planner —— 拆分智能从 Hub 模板移到 Agent。
// 用 `claude -p` headless 跑一次规划：lead 先读真实仓库结构（只读工具），再产出 JSON 任务
// 草案，zod 校验后转成 MissionPlan。无 CLI / 失败 / 超时一律返回 ok:false，由调用方回退模板。

const DEFAULT_MODEL = process.env.ORBIT_PLANNER_MODEL ?? "sonnet";
const DEFAULT_BUDGET_USD = Number(process.env.ORBIT_PLANNER_BUDGET_USD ?? "1");
const DEFAULT_TIMEOUT_MS = Number(process.env.ORBIT_PLANNER_TIMEOUT_MS ?? String(3 * 60_000));
// 规划只许读仓库，不许改任何东西。
const PLANNER_ALLOWED_TOOLS = "Read Glob Grep";

// lead 输出的单个任务草案：契约四字段必须填满（fileScope/doneWhen 不许空）。
const leadTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().default(""),
  area: z.enum(["frontend", "backend", "general"]).default("general"),
  fileScope: z.array(z.string().min(1)).min(1),
  doneWhen: z.string().min(1),
  verifyCommand: z.string().default(""),
  interfaceRef: z.string().default(""),
});
const leadPlanSchema = z.object({
  tasks: z.array(leadTaskSchema).min(1).max(4),
});

export type LeadPlanResult = { ok: true; plan: MissionPlan } | { ok: false; reason: string };

export interface LeadPlanInput {
  goal: string;
  projectPath: string;
  agents: Agent[]; // 在线 agent 列表（决定拆几份、各自方向）
  verifyCommandHint?: string; // 项目已探测到的验证命令（lead 可直接采用）
  model?: string;
  timeoutMs?: number;
  budgetUsd?: number;
}

export type LeadPlannerFn = (input: LeadPlanInput) => Promise<LeadPlanResult>;

interface RunnerResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

// 可注入的 headless 执行器（测试用假 runner，不依赖真实 claude CLI）。
export type HeadlessRunner = (
  args: string[],
  opts: { cwd: string; timeoutMs: number },
) => Promise<RunnerResult>;

const defaultRunner: HeadlessRunner = (args, opts) =>
  new Promise((resolve) => {
    const child = spawn("claude", args, {
      cwd: opts.cwd,
      env: claudeWorkerEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, opts.timeoutMs);
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ exitCode: null, stdout, stderr: stderr || err.message, timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code, stdout, stderr, timedOut });
    });
  });

function agentLine(a: Agent): string {
  const role = a.role ? `，角色：${a.role}` : "";
  return `- ${a.name}（harness：${a.harness}${role}）`;
}

export function buildPlanningPrompt(goal: string, agents: Agent[], verifyCommandHint?: string): string {
  const drivable = agents.filter((a) => a.harness === "claude-code" || a.harness === "codex");
  const workerCount = Math.min(Math.max(drivable.length, 2), 4);
  const lines: (string | null)[] = [
    `你是一个多 Agent 开发团队的 lead。你的唯一职责：把下面的目标拆成可并行执行的任务，输出 JSON。`,
    ``,
    `目标：${goal}`,
    ``,
    `在线 worker（拆分要与之匹配）：`,
    ...(agents.length > 0 ? agents.map(agentLine) : ["-（暂无在线 worker，按 2 个并行 worker 拆）"]),
    ``,
    `硬性要求：`,
    `1. 动手拆分前，必须先用 Glob/Read 工具查看当前仓库的真实目录结构和关键文件（package.json、入口文件、src 布局），拆分必须与真实结构对得上——不许凭空编造路径。`,
    `2. 拆成 ${workerCount} 个可并行的任务（互相不阻塞）。`,
    `3. 每个任务必须填满任务契约四个字段：`,
    `   - fileScope：该任务允许修改的文件/目录（仓库相对路径或 glob，必须真实存在或合理的新增路径）；不同任务的 fileScope 不许重叠，这是并行不打架的前提。`,
    `   - doneWhen：可人工核对的完成标准（一两句话）。`,
    `   - verifyCommand：在仓库根目录可直接运行的验证命令（如 npm test、npm run build）；项目没有可用命令时给空字符串。`,
    `   - interfaceRef：该任务与其他任务对接的接口/数据结构说明；无对接则空字符串。`,
    verifyCommandHint ? `   （提示：项目已探测到验证命令：${verifyCommandHint}，可直接采用。）` : null,
    `4. area 字段标注任务方向：frontend / backend / general。`,
    ``,
    `最终回复只输出一个 JSON 对象，不要解释、不要 markdown 代码块，格式：`,
    `{"tasks":[{"title":"...","description":"...","area":"backend","fileScope":["src/api/**"],"doneWhen":"...","verifyCommand":"npm test","interfaceRef":"..."}]}`,
  ];
  return lines.filter((l): l is string => l !== null).join("\n");
}

// 从 claude 的最终文本里抠出 JSON（容忍 markdown 代码块 / 前后缀解释文字）。
export function extractJson(text: string): unknown | null {
  const t = text.trim();
  const candidates: string[] = [];
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(t);
  if (fence?.[1]) candidates.push(fence[1].trim());
  candidates.push(t);
  const first = t.indexOf("{");
  const last = t.lastIndexOf("}");
  if (first !== -1 && last > first) candidates.push(t.slice(first, last + 1));
  for (const c of candidates) {
    try {
      return JSON.parse(c) as unknown;
    } catch {
      // 尝试下一个候选
    }
  }
  return null;
}

// `claude -p --output-format json` 的顶层结果对象。
interface ClaudeJsonResult {
  type?: string;
  is_error?: boolean;
  result?: unknown;
}

// 校验 + 归一化 lead 的 JSON 输出 → MissionPlan（导出供单测）。
export function parseLeadPlan(raw: unknown): LeadPlanResult {
  const parsed = leadPlanSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, reason: `JSON 不符合任务草案格式：${parsed.error.issues[0]?.message ?? "unknown"}` };
  }
  const tasks: TaskDraft[] = parsed.data.tasks.map((t) => ({
    title: t.title,
    description: t.description,
    area: t.area,
    files: t.fileScope,
    fileScope: t.fileScope,
    doneWhen: t.doneWhen,
    verifyCommand: t.verifyCommand,
    interfaceRef: t.interfaceRef,
  }));
  // 轻量重叠检查：完全相同的 fileScope 条目出现在多个任务 → 提示但不否决（globs 重叠无法静态判全）。
  const seen = new Map<string, number>();
  let overlap: string | null = null;
  tasks.forEach((t, i) => {
    for (const f of t.fileScope) {
      const prev = seen.get(f);
      if (prev !== undefined && prev !== i) overlap = f;
      seen.set(f, i);
    }
  });
  return {
    ok: true,
    plan: {
      template: "lead",
      templateLabel: "Lead 拆分",
      tasks,
      source: "lead",
      note: overlap ? `注意：fileScope 存在重叠（${overlap}），启动前请在预览里调整。` : undefined,
    },
  };
}

// 跑一次 lead 规划。任何失败（无 CLI / 超时 / 输出不可解析）返回 ok:false，调用方回退模板。
export async function planWithLead(input: LeadPlanInput, runner: HeadlessRunner = defaultRunner): Promise<LeadPlanResult> {
  const prompt = buildPlanningPrompt(input.goal, input.agents, input.verifyCommandHint);
  const args = [
    "-p",
    prompt,
    "--output-format",
    "json",
    "--model",
    input.model ?? DEFAULT_MODEL,
    "--max-budget-usd",
    String(input.budgetUsd ?? DEFAULT_BUDGET_USD),
    "--allowedTools",
    PLANNER_ALLOWED_TOOLS,
  ];
  let res: RunnerResult;
  try {
    res = await runner(args, { cwd: input.projectPath, timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS });
  } catch (err) {
    return { ok: false, reason: `规划进程启动失败：${(err as Error).message}` };
  }
  if (res.timedOut) return { ok: false, reason: "lead 规划超时" };
  // --output-format json：stdout 是单个 JSON 对象，result 字段是最终文本。
  // 注意：claude 出错（如 401）时退出码非 0 但 stdout 仍是结构化 JSON——先解析它，
  // 错误原因（result 文本）远比退出码 + 原始尾巴可读。
  const top = extractJson(res.stdout) as ClaudeJsonResult | null;
  if (top?.is_error) return { ok: false, reason: `claude 报错：${String(top.result ?? "").slice(0, 200)}` };
  if (res.exitCode !== 0) {
    return { ok: false, reason: `claude 退出码 ${res.exitCode ?? "null"}：${(res.stderr || res.stdout).slice(-200)}` };
  }
  if (!top) return { ok: false, reason: "无法解析 claude 输出" };
  const payload = typeof top.result === "string" ? extractJson(top.result) : (top.result ?? top);
  if (!payload) return { ok: false, reason: "lead 输出里找不到 JSON 任务草案" };
  return parseLeadPlan(payload);
}
