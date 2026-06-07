import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Express, Request, Response } from "express";
import { z, type ZodType } from "zod";
import type { CoordinationCore } from "../core/core.js";
import type { Agent, Harness, Task } from "../core/types.js";
import type { RunManager } from "./run-manager.js";
import type { IntegrationManager } from "./integration-manager.js";
import { detectEnvironment } from "../drivers/detect.js";

interface RouteOptions {
  tokenRequired?: boolean;
}

const HARNESS = z.enum(["claude-code", "codex", "gemini", "opencode", "other"]);
const TASK_STATUS = z.enum(["todo", "claimed", "in_progress", "done"]);
const MCP_SERVER_ID = "orbit";

const registerSchema = z.object({
  name: z.string().min(1),
  harness: HARNESS.default("other"),
  principal: z.string().optional(),
});
const messageSchema = z.object({ from: z.string().min(1), to: z.string().min(1), content: z.string().min(1) });
const createTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  dependsOn: z.array(z.string()).optional(),
  files: z.array(z.string()).optional(),
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
const launchMissionSchema = z.object({
  goal: z.string().min(1),
  projectId: z.string().optional(),
  projectPath: z.string().optional(),
  createdBy: z.string().nullish(),
  // 第二阶段：显式请求并行拉起的 worker（每个独立 worktree 并行修改）。
  // 不传则自动按"分配给可驱动 Agent 的任务"并行；都没有则回退单 worker。
  agents: z.array(z.enum(["claude-code", "codex"])).optional(),
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
  const proto = forwardedProto || req.protocol || "http";
  return `${proto}://${req.get("host")}`;
}

function cliLaunchParts(): { command: string; baseArgs: string[] } {
  const cliPath = process.argv.find((a) => /[/\\]cli\.(js|ts)$/.test(a)) ?? process.argv[1] ?? "dist/cli.js";
  return cliPath.endsWith(".ts") ? { command: "npx", baseArgs: ["tsx", cliPath] } : { command: process.execPath, baseArgs: [cliPath] };
}

function mcpArgs(name: string, harness: string, url: string, tokenRequired: boolean): string[] {
  return [
    ...cliLaunchParts().baseArgs,
    "mcp",
    "--name",
    name,
    "--harness",
    harness,
    "--hub",
    url,
    ...(tokenRequired ? ["--token", "<TOKEN>"] : []),
  ];
}

function connectInfo(req: Request, tokenRequired: boolean) {
  const url = hubUrl(req);
  const { command } = cliLaunchParts();
  const claudeArgs = mcpArgs("Claude", "claude-code", url, tokenRequired);
  const codexArgs = mcpArgs("Codex", "codex", url, tokenRequired);
  return {
    hubUrl: url,
    tokenRequired,
    claudeCommand: `claude mcp add ${MCP_SERVER_ID} -- ${command} ${claudeArgs.map(shellQuote).join(" ")}`,
    codexToml: [
      `[mcp_servers.${MCP_SERVER_ID}]`,
      `command = ${JSON.stringify(command)}`,
      `args = [${codexArgs.map((a) => JSON.stringify(a)).join(", ")}]`,
    ].join("\n"),
  };
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

function agentArea(agent: Agent): "frontend" | "backend" | "general" {
  // 操作员显式设置的 role 优先；只有未设 role 时才回退到 harness 默认归类，
  // 避免 "把 Codex 设成后端" 这类显式意图被 harness 关键词覆盖。
  const role = (agent.role ?? "").toLowerCase();
  if (role) {
    if (role.includes("前端") || role.includes("ui") || role.includes("front")) return "frontend";
    if (role.includes("后端") || role.includes("api") || role.includes("back") || role.includes("服务")) return "backend";
    return "general"; // 测试/设计/自定义角色不抢前后端槽位
  }
  if (agent.harness === "codex") return "frontend";
  if (agent.harness === "claude-code") return "backend";
  return "general";
}

// 拆任务的核心原则：始终覆盖"前端 + 后端"两端（这正是并行开发的两条线），
// 但只把任务 assign 给【在线】的对应 Agent；该领域没有在线 Agent 时任务留在板上
// （assignee=null → todo 待认领），等对应 Agent 上线后自己 claim，绝不硬派给离线的人。
function taskPlan(onlineAgents: Agent[], goal: string): { title: string; description: string; assignee: string | null; files: string[] }[] {
  const peers = onlineAgents.filter((a) => a.harness !== "other" && a.status === "online");
  const frontendAgent = peers.find((a) => agentArea(a) === "frontend") ?? null;
  const backendAgent = peers.find((a) => agentArea(a) === "backend") ?? null;

  const plans = [
    {
      title: `前端 · ${goal}`,
      description: `目标：${goal}\n\n你负责前端/UI/交互。开工前先 get_contract，再 declare_intent 并 acquire_file_lock 锁定要改的 UI 文件；接口不确定时先消息后端 Agent，避免改动撞车。`,
      assignee: frontendAgent ? frontendAgent.id : null,
      files: ["src/ui/**", "src/components/**", "dashboard/src/**"],
    },
    {
      title: `后端 · ${goal}`,
      description: `目标：${goal}\n\n你负责接口、数据模型和共享契约。开工前先 update_contract / get_contract，再 declare_intent 并 acquire_file_lock 锁定后端文件；接口有变要广播给前端 Agent。`,
      assignee: backendAgent ? backendAgent.id : null,
      files: ["src/api/**", "src/server/**", "src/core/**"],
    },
  ];

  // 已被前/后端槽位占用之外的在线 Agent（测试/设计/额外成员）各补一个协作任务。
  const taken = new Set([frontendAgent?.id, backendAgent?.id].filter(Boolean) as string[]);
  for (const agent of peers) {
    if (taken.has(agent.id)) continue;
    plans.push({
      title: `协作 · ${goal}（${agent.name}）`,
      description: `目标：${goal}\n\n领取你最擅长的部分。开工前先读任务板、declare_intent、acquire_file_lock 锁文件，并与其他 Agent 保持消息同步。`,
      assignee: agent.id,
      files: [],
    });
  }
  return plans;
}

// 第二阶段：一次 mission 最多并行拉起的 worker 数（防止拉爆本机；验收场景为 2 个）。
const MAX_PARALLEL_WORKERS = 4;

interface LaunchTarget {
  harness: Harness;
  task: Task | null;
}

// 决定本次 mission 要并行拉起哪些 worker（每个独立 worktree）。
// 1) 显式 agents：为每个 harness 拉一个，按顺序绑定任务；
// 2) 否则：为每个分配给可驱动 Agent（claude-code/codex）的任务各拉一个（并行）；
// 3) 都没有：回退第一个任务 + 默认 Claude（保留单 worker 行为）。
function planLaunchTargets(core: CoordinationCore, tasks: Task[], explicitAgents?: ("claude-code" | "codex")[]): LaunchTarget[] {
  if (explicitAgents && explicitAgents.length > 0) {
    return explicitAgents.map((harness, i) => ({ harness, task: tasks[i] ?? null }));
  }
  const drivable: LaunchTarget[] = [];
  for (const t of tasks) {
    const a = t.assignee ? core.agents.get(t.assignee) : null;
    if (a && (a.harness === "claude-code" || a.harness === "codex")) drivable.push({ harness: a.harness, task: t });
  }
  if (drivable.length > 0) return drivable;
  return tasks[0] ? [{ harness: "claude-code", task: tasks[0] }] : [];
}

// Mounts every REST endpoint. Writes use POST, reads use GET — one simple mental model.
export function mountRoutes(
  app: Express,
  core: CoordinationCore,
  options: RouteOptions = {},
  runs?: RunManager,
  integration?: IntegrationManager,
): void {
  app.get("/healthz", (_req, res) => res.json({ ok: true }));
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
  app.get("/api/connect", (req, res) => res.json(connectInfo(req, Boolean(options.tokenRequired))));
  app.post("/api/connect/install/codex", (req, res) => {
    const info = connectInfo(req, Boolean(options.tokenRequired));
    res.json({ ok: true, ...installCodexConfig(info.codexToml) });
  });

  // ----- missions -----
  app.get("/api/missions", (_req, res) => res.json({ missions: core.missions.list() }));
  app.get("/api/workers", (_req, res) => res.json({ workers: runs ? runs.list() : [] }));
  app.post("/api/missions/launch", (req, res) => {
    const body = parse(launchMissionSchema, req, res);
    if (!body) return;
    const peers = core.agents.list().filter((a) => a.harness !== "other");
    const onlinePeers = peers.filter((a) => a.status === "online");
    // 优先用已登记 Project（A04）；其 rootPath 作为 projectPath。否则回退到裸 projectPath。
    const project = body.projectId ? core.projects.get(body.projectId) : null;
    const projectPath = project ? project.rootPath : body.projectPath;
    // worktree 计划与任务分配都只基于在线 Agent；离线领域的任务会留在板上待认领。
    const mission = core.missions.create({
      goal: body.goal,
      projectId: project?.id ?? null,
      projectPath,
      createdBy: body.createdBy ?? null,
      agents: onlinePeers,
    });
    const createdTasks = taskPlan(onlinePeers, body.goal).map((plan) => {
      const task = core.tasks.create({
        title: plan.title,
        description: plan.description,
        files: plan.files,
        createdBy: body.createdBy ?? null,
      });
      return plan.assignee ? core.tasks.assign(task.id, plan.assignee) ?? task : task;
    });
    const updated = core.missions.setTaskIds(
      mission.id,
      createdTasks.map((t) => t.id),
    );
    if (body.createdBy) {
      const unassigned = createdTasks.filter((t) => !t.assignee);
      const lines = [
        `Mission launched: ${body.goal}`,
        body.projectPath ? `Project: ${body.projectPath}` : "",
        `Tasks:`,
        ...createdTasks.map((t) => `- ${t.id} ${t.title}${t.assignee ? ` -> ${core.agents.get(t.assignee)?.name ?? t.assignee}` : " (待认领)"}`),
        unassigned.length ? `有 ${unassigned.length} 个任务暂无在线负责人，对应 Agent 上线后请用 claim_task 认领。` : "",
        `Loop: get_contract -> declare_intent -> acquire_file_lock -> update_task in_progress -> build -> release_file_lock -> update_task done.`,
      ].filter(Boolean);
      core.messages.send(body.createdBy, "all", lines.join("\n"));
    }

    // 驱动层（第二阶段：两个 Agent 在隔离目录并行修改）：有项目目录时，为应执行的任务
    // 并行拉起多个 worker，每个由 RunManager 自动创建独立 worktree+分支，互不干扰。
    const launchPath = projectPath?.trim();
    const launchedRuns: string[] = [];
    if (runs && launchPath) {
      const resolvedPath = path.resolve(launchPath);
      const url = hubUrl(req);
      const { command } = cliLaunchParts();
      const missionId = (updated ?? mission).id;

      // 一次运行的描述：harness + 绑定任务（任务用于命名、领域提示与 taskId）。
      const targets = planLaunchTargets(core, createdTasks, body.agents);
      for (const { harness, task } of targets.slice(0, MAX_PARALLEL_WORKERS)) {
        const workerName = `自动助手·${task ? task.id.slice(-4) : harness}`;
        runs.start({
          harness,
          missionId,
          taskId: task?.id ?? null,
          projectId: project?.id ?? null,
          taskTitle: task?.title ?? `${harness} · ${body.goal}`,
          goal: body.goal,
          projectPath: resolvedPath,
          mcp: { command, args: mcpArgs(workerName, harness, url, Boolean(options.tokenRequired)) },
        });
        launchedRuns.push(harness);
      }
    }

    // B06：拉起了 worker → 推进状态机 draft→planning→preparing_workspaces→running。
    let finalMission = updated ?? mission;
    if (launchedRuns.length > 0) finalMission = core.missions.markRunning(finalMission.id) ?? finalMission;

    res.json({ mission: finalMission, tasks: createdTasks, launchedRuns });
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
    res.json({ message: core.messages.send(body.from, body.to, body.content) });
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
