import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Express, Request, Response } from "express";
import { z, type ZodType } from "zod";
import type { CoordinationCore } from "../core/core.js";
import type { Agent, Harness, Task } from "../core/types.js";
import type { RunManager } from "./run-manager.js";
import type { IntegrationManager } from "./integration-manager.js";
import type { MessageRouter } from "./message-router.js";
import { detectEnvironment } from "../drivers/detect.js";
import { detectCommands } from "../core/projects.js";
import { launchParts } from "../launch.js";
import { newId } from "../core/id.js";
import { buildReviewPrompt } from "./review.js";
import { buildRescuePrompt, selectRescueTargets, RESCUE_STALL_MS } from "./rescue.js";
import { buildAgentCard } from "./agent-card.js";
import { planTasks, planWithTemplate, listTemplates, assignDraftsToAgents, type MissionPlan, type TaskDraft } from "./task-planner.js";
import type { LeadPlannerFn } from "./lead-planner.js";

interface RouteOptions {
  tokenRequired?: boolean;
  // 1.1 Lead Planner（claude headless 拆分）。不注入则一律走模板（测试/无 CLI 环境）。
  leadPlanner?: LeadPlannerFn;
}

const HARNESS = z.enum(["claude-code", "codex", "gemini", "opencode", "other"]);
const TASK_STATUS = z.enum(["todo", "claimed", "in_progress", "done"]);
const MCP_SERVER_ID = "orbit";

const registerSchema = z.object({
  name: z.string().min(1),
  harness: HARNESS.default("other"),
  principal: z.string().optional(),
});
const messageSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  content: z.string().min(1),
  // P2 结构化字段（可选）。
  missionId: z.string().optional(),
  taskId: z.string().optional(),
  kind: z.enum(["normal", "sync", "question", "conflict"]).optional(),
  replyTo: z.string().optional(),
  requiresReply: z.boolean().optional(),
});
const createTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  dependsOn: z.array(z.string()).optional(),
  files: z.array(z.string()).optional(),
  fileScope: z.array(z.string()).optional(),
  doneWhen: z.string().optional(),
  verifyCommand: z.string().optional(),
  interfaceRef: z.string().optional(),
  createdBy: z.string().nullish(),
});
const claimSchema = z.object({ agent: z.string().min(1) });
const updateTaskSchema = z.object({ status: TASK_STATUS.optional(), note: z.string().optional() });
const acquireSchema = z.object({ agent: z.string().min(1), paths: z.array(z.string()).min(1), note: z.string().optional() });
const releaseLockSchema = z.object({ agent: z.string().min(1), paths: z.array(z.string()).min(1) });
const checkSchema = z.object({ paths: z.array(z.string()).min(1) });
const noteSchema = z.object({ agent: z.string().min(1), content: z.string().min(1) });
const roleSchema = z.object({ role: z.string().nullable() });
const declareIntentSchema = z.object({
  agent: z.string().min(1),
  summary: z.string().min(1),
  resources: z.array(z.string()).min(1),
});
const resolveConflictSchema = z.object({ by: z.string().nullish(), resolution: z.string().default("") });
const updateContractSchema = z.object({
  by: z.string().nullish(),
  apiContract: z.string().optional(),
  designSpec: z.string().optional(),
  expectedVersion: z.number().optional(),
});
const taskDraftSchema = z.object({
  title: z.string().min(1),
  description: z.string().default(""),
  area: z.enum(["frontend", "backend", "general"]).default("general"),
  files: z.array(z.string()).default([]),
  // 1.2 Task contract（旧客户端不传 → 默认空，行为不变）。
  fileScope: z.array(z.string()).default([]),
  doneWhen: z.string().default(""),
  verifyCommand: z.string().default(""),
  interfaceRef: z.string().default(""),
});
const planMissionSchema = z.object({
  goal: z.string().min(1),
  template: z.string().optional(),
  // 1.1：带上项目信息才会启用 lead planner（lead 必须能读到真实仓库）。
  projectId: z.string().optional(),
  projectPath: z.string().optional(),
});
// 1.3 worker 规格：模型 / 预算 / 超时从 dashboard 可配。
const workerSpecSchema = z
  .object({
    model: z.string().min(1).optional(),
    budgetUsd: z.number().positive().max(200).optional(),
    timeoutMs: z
      .number()
      .int()
      .min(60_000)
      .max(6 * 60 * 60_000)
      .optional(),
  })
  .optional();
const launchMissionSchema = z.object({
  goal: z.string().min(1),
  projectId: z.string().optional(),
  projectPath: z.string().optional(),
  createdBy: z.string().nullish(),
  // 第二阶段：显式请求并行拉起的 worker（每个独立 worktree 并行修改）。
  // 不传则自动按"分配给可驱动 Agent 的任务"并行；都没有则回退单 worker。
  agents: z.array(z.enum(["claude-code", "codex"])).optional(),
  // 用户编辑过的任务草案；不传则回退到自动拆分（lead 优先，模板兜底）。
  customTasks: z.array(taskDraftSchema).optional(),
  workerSpec: workerSpecSchema,
});
const commandsSchema = z
  .object({
    install: z.string().optional(),
    build: z.string().optional(),
    lint: z.string().optional(),
    test: z.string().optional(),
  })
  .optional();
const createProjectSchema = z.object({
  rootPath: z.string().min(1),
  name: z.string().optional(),
  commands: commandsSchema,
});
const updateProjectSchema = z.object({
  name: z.string().optional(),
  targetBranch: z.string().nullable().optional(),
  commands: commandsSchema,
});

// Validate a request body against a schema; on failure send 400 and return undefined.
function parse<T>(schema: ZodType<T>, req: Request, res: Response): T | undefined {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: "invalid_request", details: result.error.issues });
    return undefined;
  }
  return result.data;
}

function shellQuote(s: string): string {
  return /\s/.test(s) ? JSON.stringify(s) : s;
}

function hubUrl(req: Request): string {
  const forwardedProto = String(req.headers["x-forwarded-proto"] ?? "").split(",")[0]?.trim();
  // 跨机协作关键：隧道/反代（tailscale serve、ngrok）会把请求转发到 localhost，
  // 真实公网 host 在 x-forwarded-host 里。优先用它，否则生成的连接命令会指向 localhost，
  // 队友复制后根本连不上。
  const forwardedHost = String(req.headers["x-forwarded-host"] ?? "").split(",")[0]?.trim();
  const proto = forwardedProto || req.protocol || "http";
  const host = forwardedHost || req.get("host") || "localhost";
  return `${proto}://${host}`;
}

function cliLaunchParts(): { command: string; baseArgs: string[] } {
  const cliPath = process.argv.find((a) => /[/\\]cli\.(js|ts)$/.test(a)) ?? process.argv[1] ?? "dist/cli.js";
  return launchParts(cliPath);
}

function mcpArgs(name: string, harness: string, url: string, tokenRequired: boolean, principal?: string, runId?: string): string[] {
  return [
    ...cliLaunchParts().baseArgs,
    "mcp",
    "--name",
    name,
    "--harness",
    harness,
    "--hub",
    url,
    ...(principal ? ["--principal", principal] : []),
    ...(tokenRequired ? ["--token", "<TOKEN>"] : []),
    ...(runId ? ["--run-id", runId] : []),
  ];
}

// principal：团队成员归属方。带上时，连接命令会注入 --principal 并给 Agent 名加前缀
// （如 Bob-Claude），这样同名 Agent 按 principal 隔离、面板也能区分是谁的。
function connectInfo(req: Request, tokenRequired: boolean, principal?: string) {
  const url = hubUrl(req);
  const { command } = cliLaunchParts();
  const claudeName = principal ? `${principal}-Claude` : "Claude";
  const codexName = principal ? `${principal}-Codex` : "Codex";
  const claudeArgs = mcpArgs(claudeName, "claude-code", url, tokenRequired, principal);
  const codexArgs = mcpArgs(codexName, "codex", url, tokenRequired, principal);
  return {
    hubUrl: url,
    tokenRequired,
    principal: principal ?? null,
    claudeCommand: `claude mcp add ${MCP_SERVER_ID} -- ${command} ${claudeArgs.map(shellQuote).join(" ")}`,
    codexToml: [
      `[mcp_servers.${MCP_SERVER_ID}]`,
      `command = ${JSON.stringify(command)}`,
      `args = [${codexArgs.map((a) => JSON.stringify(a)).join(", ")}]`,
    ].join("\n"),
  };
}

// 从请求 query 取可选 principal（团队成员名），空白视为未提供。
function principalFromQuery(req: Request): string | undefined {
  const p = req.query.principal;
  return typeof p === "string" && p.trim() ? p.trim() : undefined;
}

function installCodexConfig(snippet: string): { path: string; action: "created" | "updated"; content: string } {
  const home = process.env.HOME || os.homedir();
  const configPath = path.join(home, ".codex", "config.toml");
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const current = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf8") : "";
  const block = snippet.trimEnd();
  const table = `[mcp_servers.${MCP_SERVER_ID}]`;
  const start = current.indexOf(table);
  let next = -1;
  if (start !== -1) {
    const rest = current.slice(start + table.length);
    const match = /\n\[/.exec(rest);
    next = match ? start + table.length + match.index + 1 : current.length;
  }
  const content =
    start === -1
      ? `${current.trimEnd()}${current.trim() ? "\n\n" : ""}${block}\n`
      : `${current.slice(0, start).trimEnd()}${start > 0 ? "\n\n" : ""}${block}\n${current.slice(next).replace(/^\n+/, "")}`;
  fs.writeFileSync(configPath, content);
  return { path: configPath, action: current ? "updated" : "created", content };
}

// 旧的 taskPlan 已迁移至 task-planner.ts，通过 assignDraftsToAgents 实现。

// 第二阶段：一次 mission 最多并行拉起的 worker 数（防止拉爆本机；验收场景为 2 个）。
const MAX_PARALLEL_WORKERS = 4;

interface LaunchTarget {
  harness: Harness;
  task: Task | null;
}

// 决定本次 mission 要并行拉起哪些 worker（每个独立 worktree）。
// 1) 显式 agents：为每个 harness 拉一个，按顺序绑定任务；
// 2) 否则：为每个分配给可驱动 Agent（claude-code/codex）的任务各拉一个（并行）；
// 3) 都没有（如还没有任何外部 Agent 接入）：为每个任务按方向拉一个
//    （前端→codex，其余→claude-code）——枢纽自己就能开工，不依赖外部会话。
function planLaunchTargets(
  core: CoordinationCore,
  tasks: Task[],
  explicitAgents?: ("claude-code" | "codex")[],
  areas?: ("frontend" | "backend" | "general")[],
): LaunchTarget[] {
  if (explicitAgents && explicitAgents.length > 0) {
    return explicitAgents.map((harness, i) => ({ harness, task: tasks[i] ?? null }));
  }
  const drivable: LaunchTarget[] = [];
  for (const t of tasks) {
    const a = t.assignee ? core.agents.get(t.assignee) : null;
    if (a && (a.harness === "claude-code" || a.harness === "codex")) drivable.push({ harness: a.harness, task: t });
  }
  if (drivable.length > 0) return drivable;
  return tasks.map((task, i) => ({
    harness: areas?.[i] === "frontend" ? ("codex" as const) : ("claude-code" as const),
    task,
  }));
}

// Mounts every REST endpoint. Writes use POST, reads use GET — one simple mental model.
export function mountRoutes(
  app: Express,
  core: CoordinationCore,
  options: RouteOptions = {},
  runs?: RunManager,
  integration?: IntegrationManager,
  messageRouter?: MessageRouter,
): void {
  app.get("/healthz", (_req, res) => res.json({ ok: true }));

  // M4.2 A2A 服务发现：公开的 Agent Card（不在 /api 下，故免鉴权）。外部 A2A 客户端
  // 据此把 Orbit 当作一个标准 agent 来调用。
  app.get("/.well-known/agent.json", (req, res) => res.json(buildAgentCard(hubUrl(req))));
  app.get("/api/snapshot", (_req, res) => res.json(core.snapshot()));

  // ----- A01/A02 环境与登录检测 -----
  app.get("/api/environment", async (_req, res) => {
    res.json(await detectEnvironment());
  });

  // ----- A04 projects -----
  app.get("/api/projects", (_req, res) => res.json({ projects: core.projects.list() }));
  app.get("/api/projects/:id", (req, res) => {
    const project = core.projects.get(req.params.id);
    if (!project) return res.status(404).json({ error: "unknown_project" });
    res.json({ project });
  });
  app.post("/api/projects", (req, res) => {
    const body = parse(createProjectSchema, req, res);
    if (!body) return;
    const rootPath = path.resolve(body.rootPath);
    if (!fs.existsSync(rootPath) || !fs.statSync(rootPath).isDirectory()) {
      return res.status(400).json({ error: "path_not_found", message: `目录不存在：${rootPath}` });
    }
    const existing = core.store.findProjectByRoot(rootPath);
    const project = existing ?? core.projects.create({ rootPath, name: body.name, commands: body.commands });
    // 决策：非 git 目录允许创建，但提示前端可一键 git init。
    res.json({ project, suggestGitInit: !project.isGitRepo, reused: Boolean(existing) });
  });
  app.post("/api/projects/:id", (req, res) => {
    const body = parse(updateProjectSchema, req, res);
    if (!body) return;
    const project = core.projects.update(req.params.id, {
      name: body.name,
      targetBranch: body.targetBranch,
      commands: body.commands,
    });
    if (!project) return res.status(404).json({ error: "unknown_project" });
    res.json({ project });
  });
  app.post("/api/projects/:id/git-init", (req, res) => {
    try {
      const project = core.projects.initGit(req.params.id);
      if (!project) return res.status(404).json({ error: "unknown_project" });
      res.json({ project });
    } catch (err) {
      res.status(500).json({ error: "git_init_failed", message: (err as Error).message });
    }
  });

  // D01 列项目下的所有 worktree（主工作区 + Orbit 隔离区）。
  app.get("/api/projects/:id/worktrees", (req, res) => {
    if (!runs) return res.status(503).json({ error: "runs_unavailable" });
    const project = core.projects.get(req.params.id);
    if (!project) return res.status(404).json({ error: "unknown_project" });
    res.json({ worktrees: runs.listProjectWorktrees(project.rootPath) });
  });

  // ----- 统一工作区：设置一次，启动任务/派单都默认在这个目录里自动执行 -----
  app.get("/api/workspace", (_req, res) => {
    const wsPath = core.store.getSetting("workspace_path");
    const project = wsPath ? core.store.findProjectByRoot(wsPath) : null;
    res.json({ path: wsPath, project });
  });
  app.post("/api/workspace", (req, res) => {
    const body = parse(z.object({ path: z.string().min(1) }), req, res);
    if (!body) return;
    const resolved = path.resolve(body.path.trim());
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      return res.status(400).json({ error: "path_not_found", message: `目录不存在：${resolved}` });
    }
    const existing = core.store.findProjectByRoot(resolved);
    const project = existing ?? core.projects.create({ rootPath: resolved, commands: detectCommands(resolved) });
    core.store.setSetting("workspace_path", resolved);
    core.events.emit("workspace_updated", { path: resolved, project });
    res.json({ path: resolved, project, suggestGitInit: !project.isGitRepo });
  });

  // ----- C04/C07 agent runs -----
  app.get("/api/agent-runs", (_req, res) => res.json({ runs: runs ? runs.list() : [] }));
  app.post("/api/agent-runs/:id/stop", (req, res) => {
    if (!runs) return res.status(503).json({ error: "runs_unavailable" });
    const run = runs.stop(req.params.id);
    if (!run) return res.status(404).json({ error: "unknown_run" });
    res.json({ run });
  });
  // D01 run 的工作区相对 base 分支的基础 diff 摘要。
  app.get("/api/agent-runs/:id/diff", (req, res) => {
    if (!runs) return res.status(503).json({ error: "runs_unavailable" });
    const result = runs.diff(req.params.id);
    if (!result.ok) return res.status(result.reason === "not_found" ? 404 : 400).json({ error: result.reason });
    res.json({ diff: result.diff });
  });
  // 1.3 waiting_for_input 一键注入回复：复用 C05 resume 通道往会话追加一条用户输入。
  app.post("/api/agent-runs/:id/input", (req, res) => {
    if (!runs) return res.status(503).json({ error: "runs_unavailable" });
    const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
    if (!message) return res.status(400).json({ error: "missing_message" });
    const result = runs.resume(req.params.id, message);
    if (!result.ok) {
      const status = result.reason === "not_found" ? 404 : result.reason === "still_running" ? 409 : 400;
      return res.status(status).json({ error: result.reason });
    }
    res.json({ ok: true, run: runs.get(req.params.id) });
  });

  // D01 显式清理 run 的工作区+分支（保留 run 记录）。
  app.post("/api/agent-runs/:id/worktree/remove", (req, res) => {
    if (!runs) return res.status(503).json({ error: "runs_unavailable" });
    const result = runs.removeWorktree(req.params.id);
    if (!result.ok) {
      const status = result.reason === "not_found" ? 404 : result.reason === "still_running" ? 409 : 400;
      return res.status(status).json({ error: result.reason });
    }
    res.json({ run: result.run });
  });
  // M2.2 绑定 run ↔ agentId（worker adapter 注册后回调）。
  app.post("/api/agent-runs/:id/bind", (req, res) => {
    if (!runs) return res.status(503).json({ error: "runs_unavailable" });
    const { agentId } = req.body as { agentId?: string };
    if (!agentId || typeof agentId !== "string") return res.status(400).json({ error: "missing_agentId" });
    const run = runs.bind(req.params.id, agentId);
    if (!run) return res.status(404).json({ error: "not_found" });
    res.json({ run });
  });

  // M2.2 orbit_wait 长轮询：等待未读消息到达（或超时），返回消息列表并标记已读。
  app.post("/api/agents/:id/wait", async (req, res) => {
    const agentId = req.params.id;
    const timeoutMs = Math.min(Number(req.body?.timeoutMs ?? 30_000), 60_000);
    if (messageRouter) await messageRouter.wait(agentId, timeoutMs);
    const messages = core.messages.inbox(agentId);
    res.json({ messages });
  });

  app.get("/api/connect", (req, res) => res.json(connectInfo(req, Boolean(options.tokenRequired), principalFromQuery(req))));
  app.post("/api/connect/install/codex", (req, res) => {
    const info = connectInfo(req, Boolean(options.tokenRequired), principalFromQuery(req));
    res.json({ ok: true, ...installCodexConfig(info.codexToml) });
  });

  // ----- demo seed -----
  app.post("/api/demo/seed", (_req, res) => {
    // Quick check: if agents already exist, skip to avoid duplicating demo data.
    if (core.agents.list().filter((a) => a.harness !== "other").length > 0) {
      return res.json({ ok: false, reason: "already_seeded" });
    }
    const claude = core.agents.register("Claude", "claude-code");
    const codex = core.agents.register("Codex", "codex");
    const api = core.tasks.create({ title: "Design /users API", description: "REST endpoints for users", files: ["src/api/users.ts"], createdBy: claude.id });
    const ui = core.tasks.create({ title: "Build users UI", description: "List + form components", files: ["src/ui/Users.tsx"], createdBy: claude.id });
    core.tasks.create({ title: "Write integration tests", description: "Cover the /users endpoints", dependsOn: [api.id], createdBy: claude.id });
    const ci = core.tasks.create({ title: "Set up CI pipeline", createdBy: codex.id });
    core.tasks.claim(ci.id, codex.id);
    core.tasks.update(ci.id, { status: "done" });
    core.tasks.claim(api.id, claude.id);
    core.tasks.update(api.id, { status: "in_progress" });
    core.tasks.claim(ui.id, codex.id);
    core.tasks.update(ui.id, { status: "in_progress" });
    core.locks.acquire(claude.id, ["src/api/users.ts"]);
    core.locks.acquire(codex.id, ["src/ui/Users.tsx"]);
    core.messages.send(claude.id, codex.id, "I'm adding an `email` field to the User type — update your form.");
    core.messages.send(codex.id, "all", "UI scaffold pushed to my branch, mocking the API for now.");
    core.notes.append(claude.id, "API contract: GET /users → { id, name, email }[]");
    res.json({ ok: true, agents: [claude, codex] });
  });

  // ----- task planning -----

  // 解析 projectId/projectPath → 真实存在的项目目录（lead planner 的前提）。
  // 与 /launch 的行为一致：什么都没传时回退统一工作区。
  function resolvePlanningDir(projectId?: string, projectPath?: string): string | null {
    const project = projectId ? core.projects.get(projectId) : null;
    const candidate = project?.rootPath ?? projectPath ?? core.store.getSetting("workspace_path") ?? undefined;
    if (!candidate) return null;
    const resolved = path.resolve(candidate);
    return fs.existsSync(resolved) && fs.statSync(resolved).isDirectory() ? resolved : null;
  }

  // 1.1：优先 lead planner（真实读仓库拆分），无 CLI/失败/超时回退模板并附注原因。
  async function planMission(goal: string, template?: string, projectId?: string, projectPath?: string): Promise<MissionPlan> {
    const fallback = (note?: string): MissionPlan => {
      const plan = template ? planWithTemplate(goal, template) : planTasks(goal);
      return note ? { ...plan, note } : plan;
    };
    // 用户显式选了模板 → 尊重选择，不跑 lead。
    if (template) return fallback();
    const dir = resolvePlanningDir(projectId, projectPath);
    if (!options.leadPlanner || !dir) return fallback();
    const onlinePeers = core.agents.list().filter((a) => a.harness !== "other" && a.status === "online");
    const commands = detectCommands(dir);
    const verifyCommandHint = commands.test ?? commands.build ?? commands.lint;
    try {
      const result = await options.leadPlanner({ goal, projectPath: dir, agents: onlinePeers, verifyCommandHint });
      if (result.ok) return result.plan;
      return fallback(`lead 拆分失败，已回退模板：${result.reason}`);
    } catch (err) {
      return fallback(`lead 拆分异常，已回退模板：${(err as Error).message}`);
    }
  }

  app.get("/api/templates", (_req, res) => res.json({ templates: listTemplates() }));
  app.post("/api/missions/plan", async (req, res) => {
    const body = parse(planMissionSchema, req, res);
    if (!body) return;
    const plan = await planMission(body.goal, body.template, body.projectId, body.projectPath);
    res.json({ plan });
  });

  // ----- missions -----
  app.get("/api/missions", (_req, res) => res.json({ missions: core.missions.list() }));
  app.get("/api/workers", (_req, res) => res.json({ workers: runs ? runs.list() : [] }));
  app.post("/api/missions/launch", async (req, res) => {
    const body = parse(launchMissionSchema, req, res);
    if (!body) return;
    const peers = core.agents.list().filter((a) => a.harness !== "other");
    const onlinePeers = peers.filter((a) => a.status === "online");
    let project = body.projectId ? core.projects.get(body.projectId) : null;
    // 没显式传项目目录时回退到统一工作区——这是"启动任务后枢纽自动拉起 Agent
    // 去干活"的默认路径；不回退的话任务只会停在任务板上等外部会话来认领。
    const requestedPath = body.projectPath?.trim() || core.store.getSetting("workspace_path") || undefined;
    // 只传了 projectPath（dashboard 快捷启动）→ 自动 find-or-create 项目并探测验证命令，
    // 让"集成前自动验证"在默认路径下也生效（否则集成阶段无命令可跑，安全卖点落空）。
    if (!project && requestedPath) {
      const resolved = path.resolve(requestedPath);
      if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
        const existing = core.store.findProjectByRoot(resolved);
        project = existing ?? core.projects.create({ rootPath: resolved, commands: detectCommands(resolved) });
      }
    }
    const projectPath = project ? project.rootPath : requestedPath;
    const mission = core.missions.create({
      goal: body.goal,
      projectId: project?.id ?? null,
      projectPath,
      createdBy: body.createdBy ?? null,
      agents: onlinePeers,
    });
    // 任务草案来源：用户编辑过的（dashboard 预览确认）优先；否则自动规划（lead 优先，模板兜底）。
    const drafts: TaskDraft[] =
      body.customTasks && body.customTasks.length > 0
        ? body.customTasks
        : (await planMission(body.goal, undefined, project?.id, projectPath)).tasks;
    const assignedPlans = assignDraftsToAgents(drafts, onlinePeers);
    const createdTasks = assignedPlans.map((plan) => {
      const task = core.tasks.create({
        title: plan.title,
        description: plan.description,
        files: plan.files.length > 0 ? plan.files : plan.fileScope,
        fileScope: plan.fileScope,
        doneWhen: plan.doneWhen,
        verifyCommand: plan.verifyCommand,
        interfaceRef: plan.interfaceRef,
        createdBy: body.createdBy ?? null,
      });
      return plan.assignee ? core.tasks.assign(task.id, plan.assignee) ?? task : task;
    });
    const updated = core.missions.setTaskIds(
      mission.id,
      createdTasks.map((t) => t.id),
    );

    // 驱动层（第二阶段：两个 Agent 在隔离目录并行修改）：有项目目录时，为应执行的任务
    // 并行拉起多个 worker，每个由 RunManager 自动创建独立 worktree+分支，互不干扰。
    const launchPath = projectPath?.trim();
    const launchedRuns: string[] = [];
    if (runs && launchPath) {
      const resolvedPath = path.resolve(launchPath);
      const url = hubUrl(req);
      const { command } = cliLaunchParts();
      const missionId = (updated ?? mission).id;

      // 一次运行的描述：harness + 绑定任务（任务的契约字段渲染进 worker 的 prompt/harness 文件）。
      const targets = planLaunchTargets(core, createdTasks, body.agents, drafts.map((d) => d.area));
      for (const { harness, task } of targets.slice(0, MAX_PARALLEL_WORKERS)) {
        // worker 的协议是 claim_task 原子认领；预指派给外部 Agent 会让 worker
        // 撞 already_claimed 直接退出（实测的"自动执行没人开工"根因之一）→ 先释放。
        if (task?.assignee) core.tasks.release(task.id);
        const workerName = `自动助手·${task ? task.id.slice(-4) : harness}`;
        const runId = newId("run");
        runs.start({
          runId,
          harness,
          missionId,
          taskId: task?.id ?? null,
          projectId: project?.id ?? null,
          taskTitle: task?.title ?? `${harness} · ${body.goal}`,
          goal: body.goal,
          taskDescription: task?.description,
          fileScope: task?.fileScope,
          doneWhen: task?.doneWhen,
          verifyCommand: task?.verifyCommand,
          interfaceRef: task?.interfaceRef,
          projectPath: resolvedPath,
          mcp: { command, args: mcpArgs(workerName, harness, url, Boolean(options.tokenRequired), undefined, runId) },
          // 1.3 worker 规格（dashboard 可配）；不传用 Driver/环境默认值。
          model: body.workerSpec?.model,
          budgetUsd: body.workerSpec?.budgetUsd,
          timeoutMs: body.workerSpec?.timeoutMs,
        });
        launchedRuns.push(harness);
      }
    }

    // 通知在 worker 拉起之后发送，消息里的任务归属才是真实状态。
    const finalTasks = createdTasks.map((t) => core.tasks.get(t.id) ?? t);
    if (body.createdBy) {
      const unassigned = finalTasks.filter((t) => !t.assignee);
      const lines = [
        `Mission launched: ${body.goal}`,
        launchPath ? `Project: ${launchPath}` : "",
        `Tasks:`,
        ...finalTasks.map((t) => `- ${t.id} ${t.title}${t.assignee ? ` -> ${core.agents.get(t.assignee)?.name ?? t.assignee}` : " (待认领)"}`),
        launchedRuns.length ? `枢纽已自动拉起 ${launchedRuns.length} 个执行助手，会用 claim_task 接管上面的待认领任务。` : "",
        !launchedRuns.length && unassigned.length ? `有 ${unassigned.length} 个任务暂无在线负责人，对应 Agent 上线后请用 claim_task 认领。` : "",
        `Loop: get_contract -> declare_intent -> acquire_file_lock -> update_task in_progress -> build -> release_file_lock -> update_task done.`,
      ].filter(Boolean);
      core.messages.send(body.createdBy, "all", lines.join("\n"));
    }

    // B06：拉起了 worker → 推进状态机 draft→planning→preparing_workspaces→running。
    let finalMission = updated ?? mission;
    if (launchedRuns.length > 0) finalMission = core.missions.markRunning(finalMission.id) ?? finalMission;

    res.json({ mission: finalMission, tasks: finalTasks, launchedRuns });
  });

  // M3 /cancel：取消 mission——停掉它名下所有在途 worker，再把状态机推进 cancelled。
  app.post("/api/missions/:id/cancel", (req, res) => {
    const mission = core.missions.get(req.params.id);
    if (!mission) return res.status(404).json({ error: "unknown_mission" });
    const stoppedRuns: string[] = [];
    if (runs) {
      for (const r of runs.list()) {
        const inFlight = r.status === "starting" || r.status === "running" || r.status === "waiting_for_input";
        if (r.missionId === mission.id && inFlight) {
          runs.stop(r.id);
          stoppedRuns.push(r.id);
        }
      }
    }
    const result = core.missions.transition(mission.id, "cancelled");
    res.json({ mission: result.mission ?? mission, stoppedRuns, transitioned: result.ok });
  });

  // M3.2 /review：对集成候选起一个只读审查 worker。它在集成 worktree 现场跑、连回
  // Orbit MCP，把审查结论用 send_message 回灌时间线（借 codex-plugin-cc 的后台任务模型）。
  app.post("/api/missions/:id/review", (req, res) => {
    if (!runs) return res.status(503).json({ error: "runs_unavailable" });
    if (!integration) return res.status(503).json({ error: "integration_unavailable" });
    const mission = core.missions.get(req.params.id);
    if (!mission) return res.status(404).json({ error: "unknown_mission" });
    const integ = integration.getIntegration(mission.id);
    // 没有集成候选就没有统一的「本次改动」可审；提示先 /integrate。
    if (!integ) return res.status(409).json({ error: "no_integration" });

    // 审查者优先用一个在线 peer 的 harness，否则回退 claude-code。
    const reviewer = core.agents.list().find((a) => a.harness !== "other" && a.status === "online");
    const harness: Harness = reviewer?.harness ?? "claude-code";
    const prompt = buildReviewPrompt(mission.goal, integ.baseCommit);
    const url = hubUrl(req);
    const { command } = cliLaunchParts();
    const runId = newId("run");
    const workerName = `审查助手·${mission.id.slice(-4)}`;
    runs.start({
      runId,
      harness,
      missionId: mission.id,
      taskId: null,
      projectId: mission.projectId ?? null,
      taskTitle: `审查：${mission.goal}`,
      goal: prompt,
      // 显式 prompt 绕过协作协议渲染——审查在集成 worktree 现场进行，不走任务板/锁协议。
      prompt,
      projectPath: integ.worktreePath,
      isolate: false, // 直接在集成候选 worktree 现场审查（只读），不另建隔离区
      mcp: { command, args: mcpArgs(workerName, harness, url, Boolean(options.tokenRequired), undefined, runId) },
    });
    res.json({ ok: true, runId });
  });

  // M3.2 /rescue：救援该 mission 下停滞/受阻的 worker。对每个看起来卡住的 worker（等待输入、
  // 失败、或长时间无活动）注入救援提示让它报告进度并继续；进程仍在跑的无法安全打断，记为 skipped。
  app.post("/api/missions/:id/rescue", (req, res) => {
    if (!runs) return res.status(503).json({ error: "runs_unavailable" });
    const mission = core.missions.get(req.params.id);
    if (!mission) return res.status(404).json({ error: "unknown_mission" });
    const now = Date.now();
    const mineWorkers = runs.list().filter((r) => r.missionId === mission.id);
    const targets = selectRescueTargets(mineWorkers, now, RESCUE_STALL_MS);
    const prompt = buildRescuePrompt();
    const rescued: string[] = [];
    const skipped: { runId: string; reason: string }[] = [];
    for (const t of targets) {
      const r = runs.resume(t.id, prompt);
      if (r.ok) rescued.push(t.id);
      else skipped.push({ runId: t.id, reason: r.reason ?? "unknown" });
    }
    res.json({ rescued, skipped, scanned: mineWorkers.length });
  });

  // ----- 第四阶段：集成、验证、最终 Diff、人工审批 -----
  // 产出集成候选（合并各 Agent 分支 → 验证）。
  app.post("/api/missions/:id/integrate", (req, res) => {
    if (!integration) return res.status(503).json({ error: "integration_unavailable" });
    const result = integration.integrate(req.params.id);
    if (!result.ok) {
      const status = result.reason === "mission_not_found" ? 404 : result.reason === "merge_conflict" || result.reason === "validation_failed" ? 409 : 400;
      return res.status(status).json({ error: result.reason, integration: result.integration });
    }
    res.json({ integration: result.integration });
  });
  // 集成候选总览：状态 + 最终 Diff + 验证报告 + 审批记录。
  app.get("/api/missions/:id/integration", (req, res) => {
    if (!integration) return res.status(503).json({ error: "integration_unavailable" });
    const integ = integration.getIntegration(req.params.id);
    if (!integ) return res.status(404).json({ error: "no_integration" });
    res.json({
      integration: integ,
      diff: integration.diff(req.params.id),
      validations: integration.validations(req.params.id),
      approvals: integration.approvals(req.params.id),
    });
  });
  // G06：最终 Diff 摘要。
  app.get("/api/missions/:id/integration/diff", (req, res) => {
    if (!integration) return res.status(503).json({ error: "integration_unavailable" });
    const diff = integration.diff(req.params.id);
    if (!diff) return res.status(404).json({ error: "no_integration" });
    res.json({ diff });
  });
  // B08 + G07：批准 → 真实合入目标分支（失败回滚）。
  app.post("/api/missions/:id/approve", (req, res) => {
    if (!integration) return res.status(503).json({ error: "integration_unavailable" });
    const result = integration.approve(req.params.id, req.body?.by ?? null, req.body?.note ?? "");
    if (!result.ok) return res.status(409).json({ error: result.reason, approval: result.approval });
    res.json({ ok: true, approval: result.approval, resultCommit: result.resultCommit });
  });
  // 集成冲突自动派回修复：起一个 Agent 在集成 worktree 现场解决冲突，完成后自动续跑。
  app.post("/api/missions/:id/dispatch-conflict-fix", (req, res) => {
    if (!integration) return res.status(503).json({ error: "integration_unavailable" });
    const result = integration.dispatchConflictFix(req.params.id);
    if (!result.ok) {
      const status = result.reason === "no_integration" ? 404 : result.reason === "runs_unavailable" ? 503 : 409;
      return res.status(status).json({ error: result.reason });
    }
    res.json({ ok: true, runId: result.runId });
  });

  // B08：驳回集成候选。
  app.post("/api/missions/:id/reject", (req, res) => {
    if (!integration) return res.status(503).json({ error: "integration_unavailable" });
    const result = integration.reject(req.params.id, req.body?.by ?? null, req.body?.note ?? "");
    if (!result.ok) return res.status(404).json({ error: result.reason });
    res.json({ ok: true, approval: result.approval });
  });

  // ----- agents -----
  app.post("/api/agents", (req, res) => {
    const body = parse(registerSchema, req, res);
    if (!body) return;
    res.json({ agent: core.agents.register(body.name, body.harness, body.principal) });
  });
  app.post("/api/agents/:id/heartbeat", (req, res) => {
    const agent = core.agents.heartbeat(req.params.id);
    if (!agent) return res.status(404).json({ error: "unknown_agent" });
    res.json({ agent });
  });
  app.get("/api/agents", (_req, res) => res.json({ agents: core.agents.list() }));

  // ----- messages -----
  app.post("/api/messages", (req, res) => {
    const body = parse(messageSchema, req, res);
    if (!body) return;
    res.json({
      message: core.messages.send(body.from, body.to, body.content, {
        missionId: body.missionId,
        taskId: body.taskId,
        kind: body.kind,
        replyTo: body.replyTo,
        requiresReply: body.requiresReply,
      }),
    });
  });
  app.get("/api/messages/inbox", (req, res) => {
    const agent = String(req.query.agent ?? "");
    if (!agent) return res.status(400).json({ error: "missing_agent" });
    res.json({ messages: core.messages.inbox(agent) });
  });
  app.get("/api/messages", (req, res) => {
    const limit = Number(req.query.limit ?? 100);
    res.json({ messages: core.messages.recent(Number.isFinite(limit) ? limit : 100) });
  });

  // ----- tasks -----
  app.post("/api/tasks", (req, res) => {
    const body = parse(createTaskSchema, req, res);
    if (!body) return;
    res.json({ task: core.tasks.create(body) });
  });
  app.get("/api/tasks", (req, res) => {
    const status = req.query.status ? TASK_STATUS.safeParse(req.query.status) : undefined;
    res.json({ tasks: core.tasks.list(status?.success ? status.data : undefined) });
  });
  app.post("/api/tasks/:id/claim", (req, res) => {
    const body = parse(claimSchema, req, res);
    if (!body) return;
    res.json(core.tasks.claim(req.params.id, body.agent));
  });
  app.post("/api/tasks/:id/assign", (req, res) => {
    const body = parse(claimSchema, req, res);
    if (!body) return;
    const task = core.tasks.assign(req.params.id, body.agent);
    if (!task) return res.status(404).json({ error: "unknown_task" });
    res.json({ task });
  });
  app.post("/api/tasks/:id/update", (req, res) => {
    const body = parse(updateTaskSchema, req, res);
    if (!body) return;
    const task = core.tasks.update(req.params.id, body);
    if (!task) return res.status(404).json({ error: "unknown_task" });
    res.json({ task });
  });
  app.post("/api/tasks/:id/release", (req, res) => {
    const task = core.tasks.release(req.params.id);
    if (!task) return res.status(404).json({ error: "unknown_task" });
    res.json({ task });
  });

  // 一键派单：为单个卡住的任务直接拉起一个自动 worker 去做。
  // 项目目录取所属 mission 的，否则回退统一工作区；都没有则明确报错。
  app.post("/api/tasks/:id/dispatch", (req, res) => {
    if (!runs) return res.status(503).json({ error: "runs_unavailable" });
    const body = parse(z.object({ harness: z.enum(["claude-code", "codex"]).optional() }), req, res);
    if (!body) return;
    const task = core.tasks.get(req.params.id);
    if (!task) return res.status(404).json({ error: "unknown_task" });
    if (task.status === "done") return res.status(400).json({ error: "task_done", message: "任务已完成，无需派单。" });

    const mission = core.missions.list().filter((m) => m.taskIds.includes(task.id)).at(-1) ?? null;
    const wsPath = mission?.projectPath?.trim() || core.store.getSetting("workspace_path");
    if (!wsPath) {
      return res.status(400).json({ error: "no_workspace", message: "未设置工作区目录，无法自动执行。先在面板里设置工作区。" });
    }
    const resolvedPath = path.resolve(wsPath);
    if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isDirectory()) {
      return res.status(400).json({ error: "path_not_found", message: `工作区目录不存在：${resolvedPath}` });
    }

    const assignee = task.assignee ? core.agents.get(task.assignee) : null;
    const harness =
      body.harness ?? (assignee && (assignee.harness === "claude-code" || assignee.harness === "codex") ? assignee.harness : "claude-code");
    // worker 用 claim_task 原子认领；任务卡在他人名下会让 worker 撞 already_claimed
    // 直接退出。派单 = 显式接管，先把任务释放回待认领。
    if (task.assignee || task.status !== "todo") core.tasks.release(task.id);
    const project = mission?.projectId ? core.projects.get(mission.projectId) : core.store.findProjectByRoot(resolvedPath);
    const workerName = `自动助手·${task.id.slice(-4)}`;
    const run = runs.start({
      harness,
      missionId: mission?.id ?? null,
      taskId: task.id,
      projectId: project?.id ?? null,
      taskTitle: task.title,
      goal: mission?.goal ?? task.title,
      projectPath: resolvedPath,
      mcp: { command: cliLaunchParts().command, args: mcpArgs(workerName, harness, hubUrl(req), Boolean(options.tokenRequired)) },
    });
    if (mission) core.missions.markRunning(mission.id);
    res.json({ run });
  });

  // ----- locks -----
  app.post("/api/locks/acquire", (req, res) => {
    const body = parse(acquireSchema, req, res);
    if (!body) return;
    res.json(core.locks.acquire(body.agent, body.paths, body.note));
  });
  app.post("/api/locks/release", (req, res) => {
    const body = parse(releaseLockSchema, req, res);
    if (!body) return;
    res.json({ released: core.locks.release(body.agent, body.paths) });
  });
  app.post("/api/locks/check", (req, res) => {
    const body = parse(checkSchema, req, res);
    if (!body) return;
    res.json({ status: core.locks.check(body.paths) });
  });
  app.get("/api/locks", (_req, res) => res.json({ locks: core.locks.list() }));

  // ----- notes -----
  app.post("/api/notes", (req, res) => {
    const body = parse(noteSchema, req, res);
    if (!body) return;
    res.json({ note: core.notes.append(body.agent, body.content) });
  });
  app.get("/api/notes", (_req, res) => res.json({ notes: core.notes.list() }));

  // ----- roles (MPAC) -----
  app.post("/api/agents/:id/role", (req, res) => {
    const body = parse(roleSchema, req, res);
    if (!body) return;
    const agent = core.agents.setRole(req.params.id, body.role);
    if (!agent) return res.status(404).json({ error: "unknown_agent" });
    res.json({ agent });
  });

  // ----- intents (MPAC) -----
  app.post("/api/intents", (req, res) => {
    const body = parse(declareIntentSchema, req, res);
    if (!body) return;
    res.json(core.intents.declare(body.agent, body.summary, body.resources));
  });
  app.get("/api/intents", (_req, res) => res.json({ intents: core.intents.list() }));
  app.post("/api/intents/:id/withdraw", (req, res) => {
    const intent = core.intents.withdraw(req.params.id);
    if (!intent) return res.status(404).json({ error: "unknown_intent" });
    res.json({ intent });
  });

  // ----- conflicts (MPAC governance) -----
  app.get("/api/conflicts", (_req, res) => res.json({ conflicts: core.conflicts.list() }));
  app.post("/api/conflicts/:id/resolve", (req, res) => {
    const body = parse(resolveConflictSchema, req, res);
    if (!body) return;
    const conflict = core.conflicts.resolve(req.params.id, body.by ?? null, body.resolution);
    if (!conflict) return res.status(404).json({ error: "unknown_conflict" });
    res.json({ conflict });
  });
  app.post("/api/conflicts/:id/dismiss", (req, res) => {
    const body = parse(resolveConflictSchema, req, res);
    if (!body) return;
    const conflict = core.conflicts.dismiss(req.params.id, body.by ?? null, body.resolution);
    if (!conflict) return res.status(404).json({ error: "unknown_conflict" });
    res.json({ conflict });
  });

  // ----- contract (MPAC shared state) -----
  app.get("/api/contract", (_req, res) => res.json({ contract: core.contract.get() }));
  app.post("/api/contract", (req, res) => {
    const body = parse(updateContractSchema, req, res);
    if (!body) return;
    res.json(
      core.contract.update(body.by ?? null, { apiContract: body.apiContract, designSpec: body.designSpec }, body.expectedVersion),
    );
  });
}
