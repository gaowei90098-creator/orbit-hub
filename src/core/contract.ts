import type { Store } from "./store.js";
import type { EventBus } from "./events.js";
import type { Contract } from "./types.js";

export type ContractUpdateResult =
  | { ok: true; contract: Contract }
  | { ok: false; reason: "stale"; contract: Contract };

// MPAC shared state: the contract both sides build against — an API/interface
// agreement plus a design spec (design tokens / style guide) for consistent UI.
// Optimistic concurrency: an update carrying a stale version is rejected so two
// agents can't silently overwrite each other's contract changes.
export class ContractStore {
  constructor(
    private readonly store: Store,
    private readonly events: EventBus,
  ) {}

  get(): Contract {
    return this.store.getContract();
  }

  update(
    updatedBy: string | null,
    fields: { apiContract?: string; designSpec?: string },
    expectedVersion?: number,
  ): ContractUpdateResult {
    const current = this.store.getContract();
    if (expectedVersion !== undefined && expectedVersion !== current.version) {
      return { ok: false, reason: "stale", contract: current };
    }
    const apiContract = fields.apiContract ?? current.apiContract;
    const designSpec = fields.designSpec ?? current.designSpec;
    const version = current.version + 1;
    this.store.updateContract(apiContract, designSpec, version, updatedBy, Date.now());
    const updated = this.store.getContract();
    this.events.emit("contract_updated", updated);
    return { ok: true, contract: updated };
  }
}
