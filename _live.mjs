// 真机联调：启动真实 hub 子进程 + 两个真实 stdio adapter 子进程（Claude/Codex 实际的连法），
// 挂 SSE 监听，跑完整 MPAC 协作剧本。agent 动作走 MCP 工具，operator 动作走 REST。
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(ROOT, "dist", "cli.js");
const PORT = 4137;
const HUB = `http://127.0.0.1:${PORT}`;

const log = (s) => process.stdout.write(s + "\n");
const ind = (s) => s.split("\n").map((l) => "      " + l).join("\n");

// ---- REST (operator 视角) ----
async function rest(method, p, body) {
  const res = await fetch(HUB + p, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${p} -> ${res.status} ${await res.text()}`);
  return res.json();
}

// ---- MCP tool call (agent 视角) ----
const textOf = (r) => (r.content ?? []).map((c) => c.text ?? "").join("\n");
async function call(client, name, args = {}) {
  const r = await client.callTool({ name, arguments: args });
  return { text: textOf(r), isError: !!r.isError };
}

async function connectAgent(name, harness) {
  const transport = new StdioClientTransport({
    command: "node",
    args: [CLI, "mcp", "--name", name, "--harness", harness, "--hub", HUB],
    stderr: "ignore",
  });
  const client = new Client({ name: `${name}-client`, version: "1.0.0" });
  await client.connect(transport);
  return client;
}

// ---- SSE listener (dashboard 视角：实时推送) ----
function startSse(events) {
  const ctrl = new AbortController();
  (async () => {
    const res = await fetch(HUB + "/api/events", { signal: ctrl.signal });
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (line.startsWith("event:")) events.push(line.slice(6).trim());
      }
    }
  })().catch(() => {});
  return ctrl;
}

let hub;
let claude;
let codex;
let sse;
const events = [];

async function main() {
  // 1. 启动真实 hub 子进程
  hub = spawn("node", [CLI, "start", "--port", String(PORT), "--db", ":memory:"], {
    stdio: ["ignore", "ignore", "inherit"],
  });
  let up = false;
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(HUB + "/healthz");
      if (r.ok) { up = true; break; }
    } catch {}
    await sleep(100);
  }
  if (!up) throw new Error("hub 未能启动");
  log("① Hub 已启动 (真实子进程, " + HUB + ", 内存DB)  ✓");

  // 2. 挂 SSE 监听
  sse = startSse(events);
  await sleep(200);
  log("② SSE 实时推送已连接 (/api/events)  ✓");

  // 3. 两个真实 adapter 子进程上线（Claude Code / Codex 的真实连法）
  claude = await connectAgent("Claude", "claude-code");
  codex = await connectAgent("Codex", "codex");
  log("③ 两个真实 MCP adapter 子进程已连接 (stdio)  ✓");

  // 工具清单（证明新 MPAC 工具确实暴露给了 agent）
  const tools = (await claude.listTools()).tools.map((t) => t.name);
  const mpac = ["declare_intent", "withdraw_intent", "get_contract", "update_contract", "check_conflicts"];
  log("   Claude 可见工具 " + tools.length + " 个，含 MPAC: " + mpac.filter((t) => tools.includes(t)).join(", "));

  // 4. 互相发现
  const seen = await call(claude, "list_agents");
  log("\n④ Claude 看到的在线 agent:");
  log(ind(seen.text));

  // 5. operator 指派角色 + 分工（REST，= 你在面板上的操作）
  const { agents } = await rest("GET", "/api/agents");
  const idOf = (n) => agents.find((a) => a.name === n)?.id;
  const cid = idOf("Claude"), xid = idOf("Codex");
  await rest("POST", `/api/agents/${cid}/role`, { role: "后端" });
  await rest("POST", `/api/agents/${xid}/role`, { role: "前端" });
  log("\n⑤ 操作员指派分工: Claude=后端, Codex=前端  ✓");

  // operator 建两个任务并分别指派（手动分工，不是中控自动拆）
  const t1 = (await rest("POST", "/api/tasks", { title: "实现 /users 后端 API", files: ["src/api/users.ts"] })).task;
  const t2 = (await rest("POST", "/api/tasks", { title: "做 Users 列表前端 UI", files: ["src/ui/Users.tsx"] })).task;
  await rest("POST", `/api/tasks/${t1.id}/assign`, { agent: cid });
  await rest("POST", `/api/tasks/${t2.id}/assign`, { agent: xid });
  log("   操作员派活: " + t1.id + "→Claude, " + t2.id + "→Codex  ✓");

  // 6. 共享约定：后端先定接口契约 + 设计规范
  await call(claude, "update_contract", {
    api_contract: "GET /users -> { users: {id:string,email:string,name:string}[] }",
    design_spec: "主色 #6366f1; 圆角 12px; 字体 Space Grotesk; 列表用卡片",
  });
  log("\n⑥ Claude(后端) 写入共享约定: 接口契约 + 设计规范  ✓");

  // 7. 前端读约定 —— 验证“相互适配 / 设计风格一致”
  const ctr = await call(codex, "get_contract");
  log("\n⑦ Codex(前端) 读到的共享约定 (无需口头沟通, 直接对齐):");
  log(ind(ctr.text));

  // 前端应已收到约定更新的广播通知
  const inbox = await call(codex, "get_messages");
  log("   Codex 收件箱(约定更新通知):");
  log(ind(inbox.text));

  // 8. 各自声明意图 —— 不撞车
  const d1 = await call(claude, "declare_intent", { summary: "实现 /users API", resources: ["src/api/users.ts"] });
  const d2 = await call(codex, "declare_intent", { summary: "做 Users 列表 UI", resources: ["src/ui/Users.tsx"] });
  log("\n⑧ 各自声明意图(分头干活, 不冲突):");
  log(ind("Claude: " + d1.text.split("\n")[0]));
  log(ind("Codex:  " + d2.text.split("\n")[0]));

  // 9. 制造撞车：Codex 也想动后端的文件 —— 自动产生冲突
  const clash = await call(codex, "declare_intent", { summary: "顺手改下 users API", resources: ["src/api/users.ts"] });
  log("\n⑨ Codex 声明也要改 src/api/users.ts → 自动撞车检测:");
  log(ind(clash.text));

  // 10. agent 查冲突
  const conf = await call(codex, "check_conflicts");
  log("\n⑩ Codex check_conflicts:");
  log(ind(conf.text));

  // 11. operator 裁决冲突（REST，= 你在面板上点“裁决”）
  const { conflicts } = await rest("GET", "/api/conflicts");
  const open = conflicts.find((c) => c.status === "open");
  await rest("POST", `/api/conflicts/${open.id}/resolve`, {
    by: "操作员",
    resolution: "src/api/users.ts 归 Claude；Codex 只调用接口，不改实现",
  });
  log("\n⑪ 操作员裁决冲突 " + open.id + " → resolved  ✓");

  // 12. 收尾：Claude 完成任务
  await call(claude, "update_task", { task_id: t1.id, status: "done", note: "API done" });
  log("\n⑫ Claude 标记后端任务完成  ✓");

  // 13. SSE 汇总
  await sleep(300);
  const counts = {};
  for (const e of events) counts[e] = (counts[e] || 0) + 1;
  log("\n⑬ SSE 实时事件统计 (共 " + events.length + " 条, dashboard 会据此实时刷新):");
  log(ind(Object.entries(counts).map(([k, v]) => `${k} ×${v}`).join("\n")));

  log("\n✅ 真机联调通过：两个异构 agent 经真实 stdio adapter 连上 hub，");
  log("   完整跑通【分工→共享约定→相互适配→撞车检测→人工裁决】，全程 SSE 实时推送。");
}

main()
  .catch((e) => { log("\n❌ 联调失败: " + (e?.stack || e)); process.exitCode = 1; })
  .finally(async () => {
    try { sse?.abort(); } catch {}
    try { await claude?.close(); } catch {}
    try { await codex?.close(); } catch {}
    try { hub?.kill("SIGTERM"); } catch {}
    await sleep(200);
    process.exit(process.exitCode ?? 0);
  });
