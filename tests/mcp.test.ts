import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Server } from "node:http";
import { createHubApp } from "../src/hub/server.js";
import { createAgentServer } from "../src/mcp/adapter.js";
import type { Harness } from "../src/core/types.js";

let httpServer: Server;
let hubUrl: string;
const clients: Client[] = [];

beforeEach(async () => {
  const { app } = createHubApp({ dbPath: ":memory:" });
  await new Promise<void>((resolve) => {
    httpServer = app.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = httpServer.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  hubUrl = `http://127.0.0.1:${port}`;
});

afterEach(async () => {
  for (const c of clients) await c.close().catch(() => {});
  clients.length = 0;
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
});

// Connect a real MCP client to a freshly-built adapter server over an in-memory transport.
async function connectAgent(name: string, harness: Harness): Promise<Client> {
  const { server } = await createAgentServer({ hubUrl, agentName: name, harness });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: `${name}-client`, version: "1.0.0" });
  await client.connect(clientTransport);
  clients.push(client);
  return client;
}

interface ToolCallResult {
  content?: { type: string; text?: string }[];
  isError?: boolean;
}
const textOf = (r: ToolCallResult): string => (r.content ?? []).map((c) => c.text ?? "").join("\n");
const call = (c: Client, name: string, args: Record<string, unknown> = {}) =>
  c.callTool({ name, arguments: args }) as Promise<ToolCallResult>;

describe("MCP adapter end-to-end", () => {
  it("injects operating rules as server instructions", async () => {
    const { server } = await createAgentServer({ hubUrl, agentName: "RuleTest", harness: "claude-code" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "rule-test-client", version: "1.0.0" });
    await client.connect(clientTransport);
    clients.push(client);
    const instructions = client.getInstructions();
    expect(instructions).toBeDefined();
    expect(instructions).toContain("claim_task");
    expect(instructions).toContain("acquire_file_lock");
    expect(instructions).toContain("update_contract");
    expect(instructions).toContain("anti-clobber");
    expect(instructions).toContain("Report progress");
  });

  it("propagates progress notes to the shared board", async () => {
    const claude = await connectAgent("Claude", "claude-code");
    const codex = await connectAgent("Codex", "codex");
    const created = textOf(await call(claude, "create_task", { title: "Build API" }));
    const taskId = created.match(/t_[0-9a-f]+/)?.[0];
    expect(taskId).toBeTruthy();
    await call(claude, "claim_task", { task_id: taskId });

    const ack = textOf(
      await call(claude, "update_task", { task_id: taskId, status: "in_progress", note: "路由完成，开始写测试" }),
    );
    expect(ack).toContain("Progress note recorded");

    // 队友（和操作员面板走的是同一份数据）能在任务板上看到最新进展。
    const board = textOf(await call(codex, "list_tasks"));
    expect(board).toContain("路由完成，开始写测试");
  });

  it("exposes the full toolset", async () => {
    const claude = await connectAgent("Claude", "claude-code");
    const tools = await claude.listTools();
    const names = tools.tools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "whoami",
        "list_agents",
        "send_message",
        "get_messages",
        "create_task",
        "list_tasks",
        "claim_task",
        "update_task",
        "release_task",
        "acquire_file_lock",
        "release_file_lock",
        "check_file_locks",
        "get_shared_notes",
        "append_shared_note",
      ]),
    );
  });

  it("sees other connected agents", async () => {
    const claude = await connectAgent("Claude", "claude-code");
    await connectAgent("Codex", "codex");
    const agents = textOf(await call(claude, "list_agents"));
    expect(agents).toContain("Claude");
    expect(agents).toContain("Codex");
  });

  it("delivers a message from one agent to another by name", async () => {
    const claude = await connectAgent("Claude", "claude-code");
    const codex = await connectAgent("Codex", "codex");
    await call(claude, "send_message", { to: "Codex", content: "I changed the /users API" });
    const inbox = textOf(await call(codex, "get_messages"));
    expect(inbox).toContain("I changed the /users API");
    expect(inbox).toContain("Claude");
  });

  it("prevents two agents from claiming the same task", async () => {
    const claude = await connectAgent("Claude", "claude-code");
    const codex = await connectAgent("Codex", "codex");
    const created = textOf(await call(claude, "create_task", { title: "Build API" }));
    const taskId = created.match(/t_[0-9a-f]+/)?.[0];
    expect(taskId).toBeTruthy();

    const first = await call(claude, "claim_task", { task_id: taskId });
    const second = await call(codex, "claim_task", { task_id: taskId });
    expect(textOf(first)).toContain("Claimed");
    expect(second.isError).toBe(true);
    expect(textOf(second)).toContain("already claimed by Claude");
  });

  it("warns on a file-lock conflict naming the holder", async () => {
    const claude = await connectAgent("Claude", "claude-code");
    const codex = await connectAgent("Codex", "codex");
    const lock = textOf(await call(claude, "acquire_file_lock", { paths: ["src/api.ts"] }));
    expect(lock).toContain("Locked");

    const conflict = await call(codex, "acquire_file_lock", { paths: ["src/api.ts"] });
    expect(conflict.isError).toBe(true);
    expect(textOf(conflict)).toContain("held by Claude");
  });

  it("shares notes across agents", async () => {
    const claude = await connectAgent("Claude", "claude-code");
    const codex = await connectAgent("Codex", "codex");
    await call(claude, "append_shared_note", { content: "User type now has an email field" });
    const notes = textOf(await call(codex, "get_shared_notes"));
    expect(notes).toContain("User type now has an email field");
    expect(notes).toContain("Claude");
  });

  it("returns a friendly error for a bad task id", async () => {
    const claude = await connectAgent("Claude", "claude-code");
    const res = await call(claude, "claim_task", { task_id: "nope" });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain("No task with that id");
  });
});
