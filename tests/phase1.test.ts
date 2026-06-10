import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";
import request from "supertest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  buildHarnessProfile,
  harnessFileName,
  installHarnessFile,
  renderHarnessFile,
  renderWorkerPrompt,
} from "../src/core/harness.js";
import { addWorktree } from "../src/core/worktrees.js";
import {
  buildPlanningPrompt,
  extractJson,
  parseLeadPlan,
  planWithLead,
  type HeadlessRunner,
} from "../src/hub/lead-planner.js";
import { createHubApp } from "../src/hub/server.js";
import { createAgentServer } from "../src/mcp/adapter.js";
import type { Agent } from "../src/core/types.js";

// ===== 阶段一（单机闭环质量）：1.1 Lead Planner + 1.2 Harness Profile + 1.3 worker 规格 =====

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
    fs.rmSync(`${d}-orbit`, { recursive: true, force: true });
  }
});

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@t",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@t",
};

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, env: GIT_ENV, encoding: "utf8" }).trim();
}

function makeGitRepo(withClaudeMd = false): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-p1-"));
  tmpDirs.push(dir);
  execFileSync("git", ["init", "-b", "main"], { cwd: dir, env: GIT_ENV, stdio: "ignore" });
  fs.writeFileSync(path.join(dir, "README.md"), "hello\n");
  if (withClaudeMd) fs.writeFileSync(path.join(dir, "CLAUDE.md"), "# 项目自带说明\n");
  git(dir, ["add", "."]);
  git(dir, ["commit", "-m", "init"]);
  return dir;
}

const agent = (over: Partial<Agent>): Agent => ({
  id: "a1",
  name: "Claude",
  harness: "claude-code",
  status: "online",
  currentTaskId: null,
  registeredAt: 0,
  lastSeen: 0,
  role: null,
  principal: "本机",
  ...over,
});

// ---------- 1.2 HarnessProfile：同源双渲染 ----------

describe("harness profile rendering", () => {
  const profileInput = {
    goal: "做一个贪吃蛇",
    taskTitle: "核心逻辑",
    taskId: "t_123",
    fileScope: ["src/core/**", "src/game.ts"],
    doneWhen: "贪吃蛇可以吃食物并增长",
    verifyCommand: "npm test",
    interfaceRef: "GameState 类型",
  };

  it("renders the same profile with prefixed tool names for claude and bare names for codex", () => {
    const profile = buildHarnessProfile(profileInput);
    const claude = renderWorkerPrompt(profile, "claude-code");
    const codex = renderWorkerPrompt(profile, "codex");

    expect(claude).toContain("mcp__orbit__claim_task");
    expect(claude).toContain("mcp__orbit__acquire_file_lock");
    expect(codex).not.toContain("mcp__orbit__");
    expect(codex).toContain("claim_task");
    expect(codex).toContain("acquire_file_lock");
    // 同源：去掉工具名前缀后两份 prompt 完全一致。
    expect(claude.replaceAll("mcp__orbit__", "")).toBe(codex);
  });

  it("includes the task contract and the verify hard rule in the prompt", () => {
    const prompt = renderWorkerPrompt(buildHarnessProfile(profileInput), "claude-code");
    expect(prompt).toContain("src/core/**");
    expect(prompt).toContain("贪吃蛇可以吃食物并增长");
    expect(prompt).toContain("`npm test`");
    expect(prompt).toContain("GameState 类型");
    expect(prompt).toContain("硬规则");
    expect(prompt).toContain("才允许 mcp__orbit__update_task 标记 done");
  });

  it("omits the orbit protocol when withOrbitProtocol=false", () => {
    const prompt = renderWorkerPrompt(buildHarnessProfile({ ...profileInput, withOrbitProtocol: false }), "claude-code");
    expect(prompt).not.toContain("whoami");
    expect(prompt).not.toContain("claim_task");
    expect(prompt).toContain("src/core/**"); // 契约仍在
  });

  it("renders a harness file with markers, contract and protocol", () => {
    const content = renderHarnessFile(buildHarnessProfile(profileInput), "codex");
    expect(content).toContain("<!-- orbit:harness:start -->");
    expect(content).toContain("<!-- orbit:harness:end -->");
    expect(content).toContain("fileScope");
    expect(content).toContain("`npm test`");
    expect(content).toContain("update_contract");
  });

  it("picks CLAUDE.md for claude and AGENTS.md for codex", () => {
    expect(harnessFileName("claude-code")).toBe("CLAUDE.md");
    expect(harnessFileName("codex")).toBe("AGENTS.md");
  });
});

describe("installHarnessFile (worktree, git-clean)", () => {
  it("creates an untracked harness file that never shows up in git status", () => {
    const root = makeGitRepo();
    const wt = path.join(`${root}-orbit`, "w1");
    addWorktree({ projectRoot: root, worktreePath: wt, branch: "orbit/w1" });

    const profile = buildHarnessProfile({ goal: "g", taskTitle: "t", taskId: null });
    const result = installHarnessFile(wt, "claude-code", renderHarnessFile(profile, "claude-code"));
    expect(result.mode).toBe("created");
    expect(fs.existsSync(path.join(wt, "CLAUDE.md"))).toBe(true);
    // 关键验收：git 完全看不到它（不会被 commitAgentWork 的 add -A 带进 Agent 分支）。
    expect(git(wt, ["status", "--porcelain"])).toBe("");
  });

  it("is idempotent: reinstalling replaces the orbit section instead of duplicating it", () => {
    const root = makeGitRepo();
    const wt = path.join(`${root}-orbit`, "w2");
    addWorktree({ projectRoot: root, worktreePath: wt, branch: "orbit/w2" });

    const profile = buildHarnessProfile({ goal: "g", taskTitle: "t", taskId: null });
    const content = renderHarnessFile(profile, "claude-code");
    installHarnessFile(wt, "claude-code", content);
    const second = installHarnessFile(wt, "claude-code", content);
    expect(second.mode).toBe("replaced");
    const text = fs.readFileSync(path.join(wt, "CLAUDE.md"), "utf8");
    expect(text.match(/orbit:harness:start/g)).toHaveLength(1);
  });

  it("appends to a tracked CLAUDE.md and keeps the modification out of git via skip-worktree", () => {
    const root = makeGitRepo(true);
    const wt = path.join(`${root}-orbit`, "w3");
    addWorktree({ projectRoot: root, worktreePath: wt, branch: "orbit/w3" });

    const profile = buildHarnessProfile({ goal: "g", taskTitle: "t", taskId: null });
    const result = installHarnessFile(wt, "claude-code", renderHarnessFile(profile, "claude-code"));
    expect(result.mode).toBe("appended");
    const text = fs.readFileSync(path.join(wt, "CLAUDE.md"), "utf8");
    expect(text).toContain("项目自带说明"); // 原内容保留
    expect(text).toContain("orbit:harness:start");
    // skip-worktree：本地修改不进 status / add -A。
    expect(git(wt, ["status", "--porcelain"])).toBe("");
  });
});

// ---------- 1.1 Lead Planner ----------

describe("lead planner", () => {
  it("builds a planning prompt that forces reading the repo and lists online agents", () => {
    const prompt = buildPlanningPrompt("加用户系统", [
      agent({ name: "Claude", harness: "claude-code", role: "后端" }),
      agent({ id: "a2", name: "Codex", harness: "codex" }),
    ]);
    expect(prompt).toContain("Glob/Read");
    expect(prompt).toContain("Claude");
    expect(prompt).toContain("Codex");
    expect(prompt).toContain("fileScope");
    expect(prompt).toContain("doneWhen");
    expect(prompt).toContain("verifyCommand");
    expect(prompt).toContain("interfaceRef");
    expect(prompt).toContain("拆成 2 个可并行的任务");
  });

  it("extracts JSON from fenced or noisy text", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('前置解释 {"a":1} 后缀')).toEqual({ a: 1 });
    expect(extractJson("not json at all")).toBeNull();
  });

  it("parses a valid lead plan into a MissionPlan with contract fields", () => {
    const result = parseLeadPlan({
      tasks: [
        { title: "后端", area: "backend", fileScope: ["src/api/**"], doneWhen: "接口可用", verifyCommand: "npm test", interfaceRef: "POST /users" },
        { title: "前端", area: "frontend", fileScope: ["src/ui/**"], doneWhen: "表单可提交" },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.source).toBe("lead");
    expect(result.plan.tasks).toHaveLength(2);
    expect(result.plan.tasks[0]!.fileScope).toEqual(["src/api/**"]);
    expect(result.plan.tasks[0]!.verifyCommand).toBe("npm test");
    expect(result.plan.tasks[1]!.doneWhen).toBe("表单可提交");
    expect(result.plan.note).toBeUndefined();
  });

  it("rejects drafts missing the mandatory contract fields", () => {
    const result = parseLeadPlan({ tasks: [{ title: "x", fileScope: [], doneWhen: "" }] });
    expect(result.ok).toBe(false);
  });

  it("flags overlapping fileScope entries in the plan note", () => {
    const result = parseLeadPlan({
      tasks: [
        { title: "a", fileScope: ["src/shared.ts"], doneWhen: "d1" },
        { title: "b", fileScope: ["src/shared.ts"], doneWhen: "d2" },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.note).toContain("重叠");
  });

  it("planWithLead succeeds against a fake claude runner", async () => {
    const planJson = JSON.stringify({
      tasks: [{ title: "核心", area: "general", fileScope: ["src/**"], doneWhen: "测试通过", verifyCommand: "npm test", interfaceRef: "" }],
    });
    const runner: HeadlessRunner = async (args) => {
      expect(args[0]).toBe("-p");
      expect(args).toContain("--output-format");
      expect(args).toContain("Read Glob Grep");
      return {
        exitCode: 0,
        stdout: JSON.stringify({ type: "result", is_error: false, result: planJson }),
        stderr: "",
        timedOut: false,
      };
    };
    const result = await planWithLead({ goal: "g", projectPath: "/tmp", agents: [] }, runner);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.tasks[0]!.title).toBe("核心");
  });

  it("planWithLead fails cleanly on timeout / bad exit / garbage output", async () => {
    const timeoutRunner: HeadlessRunner = async () => ({ exitCode: null, stdout: "", stderr: "", timedOut: true });
    const badExitRunner: HeadlessRunner = async () => ({ exitCode: 1, stdout: "", stderr: "boom", timedOut: false });
    const garbageRunner: HeadlessRunner = async () => ({ exitCode: 0, stdout: "not json", stderr: "", timedOut: false });

    const base = { goal: "g", projectPath: "/tmp", agents: [] };
    expect((await planWithLead(base, timeoutRunner)).ok).toBe(false);
    expect((await planWithLead(base, badExitRunner)).ok).toBe(false);
    expect((await planWithLead(base, garbageRunner)).ok).toBe(false);
  });

  it("surfaces claude's structured error text even when the exit code is non-zero", async () => {
    // 实测：claude 出错（如 401）时退出码 1，但 stdout 是含 is_error/result 的 JSON。
    const authFailRunner: HeadlessRunner = async () => ({
      exitCode: 1,
      stdout: JSON.stringify({
        type: "result",
        is_error: true,
        result: "Failed to authenticate. API Error: 401 Invalid authentication credentials",
      }),
      stderr: "",
      timedOut: false,
    });
    const result = await planWithLead({ goal: "g", projectPath: "/tmp", agents: [] }, authFailRunner);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("401 Invalid authentication credentials");
    expect(result.reason).not.toContain("退出码");
  });
});

// ---------- routes：plan/launch 优先 lead，失败回退模板 ----------

describe("hub routes with lead planner", () => {
  it("POST /api/missions/plan prefers the injected lead planner when a project dir exists", async () => {
    const dir = makeGitRepo();
    const { app, core } = createHubApp({
      dbPath: ":memory:",
      leadPlanner: async (input) => {
        expect(input.projectPath).toBe(dir);
        return {
          ok: true,
          plan: {
            template: "lead",
            templateLabel: "Lead 拆分",
            source: "lead",
            tasks: [
              { title: "T1", description: "", area: "backend", files: ["a.ts"], fileScope: ["a.ts"], doneWhen: "d", verifyCommand: "npm test", interfaceRef: "" },
            ],
          },
        };
      },
    });
    const res = await request(app).post("/api/missions/plan").send({ goal: "目标", projectPath: dir });
    expect(res.status).toBe(200);
    expect(res.body.plan.source).toBe("lead");
    expect(res.body.plan.tasks[0].fileScope).toEqual(["a.ts"]);
    core.close();
  });

  it("falls back to template planning (with a note) when the lead planner fails", async () => {
    const dir = makeGitRepo();
    const { app, core } = createHubApp({
      dbPath: ":memory:",
      leadPlanner: async () => ({ ok: false, reason: "lead 规划超时" }),
    });
    const res = await request(app).post("/api/missions/plan").send({ goal: "做一个 CLI 工具", projectPath: dir });
    expect(res.status).toBe(200);
    expect(res.body.plan.source).toBe("template");
    expect(res.body.plan.note).toContain("lead 规划超时");
    core.close();
  });

  it("skips the lead planner without a project dir and when the user picked a template", async () => {
    let called = 0;
    const dir = makeGitRepo();
    const { app, core } = createHubApp({
      dbPath: ":memory:",
      leadPlanner: async () => {
        called++;
        return { ok: false, reason: "should not run" };
      },
    });
    const noDir = await request(app).post("/api/missions/plan").send({ goal: "做一个 CLI 工具" });
    expect(noDir.body.plan.source).toBe("template");
    const withTemplate = await request(app).post("/api/missions/plan").send({ goal: "x", template: "cli", projectPath: dir });
    expect(withTemplate.body.plan.template).toBe("cli");
    expect(called).toBe(0);
    core.close();
  });

  it("launch persists the task contract onto created tasks", async () => {
    const { app, core } = createHubApp({ dbPath: ":memory:" });
    const reg = await request(app).post("/api/agents").send({ name: "Claude", harness: "claude-code" });
    const res = await request(app)
      .post("/api/missions/launch")
      .send({
        goal: "g",
        createdBy: reg.body.agent.id,
        customTasks: [
          { title: "T1", description: "", area: "general", fileScope: ["src/a.ts"], doneWhen: "ok", verifyCommand: "npm test", interfaceRef: "ifc" },
        ],
      });
    expect(res.status).toBe(200);
    const task = res.body.tasks[0];
    expect(task.fileScope).toEqual(["src/a.ts"]);
    expect(task.doneWhen).toBe("ok");
    expect(task.verifyCommand).toBe("npm test");
    expect(task.interfaceRef).toBe("ifc");
    // files 未显式给 → 回退为 fileScope（锁的 advisory 范围）。
    expect(task.files).toEqual(["src/a.ts"]);
    core.close();
  });

  it("POST /api/agent-runs/:id/input validates message and run id", async () => {
    const { app, core } = createHubApp({ dbPath: ":memory:" });
    const missing = await request(app).post("/api/agent-runs/run_x/input").send({});
    expect(missing.status).toBe(400);
    const unknown = await request(app).post("/api/agent-runs/run_x/input").send({ message: "继续" });
    expect(unknown.status).toBe(404);
    core.close();
  });
});

// ---------- 1.2 硬规则：verifyCommand 跑通前不许 update_task done ----------

describe("update_task verify hard rule (MCP)", () => {
  it("blocks done without verified=true when the task has a verifyCommand, allows it with", async () => {
    const { app, core } = createHubApp({ dbPath: ":memory:" });
    const httpServer = await new Promise<import("node:http").Server>((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    const addr = httpServer.address();
    const hubUrl = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;

    const { server } = await createAgentServer({ hubUrl, agentName: "W", harness: "claude-code" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "t", version: "1.0.0" });
    await client.connect(clientTransport);

    const created = core.tasks.create({ title: "带验证的任务", verifyCommand: "npm test" });
    const me = core.agents.list().find((a) => a.name === "W")!;
    core.tasks.claim(created.id, me.id);

    type ToolResult = { content?: { type: string; text?: string }[]; isError?: boolean };
    const call = (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args }) as Promise<ToolResult>;

    const blocked = await call("update_task", { task_id: created.id, status: "done" });
    expect(blocked.isError).toBe(true);
    expect((blocked.content ?? []).map((c) => c.text).join("")).toContain("npm test");
    expect(core.tasks.get(created.id)!.status).not.toBe("done");

    const allowed = await call("update_task", { task_id: created.id, status: "done", verified: true, note: "npm test 通过" });
    expect(allowed.isError).toBeFalsy();
    expect(core.tasks.get(created.id)!.status).toBe("done");

    await client.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    core.close();
  });
});
