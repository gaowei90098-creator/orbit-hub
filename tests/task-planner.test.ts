import { describe, it, expect } from "vitest";
import { assignDraftsToAgents } from "../src/hub/task-planner.js";
import type { Agent, Harness, AgentStatus } from "../src/core/types.js";
import type { TaskDraft } from "../src/hub/task-planner.js";

// assignDraftsToAgents 的契约：只认操作员显式指派的角色，不按厂商（codex/claude）推断方向；
// 未被角色固定的 Agent 轮流接任务，避免「有 Agent 在线却没人领」。

let seq = 0;
function agent(over: Partial<Agent> = {}): Agent {
  seq += 1;
  return {
    id: over.id ?? `a${seq}`,
    name: over.name ?? `A${seq}`,
    harness: over.harness ?? ("claude-code" as Harness),
    status: over.status ?? ("online" as AgentStatus),
    currentTaskId: null,
    registeredAt: 0,
    lastSeen: 0,
    role: over.role ?? null,
    principal: "本机",
    ...over,
  };
}

function draft(area: TaskDraft["area"]): TaskDraft {
  return {
    title: `t-${area}`,
    description: "",
    area,
    files: [],
    fileScope: [],
    doneWhen: "",
    verifyCommand: "",
    interfaceRef: "",
  };
}

describe("assignDraftsToAgents", () => {
  it("不按厂商推断方向：无角色时 codex 也能接后端、claude 也能接前端", () => {
    const claude = agent({ id: "claude", harness: "claude-code" as Harness });
    const codex = agent({ id: "codex", harness: "codex" as Harness });
    // 旧逻辑会强制 codex→前端、claude→后端；新逻辑按在线顺序轮流。
    const out = assignDraftsToAgents([draft("frontend"), draft("backend")], [claude, codex]);
    expect(out[0]!.assignee).toBe("claude");
    expect(out[1]!.assignee).toBe("codex");
  });

  it("显式角色仍然固定方向", () => {
    const be = agent({ id: "be", role: "后端" });
    const fe = agent({ id: "fe", role: "前端" });
    const out = assignDraftsToAgents([draft("frontend"), draft("backend")], [be, fe]);
    expect(out[0]!.assignee).toBe("fe");
    expect(out[1]!.assignee).toBe("be");
  });

  it("未固定的 Agent 轮流接任务", () => {
    const a = agent({ id: "x" });
    const b = agent({ id: "y" });
    const c = agent({ id: "z" });
    const out = assignDraftsToAgents(
      [draft("general"), draft("general"), draft("general"), draft("general")],
      [a, b, c],
    );
    expect(out.map((d) => d.assignee)).toEqual(["x", "y", "z", "x"]);
  });

  it("全部被角色固定时，general 任务仍在所有在线 Agent 间轮流而非无人领", () => {
    const fe = agent({ id: "fe", role: "前端" });
    const be = agent({ id: "be", role: "后端" });
    const out = assignDraftsToAgents([draft("general"), draft("general")], [fe, be]);
    expect(out[0]!.assignee).toBe("fe");
    expect(out[1]!.assignee).toBe("be");
  });

  it("离线 Agent 与 operator(other) 不参与分配", () => {
    const online = agent({ id: "on", status: "online" as AgentStatus });
    const offline = agent({ id: "off", status: "offline" as AgentStatus });
    const operator = agent({ id: "op", harness: "other" as Harness });
    const out = assignDraftsToAgents([draft("general")], [offline, operator, online]);
    expect(out[0]!.assignee).toBe("on");
  });

  it("无在线 Agent 时分配为 null（任务挂在板上待认领）", () => {
    const out = assignDraftsToAgents([draft("frontend"), draft("general")], []);
    expect(out[0]!.assignee).toBeNull();
    expect(out[1]!.assignee).toBeNull();
  });
});
