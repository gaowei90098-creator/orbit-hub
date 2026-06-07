import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";
import { CoordinationCore } from "../src/core/core.js";
import { RunManager } from "../src/hub/run-manager.js";
import { Coordinator, buildSyncMessage } from "../src/hub/coordinator.js";
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-coord-"));
  tmpDirs.push(dir);
  execFileSync("git", ["init", "-b", "main"], { cwd: dir, env: GIT_ENV, stdio: "ignore" });
  fs.writeFileSync(path.join(dir, "README.md"), "base\n");
  execFileSync("git", ["add", "."], { cwd: dir, env: GIT_ENV, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "init"], { cwd: dir, env: GIT_ENV, stdio: "ignore" });
  return dir;
}

// 假 worker：开局打印 session（运行中即可捕获），完成时打印 done。可配延迟模拟"还在忙"。
// buildResume 把注入的 message 记到 sink —— 直接验证"注入到了另一 Agent 的会话"。
function makeDriver(tag: string, sink: { message: string }[], doneDelayMs = 0): DriverSpec {
  return {
    id: "claude-code",
    harness: "claude-code",
    async detect() {
      return { harness: "claude-code", available: true, binPath: null, version: null, loggedIn: null, hint: "" };
    },
    buildStart(input) {
      const done = `fs.writeFileSync('${tag}.txt','x');console.log(JSON.stringify({t:'done'}));`;
      const body =
        doneDelayMs > 0
          ? `console.log(JSON.stringify({t:'session',sid:'sess-${tag}'}));setTimeout(()=>{${done}},${doneDelayMs});`
          : `console.log(JSON.stringify({t:'session',sid:'sess-${tag}'}));${done}`;
      return { command: process.execPath, args: ["-e", `const fs=require('fs');${body}`], cwd: input.projectPath, env: process.env };
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
      } catch {
        /* ignore */
      }
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

describe("buildSyncMessage", () => {
  it("formats the contract into a sync instruction", () => {
    const msg = buildSyncMessage({ apiContract: "POST /api/register", designSpec: "", version: 3, updatedBy: "a", updatedAt: 0 });
    expect(msg).toContain("v3");
    expect(msg).toContain("POST /api/register");
    expect(msg).toContain("同步");
  });
});

describe("Coordinator 阶段同步 (E02/E04 · 第三阶段验收)", () => {
  it("auto-injects the updated contract into the other agent's session", async () => {
    const root = makeGitRepo();
    const core = new CoordinationCore(":memory:");
    const sink: { message: string }[] = [];
    const resolver = (h: Harness): DriverSpec => makeDriver(h === "codex" ? "CODEX" : "CLAUDE", sink);
    const runs = new RunManager(core, resolver);
    const coord = new Coordinator(core, runs);
    coord.start();

    const mission = core.missions.create({ goal: "加用户注册", projectPath: root });
    core.missions.markRunning(mission.id);
    const rA = runs.start({ harness: "claude-code", missionId: mission.id, taskId: "be", projectId: null, taskTitle: "后端", goal: "g", projectPath: root });
    const rB = runs.start({ harness: "codex", missionId: mission.id, taskId: "fe", projectId: null, taskTitle: "前端", goal: "g", projectPath: root });
    await Promise.all([waitTerminal(core, rA.id), waitTerminal(core, rB.id)]);
    // 两个 Agent 都跑完并各自捕获了 session（C04/C05 前提）。
    expect(core.store.getAgentRun(rA.id)!.sessionId).toBeTruthy();
    expect(core.store.getAgentRun(rB.id)!.sessionId).toBeTruthy();

    sink.length = 0;
    // 后端 Agent 更新接口契约 → Coordinator 自动注入（无需任何人主动读收件箱）。
    core.contract.update("backend", { apiContract: "POST /api/register {email,password}" });
    await tick();

    // 接口变更被注入到了 Agent 的会话里（完成标准）。
    expect(sink.some((c) => c.message.includes("POST /api/register"))).toBe(true);
    // mission 进入同步态，注入完成后回到 running。
    await tick(80);
    expect(core.missions.get(mission.id)!.state).toBe("running");

    coord.stop();
    core.close();
  });

  it("queues injection while the target agent is busy, then flushes on completion", async () => {
    const root = makeGitRepo();
    const core = new CoordinationCore(":memory:");
    const sink: { message: string }[] = [];
    // 后端快速完成；前端（codex）慢——更新契约时仍在忙。
    const resolver = (h: Harness): DriverSpec =>
      h === "codex" ? makeDriver("CODEX", sink, 600) : makeDriver("CLAUDE", sink);
    const runs = new RunManager(core, resolver);
    const coord = new Coordinator(core, runs);
    coord.start();

    const mission = core.missions.create({ goal: "x", projectPath: root });
    core.missions.markRunning(mission.id);
    const rA = runs.start({ harness: "claude-code", missionId: mission.id, taskId: "be", projectId: null, taskTitle: "后端", goal: "g", projectPath: root });
    const rB = runs.start({ harness: "codex", missionId: mission.id, taskId: "fe", projectId: null, taskTitle: "前端", goal: "g", projectPath: root });
    await waitTerminal(core, rA.id); // A 先完成，B 仍在忙
    await waitFor(() => core.store.getAgentRun(rB.id)?.sessionId); // 等 B 运行中捕获 session
    expect(core.store.getAgentRun(rB.id)!.sessionId).toBeTruthy();
    expect(runs.isRunning(rB.id)).toBe(true); // B 确实仍在忙

    sink.length = 0;
    // 显式同步（排除已完成的 A），只针对仍在忙的 B：应进入排队，不立即注入。
    const res = coord.syncMission(mission.id, "SYNC-MSG-XYZ", rA.id);
    expect(res.queued).toContain(rB.id);
    expect(res.injected).toEqual([]);
    expect(core.missions.get(mission.id)!.state).toBe("synchronization_required");
    expect(sink.length).toBe(0); // 还没注入

    // B 跑完 → 自动把排队的注入冲刷出去，mission 回到 running。
    await waitTerminal(core, rB.id);
    await tick(80);
    expect(sink.some((c) => c.message === "SYNC-MSG-XYZ")).toBe(true);
    expect(core.missions.get(mission.id)!.state).toBe("running");

    coord.stop();
    core.close();
  });
});
