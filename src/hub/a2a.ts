import type { Mission, MissionState, Task } from "../core/types.js";

// M4.2 A2A 端点：把 Orbit 当作一个 A2A agent 调用。JSON-RPC 2.0，方法：
//   message/send —— 发一个目标，Orbit 内部拆分并拉起多 Agent 协作，返回一个 Task；
//   tasks/get    —— 按 task id（= missionId）查协作进度，返回 Task 当前状态。
// 这里只放纯逻辑（协议解析 / 状态映射 / Task 组装），副作用（拉起协作）由 routes 注入。

export interface JsonRpcRequest {
  jsonrpc: string;
  id: string | number | null;
  method: string;
  params?: unknown;
}

// A2A 任务状态机（子集）。映射自 Orbit 的 mission 状态。
export type A2ATaskState = "submitted" | "working" | "input-required" | "completed" | "canceled" | "failed";

export interface A2ATask {
  id: string; // = missionId
  contextId: string; // 单 mission 单上下文，先等于 missionId
  status: { state: A2ATaskState; timestamp: string };
  metadata: { goal: string; taskCount: number };
}

// JSON-RPC 标准错误码（A2A 复用）。
export const RPC_PARSE_ERROR = -32700;
export const RPC_INVALID_REQUEST = -32600;
export const RPC_METHOD_NOT_FOUND = -32601;
export const RPC_INVALID_PARAMS = -32602;

export function rpcResult(id: JsonRpcRequest["id"], result: unknown): object {
  return { jsonrpc: "2.0", id, result };
}

export function rpcError(id: JsonRpcRequest["id"], code: number, message: string): object {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

// 校验 JSON-RPC 信封；返回 null 表示合法，否则返回错误信息。
export function validateRpc(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return "request body must be a JSON-RPC object";
  const b = body as Record<string, unknown>;
  if (b.jsonrpc !== "2.0") return 'jsonrpc must be "2.0"';
  if (typeof b.method !== "string" || b.method.length === 0) return "method is required";
  return null;
}

// 从 message/send 的 params 里抽取用户文本（拼接所有 text part）。
export function extractMessageText(params: unknown): string {
  const message = (params as { message?: { parts?: unknown } } | undefined)?.message;
  const parts = (message?.parts ?? []) as Array<{ kind?: string; text?: string }>;
  return parts
    .filter((p) => (p.kind === undefined || p.kind === "text") && typeof p.text === "string")
    .map((p) => p.text!.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

// Orbit mission 状态 → A2A 任务状态。
export function missionStateToA2A(state: MissionState | undefined): A2ATaskState {
  switch (state) {
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "cancelled":
      return "canceled";
    case "awaiting_plan_approval":
    case "awaiting_final_approval":
      return "input-required"; // 需要人工/调用方介入
    case undefined:
    case "draft":
    case "planning":
    case "preparing_workspaces":
      return "submitted";
    default:
      return "working"; // running / 各 validating / integrating / resolving_conflicts / merging…
  }
}

export function buildTask(mission: Mission, tasks: Task[]): A2ATask {
  return {
    id: mission.id,
    contextId: mission.id,
    status: { state: missionStateToA2A(mission.state), timestamp: new Date().toISOString() },
    metadata: { goal: mission.goal, taskCount: tasks.length },
  };
}
