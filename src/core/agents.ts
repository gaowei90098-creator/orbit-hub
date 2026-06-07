import type { Store } from "./store.js";
import type { EventBus } from "./events.js";
import type { Agent, Harness } from "./types.js";
import { newAgentId } from "./id.js";

// Agent presence: registration, heartbeat, and reaping of stale agents.
export class Agents {
  constructor(
    private readonly store: Store,
    private readonly events: EventBus,
  ) {}

  // Idempotent by name: re-registering an existing name re-uses its id (reconnect-friendly).
  // Re-register preserves an already-assigned role; principal follows the latest connection.
  register(name: string, harness: Harness, principal = "本机"): Agent {
    const now = Date.now();
    const existing = this.store.findAgentByName(name);
    if (existing) {
      const updated: Agent = { ...existing, harness, status: "online", lastSeen: now, principal };
      this.store.upsertAgent(updated);
      this.events.emit("agent_updated", updated);
      return updated;
    }
    const agent: Agent = {
      id: newAgentId(name),
      name,
      harness,
      status: "online",
      currentTaskId: null,
      registeredAt: now,
      lastSeen: now,
      role: null,
      principal,
    };
    this.store.upsertAgent(agent);
    this.events.emit("agent_registered", agent);
    return agent;
  }

  // Operator assigns a role (前端/后端/自定义) to an agent.
  setRole(id: string, role: string | null): Agent | null {
    const agent = this.store.getAgent(id);
    if (!agent) return null;
    this.store.setAgentRole(id, role);
    const updated = this.store.getAgent(id);
    if (updated) this.events.emit("agent_updated", updated);
    return updated;
  }

  heartbeat(id: string): Agent | null {
    const agent = this.store.getAgent(id);
    if (!agent) return null;
    this.store.touchAgent(id, Date.now());
    const updated = this.store.getAgent(id);
    if (updated) this.events.emit("agent_updated", updated);
    return updated;
  }

  get(id: string): Agent | null {
    return this.store.getAgent(id);
  }

  list(): Agent[] {
    return this.store.listAgents();
  }

  // Mark agents whose last heartbeat exceeded ttl as offline and release their file locks,
  // so a crashed agent never deadlocks files for the rest of the team.
  reap(ttlMs: number): { offline: Agent[]; releasedLocks: string[] } {
    const now = Date.now();
    const stale = this.store.listAgents().filter((a) => a.status === "online" && now - a.lastSeen > ttlMs);
    const releasedLocks: string[] = [];
    for (const a of stale) {
      this.store.setAgentStatus(a.id, "offline", a.lastSeen);
      const released = this.store.releaseAllLocks(a.id);
      releasedLocks.push(...released);
      this.events.emit("agent_offline", { ...a, status: "offline" });
      if (released.length) this.events.emit("lock_changed", { released, holder: a.id });
    }
    return { offline: stale, releasedLocks };
  }
}
