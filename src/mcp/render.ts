import type {
  AcquireLocksResult,
  Agent,
  ClaimResult,
  Conflict,
  Contract,
  DeclareIntentResult,
  Message,
  Note,
  Task,
} from "../core/types.js";

// Turns hub data into concise, action-guiding text. The wording matters: it tells the
// agent what just happened AND what to do next, which is what makes agents collaborate.

export type NameMap = Map<string, string>;

const nameOf = (id: string | null, names: NameMap): string =>
  id ? (names.get(id) ?? id) : "—";

export function renderAgents(agents: Agent[], selfId: string, names: NameMap): string {
  if (agents.length === 0) return "No agents are connected yet.";
  const lines = agents.map((a) => {
    const role = a.role ? ` · 角色:${a.role}` : "";
    const work = a.currentTaskId ? `on ${a.currentTaskId}` : "idle";
    const you = a.id === selfId ? " (you)" : "";
    return `• ${a.name} [${a.harness}]${role} · ${a.status} · ${work}${you}`;
  });
  return `Connected agents (${agents.length}):\n${lines.join("\n")}`;
}

export function renderTasks(tasks: Task[], names: NameMap): string {
  if (tasks.length === 0) return "The task board is empty. Use create_task to add work.";
  const lines = tasks.map((t) => {
    const who = t.assignee ? ` → ${nameOf(t.assignee, names)}` : "";
    const files = t.files.length ? `  files: ${t.files.join(", ")}` : "";
    const deps = t.dependsOn.length ? `  deps: ${t.dependsOn.join(", ")}` : "";
    const scope = t.fileScope.length ? `  fileScope: ${t.fileScope.join(", ")}` : "";
    const verify = t.verifyCommand ? `  verify: \`${t.verifyCommand}\`` : "";
    const done = t.doneWhen ? `  doneWhen: ${t.doneWhen}` : "";
    return `• [${t.status}] ${t.id} — ${t.title}${who}${deps}${files}${scope}${verify}${done}`;
  });
  return `Task board (${tasks.length}):\n${lines.join("\n")}`;
}

export function renderInbox(messages: Message[], names: NameMap): string {
  if (messages.length === 0) return "No new messages.";
  const lines = messages.map((m) => {
    const scope = m.to === "all" ? " (broadcast)" : "";
    return `• ${nameOf(m.from, names)}${scope}: ${m.content}`;
  });
  return `You have ${messages.length} new message(s):\n${lines.join("\n")}`;
}

export function renderClaim(result: ClaimResult, names: NameMap): { text: string; isError: boolean } {
  if (result.ok) {
    return {
      text: `✅ Claimed ${result.task.id} "${result.task.title}". It's yours now.\nNext: acquire_file_lock on the files you'll edit, then update_task to "in_progress", and "done" when finished.`,
      isError: false,
    };
  }
  switch (result.reason) {
    case "not_found":
      return { text: `❌ No task with that id. Run list_tasks to see valid ids.`, isError: true };
    case "blocked": {
      const deps = (result.blockedBy ?? []).map((d) => `${d.id} "${d.title}" [${d.status}]`).join(", ");
      return {
        text: `⛔ "${result.task?.title}" is blocked by unfinished dependencies: ${deps}.\nWait for those to be done, or pick another task with list_tasks status=todo.`,
        isError: true,
      };
    }
    case "already_claimed":
      return {
        text: `⚠️ "${result.task?.title}" is already claimed by ${nameOf(result.heldBy?.id ?? null, names)}.\nPick another task (list_tasks status=todo) or send_message to coordinate.`,
        isError: true,
      };
  }
}

export function renderAcquire(result: AcquireLocksResult, names: NameMap): { text: string; isError: boolean } {
  const parts: string[] = [];
  if (result.granted.length) parts.push(`🔒 Locked (safe to edit): ${result.granted.join(", ")}.`);
  if (result.conflicts.length) {
    const c = result.conflicts
      .map((x) => `${x.path} (held by ${nameOf(x.heldBy?.id ?? null, names)})`)
      .join(", ");
    parts.push(
      `⚠️ Could NOT lock: ${c}.\nSomeone else is editing these. send_message to coordinate, or pick different files / another task — don't edit them blind.`,
    );
  }
  if (parts.length === 0) parts.push("Nothing to lock.");
  return { text: parts.join("\n"), isError: result.conflicts.length > 0 };
}

export function renderCheck(status: { path: string; locked: boolean; heldBy: Agent | null }[]): string {
  return status
    .map((s) => (s.locked ? `• ${s.path} — LOCKED by ${s.heldBy?.name ?? "someone"}` : `• ${s.path} — free`))
    .join("\n");
}

export function renderNotes(notes: Note[], names: NameMap): string {
  if (notes.length === 0) return "No shared notes yet.";
  const lines = notes.map((n) => `• [${nameOf(n.agentId, names)}] ${n.content}`);
  return `Shared notes (${notes.length}):\n${lines.join("\n")}`;
}

export function renderDeclare(result: DeclareIntentResult, names: NameMap): { text: string; isError: boolean } {
  const { intent, conflicts } = result;
  if (conflicts.length === 0) {
    return {
      text: `✅ 已声明意图 ${intent.id}：「${intent.summary}」，资源 ${intent.resources.join(", ")}。无冲突，可以动手。完成后用 update_task / update_contract，并在改了共享接口时通知对方。`,
      isError: false,
    };
  }
  const lines = conflicts.map((c) => {
    const others = c.agentIds.map((id) => nameOf(id, names)).join(" / ");
    return `• 资源 ${c.resource} 与 ${others} 撞车（冲突 ${c.id}）`;
  });
  return {
    text: `⚠️ 意图 ${intent.id} 已记录，但触发冲突，先别动手：\n${lines.join("\n")}\n等操作员裁决，或换其他资源/先与对方协调。`,
    isError: true,
  };
}

export function renderContract(contract: Contract): string {
  if (!contract.apiContract && !contract.designSpec) {
    return "共享约定还是空的。如果你负责定接口/设计规范，用 update_contract 写进去；否则等对方先定。";
  }
  return [
    `共享约定 (v${contract.version}):`,
    `── 接口契约 ──\n${contract.apiContract || "(空)"}`,
    `── 设计规范 ──\n${contract.designSpec || "(空)"}`,
    `照这个来，保证两边代码与 UI 风格一致。`,
  ].join("\n");
}

export function renderConflicts(conflicts: Conflict[], names: NameMap): string {
  const open = conflicts.filter((c) => c.status === "open");
  if (open.length === 0) return "当前没有未解决的冲突。";
  const lines = open.map((c) => {
    const who = c.agentIds.map((id) => nameOf(id, names)).join(" / ");
    return `• ${c.id} · 资源 ${c.resource} · 涉及 ${who}`;
  });
  return `未解决冲突 (${open.length})，等操作员裁决：\n${lines.join("\n")}`;
}

export function buildNameMap(agents: Agent[]): NameMap {
  return new Map(agents.map((a) => [a.id, a.name]));
}
