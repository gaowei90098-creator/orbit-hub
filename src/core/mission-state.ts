import type { MissionState } from "./types.js";

// B06 Mission 状态机：合法转换表（规格第六节）。非法转换被拒绝。
// paused/cancelled/failed 为异常态，可从多数运行态进入。
const TRANSITIONS: Record<MissionState, readonly MissionState[]> = {
  draft: ["planning", "cancelled"],
  planning: ["awaiting_plan_approval", "preparing_workspaces", "cancelled", "failed"],
  awaiting_plan_approval: ["preparing_workspaces", "planning", "cancelled"],
  preparing_workspaces: ["running", "failed", "cancelled"],
  running: ["synchronization_required", "validating_agents", "paused", "cancelled", "failed"],
  synchronization_required: ["running", "paused", "cancelled", "failed"],
  validating_agents: ["integrating", "running", "failed", "cancelled"],
  integrating: ["resolving_conflicts", "validating_integration", "failed", "cancelled"],
  resolving_conflicts: ["integrating", "validating_integration", "failed", "cancelled"],
  validating_integration: ["awaiting_final_approval", "resolving_conflicts", "failed", "cancelled"],
  awaiting_final_approval: ["merging", "running", "cancelled"],
  merging: ["completed", "failed"],
  completed: [],
  paused: ["running", "cancelled"],
  cancelled: [],
  failed: ["running", "cancelled"],
};

// 终态：不再有出边（或仅异常出边）。
const TERMINAL: ReadonlySet<MissionState> = new Set<MissionState>(["completed", "cancelled"]);

export function canTransition(from: MissionState, to: MissionState): boolean {
  if (from === to) return true; // 幂等：重复设为同一状态视为允许的 no-op
  return TRANSITIONS[from].includes(to);
}

export function nextStates(from: MissionState): readonly MissionState[] {
  return TRANSITIONS[from];
}

export function isTerminalState(state: MissionState): boolean {
  return TERMINAL.has(state);
}
