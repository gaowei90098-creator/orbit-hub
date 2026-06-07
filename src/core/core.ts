import { Store } from "./store.js";
import { EventBus } from "./events.js";
import { Agents } from "./agents.js";
import { Messages } from "./messages.js";
import { Tasks } from "./tasks.js";
import { Locks } from "./locks.js";
import { Notes } from "./notes.js";
import { Intents } from "./intents.js";
import { Conflicts } from "./conflicts.js";
import { ContractStore } from "./contract.js";
import { Missions } from "./missions.js";
import { Projects } from "./projects.js";
import type { Snapshot } from "./types.js";

// Single entry point that wires the store + event bus and exposes the domain modules.
// Used directly by tests and wrapped by the hub's REST layer.
export class CoordinationCore {
  readonly store: Store;
  readonly events: EventBus;
  readonly agents: Agents;
  readonly messages: Messages;
  readonly tasks: Tasks;
  readonly locks: Locks;
  readonly notes: Notes;
  readonly intents: Intents;
  readonly conflicts: Conflicts;
  readonly contract: ContractStore;
  readonly missions: Missions;
  readonly projects: Projects;

  constructor(dbPath = ":memory:") {
    this.store = new Store(dbPath);
    this.events = new EventBus();
    this.agents = new Agents(this.store, this.events);
    this.messages = new Messages(this.store, this.events);
    this.tasks = new Tasks(this.store, this.events);
    this.locks = new Locks(this.store, this.events);
    this.notes = new Notes(this.store, this.events);
    this.intents = new Intents(this.store, this.events);
    this.conflicts = new Conflicts(this.store, this.events);
    this.contract = new ContractStore(this.store, this.events);
    this.missions = new Missions(this.store, this.events);
    this.projects = new Projects(this.store, this.events);
  }

  // Full current state for the dashboard's initial load.
  snapshot(messageLimit = 100): Snapshot {
    return {
      agents: this.agents.list(),
      tasks: this.tasks.list(),
      locks: this.locks.list(),
      messages: this.messages.recent(messageLimit),
      notes: this.notes.list(),
      intents: this.intents.list(),
      conflicts: this.conflicts.list(),
      contract: this.contract.get(),
      missions: this.missions.list(),
      projects: this.projects.list(),
      agentRuns: this.store.listAgentRuns(),
    };
  }

  private _closed = false;
  // 后台子进程回调据此短路，避免在 db 关闭后访问已释放资源（关闭期竞态）。
  get closed(): boolean {
    return this._closed;
  }
  close(): void {
    this._closed = true;
    this.store.close();
  }
}
