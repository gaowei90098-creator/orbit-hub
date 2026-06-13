import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";
import { CoordinationCore } from "../src/core/core.js";
import { RunManager } from "../src/hub/run-manager.js";
import { MessageRouter } from "../src/hub/message-router.js";
import type { DriverSpec, Harness } from "../src/drivers/types.js";

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
    fs.rmSync(`${d}-orbit`, { recursive: true, force: true });
  }
});

const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
function makeGitRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-mr-"));
  tmpDirs.push(dir);
  execFileSync("git", ["init", "-b", "main"], { cwd: dir, env: GIT_ENV, stdio: "ignore" });
  fs.writeFileSync(path.join(dir, "README.md"), "base\n");
  execFileSync("git", ["add", "."], { cwd: dir, env: GIT_ENV, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "init"], { cwd: dir, env: GIT_ENV, stdio: "ignore" });
  return dir;
}

// 假 driver：启动后发布 session，然后完成（可配延迟）；resume 把 message 记入 sink。
function makeDriver(tag: string, sink: { message: string }[], doneDelayMs = 0): DriverSpec {
  return {
    id: "claude-code",
    harness: "claude-code",
    async detect() {
      return { harness: "claude-code", available: true, binPath: null, version: null, loggedIn: null, hint: "" };
    },
    buildStart(input) {
      const done = `console.log(JSON.stringify({t:'done'}));`;
      const body =
        doneDelayMs > 0
          ? `console.log(JSON.stringify({t:'session',sid:'sess-${tag}'}));setTimeout(()=>{${done}},${doneDelayMs});`
          : `console.log(JSON.stringify({t:'session',sid:'sess-${tag}'}));${done}`;
      return { command: process.execPath, args: ["-e", body], cwd: input.projectPath, env: process.env };
    },
    buildResume(_sid, message, input) {
      sink.push({ message });
      return { command: process.execPath, args: ["-e", "0"], cwd: input.projectPath, env: process.env };
    },
    parseLine(line) {
      try {
        const o = JSON.parse(line) as { t: string; sid?: string };
        if (o.t === "session" && o.sid) return [{ kind: "session", sessionId: o.sid }];
        if (o.t === "done") return [{ kind: "status", status: "done", detail: "ok" }];
      } catch { /* ignore */ }
      return [];
    },
  };
}

async function waitTerminal(core: CoordinationCore, runId: string, ms = 8000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const r = core.store.getAgentRun(runId);
    if (r && ["done", "failed", "stopped"].includes(r.status)) return;
    await new Promise((res) => setTimeout(res, 25));
  }
}
const tick = (ms = 50): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn: () => unknown, ms = 4000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (fn()) return;
    await tick(20);
  }
}

describe("MessageRouter (M2.2)", () => {
  it("idle worker: resume-injects message when run is done", async () => {
    const root = makeGitRepo();
    const core = new CoordinationCore(":memory:");
    const sink: { message: string }[] = [];
    const runs = new RunManager(core, (_h: Harness) => makeDriver("W", sink));
    const router = new MessageRouter(core, runs);
    router.start();

    const agentA = core.agents.register("Claude", "claude-code");
    const agentB = core.agents.register("Worker", "claude-code");
    const runB = runs.start({ harness: "claude-code", missionId: null, taskId: null, projectId: null, taskTitle: "task", goal: "g", projectPath: root });
    // 绑定 agentId ↔ runId（模拟 adapter 注册后的 bind）
    runs.bind(runB.id, agentB.id);

    await waitTerminal(core, runB.id);
    sink.length = 0;

    core.messages.send(agentA.id, agentB.id, "hello from A");
    await tick(100);

    expect(sink.some((c) => c.message.includes("hello from A"))).toBe(true);

    router.stop();
    core.close();
  });

  it("orbit_wait: resolves immediately if there are already unread messages", async () => {
    const core = new CoordinationCore(":memory:");
    const runs = new RunManager(core);
    const router = new MessageRouter(core, runs);
    router.start();

    const agentA = core.agents.register("A", "claude-code");
    const agentB = core.agents.register("B", "claude-code");

    // 先发消息，再调用 wait
    core.messages.send(agentA.id, agentB.id, "pre-existing");

    const start = Date.now();
    await router.wait(agentB.id, 5000);
    expect(Date.now() - start).toBeLessThan(100); // 应立即返回

    router.stop();
    core.close();
  });

  it("orbit_wait: blocks then resolves when message arrives", async () => {
    const core = new CoordinationCore(":memory:");
    const runs = new RunManager(core);
    const router = new MessageRouter(core, runs);
    router.start();

    const agentA = core.agents.register("A", "claude-code");
    const agentB = core.agents.register("B", "claude-code");

    const waitPromise = router.wait(agentB.id, 5000);
    await tick(50); // 确保 waiter 已注册

    core.messages.send(agentA.id, agentB.id, "delayed msg");

    const start = Date.now();
    await waitPromise;
    expect(Date.now() - start).toBeLessThan(500); // 被唤醒，不等到超时

    const inbox = core.messages.inbox(agentB.id);
    expect(inbox.some((m) => m.content === "delayed msg")).toBe(true);

    router.stop();
    core.close();
  });

  it("orbit_wait: times out with empty when no message arrives", async () => {
    const core = new CoordinationCore(":memory:");
    const runs = new RunManager(core);
    const router = new MessageRouter(core, runs);
    router.start();

    core.agents.register("B", "claude-code");

    const start = Date.now();
    await router.wait("nonexistent-agent", 100); // 100ms 超时
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(90);
    expect(elapsed).toBeLessThan(500);

    router.stop();
    core.close();
  });

  it("sync message stops in-transit run and injects on terminal", async () => {
    const root = makeGitRepo();
    const core = new CoordinationCore(":memory:");
    const sink: { message: string }[] = [];
    // Worker 慢（500ms），消息在途中到达
    const runs = new RunManager(core, (_h: Harness) => makeDriver("SLOW", sink, 500));
    const router = new MessageRouter(core, runs);
    router.start();

    const agentA = core.agents.register("A", "claude-code");
    const agentB = core.agents.register("B", "claude-code");
    const runB = runs.start({ harness: "claude-code", missionId: null, taskId: null, projectId: null, taskTitle: "t", goal: "g", projectPath: root });
    runs.bind(runB.id, agentB.id);

    // 等 B 启动（session 已捕获，进程在跑）
    await waitFor(() => core.store.getAgentRun(runB.id)?.sessionId, 4000);
    expect(runs.isRunning(runB.id)).toBe(true);

    // 发 sync 消息（高优先级）→ 应 stop run + 在终态注入
    sink.length = 0;
    core.messages.send(agentA.id, agentB.id, "SYNC-PAYLOAD", { kind: "sync" });

    // 等 run 停止并注入
    await waitTerminal(core, runB.id, 3000);
    await tick(100);

    expect(sink.some((c) => c.message.includes("SYNC-PAYLOAD"))).toBe(true);

    router.stop();
    core.close();
  });
});
