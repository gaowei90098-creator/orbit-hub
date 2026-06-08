import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  GitMerge,
  Loader2,
  Play,
  ShieldCheck,
  ThumbsDown,
  ThumbsUp,
  XCircle,
} from "lucide-react";
import type { HubActions } from "../api";
import type { IntegrationDetail, IntegrationStatus, Mission, Worker } from "../types";
import { DiffSummary } from "./DiffSummary";

const STATUS_LABEL: Record<IntegrationStatus, string> = {
  merging: "合并中",
  conflict: "合并冲突",
  validating: "验证中",
  ready: "待审批",
  failed: "验证失败",
  merged: "已合入",
  rolled_back: "已回滚",
};

const STATUS_TONE: Record<IntegrationStatus, string> = {
  merging: "info",
  conflict: "danger",
  validating: "info",
  ready: "warning",
  failed: "danger",
  merged: "success",
  rolled_back: "danger",
};

export function IntegrationPanel({
  mission,
  workers,
  actions,
}: {
  mission: Mission;
  workers: Worker[];
  actions: HubActions;
}) {
  const [detail, setDetail] = useState<IntegrationDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState("");

  const missionWorkers = workers.filter((w) => w.missionId === mission.id);
  const allDone = missionWorkers.length > 0 && missionWorkers.every((w) => w.status === "done");
  const hasIntegration = detail !== null;

  const refresh = useCallback(async () => {
    const d = await actions.getIntegration(mission.id);
    setDetail(d);
  }, [actions, mission.id]);

  useEffect(() => {
    void refresh();
  }, [refresh, mission.updatedAt]);

  const startIntegration = async () => {
    setLoading(true);
    setError("");
    try {
      await actions.triggerIntegration(mission.id);
      await refresh();
    } catch (err) {
      setError((err as Error).message || "集成失败");
    } finally {
      setLoading(false);
    }
  };

  const approve = async () => {
    setActing(true);
    setError("");
    try {
      await actions.approveMission(mission.id);
      await refresh();
    } catch (err) {
      setError((err as Error).message || "审批失败");
    } finally {
      setActing(false);
    }
  };

  const reject = async () => {
    setActing(true);
    setError("");
    try {
      await actions.rejectMission(mission.id);
      await refresh();
    } catch (err) {
      setError((err as Error).message || "驳回失败");
    } finally {
      setActing(false);
    }
  };

  // Don't show anything if no workers or mission is too early
  if (missionWorkers.length === 0) return null;

  const integ = detail?.integration;

  return (
    <section className="panel-card integration-panel">
      <div className="panel-head">
        <div>
          <h2>集成与审批</h2>
          <p>
            {!hasIntegration
              ? "所有任务完成后可开始集成。"
              : `集成状态：${STATUS_LABEL[integ!.status]}`}
          </p>
        </div>
        {integ && (
          <span className={`state-badge ${STATUS_TONE[integ.status]}`}>
            {STATUS_LABEL[integ.status]}
          </span>
        )}
      </div>

      {/* No integration yet — show trigger button */}
      {!hasIntegration && allDone && (
        <div className="integration-trigger">
          <p>所有 Agent 任务已完成，可以合并各分支并运行验证。</p>
          <button
            className="btn btn-primary"
            disabled={loading}
            onClick={() => void startIntegration()}
          >
            {loading ? <Loader2 size={16} className="spin" /> : <GitMerge size={16} />}
            开始集成
          </button>
        </div>
      )}

      {!hasIntegration && !allDone && (
        <div className="integration-waiting">
          <Loader2 size={16} className="spin" />
          <span>等待所有 Agent 完成任务后开始集成...</span>
        </div>
      )}

      {/* Integration detail */}
      {integ && (
        <div className="integration-detail">
          {/* Merged branches */}
          {integ.mergedBranches.length > 0 && (
            <div className="integration-branches">
              <b>已合并分支：</b>
              {integ.mergedBranches.map((b) => (
                <span key={b} className="branch-badge">{b}</span>
              ))}
            </div>
          )}

          {/* Conflicts */}
          {integ.status === "conflict" && integ.conflicts.length > 0 && (
            <div className="integration-conflicts">
              <AlertTriangle size={15} />
              <div>
                <b>合并冲突</b>
                <ul>
                  {integ.conflicts.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {/* Validation results */}
          {detail!.validations.length > 0 && (
            <div className="integration-validations">
              <b>验证结果：</b>
              {detail!.validations.map((v) => (
                <div key={v.id} className={`validation-row ${v.ok ? "pass" : "fail"}`}>
                  {v.ok ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
                  <code>{v.command}</code>
                  <span>退出码: {v.exitCode}</span>
                  {!v.ok && v.output && (
                    <pre className="validation-output">{v.output.slice(-500)}</pre>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Diff summary */}
          {detail!.diff && (
            <details className="integration-diff-details">
              <summary>
                <ShieldCheck size={14} />
                变更摘要（{detail!.diff.filesChanged} 个文件，+{detail!.diff.insertions} -{detail!.diff.deletions}）
              </summary>
              <DiffSummary diff={detail!.diff} />
            </details>
          )}

          {/* Approval actions */}
          {integ.status === "ready" && (
            <div className="integration-actions">
              <button
                className="btn btn-primary"
                disabled={acting}
                onClick={() => void approve()}
              >
                {acting ? <Loader2 size={16} className="spin" /> : <ThumbsUp size={16} />}
                批准合入
              </button>
              <button
                className="btn btn-danger"
                disabled={acting}
                onClick={() => void reject()}
              >
                <ThumbsDown size={16} />
                驳回
              </button>
            </div>
          )}

          {/* Approvals history */}
          {detail!.approvals.length > 0 && (
            <div className="integration-approvals">
              <b>审批记录：</b>
              {detail!.approvals.map((a) => (
                <div key={a.id} className={`approval-row ${a.decision}`}>
                  {a.decision === "approved" ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
                  <span>{a.decision === "approved" ? "已批准" : "已驳回"}</span>
                  {a.note && <span className="approval-note">{a.note}</span>}
                </div>
              ))}
            </div>
          )}

          {/* Re-integrate after rejection or conflict */}
          {(integ.status === "conflict" || integ.status === "failed" || integ.status === "rolled_back") && (
            <div className="integration-retry">
              <button
                className="btn btn-small"
                disabled={loading}
                onClick={() => void startIntegration()}
              >
                {loading ? <Loader2 size={14} className="spin" /> : <Play size={14} />}
                重新集成
              </button>
            </div>
          )}

          {/* Success state */}
          {integ.status === "merged" && (
            <div className="integration-success">
              <CheckCircle2 size={18} />
              <span>已成功合入目标分支{integ.resultCommit ? ` (${integ.resultCommit.slice(0, 8)})` : ""}</span>
            </div>
          )}
        </div>
      )}

      {error && (
        <p className="launcher-error" role="alert">
          <AlertTriangle size={14} />
          {error}
        </p>
      )}
    </section>
  );
}
