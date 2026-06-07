import type { Agent } from "./types";

export const OPERATOR_NAME = "操作员";

export const nameOf = (agents: Agent[], id: string | null): string => {
  if (!id) return "—";
  if (id === "all") return "全体";
  return agents.find((a) => a.id === id)?.name ?? id;
};

export const timeAgo = (ts: number): string => {
  if (!ts) return "";
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 5) return "刚刚";
  if (s < 60) return `${s}秒前`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}小时前`;
  return `${Math.floor(h / 24)}天前`;
};

// Agent accent color (hex).
export const harnessColor = (harness: string): string => {
  switch (harness) {
    case "claude-code":
      return "#f4b340"; // amber
    case "codex":
      return "#2fe0c4"; // teal
    case "gemini":
      return "#5ea0ff"; // blue
    case "opencode":
      return "#8b9dff";
    default:
      return "#9aa6bd"; // operator / other
  }
};

export const harnessLabel = (harness: string): string => {
  switch (harness) {
    case "claude-code":
      return "Claude Code";
    case "codex":
      return "Codex";
    case "other":
      return "操作端";
    default:
      return harness;
  }
};

export const isOperator = (a: Agent): boolean => a.name === OPERATOR_NAME || a.harness === "other";

// Preset roles the operator can assign.
export const ROLE_PRESETS = ["前端", "后端", "测试", "设计"];
