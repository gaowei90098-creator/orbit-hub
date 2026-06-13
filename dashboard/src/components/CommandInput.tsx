import { useMemo, useState } from "react";
import { Rocket, Send, Slash, Loader2, AlertTriangle } from "lucide-react";
import type { HubActions } from "../api";
import type { Agent } from "../types";
import { isOperator } from "../util";

// M3 会把这些斜杠命令接成真后台任务（借鉴 codex-plugin-cc）；M1 先占位 + 提示。
const SLASH_COMMANDS = ["/review", "/rescue", "/status", "/result", "/integrate", "/cancel"];

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
  workspace,
  actions,
}: {
  agents: Agent[];
  workspace: string | null;
  actions: HubActions;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
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
      const cmd = mode.raw.split(/\s+/)[0]!;
      if (cmd === "/integrate") {
        setError("集成命令将在 M3 接入；当前请用下方「设置与经典视图」里的集成面板。");
      } else if (SLASH_COMMANDS.includes(cmd)) {
        setError(`命令 ${cmd} 将在 M3（委派命令）接入，敬请期待。`);
      } else {
        setError(`未知命令 ${cmd}。可用：${SLASH_COMMANDS.join(" ")}`);
      }
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
          {SLASH_COMMANDS.map((c) => (
            <button key={c} type="button" className="command-suggest-chip" onClick={() => setText(c + " ")}>
              {c}
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
    </div>
  );
}
