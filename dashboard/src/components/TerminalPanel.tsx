import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { Loader2, TerminalSquare, AlertTriangle } from "lucide-react";
import {
  createTerminal,
  killTerminal,
  resizeTerminal,
  sendTerminalInput,
  terminalStreamUrl,
  type TerminalCommand,
} from "../api";

type Status = "idle" | "connecting" | "running" | "exited" | "unavailable";

// 嵌入式终端：xterm 渲染 + node-pty 真伪终端跑交互式 claude/codex。
// 用你 shell 里登录好的会话直接认证，绕开 headless `claude -p` 的 401。
export function TerminalPanel({ workspace }: { workspace: string | null }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const inputSubRef = useRef<{ dispose: () => void } | null>(null);
  const sessionRef = useRef<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [command, setCommand] = useState<TerminalCommand | null>(null);
  const [error, setError] = useState("");

  // 初始化 xterm 一次；窗口缩放时 fit + 通知后端 PTY resize。
  useEffect(() => {
    if (!hostRef.current) return;
    const term = new Terminal({
      fontSize: 13,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      cursorBlink: true,
      theme: { background: "#0b0e14", foreground: "#d4d7dd", cursor: "#e6862e" },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(hostRef.current);
    try {
      fit.fit();
    } catch {
      /* 容器还没尺寸时忽略 */
    }
    termRef.current = term;
    fitRef.current = fit;
    const onResize = () => {
      try {
        fit.fit();
      } catch {
        /* ignore */
      }
      if (sessionRef.current) void resizeTerminal(sessionRef.current, term.cols, term.rows);
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      inputSubRef.current?.dispose();
      esRef.current?.close();
      if (sessionRef.current) void killTerminal(sessionRef.current);
      term.dispose();
    };
  }, []);

  const launch = async (cmd: TerminalCommand) => {
    const term = termRef.current;
    const fit = fitRef.current;
    if (!term || !fit) return;
    // 关掉上一个会话
    inputSubRef.current?.dispose();
    esRef.current?.close();
    if (sessionRef.current) void killTerminal(sessionRef.current);
    sessionRef.current = null;
    term.reset();
    setError("");
    setCommand(cmd);
    setStatus("connecting");
    try {
      fit.fit();
    } catch {
      /* ignore */
    }

    const r = await createTerminal(cmd, { cwd: workspace ?? undefined, cols: term.cols, rows: term.rows });
    if ("error" in r) {
      setStatus("unavailable");
      setError(r.detail ?? r.error);
      return;
    }
    sessionRef.current = r.id;
    setStatus("running");
    term.focus();

    // 键入 → 回传 PTY
    inputSubRef.current = term.onData((d) => void sendTerminalInput(r.id, d));

    // PTY 输出（base64）→ 写入 xterm（Uint8Array 让 xterm 自己按 UTF-8 解码，多字节安全）
    const es = new EventSource(terminalStreamUrl(r.id));
    esRef.current = es;
    es.addEventListener("data", (e) => {
      const b64 = (e as MessageEvent<string>).data;
      term.write(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
    });
    es.addEventListener("exit", () => {
      setStatus("exited");
      es.close();
    });
  };

  return (
    <div className="terminal-panel">
      <div className="terminal-bar">
        <TerminalSquare size={15} />
        <span className="terminal-title">嵌入终端</span>
        <span className="terminal-hint">用你登录好的会话直接跑，不走 401 的 headless 调用</span>
        <div className="terminal-actions">
          <button
            type="button"
            className={`btn btn-small ${command === "claude" && status === "running" ? "btn-primary" : ""}`}
            disabled={status === "connecting"}
            onClick={() => void launch("claude")}
          >
            {status === "connecting" && command === "claude" ? <Loader2 size={13} className="spin" /> : null}
            启动 Claude
          </button>
          <button
            type="button"
            className={`btn btn-small ${command === "codex" && status === "running" ? "btn-primary" : ""}`}
            disabled={status === "connecting"}
            onClick={() => void launch("codex")}
          >
            {status === "connecting" && command === "codex" ? <Loader2 size={13} className="spin" /> : null}
            启动 Codex
          </button>
        </div>
      </div>

      {status === "unavailable" && (
        <div className="terminal-error">
          <AlertTriangle size={14} />
          <div>
            <b>终端不可用</b>
            <span>{error || "node-pty 未就绪。Electron 下需对原生模块执行 electron-rebuild。"}</span>
          </div>
        </div>
      )}
      {status === "exited" && <div className="terminal-status">会话已结束。点上面按钮可重新启动。</div>}

      <div ref={hostRef} className="terminal-host" />
    </div>
  );
}
