import { spawn, type ChildProcess } from "node:child_process";

// H01 ProcessManager：统一管理 Orbit 拉起的子进程（Claude / Codex 同一套）。
// 只负责"进程级"生命周期——spawn、按行读 stdout、收集 stderr、超时、正常终止/强杀、
// 准确上报 PID 与退出码。它不认识 claude/codex 的语义（那是 Driver 的事），因此可以
// 用任意便宜进程（如 node -e）做端到端测试。

export interface ManagedProcessOptions {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  /** 超时毫秒；到点先 SIGTERM，宽限后 SIGKILL。<=0 表示不限时。 */
  timeoutMs?: number;
  /** SIGTERM 后等待自然退出的宽限期，超过则 SIGKILL。 */
  killGraceMs?: number;
  onLine: (line: string) => void; // 每一行 stdout（已去除换行）
  onStderr?: (chunk: string) => void;
  onExit: (info: ExitInfo) => void;
  onError?: (err: Error) => void;
}

export interface ExitInfo {
  code: number | null;
  signal: NodeJS.Signals | null;
  /** 是否因超时被我们终止。 */
  timedOut: boolean;
  /** 是否因调用 stop()/kill() 被我们主动终止。 */
  stopped: boolean;
  /** 最近的 stderr 尾部（便于错误归因）。 */
  stderrTail: string;
}

interface Managed {
  child: ChildProcess;
  timer: NodeJS.Timeout | null;
  killTimer: NodeJS.Timeout | null;
  stderrTail: string;
  timedOut: boolean;
  stopped: boolean;
}

const DEFAULT_KILL_GRACE_MS = 5_000;
const STDERR_TAIL_CAP = 4_000;

export class ProcessManager {
  private readonly procs = new Map<string, Managed>();

  /** 启动并跟踪一个子进程。key 通常是 runId。返回 pid（启动失败为 null）。 */
  start(key: string, opts: ManagedProcessOptions): { pid: number | null } {
    if (this.procs.has(key)) {
      throw new Error(`process for key "${key}" already running`);
    }

    let child: ChildProcess;
    try {
      child = spawn(opts.command, opts.args, {
        cwd: opts.cwd,
        env: opts.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      // 同步抛出（极少见，如 command 非字符串）也要走 onError，不让调用方崩。
      opts.onError?.(err as Error);
      return { pid: null };
    }

    const managed: Managed = {
      child,
      timer: null,
      killTimer: null,
      stderrTail: "",
      timedOut: false,
      stopped: false,
    };
    this.procs.set(key, managed);

    if (opts.timeoutMs && opts.timeoutMs > 0) {
      managed.timer = setTimeout(() => {
        managed.timedOut = true;
        this.terminate(key, opts.killGraceMs ?? DEFAULT_KILL_GRACE_MS);
      }, opts.timeoutMs);
      managed.timer.unref?.();
    }

    let stdoutBuf = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutBuf += chunk.toString();
      let nl = stdoutBuf.indexOf("\n");
      while (nl !== -1) {
        const line = stdoutBuf.slice(0, nl).replace(/\r$/, "");
        stdoutBuf = stdoutBuf.slice(nl + 1);
        if (line.trim()) {
          try {
            opts.onLine(line);
          } catch {
            /* 解析回调里的异常不应杀掉进程读取 */
          }
        }
        nl = stdoutBuf.indexOf("\n");
      }
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      managed.stderrTail = (managed.stderrTail + chunk.toString()).slice(-STDERR_TAIL_CAP);
      opts.onStderr?.(chunk.toString());
    });

    child.on("error", (err) => {
      this.clearTimers(managed);
      this.procs.delete(key);
      opts.onError?.(err);
    });

    child.on("close", (code, signal) => {
      this.clearTimers(managed);
      this.procs.delete(key);
      // 冲掉残留的最后一行（进程结束未必以换行收尾）。
      const tail = stdoutBuf.replace(/\r$/, "");
      if (tail.trim()) {
        try {
          opts.onLine(tail);
        } catch {
          /* ignore */
        }
      }
      opts.onExit({
        code,
        signal,
        timedOut: managed.timedOut,
        stopped: managed.stopped,
        stderrTail: managed.stderrTail.trim(),
      });
    });

    return { pid: child.pid ?? null };
  }

  isRunning(key: string): boolean {
    return this.procs.has(key);
  }

  pid(key: string): number | null {
    return this.procs.get(key)?.child.pid ?? null;
  }

  runningKeys(): string[] {
    return [...this.procs.keys()];
  }

  /** 正常终止（SIGTERM，宽限后 SIGKILL）。C07：标记为主动停止。 */
  stop(key: string, killGraceMs = DEFAULT_KILL_GRACE_MS): boolean {
    const managed = this.procs.get(key);
    if (!managed) return false;
    managed.stopped = true;
    this.terminate(key, killGraceMs);
    return true;
  }

  /** 强制终止（立刻 SIGKILL）。 */
  kill(key: string): boolean {
    const managed = this.procs.get(key);
    if (!managed) return false;
    managed.stopped = true;
    this.clearTimers(managed);
    managed.child.kill("SIGKILL");
    return true;
  }

  stopAll(): void {
    for (const key of [...this.procs.keys()]) this.stop(key);
  }

  private terminate(key: string, killGraceMs: number): void {
    const managed = this.procs.get(key);
    if (!managed) return;
    managed.child.kill("SIGTERM");
    if (managed.killTimer) return; // 已安排强杀
    managed.killTimer = setTimeout(() => {
      // 若到期仍未退出（close 会删 map），补一刀 SIGKILL。
      if (this.procs.has(key)) managed.child.kill("SIGKILL");
    }, killGraceMs);
    managed.killTimer.unref?.();
  }

  private clearTimers(managed: Managed): void {
    if (managed.timer) clearTimeout(managed.timer);
    if (managed.killTimer) clearTimeout(managed.killTimer);
    managed.timer = null;
    managed.killTimer = null;
  }
}
