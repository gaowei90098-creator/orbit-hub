import { describe, it, expect } from "vitest";
import { buildTimeline, detectDecisions, STALL_AFTER_MS, type TimelineInput } from "./timeline";
import type { Agent, Conflict, Contract, Message, Mission, Task, Worker } from "../types";

const T0 = 1_000_000;

function agent(over: Partial<Agent> = {}): Agent {
  return {
    id: "a1",
    name: "A1",
    harness: "claude-code",
    status: "online",
    currentTaskId: null,
    lastSeen: T0,
    role: null,
    principal: "本机",
    ...over,
  };
}

function task(over: Partial<Task> = {}): Task {
  return {
    id: "t1",
    title: "任务一",
    description: "",
    status: "in_progress",
    assignee: null,
    dependsOn: [],
    files: [],
    note: "",
    updatedAt: T0,
    ...over,
  };
}

function message(over: Partial<Message> = {}): Message {
  return { id: "m1", from: "a1", to: "all", content: "hi", ts: T0, ...over };
}

function worker(over: Partial<Worker> = {}): Worker {
  return {
    id: "w1",
    missionId: null,
    taskId: null,
    taskTitle: "Build",
    harness: "codex",
    status: "running",
    projectPath: "/p",
    lastActivity: "working",
    error: "",
    costUsd: 0,
    startedAt: T0,
    updatedAt: T0,
    ...over,
  };
}

function conflict(over: Partial<Conflict> = {}): Conflict {
  return {
    id: "c1",
    kind: "file",
    resource: "src/x.ts",
    intentIds: [],
    agentIds: [],
    status: "open",
    resolution: "",
    resolvedBy: null,
    createdAt: T0,
    resolvedAt: null,
    ...over,
  };
}

const EMPTY_CONTRACT: Contract = { apiContract: "", designSpec: "", version: 0, updatedBy: null, updatedAt: 0 };

function input(over: Partial<TimelineInput> = {}): TimelineInput {
  return {
    tasks: [],
    messages: [],
    workers: [],
    conflicts: [],
    contract: EMPTY_CONTRACT,
    missions: [],
    agents: [],
    locks: [],
    now: T0,
    ...over,
  };
}

describe("buildTimeline", () => {
  it("把多源事件合并并按时间倒序", () => {
    const events = buildTimeline(
      input({
        tasks: [task({ id: "t1", updatedAt: T0 + 100 })],
        messages: [message({ id: "m1", ts: T0 + 300 })],
        workers: [worker({ id: "w1", updatedAt: T0 + 200 })],
      }),
    );
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.kind)).toEqual(["message", "worker", "task"]);
    expect(events[0]!.ts).toBeGreaterThan(events[1]!.ts);
  });

  it("契约 version=0 不进时间线，>0 才进", () => {
    expect(buildTimeline(input({ contract: EMPTY_CONTRACT }))).toHaveLength(0);
    const withContract = buildTimeline(
      input({ contract: { apiContract: "GET /x", designSpec: "", version: 2, updatedBy: "a1", updatedAt: T0 } }),
    );
    expect(withContract).toHaveLength(1);
    expect(withContract[0]!.title).toContain("v2");
  });

  it("任务事件标题带状态、负责人解析为角色助手名", () => {
    const events = buildTimeline(
      input({
        tasks: [task({ status: "done", assignee: "a1" })],
        agents: [agent({ id: "a1", role: "前端" })],
      }),
    );
    expect(events[0]!.title).toContain("已完成");
    expect(events[0]!.detail).toContain("前端助手");
  });

  it("limit 截断", () => {
    const tasks = Array.from({ length: 10 }, (_, i) => task({ id: `t${i}`, updatedAt: T0 + i }));
    expect(buildTimeline(input({ tasks }), 5)).toHaveLength(5);
  });

  it("P2: sync/question 消息带前缀与色调，normal 不带", () => {
    const sync = buildTimeline(input({ messages: [message({ id: "s", kind: "sync" })] }))[0]!;
    expect(sync.title).toContain("接口同步");
    expect(sync.tone).toBe("info");
    const question = buildTimeline(input({ messages: [message({ id: "q", kind: "question" })] }))[0]!;
    expect(question.title).toContain("提问");
    expect(question.tone).toBe("warning");
    const normal = buildTimeline(input({ messages: [message({ id: "n", kind: "normal" })] }))[0]!;
    expect(normal.title).not.toContain("·");
    expect(normal.tone).toBe("neutral");
    const conflict = buildTimeline(input({ messages: [message({ id: "c", kind: "conflict" })] }))[0]!;
    expect(conflict.title).toContain("冲突");
    expect(conflict.tone).toBe("danger");
  });
});

describe("detectDecisions", () => {
  it("worker 等待输入 → worker_waiting", () => {
    const d = detectDecisions(input({ workers: [worker({ status: "waiting_for_input" })] }));
    expect(d).toHaveLength(1);
    expect(d[0]!.kind).toBe("worker_waiting");
    expect(d[0]!.runId).toBe("w1");
  });

  it("开放冲突 → conflict；已解决冲突不计", () => {
    expect(detectDecisions(input({ conflicts: [conflict({ status: "open" })] }))[0]!.kind).toBe("conflict");
    expect(detectDecisions(input({ conflicts: [conflict({ status: "resolved" })] }))).toHaveLength(0);
  });

  it("负责人离线 → assignee_offline", () => {
    const d = detectDecisions(
      input({
        tasks: [task({ status: "in_progress", assignee: "a1" })],
        agents: [agent({ id: "a1", status: "offline" })],
      }),
    );
    expect(d).toHaveLength(1);
    expect(d[0]!.kind).toBe("assignee_offline");
  });

  it("已领取且超时无活 worker → task_stalled", () => {
    const d = detectDecisions(
      input({
        tasks: [task({ status: "claimed", assignee: "a1", updatedAt: T0 - STALL_AFTER_MS - 1 })],
        agents: [agent({ id: "a1", status: "online" })],
        now: T0,
      }),
    );
    expect(d.map((x) => x.kind)).toContain("task_stalled");
  });

  it("有活跃 worker 接管的任务不算停滞", () => {
    const d = detectDecisions(
      input({
        tasks: [task({ id: "t1", status: "in_progress", assignee: "a1", updatedAt: T0 - STALL_AFTER_MS - 1 })],
        workers: [worker({ taskId: "t1", status: "running" })],
        agents: [agent({ id: "a1", status: "online" })],
        now: T0,
      }),
    );
    expect(d.map((x) => x.kind)).not.toContain("task_stalled");
  });

  it("最近更新的任务不算停滞", () => {
    const d = detectDecisions(
      input({
        tasks: [task({ status: "claimed", assignee: "a1", updatedAt: T0 - 1000 })],
        agents: [agent({ id: "a1", status: "online" })],
        now: T0,
      }),
    );
    expect(d).toHaveLength(0);
  });
});
