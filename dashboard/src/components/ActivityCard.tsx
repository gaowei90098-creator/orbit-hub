import { useEffect, useRef, useState } from "react";
import { Activity, Send, Plus, ArrowRight } from "lucide-react";
import type { Agent, Message } from "../types";
import type { HubActions } from "../api";
import { harnessColor, isOperator, nameOf, timeAgo } from "../util";

export function ActivityCard({
  messages,
  agents,
  actions,
}: {
  messages: Message[];
  agents: Agent[];
  actions: HubActions;
}) {
  const peers = agents.filter((a) => !isOperator(a));
  const [to, setTo] = useState("all");
  const [msg, setMsg] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskTo, setTaskTo] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const colorOf = (id: string) => {
    const a = agents.find((x) => x.id === id);
    return a ? harnessColor(a.harness) : "#9aa6bd";
  };
  const send = () => {
    if (!msg.trim()) return;
    void actions.send(to, msg);
    setMsg("");
  };
  const addTask = () => {
    if (!taskTitle.trim()) return;
    void actions.createTask({ title: taskTitle, assignee: taskTo || undefined });
    setTaskTitle("");
    setTaskTo("");
  };

  return (
    <section className="card">
      <div className="card-head">
        <Activity size={15} className="text-[var(--accent)]" />
        <span className="card-title">动态 · 派活</span>
        <span className="ml-auto text-[11px] text-[var(--muted)]">{messages.length} 条</span>
      </div>
      <div className="card-body flex min-h-0 flex-1 flex-col gap-2">
        <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1">
          {messages.length === 0 ? (
            <p className="py-4 text-center text-[12px] text-[var(--muted)]">还没有动态。给 agent 发个指令试试 ↓</p>
          ) : (
            messages.map((m) => (
              <div
                key={m.id}
                className="fade-in rounded-lg bg-black/20 px-2.5 py-1.5 text-[12.5px]"
                style={{ borderLeft: `2px solid ${colorOf(m.from)}` }}
              >
                <div className="flex items-center gap-1.5 text-[11px]">
                  <b style={{ color: colorOf(m.from) }}>{nameOf(agents, m.from)}</b>
                  <ArrowRight size={10} className="text-[var(--muted)]" />
                  <span className="text-[var(--muted-2)]">{m.to === "all" ? "全体" : nameOf(agents, m.to)}</span>
                  <span className="ml-auto text-[var(--muted)]">{timeAgo(m.ts)}</span>
                </div>
                <div className="mt-0.5 whitespace-pre-line text-[var(--text)]">{m.content}</div>
              </div>
            ))
          )}
          <div ref={endRef} />
        </div>

        <div className="flex gap-1.5 border-t border-[var(--line)] pt-2">
          <select className="select max-w-[96px] py-1.5 text-[12px]" value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="all">全体</option>
            {peers.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <input
            className="input py-1.5 text-[12px]"
            placeholder="给 Agent 发指令…"
            value={msg}
            onChange={(e) => setMsg(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
          />
          <button className="btn btn-primary shrink-0 py-1.5" onClick={send}>
            <Send size={13} />
          </button>
        </div>

        <div className="flex gap-1.5">
          <input
            className="input py-1.5 text-[12px]"
            placeholder="新任务标题…"
            value={taskTitle}
            onChange={(e) => setTaskTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addTask()}
          />
          <select
            className="select max-w-[96px] py-1.5 text-[12px]"
            value={taskTo}
            onChange={(e) => setTaskTo(e.target.value)}
          >
            <option value="">不指派</option>
            {peers.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <button className="btn shrink-0 py-1.5" onClick={addTask} title="建任务并指派">
            <Plus size={13} />
          </button>
        </div>
      </div>
    </section>
  );
}
