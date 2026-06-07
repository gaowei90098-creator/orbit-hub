import type { Store } from "./store.js";
import type { EventBus } from "./events.js";
import type { ClaimResult, Task, TaskStatus } from "./types.js";
import { newId } from "./id.js";

export interface CreateTaskInput {
  title: string;
  description?: string;
  dependsOn?: string[];
  files?: string[];
  createdBy?: string | null;
}

// Shared task board: create, list, atomic claim (dependency-aware), update, release.
export class Tasks {
  constructor(
    private readonly store: Store,
    private readonly events: EventBus,
  ) {}

  create(input: CreateTaskInput): Task {
    const now = Date.now();
    const task: Task = {
      id: newId("t"),
      title: input.title,
      description: input.description ?? "",
      status: "todo",
      assignee: null,
      dependsOn: input.dependsOn ?? [],
      files: input.files ?? [],
      note: "",
      createdBy: input.createdBy ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.store.insertTask(task);
    this.events.emit("task_created", task);
    return task;
  }

  list(status?: TaskStatus): Task[] {
    return this.store.listTasks(status);
  }

  get(id: string): Task | null {
    return this.store.getTask(id);
  }

  // Atomic claim: fails if the task is missing, blocked by unfinished deps, or already claimed.
  claim(taskId: string, agentId: string): ClaimResult {
    const task = this.store.getTask(taskId);
    if (!task) return { ok: false, reason: "not_found" };

    const blockedBy = task.dependsOn
      .map((id) => this.store.getTask(id))
      .filter((d): d is Task => d !== null && d.status !== "done");
    if (blockedBy.length > 0) return { ok: false, reason: "blocked", task, blockedBy };

    const won = this.store.tryAssignTask(taskId, agentId, Date.now());
    if (!won) {
      const current = this.store.getTask(taskId);
      const heldBy = current?.assignee ? this.store.getAgent(current.assignee) : null;
      return { ok: false, reason: "already_claimed", task: current ?? task, heldBy };
    }

    const claimed = this.store.getTask(taskId)!;
    this.store.setAgentCurrentTask(agentId, taskId);
    this.events.emit("task_updated", claimed);
    const agent = this.store.getAgent(agentId);
    if (agent) this.events.emit("agent_updated", agent);
    return { ok: true, task: claimed };
  }

  // Operator-driven assignment from the dashboard: hand a task directly to an agent
  // (unlike claim, which is agent-initiated and atomic). Overrides any prior assignee.
  assign(taskId: string, agentId: string): Task | null {
    const task = this.store.getTask(taskId);
    if (!task) return null;
    const nextStatus: TaskStatus = task.status === "todo" || task.status === "done" ? "claimed" : task.status;
    this.store.updateTaskFields(taskId, { assignee: agentId, status: nextStatus }, Date.now());
    this.store.setAgentCurrentTask(agentId, taskId);
    const updated = this.store.getTask(taskId)!;
    this.events.emit("task_updated", updated);
    const agent = this.store.getAgent(agentId);
    if (agent) this.events.emit("agent_updated", agent);
    return updated;
  }

  update(taskId: string, fields: { status?: TaskStatus; note?: string }): Task | null {
    const task = this.store.getTask(taskId);
    if (!task) return null;
    this.store.updateTaskFields(taskId, fields, Date.now());
    const updated = this.store.getTask(taskId)!;

    // Keep the assignee's "current task" pointer in sync with status.
    if (updated.assignee) {
      if (updated.status === "in_progress") {
        this.store.setAgentCurrentTask(updated.assignee, updated.id);
      } else if (updated.status === "done") {
        const agent = this.store.getAgent(updated.assignee);
        if (agent && agent.currentTaskId === updated.id) this.store.setAgentCurrentTask(updated.assignee, null);
      }
    }

    this.events.emit("task_updated", updated);
    if (updated.assignee) {
      const agent = this.store.getAgent(updated.assignee);
      if (agent) this.events.emit("agent_updated", agent);
    }
    return updated;
  }

  // Return a claimed task to the pool (unassign + back to todo).
  release(taskId: string): Task | null {
    const task = this.store.getTask(taskId);
    if (!task) return null;
    const prevAssignee = task.assignee;
    this.store.updateTaskFields(taskId, { assignee: null, status: "todo" }, Date.now());
    if (prevAssignee) {
      const agent = this.store.getAgent(prevAssignee);
      if (agent && agent.currentTaskId === taskId) this.store.setAgentCurrentTask(prevAssignee, null);
    }
    const updated = this.store.getTask(taskId)!;
    this.events.emit("task_updated", updated);
    if (prevAssignee) {
      const agent = this.store.getAgent(prevAssignee);
      if (agent) this.events.emit("agent_updated", agent);
    }
    return updated;
  }
}
