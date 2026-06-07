import type { Store } from "./store.js";
import type { EventBus } from "./events.js";
import type { Conflict, DeclareIntentResult, Intent } from "./types.js";
import { newId } from "./id.js";

// MPAC intent layer: an agent declares what it's about to do (which files/resources it
// will touch) BEFORE acting. Declaring against a resource another agent has already
// announced raises a first-class Conflict for the operator to resolve.
export class Intents {
  constructor(
    private readonly store: Store,
    private readonly events: EventBus,
  ) {}

  declare(agentId: string, summary: string, resources: string[]): DeclareIntentResult {
    const now = Date.now();
    const intent: Intent = {
      id: newId("i"),
      agentId,
      summary,
      resources,
      status: "announced",
      createdAt: now,
      updatedAt: now,
    };
    this.store.insertIntent(intent);
    this.events.emit("intent_announced", intent);

    // Detect overlap with OTHER agents' active intents → raise conflicts.
    const others = this.store.listActiveIntents().filter((i) => i.agentId !== agentId && i.id !== intent.id);
    const conflicts: Conflict[] = [];
    for (const resource of resources) {
      const overlapping = others.filter((i) => i.resources.includes(resource));
      if (overlapping.length === 0) continue;
      const existing = this.store.findOpenConflictForResource(resource);
      if (existing) {
        conflicts.push(existing);
        continue;
      }
      const conflict: Conflict = {
        id: newId("c"),
        kind: "file",
        resource,
        intentIds: [intent.id, ...overlapping.map((i) => i.id)],
        agentIds: Array.from(new Set([agentId, ...overlapping.map((i) => i.agentId)])),
        status: "open",
        resolution: "",
        resolvedBy: null,
        createdAt: now,
        resolvedAt: null,
      };
      this.store.insertConflict(conflict);
      this.events.emit("conflict_opened", conflict);
      conflicts.push(conflict);
    }
    return { intent, conflicts };
  }

  list(): Intent[] {
    return this.store.listIntents();
  }

  active(): Intent[] {
    return this.store.listActiveIntents();
  }

  setStatus(intentId: string, status: Intent["status"]): Intent | null {
    const intent = this.store.getIntent(intentId);
    if (!intent) return null;
    this.store.setIntentStatus(intentId, status, Date.now());
    const updated = this.store.getIntent(intentId);
    if (updated) this.events.emit("intent_updated", updated);
    return updated;
  }

  withdraw(intentId: string): Intent | null {
    return this.setStatus(intentId, "withdrawn");
  }

  commit(intentId: string): Intent | null {
    return this.setStatus(intentId, "committed");
  }
}
