import { Users } from "lucide-react";
import type { Agent } from "../types";
import { harnessColor, harnessLabel, isOperator, ROLE_PRESETS } from "../util";
import type { HubActions } from "../api";

export function AgentsCard({ agents, actions }: { agents: Agent[]; actions: HubActions }) {
  const peers = agents.filter((a) => !isOperator(a));
  return (
    <section className="card">
      <div className="card-head">
        <Users size={15} className="text-[var(--accent)]" />
        <span className="card-title">参与方 · 角色指派</span>
        <span className="ml-auto text-[11px] text-[var(--muted)]">{peers.length} 个 Agent</span>
      </div>
      <div className="card-body space-y-2">
        {peers.length === 0 ? (
          <p className="py-4 text-center text-[12px] text-[var(--muted)]">
            还没有 Agent 接入。
            <br />
            打开 Claude Code / Codex，让它「用 orbit 工具登记」即可出现在这里。
          </p>
        ) : (
          peers.map((a) => {
            const color = harnessColor(a.harness);
            const online = a.status === "online";
            return (
              <div
                key={a.id}
                className="flex items-center gap-3 rounded-xl border border-[var(--line)] bg-black/20 px-3 py-2.5"
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: online ? "var(--ok)" : "#566", boxShadow: online ? "0 0 8px var(--ok)" : "none" }}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[14px] font-semibold">{a.name}</span>
                    <span className="chip" style={{ background: `${color}1f`, color }}>
                      {harnessLabel(a.harness)}
                    </span>
                  </div>
                  <div className="mt-0.5 truncate text-[11px] text-[var(--muted)]">
                    归属：{a.principal} · {online ? "在线" : "离线"}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <span className="text-[11px] text-[var(--muted)]">角色</span>
                  <select
                    className="select max-w-[110px] py-1.5 text-[12px]"
                    value={a.role ?? ""}
                    onChange={(e) => void actions.setRole(a.id, e.target.value || null)}
                  >
                    <option value="">未指派</option>
                    {ROLE_PRESETS.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                    {a.role && !ROLE_PRESETS.includes(a.role) && <option value={a.role}>{a.role}</option>}
                  </select>
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
