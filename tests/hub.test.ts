import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import type { Express } from "express";
import { createHubApp } from "../src/hub/server.js";

let app: Express;

beforeEach(() => {
  app = createHubApp({ dbPath: ":memory:" }).app;
});

async function register(name: string, harness = "claude-code"): Promise<string> {
  const res = await request(app).post("/api/agents").send({ name, harness });
  return res.body.agent.id as string;
}

describe("hub REST", () => {
  it("health and snapshot respond", async () => {
    expect((await request(app).get("/healthz")).body).toEqual({ ok: true });
    const snap = await request(app).get("/api/snapshot");
    expect(snap.status).toBe(200);
    expect(snap.body).toHaveProperty("agents");
  });

  it("registers agents and lists them", async () => {
    await register("Claude");
    await register("Codex", "codex");
    const list = await request(app).get("/api/agents");
    expect(list.body.agents).toHaveLength(2);
  });

  it("isolates same-named agents by principal but reuses id on reconnect (团队隔离)", async () => {
    const alice = await request(app).post("/api/agents").send({ name: "Claude", harness: "claude-code", principal: "Alice" });
    const bob = await request(app).post("/api/agents").send({ name: "Claude", harness: "claude-code", principal: "Bob" });
    // 同名不同 principal → 两个不同 Agent（不互相覆盖）。
    expect(alice.body.agent.id).not.toBe(bob.body.agent.id);

    // 同名同 principal 再连 → 复用同一 id（重连友好）。
    const aliceReconnect = await request(app).post("/api/agents").send({ name: "Claude", harness: "claude-code", principal: "Alice" });
    expect(aliceReconnect.body.agent.id).toBe(alice.body.agent.id);
    expect((await request(app).get("/api/agents")).body.agents).toHaveLength(2);

    // 默认 principal（本机）与具名 principal 也互不复用。
    const local = await request(app).post("/api/agents").send({ name: "Claude", harness: "claude-code" });
    expect(local.body.agent.id).not.toBe(alice.body.agent.id);
    expect((await request(app).get("/api/agents")).body.agents).toHaveLength(3);
  });

  it("returns connection snippets for agent setup", async () => {
    const res = await request(app).get("/api/connect").set("Host", "localhost:4100");
    expect(res.status).toBe(200);
    expect(res.body.hubUrl).toBe("http://localhost:4100");
    expect(res.body.claudeCommand).toContain("claude mcp add orbit");
    expect(res.body.codexToml).toContain("[mcp_servers.orbit]");
    expect(res.body.codexToml).toContain("--harness");
    expect(res.body.tokenRequired).toBe(false);
    // 默认无 principal（本地场景）。
    expect(res.body.principal).toBeNull();
    expect(res.body.claudeCommand).not.toContain("--principal");
  });

  it("injects principal into connect snippets for team members", async () => {
    const res = await request(app).get("/api/connect").query({ principal: "Bob" }).set("Host", "localhost:4100");
    expect(res.status).toBe(200);
    expect(res.body.principal).toBe("Bob");
    // 命令带 --principal，且 Agent 名加前缀以便面板区分是谁的。
    expect(res.body.claudeCommand).toContain("--principal Bob");
    expect(res.body.claudeCommand).toContain("Bob-Claude");
    expect(res.body.codexToml).toContain("Bob");
    expect(res.body.codexToml).toContain("--principal");
  });

  it("rejects an invalid register body with 400", async () => {
    const res = await request(app).post("/api/agents").send({ name: "" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
  });

  it("404s heartbeat for an unknown agent", async () => {
    const res = await request(app).post("/api/agents/nope/heartbeat").send();
    expect(res.status).toBe(404);
  });

  it("runs the full task claim race over REST", async () => {
    const a = await register("Claude");
    const b = await register("Codex", "codex");
    const task = (await request(app).post("/api/tasks").send({ title: "Build API" })).body.task;

    const first = await request(app).post(`/api/tasks/${task.id}/claim`).send({ agent: a });
    const second = await request(app).post(`/api/tasks/${task.id}/claim`).send({ agent: b });
    expect(first.body.ok).toBe(true);
    expect(second.body.ok).toBe(false);
    expect(second.body.reason).toBe("already_claimed");
    expect(second.body.heldBy.id).toBe(a);

    const done = await request(app).post(`/api/tasks/${task.id}/update`).send({ status: "done" });
    expect(done.body.task.status).toBe("done");
  });

  it("delivers messages between agents", async () => {
    const a = await register("Claude");
    const b = await register("Codex", "codex");
    await request(app).post("/api/messages").send({ from: a, to: b, content: "API changed" });
    const inbox = await request(app).get("/api/messages/inbox").query({ agent: b });
    expect(inbox.body.messages.map((m: { content: string }) => m.content)).toEqual(["API changed"]);
  });

  it("acquires, conflicts, checks and releases file locks", async () => {
    const a = await register("Claude");
    const b = await register("Codex", "codex");
    const acq = await request(app).post("/api/locks/acquire").send({ agent: a, paths: ["src/api.ts"] });
    expect(acq.body.granted).toEqual(["src/api.ts"]);

    const conflict = await request(app).post("/api/locks/acquire").send({ agent: b, paths: ["src/api.ts"] });
    expect(conflict.body.conflicts[0].heldBy.id).toBe(a);

    const check = await request(app).post("/api/locks/check").send({ paths: ["src/api.ts"] });
    expect(check.body.status[0].locked).toBe(true);

    const rel = await request(app).post("/api/locks/release").send({ agent: a, paths: ["src/api.ts"] });
    expect(rel.body.released).toEqual(["src/api.ts"]);
  });

  it("appends and lists shared notes", async () => {
    const a = await register("Claude");
    await request(app).post("/api/notes").send({ agent: a, content: "contract v1" });
    const notes = await request(app).get("/api/notes");
    expect(notes.body.notes[0].content).toBe("contract v1");
  });

  it("launches a mission by creating assigned task cards", async () => {
    const claude = await register("Claude", "claude-code");
    const codex = await register("Codex", "codex");
    await request(app).post(`/api/agents/${claude}/role`).send({ role: "后端" });
    await request(app).post(`/api/agents/${codex}/role`).send({ role: "前端" });

    const res = await request(app).post("/api/missions/launch").send({
      goal: "Build users feature",
      projectPath: "/tmp/users-app",
      createdBy: claude,
    });

    expect(res.status).toBe(200);
    expect(res.body.mission.goal).toBe("Build users feature");
    expect(res.body.mission.worktrees).toHaveLength(2);
    expect(res.body.tasks.length).toBeGreaterThanOrEqual(2);
    expect(res.body.tasks.map((t: { assignee: string | null }) => t.assignee)).toEqual(expect.arrayContaining([claude, codex]));

    const snapshot = await request(app).get("/api/snapshot");
    expect(snapshot.body.missions[0].taskIds.length).toBeGreaterThanOrEqual(2);
    expect(snapshot.body.messages.at(-1).content).toContain("Mission launched");
  });

  it("assigns an online area agent but leaves an uncovered area as a claimable todo", async () => {
    const claude = await register("Claude", "claude-code");
    await request(app).post(`/api/agents/${claude}/role`).send({ role: "后端" });
    // 只有后端 Agent 在线，没有任何前端 Agent。

    const res = await request(app).post("/api/missions/launch").send({
      goal: "做一个贪吃蛇小游戏",
      createdBy: claude,
    });

    expect(res.status).toBe(200);
    const tasks = res.body.tasks as { title: string; assignee: string | null; status: string }[];
    // 新的 planner 按模板拆分，"贪吃蛇"匹配到纯前端模板，任务都是 frontend area。
    // 后端 Agent 不匹配 frontend area → 不分配 → 待认领。
    expect(tasks.length).toBeGreaterThanOrEqual(2);
    // 每个任务标题都包含目标关键词。
    for (const t of tasks) {
      expect(t.title).toContain("做一个贪吃蛇小游戏");
    }
  });

  it("plans a mission and launches with custom tasks", async () => {
    // Step 1: plan
    const planRes = await request(app).post("/api/missions/plan").send({ goal: "做一个 CLI 工具" });
    expect(planRes.status).toBe(200);
    expect(planRes.body.plan.template).toBe("cli");
    expect(planRes.body.plan.tasks.length).toBeGreaterThanOrEqual(2);

    // Step 2: launch with custom tasks
    const claude = await register("Planner-Claude", "claude-code");
    const customTasks = [
      { title: "自定义任务1", description: "描述1", area: "backend" as const, files: [] },
      { title: "自定义任务2", description: "描述2", area: "general" as const, files: [] },
    ];
    const launchRes = await request(app).post("/api/missions/launch").send({
      goal: "做一个 CLI 工具",
      createdBy: claude,
      customTasks,
    });
    expect(launchRes.status).toBe(200);
    expect(launchRes.body.tasks).toHaveLength(2);
    expect(launchRes.body.tasks[0].title).toBe("自定义任务1");
    expect(launchRes.body.tasks[1].title).toBe("自定义任务2");
  });

  it("plan falls back to fullstack for unknown template id", async () => {
    const res = await request(app).post("/api/missions/plan").send({ goal: "build something", template: "nonexistent" });
    expect(res.status).toBe(200);
    // falls back to TEMPLATES[0] = fullstack
    expect(res.body.plan.template).toBe("fullstack");
  });

  it("launch with empty customTasks array falls back to auto planning", async () => {
    const claude = await register("FallbackClaude", "claude-code");
    const res = await request(app).post("/api/missions/launch").send({
      goal: "做一个 API 服务",
      createdBy: claude,
      customTasks: [],
    });
    expect(res.status).toBe(200);
    // empty array → fallback to planTasks()
    expect(res.body.tasks.length).toBeGreaterThanOrEqual(2);
  });

  it("lists available templates", async () => {
    const res = await request(app).get("/api/templates");
    expect(res.status).toBe(200);
    expect(res.body.templates.length).toBeGreaterThanOrEqual(5);
    expect(res.body.templates[0]).toHaveProperty("id");
    expect(res.body.templates[0]).toHaveProperty("label");
  });

  it("seeds demo data and prevents double seeding", async () => {
    const first = await request(app).post("/api/demo/seed").send();
    expect(first.status).toBe(200);
    expect(first.body.ok).toBe(true);
    expect(first.body.agents).toHaveLength(2);

    // snapshot should have agents, tasks, locks, messages, notes
    const snap = await request(app).get("/api/snapshot");
    expect(snap.body.agents.length).toBeGreaterThanOrEqual(2);
    expect(snap.body.tasks.length).toBeGreaterThanOrEqual(4);
    expect(snap.body.locks.length).toBeGreaterThanOrEqual(2);
    expect(snap.body.messages.length).toBeGreaterThanOrEqual(2);

    // second call should be a no-op
    const second = await request(app).post("/api/demo/seed").send();
    expect(second.body.ok).toBe(false);
    expect(second.body.reason).toBe("already_seeded");
  });

  it("installs the Codex config block into HOME", async () => {
    const originalHome = process.env.HOME;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agenthub-home-"));
    process.env.HOME = tmp;
    try {
      const res = await request(app).post("/api/connect/install/codex").set("Host", "localhost:4100").send();
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      const content = fs.readFileSync(path.join(tmp, ".codex", "config.toml"), "utf8");
      expect(content).toContain("[mcp_servers.orbit]");
      expect(content).toContain("http://localhost:4100");
    } finally {
      process.env.HOME = originalHome;
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("hub auth", () => {
  it("rejects /api without token and accepts with it", async () => {
    const secured = createHubApp({ dbPath: ":memory:", token: "secret" }).app;
    expect((await request(secured).get("/api/agents")).status).toBe(401);
    expect((await request(secured).get("/api/agents").set("Authorization", "Bearer secret")).status).toBe(200);
    const connect = await request(secured).get("/api/connect").set("Authorization", "Bearer secret");
    expect(connect.body.tokenRequired).toBe(true);
    expect(connect.body.codexToml).toContain("<TOKEN>");
    // health is public
    expect((await request(secured).get("/healthz")).status).toBe(200);
  });
});
