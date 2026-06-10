import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { buildHarnessProfile, renderWorkerPrompt } from "../core/harness.js";
import type { AgentRunEvent, DriverSpec, RunErrorCode, SpawnSpec, StartRunInput } from "./types.js";

// C02 CodexDriver —— 纯适配器：构造 `codex exec --json` 启动/恢复命令 + 解析 codex 的 JSONL 事件。
// 命令构造与解析逻辑用样例行单测，保证 codex 装上后即可工作。
//
// 认证复用：codex 复用 `codex login` 的本机登录态（与 claude 一样不传模型 API Key）。
// MCP：codex 从 ~/.codex/config.toml 读取 orbit MCP server（由 routes 的 installCodexConfig 写入），
// 因此这里不在命令行重复传 MCP 配置。

// Codex 二进制定位：本机可能是 npm 全局包（在 PATH）或 macOS 桌面应用（不在 PATH）。
// detect 与实际启动必须用同一优先级，否则会出现“检测可用但启动 command not found”。
const CODEX_APP_BIN = "/Applications/Codex.app/Contents/Resources/codex";

function whichSync(cmd: string): string | null {
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!dir) continue;
    const full = path.join(dir, cmd);
    try {
      fs.accessSync(full, fs.constants.X_OK);
      return full;
    } catch {
      // 不可执行或不存在，继续找下一个 PATH 段
    }
  }
  return null;
}

export interface CodexBinProbe {
  onPath: () => string | null;
  appBin: () => string | null;
}

const defaultProbe: CodexBinProbe = {
  onPath: () => whichSync("codex"),
  appBin: () => (process.platform === "darwin" && fs.existsSync(CODEX_APP_BIN) ? CODEX_APP_BIN : null),
};

// PATH 优先（用户显式安装的 codex），macOS 桌面 App 兜底；都没有则回退命令名，让 spawn 给出明确 ENOENT。
export function resolveCodexCommand(probe: CodexBinProbe = defaultProbe): string {
  return probe.onPath() ?? probe.appBin() ?? "codex";
}

// 1.2 同源双渲染：prompt 由共享 HarnessProfile 渲染（与 Claude 完全对称，工具名为裸名）。
function buildPrompt(input: StartRunInput): string {
  return renderWorkerPrompt(
    buildHarnessProfile({
      goal: input.goal,
      taskTitle: input.taskTitle,
      taskId: input.taskId,
      taskDescription: input.taskDescription,
      fileScope: input.fileScope,
      doneWhen: input.doneWhen,
      verifyCommand: input.verifyCommand,
      interfaceRef: input.interfaceRef,
      // Codex 的 MCP 配置来自 ~/.codex/config.toml（installCodexConfig 写入），命令行不传
      // mcp，因此不能据 input.mcp 判断；Codex worker 一律按已接入协作协议渲染。
      withOrbitProtocol: true,
    }),
    "codex",
  );
}

// codex exec 的 JSONL 事件（不同版本字段略有差异，这里做容错解析）。
interface CodexLine {
  type?: string;
  session_id?: string;
  id?: string;
  msg?: {
    type?: string;
    message?: string;
    text?: string;
    session_id?: string;
    command?: unknown;
    error?: string;
    // 部分版本在 token_count 里带 cost；H07：只用供应商自报的 usd，不据 token 估算。
    cost_usd?: number;
    total_cost_usd?: number;
  };
}

export function classifyCodexError(text: string): RunErrorCode {
  const t = text.toLowerCase();
  if (/401|unauthor|invalid api key|authentication|not logged|login|登录/.test(t)) return "auth";
  if (/insufficient|quota|credit|balance|余额|额度/.test(t)) return "quota";
  if (/rate.?limit|429|too many requests|限流/.test(t)) return "rate_limit";
  if (/timeout|timed out|超时/.test(t)) return "timeout";
  return "unknown";
}

function describeCommand(command: unknown): string {
  if (Array.isArray(command)) return command.map(String).join(" ").slice(0, 120);
  if (typeof command === "string") return command.slice(0, 120);
  return "命令";
}

// 纯函数：一行 codex JSONL → 统一事件（导出供单测）。
export function parseCodexLine(line: string): AgentRunEvent[] {
  let evt: CodexLine;
  try {
    evt = JSON.parse(line) as CodexLine;
  } catch {
    return [];
  }
  const out: AgentRunEvent[] = [];
  const sid = evt.session_id ?? evt.msg?.session_id;
  if (typeof sid === "string" && sid) out.push({ kind: "session", sessionId: sid });

  // 顶层 type（旧式）或 msg.type（新式）都尝试。
  const msgType = evt.msg?.type ?? evt.type;
  switch (msgType) {
    case "session.created":
    case "session_configured":
      // session id 已在上面处理。
      break;
    case "task_started":
      out.push({ kind: "status", status: "running", detail: "Codex 开始执行" });
      break;
    case "agent_message":
    case "agent_message_delta": {
      const txt = (evt.msg?.message ?? evt.msg?.text ?? "").trim();
      if (txt) out.push({ kind: "activity", text: txt.slice(0, 120) });
      break;
    }
    case "exec_command_begin":
    case "command_execution_begin": {
      const desc = describeCommand(evt.msg?.command);
      out.push({ kind: "tool", name: "Bash" }, { kind: "activity", text: `运行命令：${desc}` });
      break;
    }
    case "mcp_tool_call_begin": {
      out.push({ kind: "tool", name: "mcp" }, { kind: "activity", text: "调用 MCP 工具" });
      break;
    }
    case "token_count": {
      const usd = Number(evt.msg?.cost_usd ?? evt.msg?.total_cost_usd ?? 0);
      if (usd) out.push({ kind: "cost", costUsd: usd });
      break;
    }
    case "error": {
      const msg = String(evt.msg?.error ?? evt.msg?.message ?? "Codex 执行错误").slice(0, 300);
      out.push({ kind: "error", code: classifyCodexError(msg), message: msg });
      break;
    }
    case "task_complete":
    case "task_finished": {
      const err = evt.msg?.error;
      if (err) out.push({ kind: "error", code: classifyCodexError(String(err)), message: String(err).slice(0, 300) });
      else out.push({ kind: "status", status: "done", detail: "已完成" });
      break;
    }
    default:
      break;
  }
  return out;
}

function commonArgs(input: StartRunInput): string[] {
  const args = ["--json", "--cd", input.projectPath, "--full-auto"];
  if (input.model) args.push("-m", input.model);
  return args;
}

export const codexDriver: DriverSpec = {
  id: "codex",
  harness: "codex",
  detect: () => import("./detect.js").then((m) => m.detectCodex()),
  buildStart(input: StartRunInput): SpawnSpec {
    const prompt = input.prompt ?? buildPrompt(input);
    return {
      command: resolveCodexCommand(),
      args: ["exec", ...commonArgs(input), prompt],
      cwd: input.projectPath,
      env: { ...process.env },
    };
  },
  buildResume(sessionId: string, message: string, input: StartRunInput): SpawnSpec {
    // C05 会话恢复：codex exec resume <session> 在已有会话上追加指令。
    return {
      command: resolveCodexCommand(),
      args: ["exec", "resume", sessionId, ...commonArgs(input), message],
      cwd: input.projectPath,
      env: { ...process.env },
    };
  },
  parseLine: parseCodexLine,
};
