// M4.2 互通门面（旧 P8 A2A）：Agent Card——让 Orbit 对外表现为一个标准 A2A agent。
// 外部 A2A 客户端通过 GET /.well-known/agent.json 发现 Orbit 的身份与能力，
// 再调它的 A2A 端点把整个 Orbit 当作「一个会拆分协作的 agent」来编排。

// Orbit 作为 A2A agent 的版本（对齐 package.json，手动维护）。
export const ORBIT_AGENT_VERSION = "0.1.0";

export interface AgentSkill {
  id: string;
  name: string;
  description: string;
  tags: string[];
  examples?: string[];
}

export interface AgentCard {
  name: string;
  description: string;
  url: string; // A2A 服务基址（JSON-RPC 端点）
  version: string;
  capabilities: { streaming: boolean; pushNotifications: boolean };
  defaultInputModes: string[];
  defaultOutputModes: string[];
  skills: AgentSkill[];
}

// 纯函数：根据枢纽对外地址组装 Agent Card。streaming 暂关（SSE 流式在后续片接入）。
export function buildAgentCard(hubUrl: string): AgentCard {
  const base = hubUrl.replace(/\/+$/, "");
  return {
    name: "Orbit",
    description:
      "多 Agent 协作枢纽：给一个目标，Orbit 自动拆分任务、并行拉起多个 Agent 在隔离工作区里干活，再集成、验证、交付。可作为一个 agent 被外部系统编排。",
    url: `${base}/a2a`,
    version: ORBIT_AGENT_VERSION,
    capabilities: { streaming: false, pushNotifications: false },
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain"],
    skills: [
      {
        id: "launch_collaboration",
        name: "启动多 Agent 协作",
        description: "给定一个目标，自动拆分为多个任务并并行拉起 Agent 协作完成。",
        tags: ["orchestration", "multi-agent", "coding"],
        examples: ["实现用户注册功能", "给这个项目加上深色模式"],
      },
      {
        id: "mission_status",
        name: "查询协作进度",
        description: "查询某次协作的状态、各 Agent 进度与集成结果。",
        tags: ["status", "monitoring"],
        examples: ["看看刚才那个任务进展如何"],
      },
    ],
  };
}
