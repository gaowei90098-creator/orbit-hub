import { DatabaseSync } from "node:sqlite";
import type {
  Agent,
  AgentRun,
  Approval,
  Conflict,
  Contract,
  FileLock,
  IntegrationRun,
  Intent,
  Message,
  Mission,
  Note,
  Project,
  ProjectCommands,
  Task,
  ValidationRun,
} from "./types.js";

// Data-access layer over node:sqlite (built into Node 22+, no native build).
// Pure persistence: no business rules, no events. Domain modules layer those on top.
// node:sqlite is synchronous, and the hub is a single-threaded Node process, so a
// read-check-write sequence with no await in between is effectively atomic.

const SCHEMA = `
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  harness TEXT NOT NULL,
  status TEXT NOT NULL,
  current_task_id TEXT,
  registered_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  role TEXT,
  principal TEXT
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  content TEXT NOT NULL,
  ts INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS message_reads (
  message_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  PRIMARY KEY (message_id, agent_id)
);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL,
  assignee TEXT,
  depends_on TEXT NOT NULL,
  files TEXT NOT NULL,
  note TEXT NOT NULL,
  file_scope TEXT NOT NULL DEFAULT '[]',
  done_when TEXT NOT NULL DEFAULT '',
  verify_command TEXT NOT NULL DEFAULT '',
  interface_ref TEXT NOT NULL DEFAULT '',
  created_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS locks (
  path TEXT PRIMARY KEY,
  holder TEXT NOT NULL,
  note TEXT NOT NULL,
  acquired_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  content TEXT NOT NULL,
  ts INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS intents (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  resources TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS conflicts (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  resource TEXT NOT NULL,
  intent_ids TEXT NOT NULL,
  agent_ids TEXT NOT NULL,
  status TEXT NOT NULL,
  resolution TEXT NOT NULL,
  resolved_by TEXT,
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);
CREATE TABLE IF NOT EXISTS contract (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  api_contract TEXT NOT NULL,
  design_spec TEXT NOT NULL,
  version INTEGER NOT NULL,
  updated_by TEXT,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS missions (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  goal TEXT NOT NULL,
  project_path TEXT NOT NULL,
  status TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'draft',
  task_ids TEXT NOT NULL,
  worktrees TEXT NOT NULL,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  root_path TEXT NOT NULL,
  repository_url TEXT,
  target_branch TEXT,
  is_git_repo INTEGER NOT NULL DEFAULT 0,
  commands TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  mission_id TEXT,
  task_id TEXT,
  project_id TEXT,
  agent_id TEXT,
  driver TEXT NOT NULL,
  harness TEXT NOT NULL,
  session_id TEXT,
  pid INTEGER,
  worktree_path TEXT,
  branch TEXT,
  base_commit TEXT,
  status TEXT NOT NULL,
  error_code TEXT,
  cost_usd REAL NOT NULL DEFAULT 0,
  last_activity TEXT NOT NULL DEFAULT '',
  error TEXT NOT NULL DEFAULT '',
  task_title TEXT NOT NULL DEFAULT '',
  project_path TEXT NOT NULL DEFAULT '',
  started_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS integration_runs (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL,
  branch TEXT NOT NULL,
  worktree_path TEXT NOT NULL,
  target_branch TEXT NOT NULL,
  base_commit TEXT NOT NULL,
  result_commit TEXT,
  merged_branches TEXT NOT NULL DEFAULT '[]',
  conflicts TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL,
  validation_run_ids TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS validation_runs (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL,
  task_id TEXT,
  scope TEXT NOT NULL,
  command TEXT NOT NULL,
  exit_code INTEGER,
  output TEXT NOT NULL DEFAULT '',
  ok INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER NOT NULL,
  finished_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  decision TEXT NOT NULL,
  approved_by TEXT,
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
`;

interface AgentRow {
  id: string;
  name: string;
  harness: string;
  status: string;
  current_task_id: string | null;
  registered_at: number;
  last_seen: number;
  role: string | null;
  principal: string | null;
}
interface TaskRow {
  id: string;
  title: string;
  description: string;
  status: string;
  assignee: string | null;
  depends_on: string;
  files: string;
  note: string;
  file_scope: string | null;
  done_when: string | null;
  verify_command: string | null;
  interface_ref: string | null;
  created_by: string | null;
  created_at: number;
  updated_at: number;
}
interface MessageRow {
  id: string;
  from_id: string;
  to_id: string;
  content: string;
  ts: number;
}
interface LockRow {
  path: string;
  holder: string;
  note: string;
  acquired_at: number;
}
interface NoteRow {
  id: string;
  agent_id: string;
  content: string;
  ts: number;
}

const toAgent = (r: AgentRow): Agent => ({
  id: r.id,
  name: r.name,
  harness: r.harness as Agent["harness"],
  status: r.status as Agent["status"],
  currentTaskId: r.current_task_id,
  registeredAt: Number(r.registered_at),
  lastSeen: Number(r.last_seen),
  role: r.role ?? null,
  principal: r.principal ?? "本机",
});
const toTask = (r: TaskRow): Task => ({
  id: r.id,
  title: r.title,
  description: r.description,
  status: r.status as Task["status"],
  assignee: r.assignee,
  dependsOn: JSON.parse(r.depends_on) as string[],
  files: JSON.parse(r.files) as string[],
  note: r.note,
  fileScope: JSON.parse(r.file_scope ?? "[]") as string[],
  doneWhen: r.done_when ?? "",
  verifyCommand: r.verify_command ?? "",
  interfaceRef: r.interface_ref ?? "",
  createdBy: r.created_by,
  createdAt: Number(r.created_at),
  updatedAt: Number(r.updated_at),
});
const toMessage = (r: MessageRow): Message => ({
  id: r.id,
  from: r.from_id,
  to: r.to_id,
  content: r.content,
  ts: Number(r.ts),
});
const toLock = (r: LockRow): FileLock => ({
  path: r.path,
  holder: r.holder,
  note: r.note,
  acquiredAt: Number(r.acquired_at),
});
const toNote = (r: NoteRow): Note => ({
  id: r.id,
  agentId: r.agent_id,
  content: r.content,
  ts: Number(r.ts),
});

interface IntentRow {
  id: string;
  agent_id: string;
  summary: string;
  resources: string;
  status: string;
  created_at: number;
  updated_at: number;
}
interface ConflictRow {
  id: string;
  kind: string;
  resource: string;
  intent_ids: string;
  agent_ids: string;
  status: string;
  resolution: string;
  resolved_by: string | null;
  created_at: number;
  resolved_at: number | null;
}
interface ContractRow {
  api_contract: string;
  design_spec: string;
  version: number;
  updated_by: string | null;
  updated_at: number;
}
interface MissionRow {
  id: string;
  project_id: string | null;
  goal: string;
  project_path: string;
  status: string;
  state: string | null;
  task_ids: string;
  worktrees: string;
  created_by: string | null;
  created_at: number;
  updated_at: number;
}
interface ProjectRow {
  id: string;
  name: string;
  root_path: string;
  repository_url: string | null;
  target_branch: string | null;
  is_git_repo: number;
  commands: string;
  created_at: number;
  updated_at: number;
}
interface AgentRunRow {
  id: string;
  mission_id: string | null;
  task_id: string | null;
  project_id: string | null;
  agent_id: string | null;
  driver: string;
  harness: string;
  session_id: string | null;
  pid: number | null;
  worktree_path: string | null;
  branch: string | null;
  base_commit: string | null;
  status: string;
  error_code: string | null;
  cost_usd: number;
  last_activity: string;
  error: string;
  task_title: string;
  project_path: string;
  started_at: number;
  updated_at: number;
}
interface IntegrationRunRow {
  id: string;
  mission_id: string;
  branch: string;
  worktree_path: string;
  target_branch: string;
  base_commit: string;
  result_commit: string | null;
  merged_branches: string;
  conflicts: string;
  status: string;
  validation_run_ids: string;
  created_at: number;
  updated_at: number;
}
interface ValidationRunRow {
  id: string;
  mission_id: string;
  task_id: string | null;
  scope: string;
  command: string;
  exit_code: number | null;
  output: string;
  ok: number;
  started_at: number;
  finished_at: number;
}
interface ApprovalRow {
  id: string;
  mission_id: string;
  stage: string;
  decision: string;
  approved_by: string | null;
  note: string;
  created_at: number;
}

const toIntegrationRun = (r: IntegrationRunRow): IntegrationRun => ({
  id: r.id,
  missionId: r.mission_id,
  branch: r.branch,
  worktreePath: r.worktree_path,
  targetBranch: r.target_branch,
  baseCommit: r.base_commit,
  resultCommit: r.result_commit,
  mergedBranches: JSON.parse(r.merged_branches) as string[],
  conflicts: JSON.parse(r.conflicts) as string[],
  status: r.status as IntegrationRun["status"],
  validationRunIds: JSON.parse(r.validation_run_ids) as string[],
  createdAt: Number(r.created_at),
  updatedAt: Number(r.updated_at),
});
const toValidationRun = (r: ValidationRunRow): ValidationRun => ({
  id: r.id,
  missionId: r.mission_id,
  taskId: r.task_id,
  scope: r.scope as ValidationRun["scope"],
  command: r.command,
  exitCode: r.exit_code == null ? null : Number(r.exit_code),
  output: r.output,
  ok: Number(r.ok) === 1,
  startedAt: Number(r.started_at),
  finishedAt: Number(r.finished_at),
});
const toApproval = (r: ApprovalRow): Approval => ({
  id: r.id,
  missionId: r.mission_id,
  stage: r.stage as Approval["stage"],
  decision: r.decision as Approval["decision"],
  approvedBy: r.approved_by,
  note: r.note,
  createdAt: Number(r.created_at),
});

const toIntent = (r: IntentRow): Intent => ({
  id: r.id,
  agentId: r.agent_id,
  summary: r.summary,
  resources: JSON.parse(r.resources) as string[],
  status: r.status as Intent["status"],
  createdAt: Number(r.created_at),
  updatedAt: Number(r.updated_at),
});
const toConflict = (r: ConflictRow): Conflict => ({
  id: r.id,
  kind: r.kind as Conflict["kind"],
  resource: r.resource,
  intentIds: JSON.parse(r.intent_ids) as string[],
  agentIds: JSON.parse(r.agent_ids) as string[],
  status: r.status as Conflict["status"],
  resolution: r.resolution,
  resolvedBy: r.resolved_by,
  createdAt: Number(r.created_at),
  resolvedAt: r.resolved_at == null ? null : Number(r.resolved_at),
});
const toContract = (r: ContractRow): Contract => ({
  apiContract: r.api_contract,
  designSpec: r.design_spec,
  version: Number(r.version),
  updatedBy: r.updated_by,
  updatedAt: Number(r.updated_at),
});
const toMission = (r: MissionRow): Mission => ({
  id: r.id,
  projectId: r.project_id ?? null,
  goal: r.goal,
  projectPath: r.project_path,
  status: r.status as Mission["status"],
  state: (r.state as Mission["state"]) ?? "draft",
  taskIds: JSON.parse(r.task_ids) as string[],
  worktrees: JSON.parse(r.worktrees) as Mission["worktrees"],
  createdBy: r.created_by,
  createdAt: Number(r.created_at),
  updatedAt: Number(r.updated_at),
});
const toProject = (r: ProjectRow): Project => ({
  id: r.id,
  name: r.name,
  rootPath: r.root_path,
  repositoryUrl: r.repository_url,
  targetBranch: r.target_branch,
  isGitRepo: Number(r.is_git_repo) === 1,
  commands: JSON.parse(r.commands) as ProjectCommands,
  createdAt: Number(r.created_at),
  updatedAt: Number(r.updated_at),
});
const toAgentRun = (r: AgentRunRow): AgentRun => ({
  id: r.id,
  missionId: r.mission_id,
  taskId: r.task_id,
  projectId: r.project_id,
  agentId: r.agent_id,
  driver: r.driver as AgentRun["driver"],
  harness: r.harness as AgentRun["harness"],
  sessionId: r.session_id,
  pid: r.pid == null ? null : Number(r.pid),
  worktreePath: r.worktree_path,
  branch: r.branch,
  baseCommit: r.base_commit ?? null,
  status: r.status as AgentRun["status"],
  errorCode: (r.error_code as AgentRun["errorCode"]) ?? null,
  costUsd: Number(r.cost_usd),
  lastActivity: r.last_activity,
  error: r.error,
  taskTitle: r.task_title,
  projectPath: r.project_path,
  startedAt: Number(r.started_at),
  updatedAt: Number(r.updated_at),
});

export class Store {
  private readonly db: DatabaseSync;

  constructor(path = ":memory:") {
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.db.exec(SCHEMA);
    this.migrate();
  }

  // Additive migrations for DBs created before role/principal + the contract singleton.
  private migrate(): void {
    for (const col of ["role TEXT", "principal TEXT"]) {
      try {
        this.db.exec(`ALTER TABLE agents ADD COLUMN ${col}`);
      } catch {
        /* column already exists */
      }
    }
    // 旧库（无 project_id）平滑升级到 A04：给 missions 加 project_id 列。
    try {
      this.db.exec(`ALTER TABLE missions ADD COLUMN project_id TEXT`);
    } catch {
      /* column already exists */
    }
    // 旧库平滑升级到 D03：给 agent_runs 加 base_commit 列（worktree 起点 commit）。
    try {
      this.db.exec(`ALTER TABLE agent_runs ADD COLUMN base_commit TEXT`);
    } catch {
      /* column already exists */
    }
    // 旧库平滑升级到 B06：给 missions 加 state 列（状态机），旧数据默认 draft。
    try {
      this.db.exec(`ALTER TABLE missions ADD COLUMN state TEXT NOT NULL DEFAULT 'draft'`);
    } catch {
      /* column already exists */
    }
    // 旧库平滑升级到 1.2 Task contract：tasks 加 file_scope/done_when/verify_command/interface_ref。
    for (const col of [
      "file_scope TEXT NOT NULL DEFAULT '[]'",
      "done_when TEXT NOT NULL DEFAULT ''",
      "verify_command TEXT NOT NULL DEFAULT ''",
      "interface_ref TEXT NOT NULL DEFAULT ''",
    ]) {
      try {
        this.db.exec(`ALTER TABLE tasks ADD COLUMN ${col}`);
      } catch {
        /* column already exists */
      }
    }
    this.db
      .prepare(
        `INSERT OR IGNORE INTO contract (id, api_contract, design_spec, version, updated_by, updated_at)
         VALUES (1, '', '', 0, NULL, ?)`,
      )
      .run(Date.now());
  }

  close(): void {
    this.db.close();
  }

  // ----- agents -----
  upsertAgent(a: Agent): void {
    this.db
      .prepare(
        `INSERT INTO agents (id, name, harness, status, current_task_id, registered_at, last_seen, role, principal)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name, harness = excluded.harness, status = excluded.status,
           current_task_id = excluded.current_task_id, last_seen = excluded.last_seen,
           role = excluded.role, principal = excluded.principal`,
      )
      .run(a.id, a.name, a.harness, a.status, a.currentTaskId, a.registeredAt, a.lastSeen, a.role, a.principal);
  }
  getAgent(id: string): Agent | null {
    const row = this.db.prepare(`SELECT * FROM agents WHERE id = ?`).get(id) as AgentRow | undefined;
    return row ? toAgent(row) : null;
  }
  // 按 (name, principal) 定位 Agent：团队场景下两个人各自的同名 Agent（如都叫 "Claude"）
  // 归属不同 principal，不会互相复用 id。COALESCE 兼容早期 principal 为 NULL 的旧数据。
  findAgentByNameAndPrincipal(name: string, principal: string): Agent | null {
    const row = this.db
      .prepare(`SELECT * FROM agents WHERE name = ? AND COALESCE(principal, '本机') = ? ORDER BY registered_at DESC LIMIT 1`)
      .get(name, principal) as AgentRow | undefined;
    return row ? toAgent(row) : null;
  }
  listAgents(): Agent[] {
    return (this.db.prepare(`SELECT * FROM agents ORDER BY registered_at ASC`).all() as unknown as AgentRow[]).map(
      toAgent,
    );
  }
  setAgentStatus(id: string, status: Agent["status"], lastSeen: number): void {
    this.db.prepare(`UPDATE agents SET status = ?, last_seen = ? WHERE id = ?`).run(status, lastSeen, id);
  }
  touchAgent(id: string, lastSeen: number): void {
    this.db.prepare(`UPDATE agents SET last_seen = ?, status = 'online' WHERE id = ?`).run(lastSeen, id);
  }
  setAgentCurrentTask(id: string, taskId: string | null): void {
    this.db.prepare(`UPDATE agents SET current_task_id = ? WHERE id = ?`).run(taskId, id);
  }
  setAgentRole(id: string, role: string | null): void {
    this.db.prepare(`UPDATE agents SET role = ? WHERE id = ?`).run(role, id);
  }
  setAgentPrincipal(id: string, principal: string): void {
    this.db.prepare(`UPDATE agents SET principal = ? WHERE id = ?`).run(principal, id);
  }

  // ----- messages -----
  insertMessage(m: Message): void {
    this.db
      .prepare(`INSERT INTO messages (id, from_id, to_id, content, ts) VALUES (?, ?, ?, ?, ?)`)
      .run(m.id, m.from, m.to, m.content, m.ts);
  }
  unreadFor(agentId: string): Message[] {
    const rows = this.db
      .prepare(
        `SELECT m.* FROM messages m
         WHERE (m.to_id = ? OR m.to_id = 'all') AND m.from_id != ?
           AND NOT EXISTS (SELECT 1 FROM message_reads r WHERE r.message_id = m.id AND r.agent_id = ?)
         ORDER BY m.ts ASC`,
      )
      .all(agentId, agentId, agentId) as unknown as MessageRow[];
    return rows.map(toMessage);
  }
  markRead(messageIds: string[], agentId: string, ts: number): void {
    const stmt = this.db.prepare(
      `INSERT OR IGNORE INTO message_reads (message_id, agent_id, ts) VALUES (?, ?, ?)`,
    );
    for (const id of messageIds) stmt.run(id, agentId, ts);
  }
  recentMessages(limit: number): Message[] {
    const rows = this.db
      .prepare(`SELECT * FROM messages ORDER BY ts DESC LIMIT ?`)
      .all(limit) as unknown as MessageRow[];
    return rows.map(toMessage).reverse();
  }

  // ----- tasks -----
  insertTask(t: Task): void {
    this.db
      .prepare(
        `INSERT INTO tasks (id, title, description, status, assignee, depends_on, files, note,
            file_scope, done_when, verify_command, interface_ref, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        t.id,
        t.title,
        t.description,
        t.status,
        t.assignee,
        JSON.stringify(t.dependsOn),
        JSON.stringify(t.files),
        t.note,
        JSON.stringify(t.fileScope),
        t.doneWhen,
        t.verifyCommand,
        t.interfaceRef,
        t.createdBy,
        t.createdAt,
        t.updatedAt,
      );
  }
  getTask(id: string): Task | null {
    const row = this.db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id) as TaskRow | undefined;
    return row ? toTask(row) : null;
  }
  listTasks(status?: Task["status"]): Task[] {
    const rows = status
      ? (this.db.prepare(`SELECT * FROM tasks WHERE status = ? ORDER BY created_at ASC`).all(status) as unknown as TaskRow[])
      : (this.db.prepare(`SELECT * FROM tasks ORDER BY created_at ASC`).all() as unknown as TaskRow[]);
    return rows.map(toTask);
  }
  /** Atomic claim guard: assigns only if currently unassigned. Returns true if this call won the claim. */
  tryAssignTask(taskId: string, agentId: string, ts: number): boolean {
    const res = this.db
      .prepare(
        `UPDATE tasks SET assignee = ?, status = 'claimed', updated_at = ?
         WHERE id = ? AND assignee IS NULL`,
      )
      .run(agentId, ts, taskId);
    return Number(res.changes) > 0;
  }
  updateTaskFields(id: string, fields: Partial<Pick<Task, "status" | "assignee" | "note">>, ts: number): void {
    const sets: string[] = ["updated_at = ?"];
    const vals: (string | number | null)[] = [ts];
    if (fields.status !== undefined) {
      sets.push("status = ?");
      vals.push(fields.status);
    }
    if (fields.assignee !== undefined) {
      sets.push("assignee = ?");
      vals.push(fields.assignee);
    }
    if (fields.note !== undefined) {
      sets.push("note = ?");
      vals.push(fields.note);
    }
    vals.push(id);
    this.db.prepare(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  }

  // ----- locks -----
  getLock(path: string): FileLock | null {
    const row = this.db.prepare(`SELECT * FROM locks WHERE path = ?`).get(path) as LockRow | undefined;
    return row ? toLock(row) : null;
  }
  insertLock(l: FileLock): void {
    this.db
      .prepare(`INSERT INTO locks (path, holder, note, acquired_at) VALUES (?, ?, ?, ?)`)
      .run(l.path, l.holder, l.note, l.acquiredAt);
  }
  deleteLock(path: string, holder: string): boolean {
    const res = this.db.prepare(`DELETE FROM locks WHERE path = ? AND holder = ?`).run(path, holder);
    return Number(res.changes) > 0;
  }
  releaseAllLocks(holder: string): string[] {
    const rows = this.db.prepare(`SELECT path FROM locks WHERE holder = ?`).all(holder) as { path: string }[];
    this.db.prepare(`DELETE FROM locks WHERE holder = ?`).run(holder);
    return rows.map((r) => r.path);
  }
  listLocks(): FileLock[] {
    return (this.db.prepare(`SELECT * FROM locks ORDER BY acquired_at ASC`).all() as unknown as LockRow[]).map(toLock);
  }

  // ----- notes -----
  insertNote(n: Note): void {
    this.db.prepare(`INSERT INTO notes (id, agent_id, content, ts) VALUES (?, ?, ?, ?)`).run(n.id, n.agentId, n.content, n.ts);
  }
  listNotes(): Note[] {
    return (this.db.prepare(`SELECT * FROM notes ORDER BY ts ASC`).all() as unknown as NoteRow[]).map(toNote);
  }

  // ----- intents (MPAC intent layer) -----
  insertIntent(i: Intent): void {
    this.db
      .prepare(
        `INSERT INTO intents (id, agent_id, summary, resources, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(i.id, i.agentId, i.summary, JSON.stringify(i.resources), i.status, i.createdAt, i.updatedAt);
  }
  getIntent(id: string): Intent | null {
    const row = this.db.prepare(`SELECT * FROM intents WHERE id = ?`).get(id) as IntentRow | undefined;
    return row ? toIntent(row) : null;
  }
  listIntents(): Intent[] {
    return (this.db.prepare(`SELECT * FROM intents ORDER BY created_at ASC`).all() as unknown as IntentRow[]).map(toIntent);
  }
  listActiveIntents(): Intent[] {
    return (
      this.db
        .prepare(`SELECT * FROM intents WHERE status IN ('announced','committed') ORDER BY created_at ASC`)
        .all() as unknown as IntentRow[]
    ).map(toIntent);
  }
  setIntentStatus(id: string, status: Intent["status"], ts: number): void {
    this.db.prepare(`UPDATE intents SET status = ?, updated_at = ? WHERE id = ?`).run(status, ts, id);
  }

  // ----- conflicts (MPAC conflict layer) -----
  insertConflict(c: Conflict): void {
    this.db
      .prepare(
        `INSERT INTO conflicts (id, kind, resource, intent_ids, agent_ids, status, resolution, resolved_by, created_at, resolved_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        c.id,
        c.kind,
        c.resource,
        JSON.stringify(c.intentIds),
        JSON.stringify(c.agentIds),
        c.status,
        c.resolution,
        c.resolvedBy,
        c.createdAt,
        c.resolvedAt,
      );
  }
  getConflict(id: string): Conflict | null {
    const row = this.db.prepare(`SELECT * FROM conflicts WHERE id = ?`).get(id) as ConflictRow | undefined;
    return row ? toConflict(row) : null;
  }
  listConflicts(): Conflict[] {
    return (this.db.prepare(`SELECT * FROM conflicts ORDER BY created_at DESC`).all() as unknown as ConflictRow[]).map(
      toConflict,
    );
  }
  findOpenConflictForResource(resource: string): Conflict | null {
    const row = this.db
      .prepare(`SELECT * FROM conflicts WHERE resource = ? AND status = 'open' LIMIT 1`)
      .get(resource) as ConflictRow | undefined;
    return row ? toConflict(row) : null;
  }
  updateConflict(
    id: string,
    fields: { status: Conflict["status"]; resolution: string; resolvedBy: string | null; resolvedAt: number | null },
  ): void {
    this.db
      .prepare(`UPDATE conflicts SET status = ?, resolution = ?, resolved_by = ?, resolved_at = ? WHERE id = ?`)
      .run(fields.status, fields.resolution, fields.resolvedBy, fields.resolvedAt, id);
  }

  // ----- contract (MPAC shared state, single row) -----
  getContract(): Contract {
    const row = this.db.prepare(`SELECT * FROM contract WHERE id = 1`).get() as ContractRow | undefined;
    return row ? toContract(row) : { apiContract: "", designSpec: "", version: 0, updatedBy: null, updatedAt: 0 };
  }
  updateContract(apiContract: string, designSpec: string, version: number, updatedBy: string | null, ts: number): void {
    this.db
      .prepare(`UPDATE contract SET api_contract = ?, design_spec = ?, version = ?, updated_by = ?, updated_at = ? WHERE id = 1`)
      .run(apiContract, designSpec, version, updatedBy, ts);
  }

  // ----- missions (user-facing collaboration runs) -----
  insertMission(m: Mission): void {
    this.db
      .prepare(
        `INSERT INTO missions (id, project_id, goal, project_path, status, state, task_ids, worktrees, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        m.id,
        m.projectId,
        m.goal,
        m.projectPath,
        m.status,
        m.state,
        JSON.stringify(m.taskIds),
        JSON.stringify(m.worktrees),
        m.createdBy,
        m.createdAt,
        m.updatedAt,
      );
  }
  getMission(id: string): Mission | null {
    const row = this.db.prepare(`SELECT * FROM missions WHERE id = ?`).get(id) as MissionRow | undefined;
    return row ? toMission(row) : null;
  }
  listMissions(): Mission[] {
    return (this.db.prepare(`SELECT * FROM missions ORDER BY created_at DESC`).all() as unknown as MissionRow[]).map(
      toMission,
    );
  }
  updateMission(id: string, fields: Partial<Pick<Mission, "status" | "state" | "taskIds" | "worktrees">>, ts: number): void {
    const sets: string[] = ["updated_at = ?"];
    const vals: (string | number)[] = [ts];
    if (fields.status !== undefined) {
      sets.push("status = ?");
      vals.push(fields.status);
    }
    if (fields.state !== undefined) {
      sets.push("state = ?");
      vals.push(fields.state);
    }
    if (fields.taskIds !== undefined) {
      sets.push("task_ids = ?");
      vals.push(JSON.stringify(fields.taskIds));
    }
    if (fields.worktrees !== undefined) {
      sets.push("worktrees = ?");
      vals.push(JSON.stringify(fields.worktrees));
    }
    vals.push(id);
    this.db.prepare(`UPDATE missions SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  }

  // ----- settings（键值对，如统一工作区 workspace_path）-----
  getSetting(key: string): string | null {
    const row = this.db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }
  setSetting(key: string, value: string, ts: number = Date.now()): void {
    this.db
      .prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(key, value, ts);
  }

  // ----- projects (A04) -----
  insertProject(p: Project): void {
    this.db
      .prepare(
        `INSERT INTO projects (id, name, root_path, repository_url, target_branch, is_git_repo, commands, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        p.id,
        p.name,
        p.rootPath,
        p.repositoryUrl,
        p.targetBranch,
        p.isGitRepo ? 1 : 0,
        JSON.stringify(p.commands),
        p.createdAt,
        p.updatedAt,
      );
  }
  getProject(id: string): Project | null {
    const row = this.db.prepare(`SELECT * FROM projects WHERE id = ?`).get(id) as ProjectRow | undefined;
    return row ? toProject(row) : null;
  }
  findProjectByRoot(rootPath: string): Project | null {
    const row = this.db.prepare(`SELECT * FROM projects WHERE root_path = ? LIMIT 1`).get(rootPath) as ProjectRow | undefined;
    return row ? toProject(row) : null;
  }
  listProjects(): Project[] {
    return (this.db.prepare(`SELECT * FROM projects ORDER BY created_at DESC`).all() as unknown as ProjectRow[]).map(toProject);
  }
  updateProjectFields(
    id: string,
    fields: Partial<Pick<Project, "name" | "targetBranch" | "repositoryUrl" | "isGitRepo" | "commands">>,
    ts: number,
  ): void {
    const sets: string[] = ["updated_at = ?"];
    const vals: (string | number | null)[] = [ts];
    if (fields.name !== undefined) {
      sets.push("name = ?");
      vals.push(fields.name);
    }
    if (fields.targetBranch !== undefined) {
      sets.push("target_branch = ?");
      vals.push(fields.targetBranch);
    }
    if (fields.repositoryUrl !== undefined) {
      sets.push("repository_url = ?");
      vals.push(fields.repositoryUrl);
    }
    if (fields.isGitRepo !== undefined) {
      sets.push("is_git_repo = ?");
      vals.push(fields.isGitRepo ? 1 : 0);
    }
    if (fields.commands !== undefined) {
      sets.push("commands = ?");
      vals.push(JSON.stringify(fields.commands));
    }
    vals.push(id);
    this.db.prepare(`UPDATE projects SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  }

  // ----- agent_runs (C04) -----
  insertAgentRun(r: AgentRun): void {
    this.db
      .prepare(
        `INSERT INTO agent_runs (id, mission_id, task_id, project_id, agent_id, driver, harness, session_id, pid,
            worktree_path, branch, base_commit, status, error_code, cost_usd, last_activity, error, task_title, project_path,
            started_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        r.id,
        r.missionId,
        r.taskId,
        r.projectId,
        r.agentId,
        r.driver,
        r.harness,
        r.sessionId,
        r.pid,
        r.worktreePath,
        r.branch,
        r.baseCommit,
        r.status,
        r.errorCode,
        r.costUsd,
        r.lastActivity,
        r.error,
        r.taskTitle,
        r.projectPath,
        r.startedAt,
        r.updatedAt,
      );
  }
  getAgentRun(id: string): AgentRun | null {
    const row = this.db.prepare(`SELECT * FROM agent_runs WHERE id = ?`).get(id) as AgentRunRow | undefined;
    return row ? toAgentRun(row) : null;
  }
  listAgentRuns(): AgentRun[] {
    return (this.db.prepare(`SELECT * FROM agent_runs ORDER BY started_at DESC`).all() as unknown as AgentRunRow[]).map(
      toAgentRun,
    );
  }
  updateAgentRunFields(
    id: string,
    fields: Partial<
      Pick<
        AgentRun,
        | "agentId"
        | "sessionId"
        | "pid"
        | "status"
        | "errorCode"
        | "costUsd"
        | "lastActivity"
        | "error"
        | "worktreePath"
        | "branch"
      >
    >,
    ts: number,
  ): void {
    const col: Record<string, string> = {
      agentId: "agent_id",
      sessionId: "session_id",
      pid: "pid",
      status: "status",
      errorCode: "error_code",
      costUsd: "cost_usd",
      lastActivity: "last_activity",
      error: "error",
      worktreePath: "worktree_path",
      branch: "branch",
    };
    const sets: string[] = ["updated_at = ?"];
    const vals: (string | number | null)[] = [ts];
    for (const [key, value] of Object.entries(fields)) {
      const column = col[key];
      if (!column || value === undefined) continue;
      sets.push(`${column} = ?`);
      vals.push(value as string | number | null);
    }
    vals.push(id);
    this.db.prepare(`UPDATE agent_runs SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  }

  // ----- integration_runs (D06, 第四阶段) -----
  insertIntegrationRun(r: IntegrationRun): void {
    this.db
      .prepare(
        `INSERT INTO integration_runs (id, mission_id, branch, worktree_path, target_branch, base_commit,
            result_commit, merged_branches, conflicts, status, validation_run_ids, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        r.id,
        r.missionId,
        r.branch,
        r.worktreePath,
        r.targetBranch,
        r.baseCommit,
        r.resultCommit,
        JSON.stringify(r.mergedBranches),
        JSON.stringify(r.conflicts),
        r.status,
        JSON.stringify(r.validationRunIds),
        r.createdAt,
        r.updatedAt,
      );
  }
  getIntegrationRun(id: string): IntegrationRun | null {
    const row = this.db.prepare(`SELECT * FROM integration_runs WHERE id = ?`).get(id) as IntegrationRunRow | undefined;
    return row ? toIntegrationRun(row) : null;
  }
  getLatestIntegrationByMission(missionId: string): IntegrationRun | null {
    const row = this.db
      .prepare(`SELECT * FROM integration_runs WHERE mission_id = ? ORDER BY created_at DESC LIMIT 1`)
      .get(missionId) as IntegrationRunRow | undefined;
    return row ? toIntegrationRun(row) : null;
  }
  updateIntegrationRunFields(
    id: string,
    fields: Partial<Pick<IntegrationRun, "resultCommit" | "mergedBranches" | "conflicts" | "status" | "validationRunIds">>,
    ts: number,
  ): void {
    const sets: string[] = ["updated_at = ?"];
    const vals: (string | number | null)[] = [ts];
    if (fields.resultCommit !== undefined) {
      sets.push("result_commit = ?");
      vals.push(fields.resultCommit);
    }
    if (fields.mergedBranches !== undefined) {
      sets.push("merged_branches = ?");
      vals.push(JSON.stringify(fields.mergedBranches));
    }
    if (fields.conflicts !== undefined) {
      sets.push("conflicts = ?");
      vals.push(JSON.stringify(fields.conflicts));
    }
    if (fields.status !== undefined) {
      sets.push("status = ?");
      vals.push(fields.status);
    }
    if (fields.validationRunIds !== undefined) {
      sets.push("validation_run_ids = ?");
      vals.push(JSON.stringify(fields.validationRunIds));
    }
    vals.push(id);
    this.db.prepare(`UPDATE integration_runs SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  }

  // ----- validation_runs (G02/G03/G04) -----
  insertValidationRun(r: ValidationRun): void {
    this.db
      .prepare(
        `INSERT INTO validation_runs (id, mission_id, task_id, scope, command, exit_code, output, ok, started_at, finished_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(r.id, r.missionId, r.taskId, r.scope, r.command, r.exitCode, r.output, r.ok ? 1 : 0, r.startedAt, r.finishedAt);
  }
  listValidationRunsByMission(missionId: string): ValidationRun[] {
    return (
      this.db.prepare(`SELECT * FROM validation_runs WHERE mission_id = ? ORDER BY started_at ASC`).all(missionId) as unknown as ValidationRunRow[]
    ).map(toValidationRun);
  }

  // ----- approvals (B08) -----
  insertApproval(a: Approval): void {
    this.db
      .prepare(`INSERT INTO approvals (id, mission_id, stage, decision, approved_by, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(a.id, a.missionId, a.stage, a.decision, a.approvedBy, a.note, a.createdAt);
  }
  listApprovalsByMission(missionId: string): Approval[] {
    return (
      this.db.prepare(`SELECT * FROM approvals WHERE mission_id = ? ORDER BY created_at ASC`).all(missionId) as unknown as ApprovalRow[]
    ).map(toApproval);
  }
}
