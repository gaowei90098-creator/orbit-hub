import { buildHarnessProfile, renderWorkerPrompt } from "../core/harness.js";
import type { AgentRunEvent, DriverSpec, RunErrorCode, SpawnSpec, StartRunInput } from "./types.js";

// C01 ClaudeDriver —— 从旧 workers.ts 拆出来的"纯适配器"：只构造启动/恢复命令 + 解析
// stream-json 输出，不持有进程（进程由 ProcessManager 跑、由 RunManager 编排）。

// worker 只允许 Orbit 协作工具 + 本地读写/构建；白名单 + acceptEdits 让它无人值守干活，
// 但不放开危险操作（不是 --dangerously-skip-permissions）。
const DEFAULT_ALLOWED_TOOLS = [
  "mcp__orbit__whoami",
  "mcp__orbit__list_tasks",
  "mcp__orbit__claim_task",
  "mcp__orbit__update_task",
  "mcp__orbit__get_contract",
  "mcp__orbit__acquire_file_lock",
  "mcp__orbit__release_file_lock",
  "mcp__orbit__check_file_locks",
  "mcp__orbit__send_message",
  "mcp__orbit__append_shared_note",
  "Read",
  "Write",
  "Edit",
  "Bash",
];

const DEFAULT_MODEL = process.env.ORBIT_WORKER_MODEL ?? "sonnet";
// 1.3 默认值上调：$2 干不了真活，真实任务的合理预算默认 $10（可被 dashboard / env 覆盖）。
const DEFAULT_BUDGET_USD = Number(process.env.ORBIT_WORKER_BUDGET_USD ?? "10");

// 1.2 同源双渲染：prompt 由共享 HarnessProfile 渲染（与 Codex 完全对称）。
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
      withOrbitProtocol: Boolean(input.mcp),
    }),
    "claude-code",
  );
}

// worker 是独立子进程，认证有一个反直觉的坑（已实测）：不能继承"会话级的认证刷新标记"。
// 当 CLAUDE_CODE_SDK_HAS_OAUTH_REFRESH / *_HAS_HOST_AUTH_REFRESH 存在时，claude 会以为有
// 后台刷新通道、放弃直接用 env 里的 ANTHROPIC_AUTH_TOKEN —— 但子进程够不到那个通道，于是 401。
// 删掉这些标记（连同会话标记）后，claude 老实用继承来的 token 认证，通过。
// 因此【保留】ANTHROPIC_*（token / base_url 都是有效凭证），只剥离会话级标记。
// 跑长任务最稳的是用 ORBIT_WORKER_ANTHROPIC_API_KEY(+_BASE_URL) 给 worker 配独立持久凭证。
export function claudeWorkerEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base };
  for (const key of [
    "CLAUDE_CODE_SDK_HAS_OAUTH_REFRESH",
    "CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH",
    "CLAUDECODE",
    "CLAUDE_CODE_SESSION_ID",
    "CLAUDE_CODE_ENTRYPOINT",
    "CLAUDE_CODE_EXECPATH",
    "CLAUDE_AGENT_SDK_VERSION",
  ]) {
    delete env[key];
  }
  const workerKey = base.ORBIT_WORKER_ANTHROPIC_API_KEY;
  const workerBase = base.ORBIT_WORKER_ANTHROPIC_BASE_URL;
  if (workerKey) env.ANTHROPIC_API_KEY = workerKey;
  if (workerBase) env.ANTHROPIC_BASE_URL = workerBase;
  return env;
}

// 公共标志位（首启与恢复共用）。
function commonArgs(input: StartRunInput): string[] {
  const model = input.model ?? DEFAULT_MODEL;
  const budget = input.budgetUsd ?? DEFAULT_BUDGET_USD;
  const allowed = (input.allowedTools ?? DEFAULT_ALLOWED_TOOLS).join(" ");
  const args: string[] = [];
  if (input.mcp) {
    const mcpConfig = JSON.stringify({ mcpServers: { orbit: { command: input.mcp.command, args: input.mcp.args } } });
    args.push("--mcp-config", mcpConfig, "--strict-mcp-config");
  }
  args.push(
    "--permission-mode",
    "acceptEdits",
    "--allowedTools",
    allowed,
    "--add-dir",
    input.projectPath,
    "--model",
    model,
    "--max-budget-usd",
    String(budget),
    "--output-format",
    "stream-json",
    "--verbose",
  );
  return args;
}

// stream-json 单行（只取关心字段）。
interface ClaudeStreamLine {
  type?: string;
  subtype?: string;
  session_id?: string;
  message?: { content?: Array<{ type: string; text?: string; name?: string }> };
  total_cost_usd?: number;
  is_error?: boolean;
  result?: unknown;
}

// 把 claude 报错文本归类到统一错误码（C09 第一阶段子集）。
export function classifyClaudeError(text: string): RunErrorCode {
  const t = text.toLowerCase();
  if (/401|unauthor|invalid api key|authentication|oauth|not logged|登录/.test(t)) return "auth";
  if (/insufficient|quota|credit|balance|余额|额度/.test(t)) return "quota";
  if (/rate.?limit|429|too many requests|限流/.test(t)) return "rate_limit";
  if (/timeout|timed out|超时/.test(t)) return "timeout";
  return "unknown";
}

// 纯函数：一行 stream-json → 统一事件（导出供单测）。
export function parseClaudeLine(line: string): AgentRunEvent[] {
  let evt: ClaudeStreamLine;
  try {
    evt = JSON.parse(line) as ClaudeStreamLine;
  } catch {
    return [];
  }
  const out: AgentRunEvent[] = [];
  if (typeof evt.session_id === "string" && evt.session_id) {
    out.push({ kind: "session", sessionId: evt.session_id });
  }
  if (evt.type === "assistant" && evt.message?.content) {
    const tool = evt.message.content.find((p) => p.type === "tool_use")?.name;
    const txt = evt.message.content.find((p) => p.type === "text")?.text;
    if (tool) out.push({ kind: "tool", name: tool }, { kind: "activity", text: `调用工具：${tool}` });
    else if (txt && txt.trim()) out.push({ kind: "activity", text: txt.trim().slice(0, 120) });
  } else if (evt.type === "result") {
    const cost = Number(evt.total_cost_usd ?? 0);
    if (cost) out.push({ kind: "cost", costUsd: cost });
    const failed = evt.is_error === true || (evt.subtype !== undefined && evt.subtype !== "success");
    if (failed) {
      const msg = String(evt.result ?? evt.subtype ?? "执行失败").slice(0, 300);
      out.push({ kind: "error", code: classifyClaudeError(msg), message: msg });
    } else {
      out.push({ kind: "status", status: "done", detail: "已完成" });
    }
  }
  return out;
}

export const claudeDriver: DriverSpec = {
  id: "claude-code",
  harness: "claude-code",
  detect: () => import("./detect.js").then((m) => m.detectClaude()),
  buildStart(input: StartRunInput): SpawnSpec {
    const prompt = input.prompt ?? buildPrompt(input);
    return {
      command: "claude",
      args: ["-p", prompt, ...commonArgs(input)],
      cwd: input.projectPath,
      env: claudeWorkerEnv(),
    };
  },
  buildResume(sessionId: string, message: string, input: StartRunInput): SpawnSpec {
    // C05 会话恢复：在已有会话上追加一条指令（同步接口变更/修复要求等）。
    return {
      command: "claude",
      args: ["-p", message, "--resume", sessionId, ...commonArgs(input)],
      cwd: input.projectPath,
      env: claudeWorkerEnv(),
    };
  },
  parseLine: parseClaudeLine,
};
