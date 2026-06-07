import type {
  AcquireLocksResult,
  Agent,
  ClaimResult,
  Conflict,
  Contract,
  DeclareIntentResult,
  FileLock,
  Intent,
  Message,
  Note,
  Task,
  TaskStatus,
} from "../core/types.js";

// Thin HTTP client over the hub REST API. Carries the optional bearer token so the
// exact same adapter works against a localhost hub or a remote (tunnelled) one.
export class HubClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token?: string,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.token) headers["Authorization"] = `Bearer ${this.token}`;
    let res: Response;
    try {
      res = await fetch(this.baseUrl + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      throw new Error(`Cannot reach hub at ${this.baseUrl} — is it running? (${(err as Error).message})`);
    }
    if (!res.ok) {
      throw new Error(`Hub ${method} ${path} failed: ${res.status} ${await res.text()}`);
    }
    return (await res.json()) as T;
  }

  registerAgent(name: string, harness: string, principal?: string): Promise<{ agent: Agent }> {
    return this.req("POST", "/api/agents", { name, harness, principal });
  }
  heartbeat(id: string): Promise<{ agent: Agent }> {
    return this.req("POST", `/api/agents/${encodeURIComponent(id)}/heartbeat`);
  }
  listAgents(): Promise<{ agents: Agent[] }> {
    return this.req("GET", "/api/agents");
  }

  sendMessage(from: string, to: string, content: string): Promise<{ message: Message }> {
    return this.req("POST", "/api/messages", { from, to, content });
  }
  inbox(agentId: string): Promise<{ messages: Message[] }> {
    return this.req("GET", `/api/messages/inbox?agent=${encodeURIComponent(agentId)}`);
  }

  createTask(input: {
    title: string;
    description?: string;
    dependsOn?: string[];
    files?: string[];
    createdBy?: string;
  }): Promise<{ task: Task }> {
    return this.req("POST", "/api/tasks", input);
  }
  listTasks(status?: TaskStatus): Promise<{ tasks: Task[] }> {
    return this.req("GET", `/api/tasks${status ? `?status=${status}` : ""}`);
  }
  claimTask(id: string, agent: string): Promise<ClaimResult> {
    return this.req("POST", `/api/tasks/${encodeURIComponent(id)}/claim`, { agent });
  }
  updateTask(id: string, fields: { status?: TaskStatus; note?: string }): Promise<{ task: Task }> {
    return this.req("POST", `/api/tasks/${encodeURIComponent(id)}/update`, fields);
  }
  releaseTask(id: string): Promise<{ task: Task }> {
    return this.req("POST", `/api/tasks/${encodeURIComponent(id)}/release`);
  }

  acquireLocks(agent: string, paths: string[], note?: string): Promise<AcquireLocksResult> {
    return this.req("POST", "/api/locks/acquire", { agent, paths, note });
  }
  releaseLocks(agent: string, paths: string[]): Promise<{ released: string[] }> {
    return this.req("POST", "/api/locks/release", { agent, paths });
  }
  checkLocks(paths: string[]): Promise<{ status: { path: string; locked: boolean; heldBy: Agent | null }[] }> {
    return this.req("POST", "/api/locks/check", { paths });
  }
  listLocks(): Promise<{ locks: FileLock[] }> {
    return this.req("GET", "/api/locks");
  }

  appendNote(agent: string, content: string): Promise<{ note: Note }> {
    return this.req("POST", "/api/notes", { agent, content });
  }
  listNotes(): Promise<{ notes: Note[] }> {
    return this.req("GET", "/api/notes");
  }

  // ----- MPAC: roles / intents / conflicts / contract -----
  declareIntent(agent: string, summary: string, resources: string[]): Promise<DeclareIntentResult> {
    return this.req("POST", "/api/intents", { agent, summary, resources });
  }
  withdrawIntent(id: string): Promise<{ intent: Intent }> {
    return this.req("POST", `/api/intents/${encodeURIComponent(id)}/withdraw`);
  }
  listIntents(): Promise<{ intents: Intent[] }> {
    return this.req("GET", "/api/intents");
  }
  listConflicts(): Promise<{ conflicts: Conflict[] }> {
    return this.req("GET", "/api/conflicts");
  }
  getContract(): Promise<{ contract: Contract }> {
    return this.req("GET", "/api/contract");
  }
  updateContract(
    by: string,
    fields: { apiContract?: string; designSpec?: string; expectedVersion?: number },
  ): Promise<{ ok: boolean; reason?: string; contract: Contract }> {
    return this.req("POST", "/api/contract", { by, ...fields });
  }
}
