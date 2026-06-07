import { spawn } from "node:child_process";
import process from "node:process";
import type { AgentEnvironment, DriverId } from "./types.js";

// A01/A02 环境与登录检测。
// 原则：只运行官方 CLI 自带的命令（--version / login status 之类），绝不读取或扫描
// 用户凭证文件、钥匙串。无法从官方命令判定登录态时，loggedIn 返回 null（未知）+ 给指引，
// 不臆测、不假装成功。

interface CaptureResult {
  code: number | null;
  stdout: string;
  stderr: string;
  spawnError: Error | null;
}

const DETECT_TIMEOUT_MS = 6_000;

// 跑一条命令并收集输出（带超时与 spawn 失败兜底）。检测专用，不进 ProcessManager。
export function runCapture(command: string, args: string[], timeoutMs = DETECT_TIMEOUT_MS): Promise<CaptureResult> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    } catch (err) {
      resolve({ code: null, stdout: "", stderr: "", spawnError: err as Error });
      return;
    }
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (r: CaptureResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ code: null, stdout, stderr, spawnError: new Error("detect timeout") });
    }, timeoutMs);
    timer.unref?.();
    child.stdout?.on("data", (c: Buffer) => (stdout += c.toString()));
    child.stderr?.on("data", (c: Buffer) => (stderr += c.toString()));
    child.on("error", (err) => finish({ code: null, stdout, stderr, spawnError: err }));
    child.on("close", (code) => finish({ code, stdout, stderr, spawnError: null }));
  });
}

// 定位二进制路径（darwin/linux: `which`，win32: `where`）。失败返回 null。
async function whichBin(command: string): Promise<string | null> {
  const finder = process.platform === "win32" ? "where" : "which";
  const r = await runCapture(finder, [command], 3_000);
  if (r.spawnError || r.code !== 0) return null;
  const first = r.stdout
    .split(/\r?\n/)
    .map((s) => s.trim())
    .find(Boolean);
  return first ?? null;
}

// 从 --version 输出里抽出版本号（取第一段 x.y[.z]）。
function extractVersion(text: string): string | null {
  const m = /(\d+\.\d+(?:\.\d+)?(?:[-.\w]*)?)/.exec(text);
  return m ? (m[1] ?? null) : null;
}

export interface ToolPresence {
  name: string;
  available: boolean;
  binPath: string | null;
  version: string | null;
  hint: string;
}

async function detectTool(name: string, command: string, versionArgs: string[], installHint: string): Promise<ToolPresence> {
  const binPath = await whichBin(command);
  const r = await runCapture(command, versionArgs, DETECT_TIMEOUT_MS);
  const available = !r.spawnError && (r.code === 0 || Boolean(extractVersion(r.stdout + r.stderr)));
  const version = available ? extractVersion(r.stdout + r.stderr) : null;
  return { name, available, binPath, version, hint: available ? "" : installHint };
}

export function detectNode(): Promise<ToolPresence> {
  // node 一定在跑（我们就是 node），直接用进程信息，避免无谓 spawn。
  return Promise.resolve({
    name: "node",
    available: true,
    binPath: process.execPath,
    version: process.version.replace(/^v/, ""),
    hint: "",
  });
}

export function detectGit(): Promise<ToolPresence> {
  return detectTool("git", "git", ["--version"], "未检测到 git。请先安装 git 再使用 Orbit 的工作区隔离能力。");
}

// ----- Claude Code -----
// 登录态：Claude Code 没有稳定、零成本的"登录状态"诊断命令；为遵守"不读凭证"约束，
// 这里只确认二进制可用，登录态返回 null（未知）并给指引，由操作员跑一次 `claude` 完成登录。
export async function detectClaude(): Promise<AgentEnvironment> {
  const binPath = await whichBin("claude");
  const r = await runCapture("claude", ["--version"], DETECT_TIMEOUT_MS);
  const available = !r.spawnError && Boolean(extractVersion(r.stdout + r.stderr));
  if (!available) {
    return {
      harness: "claude-code",
      available: false,
      binPath,
      version: null,
      loggedIn: null,
      hint: "未检测到 Claude Code。安装：npm i -g @anthropic-ai/claude-code，然后运行一次 `claude` 完成登录。",
    };
  }
  return {
    harness: "claude-code",
    available: true,
    binPath,
    version: extractVersion(r.stdout + r.stderr),
    loggedIn: null,
    hint: "已检测到 Claude Code。若尚未登录，请在终端运行一次 `claude` 完成登录后再发起协作。",
  };
}

// ----- Codex -----
// Codex 可能作为 npm 全局包 (`codex`) 或 macOS 桌面应用 (`/Applications/Codex.app`) 安装。
// 较新版本提供 `codex login status`，输出含 "Logged in" / "Not logged in"。
// 可用时据此判定登录态；不可用/旧版则返回 null。仍然只跑官方命令，不读凭证。

// macOS 桌面版 Codex 的已知二进制路径。
const CODEX_APP_BIN = "/Applications/Codex.app/Contents/Resources/codex";

async function resolveCodexBin(): Promise<string | null> {
  // 优先 PATH 中的 codex
  const fromPath = await whichBin("codex");
  if (fromPath) return fromPath;
  // 回退：macOS 桌面应用
  if (process.platform === "darwin") {
    const r = await runCapture(CODEX_APP_BIN, ["--version"], DETECT_TIMEOUT_MS);
    if (!r.spawnError) return CODEX_APP_BIN;
  }
  return null;
}

export async function detectCodex(): Promise<AgentEnvironment> {
  const bin = await resolveCodexBin();
  if (!bin) {
    return {
      harness: "codex",
      available: false,
      binPath: null,
      version: null,
      loggedIn: null,
      hint: "未检测到 Codex。安装桌面版 Codex App 或 npm i -g @openai/codex，然后完成登录。",
    };
  }
  const ver = await runCapture(bin, ["--version"], DETECT_TIMEOUT_MS);
  const available = !ver.spawnError && Boolean(extractVersion(ver.stdout + ver.stderr));
  if (!available) {
    return {
      harness: "codex",
      available: false,
      binPath: bin,
      version: null,
      loggedIn: null,
      hint: "检测到 Codex 二进制但版本获取失败。请确认安装完整。",
    };
  }
  const loggedIn = await probeCodexLogin(bin);
  return {
    harness: "codex",
    available: true,
    binPath: bin,
    version: extractVersion(ver.stdout + ver.stderr),
    loggedIn,
    hint: loggedIn === false ? "Codex 已安装但未登录。请运行 `codex login` 后再发起协作。" : "已检测到 Codex。",
  };
}

// 解析 `codex login status`：含 "logged in" 视为已登录, 含 "not logged" 视为未登录, 其余未知。
async function probeCodexLogin(bin = "codex"): Promise<boolean | null> {
  const r = await runCapture(bin, ["login", "status"], DETECT_TIMEOUT_MS);
  if (r.spawnError) return null;
  const out = (r.stdout + r.stderr).toLowerCase();
  if (/not\s+logged|未登录|please\s+log/i.test(out)) return false;
  if (/logged\s*in|已登录/i.test(out)) return true;
  return null;
}

export const DRIVER_DETECTORS: Record<DriverId, () => Promise<AgentEnvironment>> = {
  "claude-code": detectClaude,
  codex: detectCodex,
};

export interface EnvironmentReport {
  node: ToolPresence;
  git: ToolPresence;
  agents: AgentEnvironment[];
  // 至少有一个 agent 可用且 git 可用，才算"具备协作前置条件"。
  ok: boolean;
  checkedAt: number;
}

// /api/environment 的聚合检测（A01）。各项并行探测。
export async function detectEnvironment(): Promise<EnvironmentReport> {
  const [node, git, claude, codex] = await Promise.all([detectNode(), detectGit(), detectClaude(), detectCodex()]);
  const agents = [claude, codex];
  return {
    node,
    git,
    agents,
    ok: git.available && agents.some((a) => a.available),
    checkedAt: Date.now(),
  };
}
