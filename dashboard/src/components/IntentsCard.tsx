import { Crosshair } from "lucide-react";
import type { Agent, Intent } from "../types";
import { harnessColor, nameOf, timeAgo } from "../util";

export function IntentsCard({ intents, agents }: { intents: Intent[]; agents: Agent[] }) {
  const active = intents.filter((i) => i.status !== "withdrawn").slice().reverse();
  return (
    <section className="card">
      <div className="card-head">
        <Crosshair size={15} className="text-[var(--accent)]" />
        <span className="card-title">意图 · 动手前声明</span>
        <span className="ml-auto text-[11px] text-[var(--muted)]">{active.length}</span>
      </div>
      <div className="card-body space-y-2">
        {active.length === 0 ? (
          <p className="py-4 text-center text-[12px] leading-relaxed text-[var(--muted)]">
            还没有声明的意图。
            <br />
            agent 改东西前会先声明「要动什么」，撞车才能提前发现。
          </p>
        ) : (
          active.map((i) => {
            const a = agents.find((x) => x.id === i.agentId);
            const color = a ? harnessColor(a.harness) : "#9aa6bd";
            return (
              <div key={i.id} className="fade-in rounded-xl border border-[var(--line)] bg-black/20 p-2.5">
                <div className="flex items-center gap-2 text-[12px]">
                  <b style={{ color }}>{nameOf(agents, i.agentId)}</b>
                  <span className="chip bg-white/5 text-[var(--muted)]">{i.status === "committed" ? "进行中" : "已声明"}</span>
                  <span className="ml-auto text-[11px] text-[var(--muted)]">{timeAgo(i.createdAt)}</span>
                </div>
                <div className="mt-1 text-[13px] text-[var(--text)]">{i.summary}</div>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {i.resources.map((r) => (
                    <span key={r} className="mono chip bg-white/5 text-[var(--muted-2)]">
                      {r}
                    </span>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
