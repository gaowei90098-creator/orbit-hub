import { Users } from "lucide-react";
import type { Agent, Task } from "../types";
import { isOperator } from "../util";

const HARNESS_LABEL: Record<string, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  gemini: "Gemini",
  opencode: "OpenCode",
  other: "其它",
};

// 团队成员视图：按 principal（归属方）分组显示在线状态与各自在做什么。
// 仅在出现 ≥2 个 principal（即真正的团队/跨机场景）时渲染；本地单人场景退化为不显示，
// 由"协作概览"覆盖，避免冗余。
export function TeamMembers({ agents, tasks }: { agents: Agent[]; tasks: Task[] }) {
  const peers = agents.filter((a) => !isOperator(a));

  const groups = new Map<string, Agent[]>();
  for (const a of peers) {
    const key = a.principal || "本机";
    const list = groups.get(key) ?? [];
    list.push(a);
    groups.set(key, list);
  }
  if (groups.size < 2) return null;

  const taskTitle = (id: string | null): string | null =>
    id ? (tasks.find((t) => t.id === id)?.title ?? null) : null;

  const totalOnline = peers.filter((p) => p.status === "online").length;

  return (
    <section className="panel-card team-members">
      <div className="panel-head">
        <div>
          <h2>团队成员</h2>
          <p>按归属方分组，看谁在线、各自在做什么。</p>
        </div>
        <span className="mini-badge">
          <Users size={13} /> {groups.size} 方 · {totalOnline} 在线
        </span>
      </div>
      <div className="team-groups">
        {[...groups.entries()].map(([principal, members]) => {
          const online = members.filter((m) => m.status === "online").length;
          return (
            <div className="team-group" key={principal}>
              <div className="team-group-head">
                <b>{principal}</b>
                <span className={online > 0 ? "team-group-count online" : "team-group-count"}>
                  {online}/{members.length} 在线
                </span>
              </div>
              <div className="team-group-agents">
                {members.map((m) => {
                  const doing = taskTitle(m.currentTaskId);
                  return (
                    <div className="team-agent" key={m.id}>
                      <span className={m.status === "online" ? "status-dot online" : "status-dot"} />
                      <div className="team-agent-body">
                        <b>{m.name}</b>
                        <small>
                          {doing
                            ? `在做：${doing}`
                            : m.role
                              ? `${m.role} · 空闲`
                              : `${HARNESS_LABEL[m.harness] ?? m.harness} · 空闲`}
                        </small>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
