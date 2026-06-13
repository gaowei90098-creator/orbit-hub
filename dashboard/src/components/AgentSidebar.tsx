import { Bot, Plus } from "lucide-react";
import type { Agent } from "../types";
import { isOperator } from "../util";

function displayName(agent: Agent): string {
  if (agent.role) return `${agent.role}助手`;
  return agent.name;
}

function harnessTag(harness: string): string {
  if (harness === "claude-code") return "Claude Code";
  if (harness === "codex") return "Codex";
  if (harness === "gemini") return "Gemini";
  return harness;
}

// 左侧 Agent 名册：学两个 AgentHub 的共同做法——侧栏放角色/成员，不放功能锚点。
export function AgentSidebar({
  agents,
  onConnect,
}: {
  agents: Agent[];
  onConnect: () => void;
}) {
  const peers = agents.filter((agent) => !isOperator(agent));
  const online = peers.filter((agent) => agent.status === "online").length;

  return (
    <aside className="console-sidebar">
      <div className="console-sidebar-head">
        <span>Agents</span>
        <small>
          在线 {online}/{peers.length}
        </small>
      </div>
      <div className="console-agent-list">
        {peers.length === 0 ? (
          <button className="console-agent-empty" type="button" onClick={onConnect}>
            <Bot size={16} />
            还没有 Agent，点此连接
          </button>
        ) : (
          peers.map((agent) => (
            <div key={agent.id} className={agent.status === "online" ? "console-agent online" : "console-agent"}>
              <span className={agent.status === "online" ? "status-dot online" : "status-dot"} />
              <div className="console-agent-main">
                <b>{displayName(agent)}</b>
                <small>{harnessTag(agent.harness)}</small>
              </div>
              <span className="console-agent-state">{agent.status === "online" ? "在线" : "离线"}</span>
            </div>
          ))
        )}
      </div>
      <button className="console-sidebar-add" type="button" onClick={onConnect}>
        <Plus size={14} />
        连接新 Agent
      </button>
    </aside>
  );
}
