import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { HubClient } from "./client.js";
import { OPERATING_RULES } from "./operating-rules.js";
import {
  buildNameMap,
  renderAcquire,
  renderAgents,
  renderCheck,
  renderClaim,
  renderConflicts,
  renderContract,
  renderDeclare,
  renderInbox,
  renderNotes,
  renderTasks,
} from "./render.js";
import type { Harness, TaskStatus } from "../core/types.js";

export interface AdapterConfig {
  hubUrl: string;
  agentName: string;
  harness: Harness;
  token?: string;
  principal?: string; // 归属方(人/团队), 多 principal 协作用
  runId?: string; // M2.2：Orbit 拉起的 worker 携带，注册后自动绑定 run ↔ agentId
}

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };
const text = (s: string, isError = false): ToolResult => ({ content: [{ type: "text", text: s }], isError });

// Friendly error wrapper so a missing/unreachable hub never surfaces as a raw stack trace.
async function guard(fn: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await fn();
  } catch (err) {
    return text(`⚠️ Hub error: ${(err as Error).message}`, true);
  }
}

// Registers this agent with the hub and builds the configured MCP server (no transport yet).
// The agent's own id is injected automatically — the model never has to pass it.
// Split from the stdio entrypoint so tests can drive it over an in-memory transport.
export async function createAgentServer(config: AdapterConfig): Promise<{ server: McpServer; selfId: string }> {
  const client = new HubClient(config.hubUrl, config.token);

  const { agent } = await client.registerAgent(config.agentName, config.harness, config.principal);
  const selfId = agent.id;
  process.stderr.write(`[orbit] registered "${agent.name}" (${selfId}) with hub at ${config.hubUrl}\n`);

  // M2.2：Orbit worker 启动时携带 --run-id，注册后立即绑定 agentId → run，
  // 让 MessageRouter 可以通过 agentId 找到 run 并路由消息。
  if (config.runId) {
    await client.bindRun(config.runId, selfId).catch(() => {});
  }

  // Keep presence fresh; unref so it never holds the process open on its own.
  const heartbeat = setInterval(() => {
    void client.heartbeat(selfId).catch(() => {});
  }, 20_000);
  heartbeat.unref();

  const resolveTarget = async (to: string): Promise<string> => {
    if (to.trim().toLowerCase() === "all") return "all";
    const { agents } = await client.listAgents();
    const match =
      agents.find((a) => a.id === to) ?? agents.find((a) => a.name.toLowerCase() === to.toLowerCase());
    if (!match) {
      const names = agents.map((a) => a.name).join(", ") || "none";
      throw new Error(`No agent "${to}". Connected: ${names}. Use an agent name, an id, or "all".`);
    }
    return match.id;
  };

  const server = new McpServer(
    { name: "orbit", version: "0.1.0" },
    { instructions: OPERATING_RULES },
  );

  server.registerTool(
    "whoami",
    {
      description: "Show your own identity and assigned role on the hub. The operator assigns your role (e.g. 前端/后端).",
      inputSchema: {},
    },
    async () =>
      guard(async () => {
        const { agents } = await client.listAgents();
        const me = agents.find((a) => a.id === selfId);
        const role = me?.role ? `角色: ${me.role}` : "角色: 未指派(等操作员分配)";
        return text(`你是 "${agent.name}" · id ${selfId} · harness ${config.harness} · ${role}.`);
      }),
  );

  server.registerTool(
    "list_agents",
    { description: "List all agents connected to the hub and what each is currently working on.", inputSchema: {} },
    async () =>
      guard(async () => {
        const { agents } = await client.listAgents();
        return text(renderAgents(agents, selfId, buildNameMap(agents)));
      }),
  );

  server.registerTool(
    "send_message",
    {
      description:
        "Send a message to another agent. Use this to coordinate — e.g. announce an API/interface change so the other agent stays compatible. " +
        'Set kind="sync" when announcing an interface/contract change, kind="question" (with requires_reply=true) when you need an answer to proceed, kind="conflict" to halt a peer that is colliding with you (it pauses its in-flight worker until adjudicated); bind task_id to the relevant task so the message shows up in context.',
      inputSchema: {
        to: z.string().describe('Recipient agent name or id, or "all" to broadcast to everyone.'),
        content: z.string().describe("The message text."),
        task_id: z.string().optional().describe("Bind this message to a task id for context."),
        kind: z
          .enum(["normal", "sync", "question", "conflict"])
          .optional()
          .describe('"normal" coordination, "sync" interface/contract change, "question" needs an answer, "conflict" halts the recipient\'s in-flight worker until adjudicated.'),
        reply_to: z.string().optional().describe("Message id this is replying to (threads the conversation)."),
        requires_reply: z.boolean().optional().describe("Set true if you expect a reply before continuing."),
      },
    },
    async (args) =>
      guard(async () => {
        const to = await resolveTarget(args.to);
        await client.sendMessage(selfId, to, args.content, {
          taskId: args.task_id,
          kind: args.kind,
          replyTo: args.reply_to,
          requiresReply: args.requires_reply,
        });
        return text(`📨 Sent to ${args.to}.`);
      }),
  );

  server.registerTool(
    "get_messages",
    { description: "Check your inbox for new messages from other agents (marks them read).", inputSchema: {} },
    async () =>
      guard(async () => {
        const [{ messages }, { agents }] = await Promise.all([client.inbox(selfId), client.listAgents()]);
        return text(renderInbox(messages, buildNameMap(agents)));
      }),
  );

  server.registerTool(
    "orbit_wait",
    {
      description:
        "Block until a message arrives in your inbox (or the timeout elapses), then return all unread messages. " +
        "Use this at a natural checkpoint when you expect a reply or a sync signal from another agent — " +
        "the hub will wake you up the moment a message arrives rather than making you poll. " +
        "Prefer orbit_wait over a get_messages loop; only fall back to get_messages for a one-shot check.",
      inputSchema: {
        timeout_ms: z
          .number()
          .int()
          .min(1_000)
          .max(60_000)
          .optional()
          .describe("Max milliseconds to wait (default 30 000, max 60 000)."),
      },
    },
    async (args) =>
      guard(async () => {
        const { messages } = await client.waitMessages(selfId, args.timeout_ms ?? 30_000);
        if (messages.length === 0) return text("⏳ No new messages (timed out).");
        const { agents } = await client.listAgents();
        return text(renderInbox(messages, buildNameMap(agents)));
      }),
  );

  server.registerTool(
    "create_task",
    {
      description:
        "Add a task to the shared board so work can be divided. Others can then claim it. " +
        "Fill the task contract (file_scope / done_when / verify_command / interface_ref) so parallel work doesn't collide.",
      inputSchema: {
        title: z.string().describe("Short task title."),
        description: z.string().optional().describe("Optional details / acceptance criteria."),
        depends_on: z.array(z.string()).optional().describe("Task ids that must be done first."),
        files: z.array(z.string()).optional().describe("Files this task is expected to touch (advisory)."),
        file_scope: z.array(z.string()).optional().describe("Files/globs this task is ALLOWED to modify (hard boundary)."),
        done_when: z.string().optional().describe("Human-checkable completion criteria."),
        verify_command: z.string().optional().describe("Command that must pass (exit 0) before the task can be marked done."),
        interface_ref: z.string().optional().describe("Shared interfaces/data structures this task touches."),
      },
    },
    async (args) =>
      guard(async () => {
        const { task } = await client.createTask({
          title: args.title,
          description: args.description,
          dependsOn: args.depends_on,
          files: args.files,
          fileScope: args.file_scope,
          doneWhen: args.done_when,
          verifyCommand: args.verify_command,
          interfaceRef: args.interface_ref,
          createdBy: selfId,
        });
        return text(`🆕 Created ${task.id} "${task.title}" (todo). Anyone can now claim it with claim_task.`);
      }),
  );

  server.registerTool(
    "list_tasks",
    {
      description: "Show the shared task board. Always check this before starting work.",
      inputSchema: {
        status: z
          .enum(["todo", "claimed", "in_progress", "done"])
          .optional()
          .describe("Filter by status, e.g. todo to find available work."),
      },
    },
    async (args) =>
      guard(async () => {
        const [{ tasks }, { agents }] = await Promise.all([
          client.listTasks(args.status as TaskStatus | undefined),
          client.listAgents(),
        ]);
        return text(renderTasks(tasks, buildNameMap(agents)));
      }),
  );

  server.registerTool(
    "claim_task",
    {
      description: "Claim a task before working on it so two agents don't do the same thing. Atomic — only one wins.",
      inputSchema: { task_id: z.string().describe("The task id to claim.") },
    },
    async (args) =>
      guard(async () => {
        const [result, { agents }] = await Promise.all([client.claimTask(args.task_id, selfId), client.listAgents()]);
        const r = renderClaim(result, buildNameMap(agents));
        return text(r.text, r.isError);
      }),
  );

  server.registerTool(
    "update_task",
    {
      description:
        'Update a task you own: set status to "in_progress" when you start, "done" when finished. ' +
        "While working, call this with a short note after each meaningful step — the human operator watches these notes on the dashboard; a task without notes looks stalled. " +
        "HARD RULE: if the task has a verifyCommand, you must run it and see it pass (exit 0) BEFORE marking done; " +
        "then call this with verified=true and put the verification result in note.",
      inputSchema: {
        task_id: z.string(),
        status: z.enum(["todo", "claimed", "in_progress", "done"]).optional(),
        note: z
          .string()
          .optional()
          .describe('One-line progress note shown on the operator dashboard, e.g. "API routes done, writing tests". When marking done, include the verifyCommand output summary.'),
        verified: z
          .boolean()
          .optional()
          .describe("Set true ONLY after you ran the task's verifyCommand and it passed (exit 0)."),
      },
    },
    async (args) =>
      guard(async () => {
        // 1.2 硬规则：有 verifyCommand 的任务，跑通验证之前不许标 done。
        if (args.status === "done") {
          const { tasks } = await client.listTasks();
          const target = tasks.find((t) => t.id === args.task_id);
          if (target?.verifyCommand && args.verified !== true) {
            return text(
              `⛔ 不能标记 done：任务 ${target.id} 配置了验证命令 \`${target.verifyCommand}\`。\n` +
                `先在项目目录里运行它并确认通过（退出码 0），再调用 update_task 时带上 verified=true，并把验证结果写进 note。` +
                `验证不通过就继续修复，不要绕过验证。`,
              true,
            );
          }
        }
        const { task } = await client.updateTask(args.task_id, { status: args.status, note: args.note });
        const noteAck = args.note ? " Progress note recorded — keep reporting after each step." : "";
        return text(`✏️ ${task.id} is now "${task.status}".${noteAck}`);
      }),
  );

  server.registerTool(
    "release_task",
    {
      description: "Release a task back to the board (unclaim it) if you can't finish it.",
      inputSchema: { task_id: z.string() },
    },
    async (args) =>
      guard(async () => {
        const { task } = await client.releaseTask(args.task_id);
        return text(`↩️ Released ${task.id} "${task.title}" back to todo.`);
      }),
  );

  server.registerTool(
    "acquire_file_lock",
    {
      description:
        "Claim the files you're about to edit. If another agent holds one, you'll be warned with their name so you can coordinate instead of clobbering their work.",
      inputSchema: {
        paths: z.array(z.string()).min(1).describe("Repo-relative file paths you intend to edit."),
        note: z.string().optional(),
      },
    },
    async (args) =>
      guard(async () => {
        const [result, { agents }] = await Promise.all([
          client.acquireLocks(selfId, args.paths, args.note),
          client.listAgents(),
        ]);
        const r = renderAcquire(result, buildNameMap(agents));
        return text(r.text, r.isError);
      }),
  );

  server.registerTool(
    "release_file_lock",
    {
      description: "Release file locks you hold once you're done editing those files.",
      inputSchema: { paths: z.array(z.string()).min(1) },
    },
    async (args) =>
      guard(async () => {
        const { released } = await client.releaseLocks(selfId, args.paths);
        return text(released.length ? `🔓 Released: ${released.join(", ")}.` : "You held none of those locks.");
      }),
  );

  server.registerTool(
    "check_file_locks",
    {
      description: "Check whether files are locked by another agent before you edit them.",
      inputSchema: { paths: z.array(z.string()).min(1) },
    },
    async (args) =>
      guard(async () => {
        const { status } = await client.checkLocks(args.paths);
        return text(renderCheck(status));
      }),
  );

  server.registerTool(
    "get_shared_notes",
    {
      description: "Read the shared notes log (decisions, API contracts agreed between agents).",
      inputSchema: {},
    },
    async () =>
      guard(async () => {
        const [{ notes }, { agents }] = await Promise.all([client.listNotes(), client.listAgents()]);
        return text(renderNotes(notes, buildNameMap(agents)));
      }),
  );

  server.registerTool(
    "append_shared_note",
    {
      description: "Record a decision or API contract in the shared notes so it's durable for everyone.",
      inputSchema: { content: z.string().describe("The note, e.g. 'User type now has an email field.'") },
    },
    async (args) =>
      guard(async () => {
        await client.appendNote(selfId, args.content);
        return text("📝 Noted.");
      }),
  );

  // ===== MPAC: 意图 → 冲突 → 共享约定 =====
  server.registerTool(
    "declare_intent",
    {
      description:
        "MPAC 关键: 在你动手改文件或改共享接口【之前】先声明意图——你要做什么 + 会动哪些文件/资源。若与其他 agent 已声明的意图撞车, 会返回冲突, 先别动手, 等操作员裁决。动手前务必先声明。",
      inputSchema: {
        summary: z.string().describe("你要做的事, 例如 '给 User 加 email 字段'。"),
        resources: z.array(z.string()).min(1).describe("会动的文件/路径(或约定段落)。"),
      },
    },
    async (args) =>
      guard(async () => {
        const [result, { agents }] = await Promise.all([
          client.declareIntent(selfId, args.summary, args.resources),
          client.listAgents(),
        ]);
        const r = renderDeclare(result, buildNameMap(agents));
        return text(r.text, r.isError);
      }),
  );

  server.registerTool(
    "withdraw_intent",
    {
      description: "撤回你之前声明的意图(你不再动那些资源了)。",
      inputSchema: { intent_id: z.string() },
    },
    async (args) =>
      guard(async () => {
        await client.withdrawIntent(args.intent_id);
        return text("↩️ 已撤回意图。");
      }),
  );

  server.registerTool(
    "get_contract",
    {
      description:
        "读取共享约定: 两边都要遵守的【接口契约】+【设计规范/设计 token】。开工和改东西前先读, 保证你的代码与 UI 跟对方一致。",
      inputSchema: {},
    },
    async () =>
      guard(async () => {
        const { contract } = await client.getContract();
        return text(renderContract(contract));
      }),
  );

  server.registerTool(
    "update_contract",
    {
      description:
        "更新共享约定(接口契约 和/或 设计规范)。改了共享接口就更新它, 其他 agent 会收到通知。只传你要改的部分(传入即覆盖该段全文)。",
      inputSchema: {
        api_contract: z.string().optional().describe("新的接口契约全文。"),
        design_spec: z.string().optional().describe("新的设计规范/设计 token 全文。"),
      },
    },
    async (args) =>
      guard(async () => {
        const r = await client.updateContract(selfId, {
          apiContract: args.api_contract,
          designSpec: args.design_spec,
        });
        if (!r.ok) {
          return text(`⚠️ 更新失败: 约定已被他人更新(现 v${r.contract.version})。先 get_contract 读最新再改。`, true);
        }
        await client
          .sendMessage(selfId, "all", `📐 我更新了共享约定(v${r.contract.version})。请 get_contract 查看最新接口/设计规范。`)
          .catch(() => {});
        return text(`✅ 约定已更新到 v${r.contract.version}, 已通知其他 agent。`);
      }),
  );

  server.registerTool(
    "check_conflicts",
    {
      description: "查看当前未解决的协作冲突(撞车的意图), 等操作员裁决。",
      inputSchema: {},
    },
    async () =>
      guard(async () => {
        const [{ conflicts }, { agents }] = await Promise.all([client.listConflicts(), client.listAgents()]);
        return text(renderConflicts(conflicts, buildNameMap(agents)));
      }),
  );

  return { server, selfId };
}

// Production entrypoint: build the server and serve it over stdio (what each agent launches).
export async function startAdapter(config: AdapterConfig): Promise<void> {
  const { server } = await createAgentServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`[orbit] MCP adapter ready over stdio.\n`);
}
