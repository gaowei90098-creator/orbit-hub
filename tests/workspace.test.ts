import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";
import request from "supertest";
import { createHubApp } from "../src/hub/server.js";
import type { CoordinationCore } from "../src/core/core.js";
import type { RunManager } from "../src/hub/run-manager.js";
import type { DriverSpec } from "../src/drivers/types.js";

// 统一工作区：设置一次项目目录，启动任务 / 一键派单都默认在这里自动拉起 worker。
// 覆盖：workspace API、launch 回退工作区、无在线 Agent 时按任务方向拉 worker、单任务派单。

const tmpDirs: string[] = [];
const cores: CoordinationCore[] = [];
const runManagers: RunManager[] = [];
afterEach(() => {
  for (const r of runManagers.splice(0)) r.stopAll();
  for (const c of cores.splice(0)) c.close();
  for (const d of tmpDirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
    fs.rmSync(`${d}-orbit`, { recursive: true, force: true });
  }
});

const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
function makeGitRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-ws-"));
  tmpDirs.push(dir);
  const git = (args: string[]) =>
    execFileSync("git", args, { cwd: dir, env: GIT_ENV, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  git(["init", "-b", "main"]);
  fs.writeFileSync(path.join(dir, "README.md"), "base\n");
  git(["add", "."]);
  git(["commit", "-m", "init"]);
  return dir;
}

// 确定性假驱动：立刻输出 session + done，不依赖真实 CLI。
function fakeDriver(harness: "claude-code" | "codex"): DriverSpec {
  const s = `console.log(JSON.stringify({t:'session',sid:'s'}));console.log(JSON.stringify({t:'done'}));`;
  return {
    id: harness,
    harness,
    async detect() {
      return { harness, available: true, binPath: null, version: null, loggedIn: null, hint: "" };
    },
    buildStart(input) {
      return { command: process.execPath, args: ["-e", s], cwd: input.projectPath, env: process.env };
    },
    buildResume(_a, _b, input) {
      return { command: process.execPath, args: ["-e", "0"], cwd: input.projectPath, env: process.env };
    },
    parseLine(line) {
      try {
        const o = JSON.parse(line) as { t: string; sid?: string };
        if (o.t === "session" && o.sid) return [{ kind: "session", sessionId: o.sid }];
        if (o.t === "done") return [{ kind: "status", status: "done", detail: "ok" }];
      } catch {
        /* ignore */
      }
      return [];
    },
  };
}

function makeApp() {
  const result = createHubApp({ dbPath: ":memory:", driverResolver: (h) => fakeDriver(h as "claude-code" | "codex") });
  cores.push(result.core);
  runManagers.push(result.runs);
  return result;
}

describe("统一工作区", () => {
  it("默认未设置；设置后持久化并自动登记项目", async () => {
    const { app } = makeApp();
    const empty = await request(app).get("/api/workspace");
    expect(empty.body.path).toBeNull();

    const root = makeGitRepo();
    const set = await request(app).post("/api/workspace").send({ path: root });
    expect(set.status).toBe(200);
    expect(set.body.path).toBe(root);
    expect(set.body.project.rootPath).toBe(root);
    expect(set.body.project.isGitRepo).toBe(true);

    const got = await request(app).get("/api/workspace");
    expect(got.body.path).toBe(root);
    expect(got.body.project.id).toBe(set.body.project.id);

    // snapshot 带 workspace，dashboard 初始加载即可见。
    const snap = await request(app).get("/api/snapshot");
    expect(snap.body.workspace).toBe(root);
  });

  it("拒绝不存在的目录", async () => {
    const { app } = makeApp();
    const res = await request(app).post("/api/workspace").send({ path: "/no/such/dir-orbit-test" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("path_not_found");
  });

  it("launch 未传项目目录时回退到工作区并自动拉起 worker（零在线 Agent 也开工）", async () => {
    const { app } = makeApp();
    const root = makeGitRepo();
    await request(app).post("/api/workspace").send({ path: root });

    // 没有注册任何 Agent —— 按任务方向兜底：前端→codex，其余→claude-code。
    const launch = await request(app).post("/api/missions/launch").send({
      goal: "做一个登录页",
      customTasks: [
        { title: "前端 UI", description: "登录表单", area: "frontend", files: [] },
        { title: "后端 API", description: "登录接口", area: "backend", files: [] },
      ],
    });
    expect(launch.status).toBe(200);
    expect(launch.body.mission.projectPath).toBe(root);
    expect(launch.body.launchedRuns).toEqual(["codex", "claude-code"]);
  });

  it("一键派单：无工作区明确报错；有工作区则拉起绑定该任务的 worker", async () => {
    const { app } = makeApp();
    const created = await request(app).post("/api/tasks").send({ title: "修登录 bug" });
    const taskId = created.body.task.id as string;

    const blocked = await request(app).post(`/api/tasks/${taskId}/dispatch`).send({});
    expect(blocked.status).toBe(400);
    expect(blocked.body.error).toBe("no_workspace");

    const root = makeGitRepo();
    await request(app).post("/api/workspace").send({ path: root });
    const ok = await request(app).post(`/api/tasks/${taskId}/dispatch`).send({});
    expect(ok.status).toBe(200);
    expect(ok.body.run.taskId).toBe(taskId);
    expect(ok.body.run.harness).toBe("claude-code");

    // 显式指定 harness。
    const codex = await request(app).post(`/api/tasks/${taskId}/dispatch`).send({ harness: "codex" });
    expect(codex.status).toBe(200);
    expect(codex.body.run.harness).toBe("codex");
  });

  it("派单接管卡住的已领取任务：先释放，worker 才能 claim_task 认领", async () => {
    const { app, core } = makeApp();
    const root = makeGitRepo();
    await request(app).post("/api/workspace").send({ path: root });

    const agent = core.agents.register("Claude", "claude-code");
    const task = core.tasks.create({ title: "卡住的活" });
    core.tasks.claim(task.id, agent.id);
    expect(core.tasks.get(task.id)?.status).toBe("claimed");

    const res = await request(app).post(`/api/tasks/${task.id}/dispatch`).send({});
    expect(res.status).toBe(200);
    const after = core.tasks.get(task.id)!;
    expect(after.status).toBe("todo");
    expect(after.assignee).toBeNull();
  });

  it("派单拒绝已完成的任务", async () => {
    const { app, core } = makeApp();
    const root = makeGitRepo();
    await request(app).post("/api/workspace").send({ path: root });
    const task = core.tasks.create({ title: "已完成的活" });
    core.tasks.update(task.id, { status: "done" });
    const res = await request(app).post(`/api/tasks/${task.id}/dispatch`).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("task_done");
  });
});
