import path from "node:path";
import type { Store } from "./store.js";
import type { EventBus } from "./events.js";
import type { Agent, Mission, MissionState, WorktreePlan } from "./types.js";
import { newId } from "./id.js";
import { canTransition } from "./mission-state.js";

export interface CreateMissionInput {
  goal: string;
  projectId?: string | null;
  projectPath?: string;
  createdBy?: string | null;
  agents?: Agent[];
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

export function buildWorktreePlan(projectPath: string, agents: Agent[]): WorktreePlan[] {
  if (!projectPath.trim()) return [];
  const root = path.resolve(projectPath);
  const parent = path.dirname(root);
  const projectName = path.basename(root);
  return agents.map((agent) => {
    const agentSlug = slug(agent.name || agent.id) || agent.id;
    const branch = `orbit/${agentSlug}`;
    const worktreePath = path.join(parent, `${projectName}-${agentSlug}`);
    return {
      agentId: agent.id,
      agentName: agent.name,
      path: worktreePath,
      branch,
      command: `git -C ${JSON.stringify(root)} worktree add ${JSON.stringify(worktreePath)} -b ${JSON.stringify(branch)}`,
    };
  });
}

export class Missions {
  constructor(
    private readonly store: Store,
    private readonly events: EventBus,
  ) {}

  create(input: CreateMissionInput): Mission {
    const now = Date.now();
    const mission: Mission = {
      id: newId("mission"),
      projectId: input.projectId ?? null,
      goal: input.goal,
      projectPath: input.projectPath?.trim() ?? "",
      status: "active",
      state: "draft",
      taskIds: [],
      worktrees: buildWorktreePlan(input.projectPath ?? "", input.agents ?? []),
      createdBy: input.createdBy ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.store.insertMission(mission);
    this.events.emit("mission_created", mission);
    return mission;
  }

  list(): Mission[] {
    return this.store.listMissions();
  }

  get(id: string): Mission | null {
    return this.store.getMission(id);
  }

  setTaskIds(id: string, taskIds: string[]): Mission | null {
    this.store.updateMission(id, { taskIds }, Date.now());
    const updated = this.store.getMission(id);
    if (updated) this.events.emit("mission_updated", updated);
    return updated;
  }

  archive(id: string): Mission | null {
    this.store.updateMission(id, { status: "archived" }, Date.now());
    const updated = this.store.getMission(id);
    if (updated) this.events.emit("mission_updated", updated);
    return updated;
  }

  // B06 单步状态转换：非法转换被拒绝。同状态视为幂等 no-op。
  transition(id: string, to: MissionState): { ok: boolean; reason?: string; mission: Mission | null } {
    const m = this.store.getMission(id);
    if (!m) return { ok: false, reason: "not_found", mission: null };
    if (m.state === to) return { ok: true, mission: m };
    if (!canTransition(m.state, to)) return { ok: false, reason: "illegal_transition", mission: m };
    this.store.updateMission(id, { state: to }, Date.now());
    const updated = this.store.getMission(id);
    if (updated) this.events.emit("mission_updated", updated);
    return { ok: true, mission: updated };
  }

  // 把 mission 推进到 running（draft→planning→preparing_workspaces→running）。容错：
  // 已在更后状态时，非法中间步被忽略，以最终 getMission 为准。
  markRunning(id: string): Mission | null {
    if (!this.store.getMission(id)) return null;
    for (const to of ["planning", "preparing_workspaces", "running"] as MissionState[]) {
      this.transition(id, to);
    }
    return this.store.getMission(id);
  }
}
