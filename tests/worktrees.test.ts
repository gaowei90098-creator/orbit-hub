import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";
import request from "supertest";
import {
  addWorktree,
  hasCommits,
  isGitRepo,
  listWorktrees,
  planWorktree,
  pruneWorktrees,
  removeWorktree,
  worktreeDiff,
} from "../src/core/worktrees.js";
import { CoordinationCore } from "../src/core/core.js";
import { RunManager } from "../src/hub/run-manager.js";
import { createHubApp } from "../src/hub/server.js";
import type { AgentEnvironment, DriverSpec } from "../src/drivers/types.js";
import type { Harness } from "../src/core/types.js";

const tmpDirs: string[] = [];
afterEach(() => {
  // 同时清理 worktree 的兄弟目录 <root>-orbit。
  for (const d of tmpDirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
    fs.rmSync(`${d}-orbit`, { recursive: true, force: true });
  }
});

function registerTmp(dir: string): string {
  tmpDirs.push(dir);
  return dir;
}

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@t",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@t",
};

function makeGitRepo(): string {
  const dir = registerTmp(fs.mkdtempSync(path.join(os.tmpdir(), "orbit-wt-")));
  execFileSync("git", ["init", "-b", "main"], { cwd: dir, env: GIT_ENV, stdio: "ignore" });
  fs.writeFileSync(path.join(dir, "README.md"), "hello\n");
  execFileSync("git", ["add", "."], { cwd: dir, env: GIT_ENV, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "init"], { cwd: dir, env: GIT_ENV, stdio: "ignore" });
  return dir;
}

function makeEmptyGitRepo(): string {
  const dir = registerTmp(fs.mkdtempSync(path.join(os.tmpdir(), "orbit-empty-")));
  execFileSync("git", ["init", "-b", "main"], { cwd: dir, env: GIT_ENV, stdio: "ignore" });
  return dir;
}

function makePlainDir(): string {
  return registerTmp(fs.mkdtempSync(path.join(os.tmpdir(), "orbit-plain-")));
}

// ----- 纯函数：真实临时 git 仓库 -----

describe("worktrees core (D01)", () => {
  it("detects git repos and presence of commits", () => {
    const git = makeGitRepo();
    const empty = makeEmptyGitRepo();
    const plain = makePlainDir();
    expect(isGitRepo(git)).toBe(true);
    expect(hasCommits(git)).toBe(true);
    expect(isGitRepo(empty)).toBe(true);
    expect(hasCommits(empty)).toBe(false); // 无 commit → 不能 worktree add
    expect(isGitRepo(plain)).toBe(false);
  });

  it("plans an isolated branch + sibling worktree path", () => {
    const root = "/tmp/myproj";
    const plan = planWorktree(root, "加用户注册功能", "run_abc123");
    expect(plan.branch).toMatch(/^orbit\//);
    expect(plan.branch).toContain("abc123".slice(-6));
    // 兄弟目录 <projectName>-orbit/，不落在主仓库内。
    expect(plan.worktreePath.startsWith("/tmp/myproj-orbit/")).toBe(true);
  });

  it("adds a worktree on a new branch and lists it", () => {
    const root = makeGitRepo();
    const { worktreePath, branch } = planWorktree(root, "feature", "run_111111");
    const info = addWorktree({ projectRoot: root, worktreePath, branch });
    expect(info.branch).toBe(branch);
    expect(fs.existsSync(worktreePath)).toBe(true);
    expect(fs.existsSync(path.join(worktreePath, "README.md"))).toBe(true); // 从 main 切出

    const list = listWorktrees(root);
    // git 在 macOS 输出 realpath（/private/var/…），mkdtemp 给的是 /var/… —— 两边归一再比。
    expect(list.some((w) => fs.realpathSync(w.path) === fs.realpathSync(root))).toBe(true); // 主工作区
    expect(list.some((w) => w.branch === branch)).toBe(true); // 隔离区
  });

  it("removes a worktree and deletes its branch", () => {
    const root = makeGitRepo();
    const { worktreePath, branch } = planWorktree(root, "feature", "run_222222");
    addWorktree({ projectRoot: root, worktreePath, branch });
    removeWorktree(root, worktreePath, branch);
    expect(fs.existsSync(worktreePath)).toBe(false);
    expect(listWorktrees(root).some((w) => w.branch === branch)).toBe(false);
    pruneWorktrees(root); // 不抛
  });

  it("summarizes changes (tracked edits + untracked new files) vs base", () => {
    const root = makeGitRepo();
    const { worktreePath, branch } = planWorktree(root, "feature", "run_333333");
    addWorktree({ projectRoot: root, worktreePath, branch });
    fs.appendFileSync(path.join(worktreePath, "README.md"), "more\n"); // 改已追踪
    fs.writeFileSync(path.join(worktreePath, "new.ts"), "export const x = 1;\n"); // 新文件

    const diff = worktreeDiff(worktreePath, "main");
    expect(diff.base).toBe("main");
    expect(diff.files.some((f) => f.path === "README.md")).toBe(true);
    expect(diff.untracked).toContain("new.ts");
    expect(diff.insertions).toBeGreaterThan(0);
    expect(diff.filesChanged).toBe(diff.files.length + diff.untracked.length);
  });

  it("propagates a clear error when adding to a non-git dir", () => {
    const plain = makePlainDir();
    expect(() => addWorktree({ projectRoot: plain, worktreePath: path.join(plain, "wt"), branch: "orbit/x" })).toThrow();
  });
});

// ----- RunManager 隔离集成：真实 git + 假 DriverSpec（在 cwd 写文件，吐可解析行）-----

const fakeEnv: AgentEnvironment = {
  harness: "claude-code",
  available: true,
  binPath: null,
  version: null,
  loggedIn: null,
  hint: "",
};

// 假 worker：在 cwd（= worktree）改一个已追踪文件 + 写一个新文件，再吐 session/done 行。
const fakeDriver: DriverSpec = {
  id: "claude-code",
  harness: "claude-code",
  async detect() {
    return fakeEnv;
  },
  buildStart(input) {
    const script = [
      "const fs=require('fs');",
      "fs.appendFileSync('README.md','\\nworker was here');",
      "fs.writeFileSync('worker-output.txt','done by worker');",
      "console.log(JSON.stringify({t:'session',sid:'fake-sess-1'}));",
      "console.log(JSON.stringify({t:'done'}));",
    ].join("");
    return { command: process.execPath, args: ["-e", script], cwd: input.projectPath, env: process.env };
  },
  buildResume(_sid, _msg, input) {
    return { command: process.execPath, args: ["-e", "console.log(JSON.stringify({t:'done'}))"], cwd: input.projectPath, env: process.env };
  },
  parseLine(line) {
    try {
      const o = JSON.parse(line) as { t: string; sid?: string };
      if (o.t === "session" && o.sid) return [{ kind: "session", sessionId: o.sid }];
      if (o.t === "done") return [{ kind: "status", status: "done", detail: "完成" }];
    } catch {
      /* 非 JSON 忽略 */
    }
    return [];
  },
};

async function waitTerminal(core: CoordinationCore, runId: string, ms = 8000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const r = core.store.getAgentRun(runId);
    if (r && ["done", "failed", "stopped"].includes(r.status)) return;
    await new Promise((res) => setTimeout(res, 50));
  }
}

describe("RunManager × worktree isolation (D01)", () => {
  it("runs a worker inside an isolated worktree and persists branch + worktreePath", async () => {
    const root = makeGitRepo();
    const core = new CoordinationCore(":memory:");
    const runs = new RunManager(core, () => fakeDriver);

    const run = runs.start({
      harness: "claude-code",
      missionId: null,
      taskId: "t1",
      projectId: null,
      taskTitle: "加功能",
      goal: "x",
      projectPath: root,
    });
    await waitTerminal(core, run.id);

    const final = core.store.getAgentRun(run.id)!;
    expect(final.status).toBe("done");
    expect(final.sessionId).toBe("fake-sess-1");
    expect(final.branch).toMatch(/^orbit\//);
    expect(final.worktreePath).toBeTruthy();
    // 隔离证据：worker 的产物落在 worktree 里，主仓库不被污染。
    expect(fs.existsSync(path.join(final.worktreePath!, "worker-output.txt"))).toBe(true);
    expect(fs.existsSync(path.join(root, "worker-output.txt"))).toBe(false);
    expect(fs.readFileSync(path.join(root, "README.md"), "utf8")).not.toContain("worker was here");

    core.close();
  });

  it("exposes a diff summary and cleans up the worktree on demand", async () => {
    const root = makeGitRepo();
    const core = new CoordinationCore(":memory:");
    const runs = new RunManager(core, () => fakeDriver);
    const run = runs.start({ harness: "claude-code", missionId: null, taskId: null, projectId: null, taskTitle: "改东西", goal: "x", projectPath: root });
    await waitTerminal(core, run.id);
    const wt = core.store.getAgentRun(run.id)!.worktreePath!;

    const d = runs.diff(run.id);
    expect(d.ok).toBe(true);
    if (d.ok) {
      expect(d.diff.files.some((f) => f.path === "README.md")).toBe(true);
      expect(d.diff.untracked).toContain("worker-output.txt");
    }

    const rm = runs.removeWorktree(run.id);
    expect(rm.ok).toBe(true);
    expect(fs.existsSync(wt)).toBe(false);
    expect(core.store.getAgentRun(run.id)!.worktreePath).toBeNull(); // run 记录保留
    // 清理后再 diff → no_worktree
    expect(runs.diff(run.id)).toEqual({ ok: false, reason: "no_worktree" });

    core.close();
  });

  it("falls back to the main directory for a non-git project (no worktree)", async () => {
    const root = makePlainDir();
    const core = new CoordinationCore(":memory:");
    const runs = new RunManager(core, () => fakeDriver);
    const run = runs.start({ harness: "claude-code", missionId: null, taskId: null, projectId: null, taskTitle: "x", goal: "x", projectPath: root });
    await waitTerminal(core, run.id);

    const final = core.store.getAgentRun(run.id)!;
    expect(final.status).toBe("done");
    expect(final.worktreePath).toBeNull(); // 降级直跑
    expect(fs.existsSync(path.join(root, "worker-output.txt"))).toBe(true); // 在主目录干活
    expect(runs.diff(run.id)).toEqual({ ok: false, reason: "no_worktree" });

    core.close();
  });

  it("respects isolate:false to force running in the main directory", async () => {
    const root = makeGitRepo();
    const core = new CoordinationCore(":memory:");
    const runs = new RunManager(core, () => fakeDriver);
    const run = runs.start({ harness: "claude-code", missionId: null, taskId: null, projectId: null, taskTitle: "x", goal: "x", projectPath: root, isolate: false });
    await waitTerminal(core, run.id);

    const final = core.store.getAgentRun(run.id)!;
    expect(final.worktreePath).toBeNull();
    expect(fs.existsSync(path.join(root, "worker-output.txt"))).toBe(true);
    core.close();
  });
});

// ----- routes 端点契约（不依赖真实 worker）-----

describe("worktree REST contracts (D01)", () => {
  it("lists a project's worktrees (主工作区 at least)", async () => {
    const { app } = createHubApp({ dbPath: ":memory:" });
    const root = makeGitRepo();
    const project = (await request(app).post("/api/projects").send({ rootPath: root })).body.project;
    const res = await request(app).get(`/api/projects/${project.id}/worktrees`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.worktrees)).toBe(true);
    expect(res.body.worktrees.some((w: { path: string }) => fs.realpathSync(w.path) === fs.realpathSync(root))).toBe(true);
  });

  it("404s diff/remove for an unknown run and 400s diff with no worktree", async () => {
    const { app, core } = createHubApp({ dbPath: ":memory:" });
    expect((await request(app).get("/api/agent-runs/nope/diff")).status).toBe(404);
    expect((await request(app).post("/api/agent-runs/nope/worktree/remove")).status).toBe(404);

    // 插一条无 worktree 的 run → diff 应 400 no_worktree。
    const now = Date.now();
    core.store.insertAgentRun({
      id: "run_nowt",
      missionId: null,
      taskId: null,
      projectId: null,
      agentId: null,
      driver: "claude-code",
      harness: "claude-code",
      sessionId: null,
      pid: null,
      worktreePath: null,
      branch: null,
      baseCommit: null,
      status: "done",
      errorCode: null,
      costUsd: 0,
      lastActivity: "",
      error: "",
      taskTitle: "",
      projectPath: "/tmp",
      startedAt: now,
      updatedAt: now,
    });
    const diff = await request(app).get("/api/agent-runs/run_nowt/diff");
    expect(diff.status).toBe(400);
    expect(diff.body.error).toBe("no_worktree");
  });
});

// ----- 第二阶段完成标准：两个 Agent 在隔离目录并行修改 -----

// 带身份标记的假 worker：在 cwd（= 各自 worktree）改同名文件 README + 写 <tag>.txt。
function makeFakeDriver(tag: string): DriverSpec {
  return {
    id: "claude-code",
    harness: "claude-code",
    async detect() {
      return fakeEnv;
    },
    buildStart(input) {
      const script = [
        "const fs=require('fs');",
        `fs.appendFileSync('README.md','\\n${tag} was here');`,
        `fs.writeFileSync('${tag}.txt','by ${tag}');`,
        `console.log(JSON.stringify({t:'session',sid:'sess-${tag}'}));`,
        "console.log(JSON.stringify({t:'done'}));",
      ].join("");
      return { command: process.execPath, args: ["-e", script], cwd: input.projectPath, env: process.env };
    },
    buildResume(_sid, _msg, input) {
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

async function waitAllTerminal(core: CoordinationCore, count: number, ms = 8000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const rs = core.store.listAgentRuns();
    if (rs.length >= count && rs.every((r) => ["done", "failed", "stopped"].includes(r.status))) return;
    await new Promise((res) => setTimeout(res, 50));
  }
}

describe("two agents parallel + isolated (第二阶段验收)", () => {
  it("two agents modify the SAME file in parallel worktrees, fully isolated", async () => {
    const root = makeGitRepo();
    const core = new CoordinationCore(":memory:");
    // 按 harness 分派不同身份的假 driver：claude→CLAUDE, codex→CODEX。
    const resolver = (h: Harness): DriverSpec => makeFakeDriver(h === "codex" ? "CODEX" : "CLAUDE");
    const runs = new RunManager(core, resolver);

    // 并行启动两个 Agent（后端给 Claude、前端给 Codex），各自独立 worktree。
    const r1 = runs.start({ harness: "claude-code", missionId: "m1", taskId: "t-be", projectId: null, taskTitle: "后端", goal: "g", projectPath: root });
    const r2 = runs.start({ harness: "codex", missionId: "m1", taskId: "t-fe", projectId: null, taskTitle: "前端", goal: "g", projectPath: root });
    await Promise.all([waitTerminal(core, r1.id), waitTerminal(core, r2.id)]);

    const a = core.store.getAgentRun(r1.id)!;
    const b = core.store.getAgentRun(r2.id)!;
    expect(a.status).toBe("done");
    expect(b.status).toBe("done");
    // 独立工作区 + 独立分支（D01/D02）。
    expect(a.worktreePath).toBeTruthy();
    expect(b.worktreePath).toBeTruthy();
    expect(a.worktreePath).not.toBe(b.worktreePath);
    expect(a.branch).not.toBe(b.branch);
    // 同名文件 README 各改各的，互不可见（隔离的核心证据）。
    const ra = fs.readFileSync(path.join(a.worktreePath!, "README.md"), "utf8");
    const rb = fs.readFileSync(path.join(b.worktreePath!, "README.md"), "utf8");
    expect(ra).toContain("CLAUDE was here");
    expect(ra).not.toContain("CODEX");
    expect(rb).toContain("CODEX was here");
    expect(rb).not.toContain("CLAUDE");
    expect(fs.existsSync(path.join(a.worktreePath!, "CLAUDE.txt"))).toBe(true);
    expect(fs.existsSync(path.join(a.worktreePath!, "CODEX.txt"))).toBe(false); // 对方的产物不在自己区
    // 主工作区零污染。
    expect(fs.readFileSync(path.join(root, "README.md"), "utf8")).not.toMatch(/was here/);
    // D03 baseCommit：两者都指向主仓库起点 commit。
    const headSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    expect(a.baseCommit).toBe(headSha);
    expect(b.baseCommit).toBe(headSha);

    core.close();
  });

  it("mission launch fans out parallel isolated workers for explicit agents", async () => {
    const resolver = (h: Harness): DriverSpec => makeFakeDriver(h === "codex" ? "CODEX" : "CLAUDE");
    const { app, core } = createHubApp({ dbPath: ":memory:", driverResolver: resolver });
    const root = makeGitRepo();
    const project = (await request(app).post("/api/projects").send({ rootPath: root })).body.project;

    const res = await request(app)
      .post("/api/missions/launch")
      .send({ goal: "加用户注册", projectId: project.id, agents: ["claude-code", "codex"] });
    expect(res.status).toBe(200);
    expect(res.body.launchedRuns).toEqual(["claude-code", "codex"]);

    await waitAllTerminal(core, 2);
    const all = core.store.listAgentRuns();
    expect(all.length).toBe(2);
    expect(new Set(all.map((r) => r.worktreePath)).size).toBe(2); // 两个独立工作区
    expect(new Set(all.map((r) => r.branch)).size).toBe(2); // 两个独立分支
    expect(all.every((r) => r.status === "done")).toBe(true);

    core.close();
  });
});
