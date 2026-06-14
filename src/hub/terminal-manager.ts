import type { IPty } from "node-pty";
import { newId } from "../core/id.js";

// 嵌入式终端：用 node-pty 起一个真实伪终端跑交互式 CLI（claude / codex / shell）。
// 关键价值——worker 用「你已经登录好的交互式会话」直接跑，不走 headless `claude -p` 的
// API 认证（订阅 OAuth 在子进程里刷新不了 → 401 的根因就在那）。前端用 xterm 渲染。
//
// node-pty 是原生模块（Electron 里需 electron-rebuild）。这里【懒加载】：加载失败不拖垮
// 整个枢纽，只是终端功能返回 terminal_unavailable，其余照常。

type Listener = (chunk: string) => void;

export interface TerminalSession {
  id: string;
  command: string;
  cwd: string;
  pty: IPty;
  scrollback: string[]; // 近期输出，供后连接的订阅者补屏
  listeners: Set<Listener>;
  exitListeners: Set<(code: number) => void>;
  exited: boolean;
  exitCode: number | null;
}

const SCROLLBACK_CHUNKS = 2000;

// 懒加载 node-pty 的 spawn（兼容 CJS 默认导出/具名导出）。失败抛 terminal_unavailable。
let spawnFn: typeof import("node-pty").spawn | null = null;
async function loadPtySpawn(): Promise<typeof import("node-pty").spawn> {
  if (spawnFn) return spawnFn;
  let mod: typeof import("node-pty");
  try {
    mod = await import("node-pty");
  } catch (err) {
    throw new Error(`terminal_unavailable: node-pty 未就绪（Electron 下需 electron-rebuild）：${(err as Error).message}`);
  }
  const spawn = mod.spawn ?? (mod as { default?: typeof import("node-pty") }).default?.spawn;
  if (typeof spawn !== "function") throw new Error("terminal_unavailable: node-pty.spawn 不可用");
  spawnFn = spawn;
  return spawn;
}

export interface CreateTerminalInput {
  command: string;
  args?: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  cols?: number;
  rows?: number;
}

export class TerminalManager {
  private readonly sessions = new Map<string, TerminalSession>();

  // 是否可用（探测 node-pty 能否加载），供前端按钮置灰 + 路由给出清晰错误。
  async available(): Promise<boolean> {
    try {
      await loadPtySpawn();
      return true;
    } catch {
      return false;
    }
  }

  async create(input: CreateTerminalInput): Promise<TerminalSession> {
    const spawn = await loadPtySpawn();
    const id = newId("term");
    const pty = spawn(input.command, input.args ?? [], {
      name: "xterm-color",
      cols: input.cols ?? 80,
      rows: input.rows ?? 30,
      cwd: input.cwd,
      env: input.env ?? process.env,
    });
    const session: TerminalSession = {
      id,
      command: input.command,
      cwd: input.cwd,
      pty,
      scrollback: [],
      listeners: new Set(),
      exitListeners: new Set(),
      exited: false,
      exitCode: null,
    };
    pty.onData((chunk) => {
      session.scrollback.push(chunk);
      if (session.scrollback.length > SCROLLBACK_CHUNKS) session.scrollback.shift();
      for (const fn of session.listeners) fn(chunk);
    });
    pty.onExit(({ exitCode }) => {
      session.exited = true;
      session.exitCode = exitCode;
      for (const fn of session.exitListeners) fn(exitCode);
    });
    this.sessions.set(id, session);
    return session;
  }

  get(id: string): TerminalSession | null {
    return this.sessions.get(id) ?? null;
  }

  list(): { id: string; command: string; cwd: string; exited: boolean }[] {
    return [...this.sessions.values()].map((s) => ({ id: s.id, command: s.command, cwd: s.cwd, exited: s.exited }));
  }

  write(id: string, data: string): boolean {
    const s = this.sessions.get(id);
    if (!s || s.exited) return false;
    s.pty.write(data);
    return true;
  }

  resize(id: string, cols: number, rows: number): boolean {
    const s = this.sessions.get(id);
    if (!s || s.exited) return false;
    try {
      s.pty.resize(Math.max(1, cols), Math.max(1, rows));
      return true;
    } catch {
      return false;
    }
  }

  // 订阅输出：先回放 scrollback 补屏，再接增量。返回取消订阅函数。
  subscribe(id: string, onData: Listener, onExit?: (code: number) => void): (() => void) | null {
    const s = this.sessions.get(id);
    if (!s) return null;
    if (s.scrollback.length > 0) onData(s.scrollback.join(""));
    s.listeners.add(onData);
    if (onExit) {
      if (s.exited) onExit(s.exitCode ?? 0);
      else s.exitListeners.add(onExit);
    }
    return () => {
      s.listeners.delete(onData);
      if (onExit) s.exitListeners.delete(onExit);
    };
  }

  kill(id: string): boolean {
    const s = this.sessions.get(id);
    if (!s) return false;
    try {
      s.pty.kill();
    } catch {
      /* 已退出 */
    }
    this.sessions.delete(id);
    return true;
  }

  killAll(): void {
    for (const id of [...this.sessions.keys()]) this.kill(id);
  }
}
