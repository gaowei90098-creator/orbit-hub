import { describe, it, expect } from "vitest";
import { canTransition, nextStates, isTerminalState } from "../src/core/mission-state.js";
import { CoordinationCore } from "../src/core/core.js";

describe("mission state machine (B06)", () => {
  it("allows spec transitions and rejects illegal jumps", () => {
    expect(canTransition("draft", "planning")).toBe(true);
    expect(canTransition("preparing_workspaces", "running")).toBe(true);
    expect(canTransition("running", "synchronization_required")).toBe(true);
    expect(canTransition("synchronization_required", "running")).toBe(true);
    // 非法：跳过中间态 / 从终态出发。
    expect(canTransition("draft", "running")).toBe(false);
    expect(canTransition("completed", "running")).toBe(false);
    expect(canTransition("cancelled", "running")).toBe(false);
  });

  it("treats same-state transitions as idempotent", () => {
    expect(canTransition("running", "running")).toBe(true);
  });

  it("exposes terminal states and next states", () => {
    expect(isTerminalState("completed")).toBe(true);
    expect(isTerminalState("cancelled")).toBe(true);
    expect(isTerminalState("running")).toBe(false);
    expect(nextStates("running")).toContain("synchronization_required");
    expect(nextStates("completed")).toHaveLength(0);
  });

  it("starts a mission in draft and rejects illegal domain transitions", () => {
    const core = new CoordinationCore(":memory:");
    const m = core.missions.create({ goal: "建注册" });
    expect(m.state).toBe("draft");
    // draft → running 非法（必须经过中间态）。
    const bad = core.missions.transition(m.id, "running");
    expect(bad.ok).toBe(false);
    expect(bad.reason).toBe("illegal_transition");
    expect(core.missions.get(m.id)!.state).toBe("draft"); // 未改变
    // 合法单步。
    expect(core.missions.transition(m.id, "planning").ok).toBe(true);
    expect(core.missions.get(m.id)!.state).toBe("planning");
    core.close();
  });

  it("markRunning advances draft → running through the legal path", () => {
    const core = new CoordinationCore(":memory:");
    const m = core.missions.create({ goal: "x" });
    core.missions.markRunning(m.id);
    expect(core.missions.get(m.id)!.state).toBe("running");
    core.close();
  });

  it("can transition running ↔ synchronization_required", () => {
    const core = new CoordinationCore(":memory:");
    const m = core.missions.create({ goal: "x" });
    core.missions.markRunning(m.id);
    expect(core.missions.transition(m.id, "synchronization_required").ok).toBe(true);
    expect(core.missions.transition(m.id, "running").ok).toBe(true);
    expect(core.missions.get(m.id)!.state).toBe("running");
    core.close();
  });
});
