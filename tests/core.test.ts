import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { CoordinationCore } from "../src/core/core.js";

let core: CoordinationCore;

beforeEach(() => {
  core = new CoordinationCore(":memory:");
});
afterEach(() => {
  core.close();
});

describe("agents", () => {
  it("registers a new agent online", () => {
    const a = core.agents.register("Claude", "claude-code");
    expect(a.status).toBe("online");
    expect(a.name).toBe("Claude");
    expect(core.agents.list()).toHaveLength(1);
  });

  it("is idempotent by name (reconnect reuses id)", () => {
    const first = core.agents.register("Claude", "claude-code");
    const second = core.agents.register("Claude", "codex");
    expect(second.id).toBe(first.id);
    expect(second.harness).toBe("codex");
    expect(core.agents.list()).toHaveLength(1);
  });

  it("heartbeat keeps agent online, returns null for unknown id", () => {
    const a = core.agents.register("Claude", "claude-code");
    expect(core.agents.heartbeat(a.id)?.status).toBe("online");
    expect(core.agents.heartbeat("nope")).toBeNull();
  });

  it("reap marks stale agents offline and releases their locks", () => {
    const a = core.agents.register("Claude", "claude-code");
    core.locks.acquire(a.id, ["src/app.ts"]);
    // backdate last heartbeat past the ttl
    core.store.setAgentStatus(a.id, "online", Date.now() - 10_000);

    const { offline, releasedLocks } = core.agents.reap(5_000);
    expect(offline.map((x) => x.id)).toContain(a.id);
    expect(releasedLocks).toContain("src/app.ts");
    expect(core.agents.get(a.id)?.status).toBe("offline");
    expect(core.locks.list()).toHaveLength(0);
  });
});

describe("messages", () => {
  it("delivers a direct message to the recipient only", () => {
    const a = core.agents.register("A", "claude-code");
    const b = core.agents.register("B", "codex");
    core.messages.send(a.id, b.id, "hello B");
    expect(core.messages.inbox(b.id).map((m) => m.content)).toEqual(["hello B"]);
    expect(core.messages.inbox(a.id)).toHaveLength(0);
  });

  it("broadcast reaches others but not the sender", () => {
    const a = core.agents.register("A", "claude-code");
    const b = core.agents.register("B", "codex");
    core.messages.send(a.id, "all", "team update");
    expect(core.messages.inbox(b.id)).toHaveLength(1);
    expect(core.messages.inbox(a.id)).toHaveLength(0);
  });

  it("inbox marks messages read so they are not redelivered", () => {
    const a = core.agents.register("A", "claude-code");
    const b = core.agents.register("B", "codex");
    core.messages.send(a.id, b.id, "once");
    expect(core.messages.inbox(b.id)).toHaveLength(1);
    expect(core.messages.inbox(b.id)).toHaveLength(0);
  });

  it("recent returns the full log regardless of read state", () => {
    const a = core.agents.register("A", "claude-code");
    const b = core.agents.register("B", "codex");
    core.messages.send(a.id, b.id, "m1");
    core.messages.inbox(b.id);
    expect(core.messages.recent(10)).toHaveLength(1);
  });
});

describe("tasks", () => {
  it("creates and lists tasks, filtered by status", () => {
    core.tasks.create({ title: "T1" });
    core.tasks.create({ title: "T2" });
    expect(core.tasks.list()).toHaveLength(2);
    expect(core.tasks.list("todo")).toHaveLength(2);
    expect(core.tasks.list("done")).toHaveLength(0);
  });

  it("claim succeeds and sets the agent's current task", () => {
    const a = core.agents.register("A", "claude-code");
    const t = core.tasks.create({ title: "T1" });
    const res = core.tasks.claim(t.id, a.id);
    expect(res.ok).toBe(true);
    expect(core.agents.get(a.id)?.currentTaskId).toBe(t.id);
  });

  it("a second claim loses atomically and learns who holds it", () => {
    const a = core.agents.register("A", "claude-code");
    const b = core.agents.register("B", "codex");
    const t = core.tasks.create({ title: "T1" });
    const first = core.tasks.claim(t.id, a.id);
    const second = core.tasks.claim(t.id, b.id);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.reason).toBe("already_claimed");
      expect(second.heldBy?.id).toBe(a.id);
    }
  });

  it("claim is blocked until dependencies are done", () => {
    const a = core.agents.register("A", "claude-code");
    const dep = core.tasks.create({ title: "dep" });
    const t = core.tasks.create({ title: "main", dependsOn: [dep.id] });

    const blocked = core.tasks.claim(t.id, a.id);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.reason).toBe("blocked");

    core.tasks.claim(dep.id, a.id);
    core.tasks.update(dep.id, { status: "done" });
    expect(core.tasks.claim(t.id, a.id).ok).toBe(true);
  });

  it("claim of a missing task returns not_found", () => {
    const a = core.agents.register("A", "claude-code");
    const res = core.tasks.claim("missing", a.id);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("not_found");
  });

  it("marking done clears the assignee's current task pointer", () => {
    const a = core.agents.register("A", "claude-code");
    const t = core.tasks.create({ title: "T1" });
    core.tasks.claim(t.id, a.id);
    core.tasks.update(t.id, { status: "in_progress" });
    expect(core.agents.get(a.id)?.currentTaskId).toBe(t.id);
    core.tasks.update(t.id, { status: "done" });
    expect(core.agents.get(a.id)?.currentTaskId).toBeNull();
  });

  it("release returns a task to the pool", () => {
    const a = core.agents.register("A", "claude-code");
    const t = core.tasks.create({ title: "T1" });
    core.tasks.claim(t.id, a.id);
    const released = core.tasks.release(t.id);
    expect(released?.status).toBe("todo");
    expect(released?.assignee).toBeNull();
    expect(core.agents.get(a.id)?.currentTaskId).toBeNull();
  });

  it("update of a missing task returns null", () => {
    expect(core.tasks.update("missing", { status: "done" })).toBeNull();
    expect(core.tasks.release("missing")).toBeNull();
  });

  it("operator assign hands a task directly to an agent", () => {
    const a = core.agents.register("A", "claude-code");
    const t = core.tasks.create({ title: "T1" });
    const assigned = core.tasks.assign(t.id, a.id);
    expect(assigned?.assignee).toBe(a.id);
    expect(assigned?.status).toBe("claimed");
    expect(core.agents.get(a.id)?.currentTaskId).toBe(t.id);
    expect(core.tasks.assign("missing", a.id)).toBeNull();
  });
});

describe("locks", () => {
  it("grants an unheld path and reports conflicts for held ones", () => {
    const a = core.agents.register("A", "claude-code");
    const b = core.agents.register("B", "codex");
    expect(core.locks.acquire(a.id, ["src/api.ts"]).granted).toEqual(["src/api.ts"]);

    const res = core.locks.acquire(b.id, ["src/api.ts", "src/ui.ts"]);
    expect(res.granted).toEqual(["src/ui.ts"]);
    expect(res.conflicts).toHaveLength(1);
    expect(res.conflicts[0]?.path).toBe("src/api.ts");
    expect(res.conflicts[0]?.heldBy?.id).toBe(a.id);
  });

  it("re-acquiring your own lock is a no-op grant", () => {
    const a = core.agents.register("A", "claude-code");
    core.locks.acquire(a.id, ["src/api.ts"]);
    expect(core.locks.acquire(a.id, ["src/api.ts"]).granted).toEqual(["src/api.ts"]);
    expect(core.locks.list()).toHaveLength(1);
  });

  it("release only frees locks held by the caller", () => {
    const a = core.agents.register("A", "claude-code");
    const b = core.agents.register("B", "codex");
    core.locks.acquire(a.id, ["src/api.ts"]);
    expect(core.locks.release(b.id, ["src/api.ts"])).toEqual([]); // not yours
    expect(core.locks.release(a.id, ["src/api.ts"])).toEqual(["src/api.ts"]);
    expect(core.locks.list()).toHaveLength(0);
  });

  it("check reports lock status per path", () => {
    const a = core.agents.register("A", "claude-code");
    core.locks.acquire(a.id, ["src/api.ts"]);
    const status = core.locks.check(["src/api.ts", "src/free.ts"]);
    expect(status.find((s) => s.path === "src/api.ts")?.locked).toBe(true);
    expect(status.find((s) => s.path === "src/free.ts")?.locked).toBe(false);
  });
});

describe("notes & snapshot", () => {
  it("appends and lists shared notes", () => {
    const a = core.agents.register("A", "claude-code");
    core.notes.append(a.id, "API contract v1");
    expect(core.notes.list().map((n) => n.content)).toEqual(["API contract v1"]);
  });

  it("snapshot returns the full current state", () => {
    const a = core.agents.register("A", "claude-code");
    core.tasks.create({ title: "T1" });
    core.locks.acquire(a.id, ["src/api.ts"]);
    core.messages.send(a.id, "all", "hi");
    core.notes.append(a.id, "note");
    const snap = core.snapshot();
    expect(snap.agents).toHaveLength(1);
    expect(snap.tasks).toHaveLength(1);
    expect(snap.locks).toHaveLength(1);
    expect(snap.messages).toHaveLength(1);
    expect(snap.notes).toHaveLength(1);
    expect(snap.missions).toEqual([]);
  });
});

describe("missions", () => {
  it("creates a mission with worktree plans", () => {
    const a = core.agents.register("Claude", "claude-code");
    const mission = core.missions.create({
      goal: "Build auth",
      projectPath: "/tmp/demo",
      createdBy: a.id,
      agents: [a],
    });
    expect(mission.goal).toBe("Build auth");
    expect(mission.worktrees[0]?.agentName).toBe("Claude");
    expect(mission.worktrees[0]?.command).toContain("git -C");
    expect(core.snapshot().missions[0]?.id).toBe(mission.id);
  });
});

describe("events", () => {
  it("emits events that the SSE layer can subscribe to", () => {
    const seen: string[] = [];
    const unsub = core.events.subscribe((e) => seen.push(e.type));
    const a = core.agents.register("A", "claude-code");
    const t = core.tasks.create({ title: "T1" });
    core.tasks.claim(t.id, a.id);
    core.messages.send(a.id, "all", "hi");
    core.locks.acquire(a.id, ["x.ts"]);
    core.notes.append(a.id, "n");
    unsub();
    expect(seen).toContain("agent_registered");
    expect(seen).toContain("task_created");
    expect(seen).toContain("task_updated");
    expect(seen).toContain("message_sent");
    expect(seen).toContain("lock_changed");
    expect(seen).toContain("note_added");
  });
});

describe("MPAC: roles", () => {
  it("registers with a default principal and assigns a role", () => {
    const a = core.agents.register("Claude", "claude-code");
    expect(a.role).toBeNull();
    expect(a.principal).toBe("本机");
    const updated = core.agents.setRole(a.id, "前端");
    expect(updated?.role).toBe("前端");
    expect(core.agents.setRole("missing", "后端")).toBeNull();
  });

  it("re-registering preserves an assigned role", () => {
    const a = core.agents.register("Claude", "claude-code");
    core.agents.setRole(a.id, "后端");
    const again = core.agents.register("Claude", "codex");
    expect(again.id).toBe(a.id);
    expect(again.role).toBe("后端");
  });
});

describe("MPAC: intents & conflicts", () => {
  it("declaring an intent over a free resource raises no conflict", () => {
    const a = core.agents.register("A", "claude-code");
    const res = core.intents.declare(a.id, "改 users API", ["src/api/users.ts"]);
    expect(res.intent.status).toBe("announced");
    expect(res.conflicts).toHaveLength(0);
  });

  it("overlapping intents from different agents raise a first-class conflict", () => {
    const a = core.agents.register("A", "claude-code");
    const b = core.agents.register("B", "codex");
    core.intents.declare(a.id, "改 users API", ["src/api/users.ts"]);
    const res = core.intents.declare(b.id, "也改 users", ["src/api/users.ts"]);
    expect(res.conflicts).toHaveLength(1);
    expect(res.conflicts[0]?.resource).toBe("src/api/users.ts");
    expect(res.conflicts[0]?.agentIds).toEqual(expect.arrayContaining([a.id, b.id]));
    expect(core.conflicts.open()).toHaveLength(1);
  });

  it("withdrawn intents stop colliding", () => {
    const a = core.agents.register("A", "claude-code");
    const b = core.agents.register("B", "codex");
    const first = core.intents.declare(a.id, "改", ["x.ts"]);
    core.intents.withdraw(first.intent.id);
    const res = core.intents.declare(b.id, "改", ["x.ts"]);
    expect(res.conflicts).toHaveLength(0);
  });

  it("operator resolves a conflict", () => {
    const a = core.agents.register("A", "claude-code");
    const b = core.agents.register("B", "codex");
    core.intents.declare(a.id, "改", ["x.ts"]);
    const res = core.intents.declare(b.id, "改", ["x.ts"]);
    const cid = res.conflicts[0]!.id;
    const resolved = core.conflicts.resolve(cid, "operator", "A 先改，B 等待");
    expect(resolved?.status).toBe("resolved");
    expect(core.conflicts.open()).toHaveLength(0);
  });
});

describe("MPAC: shared contract", () => {
  it("starts empty and updates with a version bump", () => {
    const a = core.agents.register("A", "claude-code");
    expect(core.contract.get().version).toBe(0);
    const r = core.contract.update(a.id, { apiContract: "GET /users -> [{id,name}]" });
    expect(r.ok).toBe(true);
    expect(core.contract.get().version).toBe(1);
    expect(core.contract.get().apiContract).toContain("/users");
  });

  it("rejects a stale update (optimistic concurrency)", () => {
    const a = core.agents.register("A", "claude-code");
    core.contract.update(a.id, { designSpec: "primary=#57f2d8" }); // -> v1
    const stale = core.contract.update(a.id, { designSpec: "x" }, 0); // expects v0
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.reason).toBe("stale");
  });

  it("emits intent/conflict/contract events", () => {
    const seen: string[] = [];
    const unsub = core.events.subscribe((e) => seen.push(e.type));
    const a = core.agents.register("A", "claude-code");
    const b = core.agents.register("B", "codex");
    core.intents.declare(a.id, "改", ["y.ts"]);
    const res = core.intents.declare(b.id, "改", ["y.ts"]);
    core.conflicts.resolve(res.conflicts[0]!.id, "op", "ok");
    core.contract.update(a.id, { apiContract: "x" });
    unsub();
    expect(seen).toContain("intent_announced");
    expect(seen).toContain("conflict_opened");
    expect(seen).toContain("conflict_updated");
    expect(seen).toContain("contract_updated");
  });
});
