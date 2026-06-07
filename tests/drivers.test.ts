import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";
import { ProcessManager, type ExitInfo } from "../src/drivers/process-manager.js";
import { parseClaudeLine, claudeDriver, claudeWorkerEnv, classifyClaudeError } from "../src/drivers/claude-driver.js";
import { parseCodexLine, codexDriver, classifyCodexError, resolveCodexCommand } from "../src/drivers/codex-driver.js";
import { detectCodex, detectEnvironment } from "../src/drivers/detect.js";
import { getDriver } from "../src/drivers/registry.js";
import type { StartRunInput } from "../src/drivers/types.js";
import { CoordinationCore } from "../src/core/core.js";
import { RunManager } from "../src/hub/run-manager.js";

const baseInput = (over: Partial<StartRunInput> = {}): StartRunInput => ({
  harness: "claude-code",
  missionId: null,
  taskId: "t_1",
  projectId: null,
  taskTitle: "做点事",
  goal: "实现一个功能",
  projectPath: "/tmp/proj",
  ...over,
});

// 用 node 当便宜进程跑 ProcessManager 端到端，证明 Orbit 能启动并监控子进程（H01）。
function runNode(
  pm: ProcessManager,
  key: string,
  code: string,
  opts: { timeoutMs?: number; stopAfterMs?: number } = {},
): Promise<{ lines: string[]; exit: ExitInfo; pid: number | null }> {
  return new Promise((resolve) => {
    const lines: string[] = [];
    const { pid } = pm.start(key, {
      command: process.execPath,
      args: ["-e", code],
      cwd: process.cwd(),
      env: process.env,
      timeoutMs: opts.timeoutMs,
      onLine: (l) => lines.push(l),
      onExit: (exit) => resolve({ lines, exit, pid }),
      onError: (err) =>
        resolve({ lines, exit: { code: null, signal: null, timedOut: false, stopped: false, stderrTail: String(err) }, pid }),
    });
    if (opts.stopAfterMs != null) setTimeout(() => pm.stop(key), opts.stopAfterMs);
  });
}

describe("ProcessManager (H01)", () => {
  it("spawns, streams stdout by line, reports pid and exit code 0", async () => {
    const pm = new ProcessManager();
    const { lines, exit, pid } = await runNode(pm, "k_lines", "process.stdout.write('line1\\nline2\\n')");
    expect(typeof pid).toBe("number");
    expect(lines).toEqual(["line1", "line2"]);
    expect(exit.code).toBe(0);
    expect(exit.timedOut).toBe(false);
    expect(exit.stopped).toBe(false);
  });

  it("flushes a trailing line without newline on close", async () => {
    const pm = new ProcessManager();
    const { lines } = await runNode(pm, "k_tail", "process.stdout.write('only-line')");
    expect(lines).toEqual(["only-line"]);
  });

  it("stop() terminates a running process and marks stopped", async () => {
    const pm = new ProcessManager();
    const p = runNode(pm, "k_stop", "setInterval(()=>{}, 100000)", { stopAfterMs: 50 });
    const { exit, pid } = await p;
    expect(typeof pid).toBe("number");
    expect(exit.stopped).toBe(true);
    expect(pm.isRunning("k_stop")).toBe(false);
  });

  it("enforces a timeout and marks timedOut", async () => {
    const pm = new ProcessManager();
    const { exit } = await runNode(pm, "k_timeout", "setInterval(()=>{}, 100000)", { timeoutMs: 150 });
    expect(exit.timedOut).toBe(true);
  });

  it("surfaces spawn errors via onError (nonexistent command)", async () => {
    const pm = new ProcessManager();
    const result = await new Promise<{ errored: boolean }>((resolve) => {
      pm.start("k_err", {
        command: "definitely-not-a-real-binary-xyz",
        args: [],
        cwd: process.cwd(),
        env: process.env,
        onLine: () => {},
        onExit: () => resolve({ errored: false }),
        onError: () => resolve({ errored: true }),
      });
    });
    expect(result.errored).toBe(true);
  });
});

describe("parseClaudeLine (C06 统一事件)", () => {
  it("captures session id from the init line", () => {
    const events = parseClaudeLine(JSON.stringify({ type: "system", subtype: "init", session_id: "sess-abc" }));
    expect(events).toContainEqual({ kind: "session", sessionId: "sess-abc" });
  });

  it("maps a tool_use to tool + activity", () => {
    const events = parseClaudeLine(
      JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Edit" }] } }),
    );
    expect(events).toContainEqual({ kind: "tool", name: "Edit" });
    expect(events.some((e) => e.kind === "activity")).toBe(true);
  });

  it("maps assistant text to an activity", () => {
    const events = parseClaudeLine(
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "正在实现" }] } }),
    );
    expect(events).toContainEqual({ kind: "activity", text: "正在实现" });
  });

  it("maps a successful result to cost + done", () => {
    const events = parseClaudeLine(JSON.stringify({ type: "result", subtype: "success", total_cost_usd: 0.02, is_error: false }));
    expect(events).toContainEqual({ kind: "cost", costUsd: 0.02 });
    expect(events).toContainEqual({ kind: "status", status: "done", detail: "已完成" });
  });

  it("classifies a 401 result as an auth error", () => {
    const events = parseClaudeLine(JSON.stringify({ type: "result", subtype: "error", is_error: true, result: "401 Unauthorized" }));
    const err = events.find((e) => e.kind === "error");
    expect(err).toBeDefined();
    expect(err && err.kind === "error" && err.code).toBe("auth");
  });

  it("ignores non-JSON lines", () => {
    expect(parseClaudeLine("not json at all")).toEqual([]);
  });

  it("classifyClaudeError maps known categories", () => {
    expect(classifyClaudeError("rate limit 429")).toBe("rate_limit");
    expect(classifyClaudeError("insufficient credit balance")).toBe("quota");
    expect(classifyClaudeError("request timed out")).toBe("timeout");
  });
});

describe("parseCodexLine (C06 统一事件)", () => {
  it("captures session id from session.created", () => {
    const events = parseCodexLine(JSON.stringify({ type: "session.created", session_id: "cdx-1" }));
    expect(events).toContainEqual({ kind: "session", sessionId: "cdx-1" });
  });

  it("maps an agent_message to activity", () => {
    const events = parseCodexLine(JSON.stringify({ msg: { type: "agent_message", message: "已完成接口" } }));
    expect(events).toContainEqual({ kind: "activity", text: "已完成接口" });
  });

  it("maps exec_command_begin to a Bash tool + activity", () => {
    const events = parseCodexLine(JSON.stringify({ msg: { type: "exec_command_begin", command: ["bash", "-c", "ls"] } }));
    expect(events).toContainEqual({ kind: "tool", name: "Bash" });
    expect(events.some((e) => e.kind === "activity")).toBe(true);
  });

  it("maps task_complete to done", () => {
    const events = parseCodexLine(JSON.stringify({ msg: { type: "task_complete" } }));
    expect(events).toContainEqual({ kind: "status", status: "done", detail: "已完成" });
  });

  it("maps an error event and classifies rate limits", () => {
    const events = parseCodexLine(JSON.stringify({ msg: { type: "error", error: "rate limit exceeded" } }));
    const err = events.find((e) => e.kind === "error");
    expect(err && err.kind === "error" && err.code).toBe("rate_limit");
  });

  it("ignores non-JSON lines", () => {
    expect(parseCodexLine("garbage")).toEqual([]);
  });

  it("classifyCodexError maps auth", () => {
    expect(classifyCodexError("please login first")).toBe("auth");
  });
});

describe("driver command construction (C01/C02)", () => {
  it("claude buildStart produces a stream-json headless invocation", () => {
    const spec = claudeDriver.buildStart(baseInput({ projectPath: "/x", mcp: { command: "node", args: ["a"] } }));
    expect(spec.command).toBe("claude");
    expect(spec.args).toContain("-p");
    expect(spec.args).toContain("--output-format");
    expect(spec.args).toContain("stream-json");
    expect(spec.args).toContain("--mcp-config");
    expect(spec.args).toContain("--add-dir");
    expect(spec.args).toContain("/x");
    expect(spec.cwd).toBe("/x");
  });

  it("claude buildResume targets the prior session", () => {
    const spec = claudeDriver.buildResume("sess-x", "继续修复", baseInput());
    expect(spec.args).toContain("--resume");
    expect(spec.args).toContain("sess-x");
    expect(spec.args).toContain("继续修复");
  });

  it("claudeWorkerEnv strips session refresh flags but keeps ANTHROPIC token", () => {
    const env = claudeWorkerEnv({
      ANTHROPIC_AUTH_TOKEN: "keepme",
      CLAUDE_CODE_SDK_HAS_OAUTH_REFRESH: "1",
      CLAUDECODE: "1",
    } as NodeJS.ProcessEnv);
    expect(env.CLAUDE_CODE_SDK_HAS_OAUTH_REFRESH).toBeUndefined();
    expect(env.CLAUDECODE).toBeUndefined();
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe("keepme");
  });

  it("claudeWorkerEnv applies the dedicated worker key override", () => {
    const env = claudeWorkerEnv({
      ORBIT_WORKER_ANTHROPIC_API_KEY: "sk-worker",
      ORBIT_WORKER_ANTHROPIC_BASE_URL: "https://gw.example",
    } as NodeJS.ProcessEnv);
    expect(env.ANTHROPIC_API_KEY).toBe("sk-worker");
    expect(env.ANTHROPIC_BASE_URL).toBe("https://gw.example");
  });

  it("codex buildStart uses `codex exec --json --full-auto`", () => {
    const spec = codexDriver.buildStart(baseInput({ harness: "codex", projectPath: "/y" }));
    expect(spec.command).toMatch(/codex/i); // PATH 命令名或 macOS 桌面 App 绝对路径，均含 codex
    expect(spec.args[0]).toBe("exec");
    expect(spec.args).toContain("--json");
    expect(spec.args).toContain("--full-auto");
    expect(spec.args).toContain("--cd");
    expect(spec.args).toContain("/y");
    expect(spec.args.at(-1)).toContain("实现一个功能"); // prompt 末尾
  });

  it("codex buildResume uses `codex exec resume <session>`", () => {
    const spec = codexDriver.buildResume("cdx-7", "同步接口", baseInput({ harness: "codex" }));
    expect(spec.args.slice(0, 3)).toEqual(["exec", "resume", "cdx-7"]);
    expect(spec.args.at(-1)).toBe("同步接口");
  });

  // detect 能找到桌面版 Codex（不在 PATH），启动 worker 也必须用同一二进制，否则 command not found。
  it("resolveCodexCommand prefers PATH, then desktop app, then the bare command", () => {
    const onPath = "/opt/homebrew/bin/codex";
    const appBin = "/Applications/Codex.app/Contents/Resources/codex";
    expect(resolveCodexCommand({ onPath: () => onPath, appBin: () => appBin })).toBe(onPath);
    expect(resolveCodexCommand({ onPath: () => null, appBin: () => appBin })).toBe(appBin);
    expect(resolveCodexCommand({ onPath: () => null, appBin: () => null })).toBe("codex");
  });

  it("registry selects drivers by harness", () => {
    expect(getDriver("claude-code")?.id).toBe("claude-code");
    expect(getDriver("codex")?.id).toBe("codex");
    expect(getDriver("other")).toBeNull();
  });
});

describe("detect (A01/A02)", () => {
  it("detectEnvironment reports node + git + two agents", async () => {
    const env = await detectEnvironment();
    expect(env.node.available).toBe(true);
    expect(env.git.available).toBe(true);
    expect(env.agents).toHaveLength(2);
  });

  it("detectCodex returns available:false with install guidance when codex is missing", async () => {
    const codex = await detectCodex();
    if (!codex.available) {
      expect(codex.loggedIn).toBeNull();
      expect(codex.hint).toContain("codex");
    } else {
      // 若机器上恰好装了 codex，至少版本号应被识别。
      expect(codex.version).toBeTruthy();
    }
  });
});

// ----- 真实 Claude 端到端：证明 "Orbit 能启动并监控本机 Claude 并落库"（用户选择：默认跑真 Claude）。
// skipIf 守卫：没装 claude 的机器自动跳过，不报错。断言对认证结果鲁棒——无论成功还是 401，
// 只要 Orbit 拿到了 pid、捕获了事件、运行到达终态，就证明了"可启动 + 可监控"。
// 注意：skipIf 在收集阶段求值，所以这里用同步探测（不能用 beforeAll，那时还没赋值）。
function claudeIsAvailable(): boolean {
  try {
    execFileSync("claude", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
const claudeAvailable = claudeIsAvailable();

describe("RunManager × 真实 Claude (端到端验收)", () => {
  it.skipIf(!claudeAvailable)(
    "starts, monitors and persists a real claude run to a terminal state",
    async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-e2e-"));
      const core = new CoordinationCore(":memory:");
      const runs = new RunManager(core);
      let sawPid = false;
      core.events.subscribe((e) => {
        if (e.type === "worker_updated") {
          const r = e.payload as { pid: number | null };
          if (r.pid != null) sawPid = true;
        }
      });

      const run = runs.start({
        harness: "claude-code",
        missionId: null,
        taskId: null,
        projectId: null,
        taskTitle: "冒烟",
        goal: "冒烟测试",
        projectPath: dir,
        // 极小任务：只回复，不用工具、不改文件、不连 MCP；尽量快且便宜。
        prompt: "请直接回复两个字：完成。不要使用任何工具，也不要修改任何文件。",
        budgetUsd: 0.1,
        timeoutMs: 90_000,
      });

      const deadline = Date.now() + 100_000;
      let current = core.store.getAgentRun(run.id);
      while (current && !["done", "failed", "stopped"].includes(current.status) && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 500));
        current = core.store.getAgentRun(run.id);
      }

      expect(current).not.toBeNull();
      expect(["done", "failed", "stopped"]).toContain(current!.status);
      // 证明"被监控"：要么我们看到了 pid，要么捕获了 session/错误码（至少有一项被记录）。
      expect(sawPid || current!.sessionId != null || current!.errorCode != null).toBe(true);

      core.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
    120_000,
  );
});
