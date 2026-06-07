import { useState } from "react";
import { TriangleAlert, Gavel, X } from "lucide-react";
import type { Agent, Conflict, Intent } from "../types";
import type { HubActions } from "../api";
import { harnessColor, nameOf } from "../util";

function ConflictRow({
  conflict,
  intents,
  agents,
  actions,
}: {
  conflict: Conflict;
  intents: Intent[];
  agents: Agent[];
  actions: HubActions;
}) {
  const [note, setNote] = useState("");
  const related = conflict.intentIds
    .map((id) => intents.find((i) => i.id === id))
    .filter((i): i is Intent => Boolean(i));

  return (
    <div className="fade-in rounded-xl border border-[rgba(255,107,129,0.3)] bg-[rgba(255,107,129,0.06)] p-3">
      <div className="flex items-center gap-2">
        <span className="chip" style={{ background: "rgba(255,107,129,0.16)", color: "var(--danger)" }}>
          撞车
        </span>
        <span className="mono truncate text-[12.5px] text-[var(--text)]">{conflict.resource}</span>
      </div>
      <div className="mt-2 space-y-0.5">
        {related.length > 0 ? (
          related.map((i) => {
            const a = agents.find((x) => x.id === i.agentId);
            const color = a ? harnessColor(a.harness) : "#9aa6bd";
            return (
              <div key={i.id} className="text-[12.5px] text-[var(--muted-2)]">
                <b style={{ color }}>{nameOf(agents, i.agentId)}</b> 想：{i.summary}
              </div>
            );
          })
        ) : (
          <div className="text-[12.5px] text-[var(--muted)]">
            涉及：{conflict.agentIds.map((id) => nameOf(agents, id)).join("、")}
          </div>
        )}
      </div>
      <div className="mt-2.5 flex gap-2">
        <input
          className="input py-1.5 text-[12px]"
          placeholder="裁决说明，如：Claude 先改，Codex 等待"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <button
          className="btn btn-primary flex shrink-0 items-center gap-1 py-1.5"
          onClick={() => void actions.resolveConflict(conflict.id, note || "操作员已裁决")}
        >
          <Gavel size={12} /> 裁决
        </button>
        <button
          className="btn flex shrink-0 items-center gap-1 py-1.5"
          onClick={() => void actions.dismissConflict(conflict.id, note || "忽略")}
        >
          <X size={12} /> 忽略
        </button>
      </div>
    </div>
  );
}

export function ConflictsCard({
  conflicts,
  intents,
  agents,
  actions,
}: {
  conflicts: Conflict[];
  intents: Intent[];
  agents: Agent[];
  actions: HubActions;
}) {
  const open = conflicts.filter((c) => c.status === "open");
  const handled = conflicts.length - open.length;
  return (
    <section className="card" style={open.length ? { borderColor: "rgba(255,107,129,0.4)" } : undefined}>
      <div className="card-head">
        <TriangleAlert size={15} className={open.length ? "text-[var(--danger)]" : "text-[var(--muted)]"} />
        <span className="card-title">冲突裁决</span>
        {open.length > 0 && (
          <span className="chip" style={{ background: "rgba(255,107,129,0.16)", color: "var(--danger)" }}>
            {open.length} 待处理
          </span>
        )}
        {handled > 0 && <span className="ml-auto text-[11px] text-[var(--muted)]">已处理 {handled}</span>}
      </div>
      <div className="card-body space-y-2.5">
        {open.length === 0 ? (
          <p className="py-5 text-center text-[12px] leading-relaxed text-[var(--muted)]">
            ✅ 暂无冲突。
            <br />
            两个 agent 动手前都会「声明意图」，一旦撞同一文件，就会出现在这里等你裁决。
          </p>
        ) : (
          open.map((c) => <ConflictRow key={c.id} conflict={c} intents={intents} agents={agents} actions={actions} />)
        )}
      </div>
    </section>
  );
}
