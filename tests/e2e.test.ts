import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";
import request from "supertest";
import type { Express } from "express";
import { createHubApp } from "../src/hub/server.js";
import type { CoordinationCore } from "../src/core/core.js";
import type { RunManager } from "../src/hub/run-manager.js";
import type { DriverSpec, Harness } from "../src/drivers/types.js";

// 端到端：真实 HTTP(REST) + 真实 git + 真实 worktree 隔离，覆盖 routes 层
// launch → 并行 worker spawn → integrate → approve → 合入目标分支 的完整链路。
// worker 用确定性 driver（写文件 + done），不依赖真实 Agent CLI / 额度。

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
function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, env: GIT_ENV, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}
function makeGitRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-e2e-"));
  tmpDirs.push(dir);
  git(dir, ["init", "-b", "main"]);
  fs.writeFileSync(path.join(dir, "README.md"), "base\n");
  // 带 scripts 的 package.json：验证 launch 会自动探测出 build/test 验证命令。
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "e2e-proj", scripts: { build: "tsc", test: "vitest run" } }, null, 2),
  );
  git(dir, ["add", "."]);
  git(dir, ["commit", "-m", "init"]);
  return dir;
}

function fileDriver(file: string, content: string): DriverSpec {
  const s = `const fs=require('fs');fs.writeFileSync(${JSON.stringify(file)},${JSON.stringify(content)});console.log(JSON.stringify({t:'session',sid:'s'}));console.log(JSON.stringify({t:'done'}));`;
  return {
    id: "claude-code",
    harness: "claude-code",
    async detect() {
      return { harness: "claude-code", available: true, binPath: null, version: null, loggedIn: null, hint: "" };
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

async function waitRunsDone(app: Express, min: number, ms = 12000): Promise<{ status: string; worktreePath: string | null }[]> {
  const deadline = Date.now() + ms;
  let runs: { status: string; worktreePath: string | null }[] = [];
  while (Date.now() < deadline) {
    runs = (await request(app).get("/api/agent-runs")).body.runs;
    if (runs.length >= min && runs.every((r) => ["done", "failed", "stopped"].includes(r.status))) return runs;
    await new Promise((r) => setTimeout(r, 80));
  }
  return runs;
}

describe("端到端 (REST 全链路验收)", () => {
  it("launch → 并行隔离 worker → integrate → approve → 合入目标分支", async () => {
    const root = makeGitRepo();
    const resolver = (h: Harness): DriverSpec =>
      h === "codex" ? fileDriver("frontend.ts", "export const fe=1;\n") : fileDriver("backend.ts", "export const be=1;\n");
    const { app, core, runs } = createHubApp({
      dbPath: ":memory:",
      driverResolver: resolver,
      validationRunner: () => ({ exitCode: 0, output: "ok" }),
    });
    cores.push(core);
    runManagers.push(runs);

    // 注册两个 Agent + 角色
    const claude = (await request(app).post("/api/agents").send({ name: "Claude", harness: "claude-code" })).body.agent;
    const codex = (await request(app).post("/api/agents").send({ name: "Codex", harness: "codex" })).body.agent;
    await request(app).post(`/api/agents/${claude.id}/role`).send({ role: "后端" });
    await request(app).post(`/api/agents/${codex.id}/role`).send({ role: "前端" });

    // launch：真实项目路径 + 前后端任务 → 真实并行 spawn 两个 worker
    const launch = await request(app).post("/api/missions/launch").send({
      goal: "加用户注册功能",
      projectPath: root,
      createdBy: claude.id,
      customTasks: [
        { title: "后端 API", description: "实现注册接口", area: "backend", files: ["backend.ts"] },
        { title: "前端 UI", description: "实现注册表单", area: "frontend", files: ["frontend.ts"] },
      ],
    });
    expect(launch.status).toBe(200);
    const missionId = launch.body.mission.id;
    expect(launch.body.tasks).toHaveLength(2);
    expect(launch.body.launchedRuns.length).toBeGreaterThanOrEqual(2);

    // 等两个 worker 在各自隔离 worktree 跑完
    const doneRuns = await waitRunsDone(app, 2);
    expect(doneRuns.filter((r) => r.status === "done")).toHaveLength(2);
    expect(doneRuns.filter((r) => r.worktreePath)).toHaveLength(2); // 物理隔离

    // 集成：合并两分支 → 验证 → ready
    const integ = await request(app).post(`/api/missions/${missionId}/integrate`).send({});
    expect(integ.status).toBe(200);
    expect(integ.body.integration.status).toBe("ready");
    expect(integ.body.integration.mergedBranches).toHaveLength(2);

    // 最终 Diff 含两个 Agent 的改动
    const detail = await request(app).get(`/api/missions/${missionId}/integration`);
    const files = (detail.body.diff?.files ?? []).map((f: { path: string }) => f.path);
    expect(files).toContain("frontend.ts");
    expect(files).toContain("backend.ts");
    // ① 自动探测验证命令生效：集成阶段真的跑了 build/test（不再是"0 条验证报告"）。
    const commands = detail.body.validations.map((v: { command: string }) => v.command);
    expect(commands).toContain("npm run build");
    expect(commands).toContain("npm test");

    // 审批 → 真实合入目标分支
    const appr = await request(app).post(`/api/missions/${missionId}/approve`).send({ by: "operator", note: "验收通过" });
    expect(appr.body.ok).toBe(true);
    expect(appr.body.resultCommit).toBeTruthy();

    // 目标分支 main 真的有了两个 Agent 的改动；mission 完成
    git(root, ["checkout", "main"]);
    expect(fs.existsSync(path.join(root, "frontend.ts"))).toBe(true);
    expect(fs.existsSync(path.join(root, "backend.ts"))).toBe(true);
    const snapshot = await request(app).get("/api/snapshot");
    const mission = snapshot.body.missions.find((m: { id: string }) => m.id === missionId);
    expect(mission.state).toBe("completed");
  });
});
