import { useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, MessageCircleQuestion } from "lucide-react";
import type { HubActions } from "../api";
import type { Worker, WorkerStatus, WorktreeDiff } from "../types";
import { DiffSummary } from "./DiffSummary";

const STATUS_LABEL: Record<WorkerStatus, string> = {
  starting: "启动中",
  running: "执行中",
  waiting_for_input: "等待输入",
  done: "已完成",
  failed: "失败",
  stopped: "已停止",
};

const STATUS_TONE: Record<WorkerStatus, string> = {
  starting: "neutral",
  running: "info",
  waiting_for_input: "warning",
  done: "success",
  failed: "danger",
  stopped: "neutral",
};

function harnessTag(harness: string): string {
  if (harness === "claude-code") return "Claude Code";
  if (harness === "codex") return "Codex";
  return harness;
}

// 并行 worker 栏：每个 worker 一栏，实时活动滚动在栏内（视频「广播对比」的落地版）。
// 逐 token 流式留待将来的可选 proxy 模式；当前以 lastActivity 做近实时进度。
export function WorkerColumns({ workers, actions }: { workers: Worker[]; actions: HubActions }) {
  const [diffs, setDiffs] = useState<Record<string, WorktreeDiff>>({});
  const [openDiff, setOpenDiff] = useState<string | null>(null);

  if (workers.length === 0) return null;

  const loadDiff = async (runId: string) => {
    if (openDiff === runId) {
      setOpenDiff(null);
      return;
    }
    if (!diffs[runId]) {
      const d = await actions.getRunDiff(runId);
      if (d) setDiffs((prev) => ({ ...prev, [runId]: d }));
    }
    setOpenDiff(runId);
  };

  return (
    <div className="worker-columns">
      {workers.map((worker) => (
        <div key={worker.id} className={`worker-column tone-${STATUS_TONE[worker.status]}`}>
          <div className="worker-column-head">
            <b>{worker.taskTitle}</b>
            <span className="worker-column-tag">{harnessTag(worker.harness)}</span>
          </div>
          <div className="worker-column-status">
            <span className="worker-column-icon">
              {worker.status === "done" ? (
                <CheckCircle2 size={14} />
              ) : worker.status === "failed" ? (
                <AlertTriangle size={14} />
              ) : worker.status === "waiting_for_input" ? (
                <MessageCircleQuestion size={14} />
              ) : (
                <Loader2 size={14} className="spin" />
              )}
            </span>
            <span className={`state-badge ${STATUS_TONE[worker.status]}`}>{STATUS_LABEL[worker.status]}</span>
            {worker.costUsd > 0 && <span className="worker-column-cost">${worker.costUsd.toFixed(2)}</span>}
          </div>
          <p className="worker-column-activity">{worker.status === "failed" ? worker.error : worker.lastActivity || "…"}</p>
          {worker.status === "done" && (
            <button className="btn btn-small" type="button" onClick={() => void loadDiff(worker.id)}>
              {openDiff === worker.id ? "收起改动" : "查看改动"}
            </button>
          )}
          {openDiff === worker.id && diffs[worker.id] && (
            <div className="worker-column-diff">
              <DiffSummary diff={diffs[worker.id]} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
