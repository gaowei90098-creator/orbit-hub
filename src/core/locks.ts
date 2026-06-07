import type { Store } from "./store.js";
import type { EventBus } from "./events.js";
import type { AcquireLocksResult, Agent, FileLock } from "./types.js";

// Soft file locks: advisory, single-holder-per-path. Acquiring a path held by
// someone else does NOT grant it — it returns a conflict naming the holder, so the
// requesting agent can coordinate (message them / pick another task) instead of
// silently clobbering each other's edits.
export class Locks {
  constructor(
    private readonly store: Store,
    private readonly events: EventBus,
  ) {}

  acquire(agentId: string, paths: string[], note = ""): AcquireLocksResult {
    const granted: string[] = [];
    const conflicts: AcquireLocksResult["conflicts"] = [];
    const now = Date.now();
    for (const path of paths) {
      const existing = this.store.getLock(path);
      if (!existing) {
        this.store.insertLock({ path, holder: agentId, note, acquiredAt: now });
        granted.push(path);
      } else if (existing.holder === agentId) {
        granted.push(path); // already yours
      } else {
        conflicts.push({ path, heldBy: this.store.getAgent(existing.holder) });
      }
    }
    if (granted.length > 0) this.events.emit("lock_changed", { acquired: granted, holder: agentId });
    return { granted, conflicts };
  }

  release(agentId: string, paths: string[]): string[] {
    const released: string[] = [];
    for (const path of paths) {
      if (this.store.deleteLock(path, agentId)) released.push(path);
    }
    if (released.length > 0) this.events.emit("lock_changed", { released, holder: agentId });
    return released;
  }

  // Advisory pre-check before editing: which of these paths are locked, and by whom.
  check(paths: string[]): { path: string; locked: boolean; heldBy: Agent | null }[] {
    return paths.map((path) => {
      const lock = this.store.getLock(path);
      return {
        path,
        locked: lock !== null,
        heldBy: lock ? this.store.getAgent(lock.holder) : null,
      };
    });
  }

  list(): FileLock[] {
    return this.store.listLocks();
  }
}
