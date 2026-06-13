import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { CoordinationCore } from "../src/core/core.js";
import { Supervisor, buildStallAlert, SUPERVISOR_SENDER } from "../src/hub/supervisor.js";
import type { RunManager } from "../src/hub/run-manager.js";
import type { AgentRun, RunStatus } from "../src/core/types.js";

const NOW = 10_000_000;
const STALL = 5 * 60_000;

function run(over: Partial<AgentRun> = {}): AgentRun {
  return {
    id: "run1",
    missionId: "ms1",
    taskId: null,
    projectId: null,
    agentId: null,
    driver: "claude-code" as AgentRun["driver"],
    harness: "claude-code",
    sessionId: "sess",
    pid: null,
    worktreePath: null,
    branch: null,
    baseCommit: null,
    status: "running" as RunStatus,
    errorCode: null,
    costUsd: 0,
    lastActivity: "working",
    error: "",
    taskTitle: "后端",
    projectPath: "/p",
    startedAt: NOW - 30 * 60_000,
    updatedAt: NOW,
    ...over,
  };
}

// 最小 RunManager 替身：Supervisor 只用到 list() 与 resume()。
function fakeRuns(list: AgentRun[], onResume?: (id: string, msg: string) => void): RunManager {
  return {
    list: () => list,
    resume: (id: string, msg: string) => {
      onResume?.(id, msg);
      return { ok: true };
    },
  } as unknown as RunManager;
}

let core: CoordinationCore;

beforeEach(() => {
  core = new CoordinationCore(":memory:");
});
afterEach(() => {
  core.close();
});

describe("Supervisor.scan", () => {
  it("alerts once for a worker waiting on input and binds the message to its mission", () => {
    const sup = new Supervisor(core, fakeRuns([run({ status: "waiting_for_input", updatedAt: NOW })]), { stallMs: STALL });
    const fresh = sup.scan(NOW + 1000);
    expect(fresh.map((r) => r.id)).toEqual(["run1"]);

    const msgs = core.messages.recent(10);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.from).toBe(SUPERVISOR_SENDER);
    expect(msgs[0]!.to).toBe("all");
    expect(msgs[0]!.missionId).toBe("ms1");
    expect(msgs[0]!.content).toContain("等待输入");
  });

  it("does not re-alert while the same stall persists (dedup by updatedAt)", () => {
    const r = run({ status: "running", updatedAt: NOW - STALL - 1 });
    const sup = new Supervisor(core, fakeRuns([r]), { stallMs: STALL });
    expect(sup.scan(NOW)).toHaveLength(1);
    expect(sup.scan(NOW + 60_000)).toHaveLength(0); // 同一段停滞，不重复告警
    expect(core.messages.recent(10)).toHaveLength(1);
  });

  it("re-alerts after the worker had new activity and then stalled again", () => {
    const r = run({ status: "running", updatedAt: NOW - STALL - 1 });
    const list = [r];
    const sup = new Supervisor(core, fakeRuns(list), { stallMs: STALL });
    expect(sup.scan(NOW)).toHaveLength(1);
    // 有了新活动（updatedAt 前移），随后又停滞 → 视为新一段停滞，应再次告警。
    list[0] = run({ status: "running", updatedAt: NOW + 60_000 });
    expect(sup.scan(NOW + 60_000 + STALL + 1)).toHaveLength(1);
    expect(core.messages.recent(10)).toHaveLength(2);
  });

  it("ignores fresh, done and stopped workers", () => {
    const sup = new Supervisor(
      core,
      fakeRuns([
        run({ id: "fresh", status: "running", updatedAt: NOW }),
        run({ id: "done", status: "done", updatedAt: NOW - 99 * 60_000 }),
        run({ id: "stopped", status: "stopped", updatedAt: NOW - 99 * 60_000 }),
      ]),
      { stallMs: STALL },
    );
    expect(sup.scan(NOW)).toEqual([]);
    expect(core.messages.recent(10)).toHaveLength(0);
  });

  it("auto-rescues stalled workers when enabled", () => {
    const resumed: string[] = [];
    const sup = new Supervisor(
      core,
      fakeRuns([run({ status: "failed", updatedAt: NOW })], (id) => resumed.push(id)),
      { stallMs: STALL, autoRescue: true },
    );
    sup.scan(NOW);
    expect(resumed).toEqual(["run1"]);
  });
});

describe("buildStallAlert", () => {
  it("phrases the alert per status", () => {
    expect(buildStallAlert(run({ status: "waiting_for_input" }), NOW)).toContain("等待输入");
    expect(buildStallAlert(run({ status: "failed", error: "boom" }), NOW)).toContain("执行失败");
    expect(buildStallAlert(run({ status: "running", updatedAt: NOW - 7 * 60_000 }), NOW)).toContain("无活动");
  });
});
