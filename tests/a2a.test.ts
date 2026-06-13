import { describe, it, expect } from "vitest";
import {
  validateRpc,
  extractMessageText,
  missionStateToA2A,
  buildTask,
} from "../src/hub/a2a.js";
import type { Mission, Task } from "../src/core/types.js";

function mission(over: Partial<Mission> = {}): Mission {
  return {
    id: "ms1",
    goal: "加用户注册",
    projectId: null,
    projectPath: "/p",
    status: "active",
    state: "running",
    taskIds: [],
    worktrees: [],
    createdBy: null,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  } as Mission;
}

describe("validateRpc", () => {
  it("accepts a well-formed JSON-RPC request", () => {
    expect(validateRpc({ jsonrpc: "2.0", id: 1, method: "message/send" })).toBeNull();
  });
  it("rejects wrong version / missing method / non-object", () => {
    expect(validateRpc({ jsonrpc: "1.0", method: "x" })).toContain("2.0");
    expect(validateRpc({ jsonrpc: "2.0" })).toContain("method");
    expect(validateRpc(null)).toContain("object");
  });
});

describe("extractMessageText", () => {
  it("concatenates text parts and trims", () => {
    const params = { message: { parts: [{ kind: "text", text: " 实现登录 " }, { kind: "text", text: "加测试" }] } };
    expect(extractMessageText(params)).toBe("实现登录\n加测试");
  });
  it("treats missing kind as text and ignores non-text parts", () => {
    const params = { message: { parts: [{ text: "裸文本" }, { kind: "file", text: "ignored" }] } };
    expect(extractMessageText(params)).toBe("裸文本");
  });
  it("returns empty string when there is no message", () => {
    expect(extractMessageText(undefined)).toBe("");
    expect(extractMessageText({})).toBe("");
  });
});

describe("missionStateToA2A", () => {
  it("maps terminal and in-progress states", () => {
    expect(missionStateToA2A("completed")).toBe("completed");
    expect(missionStateToA2A("failed")).toBe("failed");
    expect(missionStateToA2A("cancelled")).toBe("canceled");
    expect(missionStateToA2A("running")).toBe("working");
    expect(missionStateToA2A("integrating")).toBe("working");
    expect(missionStateToA2A("draft")).toBe("submitted");
    expect(missionStateToA2A(undefined)).toBe("submitted");
    expect(missionStateToA2A("awaiting_final_approval")).toBe("input-required");
  });
});

describe("buildTask", () => {
  it("maps a mission + tasks into an A2A task", () => {
    const tasks = [{ id: "t1" } as Task, { id: "t2" } as Task];
    const task = buildTask(mission({ state: "running" }), tasks);
    expect(task.id).toBe("ms1");
    expect(task.contextId).toBe("ms1");
    expect(task.status.state).toBe("working");
    expect(task.metadata).toEqual({ goal: "加用户注册", taskCount: 2 });
    expect(typeof task.status.timestamp).toBe("string");
  });
});
