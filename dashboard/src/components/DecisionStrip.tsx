import { useState } from "react";
import { AlertTriangle, MessageCircleQuestion, Play, Send, Loader2, ShieldAlert } from "lucide-react";
import type { HubActions } from "../api";
import type { DecisionItem } from "../lib/timeline";

// worker 等待输入时的行内回复框（复用 resume 注入通道）。
function ReplyBox({ runId, actions }: { runId: string; actions: HubActions }) {
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async () => {
    const t = msg.trim();
    if (!t || busy) return;
    setBusy(true);
    const r = await actions.injectWorkerInput(runId, t);
    setBusy(false);
    if (r.ok) setMsg("");
  };
  return (
    <div className="decision-reply">
      <input
        value={msg}
        onChange={(e) => setMsg(e.target.value)}
        placeholder="回复并继续执行，回车发送"
        onKeyDown={(e) => {
          if (e.key === "Enter") void send();
        }}
      />
      <button className="btn btn-small btn-primary" type="button" disabled={!msg.trim() || busy} onClick={() => void send()}>
        {busy ? <Loader2 size={13} className="spin" /> : <Send size={13} />}
      </button>
    </div>
  );
}

// 需要操作员决策的项，置顶高亮，带行内操作。空则不渲染（保持首页清爽）。
export function DecisionStrip({
  decisions,
  actions,
  onOpenSetup,
}: {
  decisions: DecisionItem[];
  actions: HubActions;
  onOpenSetup: () => void;
}) {
  const [dispatching, setDispatching] = useState<string | null>(null);
  if (decisions.length === 0) return null;

  const dispatch = async (taskId: string) => {
    setDispatching(taskId);
    try {
      await actions.dispatchTask(taskId);
    } catch {
      // 失败时操作员可在下方设置工作区后重试
    } finally {
      setDispatching(null);
    }
  };

  return (
    <section className="decision-strip" aria-label="需要决策">
      {decisions.map((d) => (
        <div key={d.id} className={`decision-card tone-${d.tone}`}>
          <span className="decision-icon">
            {d.kind === "worker_waiting" ? (
              <MessageCircleQuestion size={16} />
            ) : d.kind === "conflict" ? (
              <ShieldAlert size={16} />
            ) : (
              <AlertTriangle size={16} />
            )}
          </span>
          <div className="decision-body">
            <b>{d.title}</b>
            <span>{d.detail}</span>
            {d.kind === "worker_waiting" && d.runId && <ReplyBox runId={d.runId} actions={actions} />}
          </div>
          <div className="decision-actions">
            {(d.kind === "task_stalled" || d.kind === "assignee_offline") && d.taskId && (
              <button
                className="btn btn-small"
                type="button"
                disabled={dispatching === d.taskId}
                onClick={() => void dispatch(d.taskId!)}
              >
                {dispatching === d.taskId ? <Loader2 size={13} className="spin" /> : <Play size={13} />}
                派 Agent 执行
              </button>
            )}
            {d.kind === "conflict" && (
              <button className="btn btn-small" type="button" onClick={onOpenSetup}>
                去裁决
              </button>
            )}
          </div>
        </div>
      ))}
    </section>
  );
}
