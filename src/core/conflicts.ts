import type { Store } from "./store.js";
import type { EventBus } from "./events.js";
import type { Conflict } from "./types.js";

// MPAC governance layer: conflicts are first-class objects a human (the operator)
// arbitrates — resolve (decide a winner / how to proceed) or dismiss (not a real clash).
export class Conflicts {
  constructor(
    private readonly store: Store,
    private readonly events: EventBus,
  ) {}

  list(): Conflict[] {
    return this.store.listConflicts();
  }

  open(): Conflict[] {
    return this.store.listConflicts().filter((c) => c.status === "open");
  }

  resolve(conflictId: string, resolvedBy: string | null, resolution: string): Conflict | null {
    return this.update(conflictId, "resolved", resolvedBy, resolution);
  }

  dismiss(conflictId: string, resolvedBy: string | null, resolution: string): Conflict | null {
    return this.update(conflictId, "dismissed", resolvedBy, resolution);
  }

  private update(
    conflictId: string,
    status: Conflict["status"],
    resolvedBy: string | null,
    resolution: string,
  ): Conflict | null {
    const conflict = this.store.getConflict(conflictId);
    if (!conflict) return null;
    this.store.updateConflict(conflictId, { status, resolution, resolvedBy, resolvedAt: Date.now() });
    const updated = this.store.getConflict(conflictId);
    if (updated) this.events.emit("conflict_updated", updated);
    return updated;
  }
}
