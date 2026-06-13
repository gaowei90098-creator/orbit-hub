import { useMemo, useState } from "react";
import { Rocket, Send, Slash, Loader2, AlertTriangle, Terminal } from "lucide-react";
import type { HubActions } from "../api";
import type { Agent, Mission, Worker } from "../types";
import { isOperator } from "../util";
import {
  SLASH_COMMANDS,
  SLASH_COMMAND_SPECS,
  parseCommand,
  pickLatestMission,
  renderResult,
  renderStatus,
} from "../lib/commands";

type CommandResult = { text: string; tone: "info" | "success" | "danger" };

type Mode =
  | { kind: "launch"; goal: string }
  | { kind: "message"; agent: Agent; content: string }
  | { kind: "message_unknown"; name: string }
  | { kind: "command"; raw: string }
  | { kind: "empty" };

function displayName(agent: Agent): string {
  return agent.role ? `${agent.role}助手` : agent.name;
}

// 一个输入框三合一：文本=启动协作；@名字=发消息给该 Agent；/=命令。
export function CommandInput({
  agents,
  missions,
  workers,
  workspace,
  actions,
}: {
  agents: Agent[];
  missions: Mission[];
  workers: Worker[];
  workspace: string | null;
  actions: HubActions;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<CommandResult | null>(null);
  const peers = useMemo(() => agents.filter((a) => !isOperator(a)), [agents]);

  const mode: Mode = useMemo(() => {
    const t = text.trim();
    if (!t) return { kind: "empty" };
    if (t.startsWith("/")) return { kind: "command", raw: t };
    if (t.startsWith("@")) {
      const space = t.indexOf(" ");
      const name = (space === -1 ? t.slice(1) : t.slice(1, space)).trim();
      const content = space === -1 ? "" : t.slice(space + 1).trim();
      const agent =
        peers.find((a) => displayName(a) === name || a.name === name || a.id === name) ?? null;
      if (!agent) return { kind: "message_unknown", name };
      return { kind: "message", agent, content };
    }
    return { kind: "launch", goal: t };
  }, [text, peers]);

  const hint = useMemo(() => {
    switch (mode.kind) {
      case "launch":
        return { label: "启动协作", tone: "info" as const };
      case "message":
        return { label: `发给 ${displayName(mode.agent)}`, tone: "neutral" as const };
      case "message_unknown":
        return { label: `找不到 Agent「${mode.name}」`, tone: "danger" as const };
      case "command":
        return { label: "命令", tone: "warning" as const };
      default:
        return { label: "", tone: "neutral" as const };
    }
  }, [mode]);

  const submit = async () => {
    if (busy) return;
    setError("");
    setResult(null);
    if (mode.kind === "empty") return;

    if (mode.kind === "launch") {
      setBusy(true);
      try {
        const { launchedRuns } = await actions.launchMission({ goal: mode.goal, projectPath: workspace ?? undefined });
        setText("");
        if (launchedRuns.length === 0 && !workspace) {
          setError("已创建任务，但未设置统一工作区，没有自动拉起 Agent。可在下方设置工作区后用「派 Agent 执行」。");
        }
      } catch {
        setError("启动失败，请确认枢纽在运行、工作区目录存在。");
      } finally {
        setBusy(false);
      }
      return;
    }

    if (mode.kind === "message") {
      if (!mode.content) {
        setError("消息内容为空：在 @名字 后面写要发的话。");
        return;
      }
      setBusy(true);
      try {
        await actions.send(mode.agent.id, mode.content);
        setText("");
      } catch {
        setError("发送失败，请稍后再试。");
      } finally {
        setBusy(false);
      }
      return;
    }

    if (mode.kind === "message_unknown") {
      setError(`找不到名为「${mode.name}」的 Agent，检查名字或先在侧栏连接。`);
      return;
    }

    if (mode.kind === "command") {
      const { cmd, spec } = parseCommand(mode.raw);
      if (!spec) {
        setError(`未知命令 ${cmd}。可用：${SLASH_COMMANDS.join(" ")}`);
        return;
      }
      if (spec.kind === "pending") {
        setError(`命令 ${cmd} 即将接入：${spec.label}`);
        return;
      }
      const mission = spec.needsMission ? pickLatestMission(missions) : null;
      if (spec.needsMission && !mission) {
        setError("还没有进行中的协作，先输入一个目标启动。");
        return;
      }
      // /status 纯读，直接渲染快照。
      if (cmd === "/status") {
        setResult({ text: renderStatus(mission, workers), tone: "info" });
        setText("");
        return;
      }
      setBusy(true);
      try {
        if (cmd === "/result") {
          const detail = await actions.getIntegration(mission!.id);
          setResult({ text: renderResult(detail), tone: "info" });
        } else if (cmd === "/integrate") {
          const integ = await actions.triggerIntegration(mission!.id);
          setResult({ text: `已发起集成（${integ.status}）。完成后用 /result 看结果。`, tone: "success" });
        } else if (cmd === "/cancel") {
          const { stoppedRuns, transitioned } = await actions.cancelMission(mission!.id);
          const head = transitioned ? "已取消该协作" : "该协作已是终态，无需取消";
          setResult({
            text: `${head}，停掉 ${stoppedRuns.length} 个在途 Agent。`,
            tone: transitioned ? "success" : "info",
          });
        }
        setText("");
      } catch {
        if (cmd === "/integrate") {
          setError("集成未成功：可能有合并冲突或验证未通过，去下方「设置与经典视图」的集成面板看详情。");
        } else {
          setError(`命令 ${cmd} 执行失败，请稍后再试。`);
        }
      } finally {
        setBusy(false);
      }
      return;
    }
  };

  return (
    <div className="command-input">
      <div className="command-input-row">
        {mode.kind === "command" ? (
          <Slash size={16} className="command-input-lead" />
        ) : mode.kind === "message" || mode.kind === "message_unknown" ? (
          <Send size={16} className="command-input-lead" />
        ) : (
          <Rocket size={16} className="command-input-lead" />
        )}
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="输入目标启动协作 · @某个Agent 发消息 · / 看命令"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
          }}
        />
        {hint.label && <span className={`command-mode-chip tone-${hint.tone}`}>{hint.label}</span>}
        <button
          className="btn btn-primary btn-small"
          type="button"
          disabled={mode.kind === "empty" || mode.kind === "message_unknown" || busy}
          onClick={() => void submit()}
        >
          {busy ? <Loader2 size={14} className="spin" /> : <Send size={14} />}
          发送
        </button>
      </div>
      {text.trim().startsWith("/") && (
        <div className="command-suggest">
          {SLASH_COMMAND_SPECS.map((s) => (
            <button
              key={s.cmd}
              type="button"
              className="command-suggest-chip"
              title={s.label}
              onClick={() => setText(s.cmd + " ")}
            >
              {s.cmd}
              {s.kind === "pending" && <span className="command-suggest-soon">即将</span>}
            </button>
          ))}
        </div>
      )}
      {error && (
        <small className="command-input-error">
          <AlertTriangle size={13} />
          {error}
        </small>
      )}
      {result && (
        <pre className={`command-result tone-${result.tone}`}>
          <Terminal size={13} className="command-result-lead" />
          {result.text}
        </pre>
      )}
    </div>
  );
}
