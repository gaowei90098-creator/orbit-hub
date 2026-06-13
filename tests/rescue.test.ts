import { describe, it, expect } from "vitest";
import { needsRescue, selectRescueTargets, buildRescuePrompt, RESCUE_STALL_MS } from "../src/hub/rescue.js";
import type { AgentRun, RunStatus } from "../src/core/types.js";

const NOW = 10_000_000;

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
    startedAt: NOW - 10 * 60_000,
    updatedAt: NOW,
    ...over,
  };
}

describe("needsRescue", () => {
  it("always rescues a worker waiting for input regardless of age", () => {
    expect(needsRescue(run({ status: "waiting_for_input", updatedAt: NOW }), NOW, RESCUE_STALL_MS)).toBe(true);
  });

  it("always rescues a failed worker", () => {
    expect(needsRescue(run({ status: "failed", updatedAt: NOW }), NOW, RESCUE_STALL_MS)).toBe(true);
  });

  it("rescues a running worker only once it is stale past the threshold", () => {
    expect(needsRescue(run({ status: "running", updatedAt: NOW - 1000 }), NOW, RESCUE_STALL_MS)).toBe(false);
    expect(needsRescue(run({ status: "running", updatedAt: NOW - RESCUE_STALL_MS - 1 }), NOW, RESCUE_STALL_MS)).toBe(true);
  });

  it("treats a stale starting worker the same as running", () => {
    expect(needsRescue(run({ status: "starting", updatedAt: NOW - RESCUE_STALL_MS - 1 }), NOW, RESCUE_STALL_MS)).toBe(true);
  });

  it("never rescues done or user-stopped workers", () => {
    expect(needsRescue(run({ status: "done", updatedAt: NOW - 99 * 60_000 }), NOW, RESCUE_STALL_MS)).toBe(false);
    expect(needsRescue(run({ status: "stopped", updatedAt: NOW - 99 * 60_000 }), NOW, RESCUE_STALL_MS)).toBe(false);
  });
});

describe("selectRescueTargets", () => {
  it("picks stuck workers and orders the most-stalled first", () => {
    const fresh = run({ id: "fresh", status: "running", updatedAt: NOW });
    const waiting = run({ id: "waiting", status: "waiting_for_input", updatedAt: NOW - 2000 });
    const staleRunning = run({ id: "stale", status: "running", updatedAt: NOW - RESCUE_STALL_MS - 5000 });
    const done = run({ id: "done", status: "done", updatedAt: NOW - 60_000 });

    const targets = selectRescueTargets([fresh, waiting, staleRunning, done], NOW, RESCUE_STALL_MS);
    expect(targets.map((t) => t.id)).toEqual(["stale", "waiting"]); // 最久没动的排前面，fresh/done 排除
  });

  it("returns empty when nothing is stuck", () => {
    expect(selectRescueTargets([run({ status: "running", updatedAt: NOW })], NOW, RESCUE_STALL_MS)).toEqual([]);
  });
});

describe("buildRescuePrompt", () => {
  it("asks the worker to report progress and use send_message when blocked", () => {
    const p = buildRescuePrompt();
    expect(p).toContain("报告");
    expect(p).toContain("send_message");
  });
});
