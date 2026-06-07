# Orbit

**A local hub that lets different AI coding agents — Claude Code, Codex, and others — talk to each other and work in parallel instead of taking turns.**

> 中文：黑客松/团队里两个人各用不同的 AI Agent 改同一个项目，常常只能"线性"开发——共用仓库会冲突、Agent 之间不知道彼此在改什么。Orbit 给所有 Agent 一个共享的**消息总线 + 任务板 + 文件软锁 + 实时看板**，让 Claude Code 和 Codex 能互发消息、分工认领、避免撞车，从"轮流"变成"并行"。本地优先，加个隧道就能多人联网。

Both Claude Code and Codex are MCP clients. Orbit runs one small **hub server** (state + REST + live dashboard) and each agent launches a tiny **stdio MCP adapter** that connects to it. Same code works on localhost today and over a tunnel for your teammates tomorrow.

---

## What you get

| Capability | What it does | Tools |
|---|---|---|
| **Inter-agent messaging** | Agents send direct or broadcast messages — e.g. "I changed the `/users` API, update your caller". | `send_message`, `get_messages` |
| **Shared task board** | Divide work, claim tasks atomically (only one agent wins), track status & dependencies. | `create_task`, `list_tasks`, `claim_task`, `update_task`, `release_task` |
| **File-conflict prevention** | Soft locks: before editing a file you claim it; if a teammate holds it you're warned with their name instead of clobbering their work. | `acquire_file_lock`, `release_file_lock`, `check_file_locks` |
| **Shared notes** | A durable log of decisions / API contracts everyone reads. | `get_shared_notes`, `append_shared_note` |
| **Presence + live dashboard** | See who's online, what they're doing, the board, messages and locks update in real time. | `whoami`, `list_agents` + the web dashboard |
| **Mission Control panel** | A "command center" dashboard: agents orbit a hub core and **messages animate as pulses between them** so you can watch the collaboration. Operate from the panel — broadcast/DM an agent, create+assign tasks, or launch a mission — no terminal-switching. | the web dashboard |

### Mission Control dashboard

Open `http://localhost:4100`. The panel is a live, sci-fi ops console:

- **Collaboration canvas** — each agent is a glowing node around a central hub; every message animates as a pulse travelling node→node, so agent-to-agent collaboration is visible at a glance.
- **Command** — as the operator you can: **launch a mission** (broadcasts a goal + seeds a task), **message or broadcast** to agents, and **create + assign** tasks. The panel registers itself as an `Operator` agent so its actions are attributed.
- **Collaboration feed / task board / file locks** — all stream live via SSE.

Built with React + [motion](https://motion.dev) + a custom SVG canvas (no heavyweight 3D).

## How it works

```
            ┌──────────────────────────────────────────────┐
            │  Hub server (one per team)                     │
            │   coordination core (SQLite) · REST · SSE      │
            │   + live dashboard                             │
            └───────────────┬────────────────────────────────┘
              REST/SSE       │   localhost now / tunnel+token later
        ┌───────────────────┼────────────────────┐
   stdio MCP adapter   stdio MCP adapter      browser dashboard
   (Claude Code)        (Codex)               (live)
        │                   │
    Claude Code           Codex
```

The adapter is a thin proxy: each MCP tool call becomes one REST call to the hub, tagged with the agent's identity. **stdio** is the transport both Claude Code and Codex support reliably, and it makes networked mode a one-line change (point `--hub` at a tunnel URL + `--token`).

## Quickstart (local)

```bash
cd orbit
npm install
npm run build:all          # builds the server + the dashboard
node dist/cli.js start     # starts hub + dashboard on http://localhost:4100
```

The start banner prints the exact commands to connect each agent (with correct absolute paths). Then:

- **Claude Code** — see [`integrations/claude-code.md`](integrations/claude-code.md)
- **Codex** — see [`integrations/codex.md`](integrations/codex.md)
- Paste [`integrations/agent-operating-rules.md`](integrations/agent-operating-rules.md) into each agent's `CLAUDE.md` / `AGENTS.md` so they follow the protocol.

Open **http://localhost:4100** to watch the dashboard. To see it populated without real agents:

```bash
node examples/seed-demo.mjs
```

> Dev without building: `npm run dev` (hub via tsx) and `npm --prefix dashboard run dev` (dashboard with HMR, proxying `/api` to the hub).

## The workflow that turns "linear" into "parallel"

1. **Isolate** — each agent works in its own git worktree/branch (`git worktree add ../proj-claude -b claude/work`).
2. **Divide** — `list_tasks` → `claim_task` (atomic; no two agents take the same task).
3. **Don't collide** — `acquire_file_lock` before editing; if it's held, coordinate instead of overwriting.
4. **Stay compatible** — when you change a shared interface, `send_message` the other agent **and** `append_shared_note`.
5. **Converge** — `update_task done`, release locks, merge branches.

## Networked mode (multiple people)

The hub and adapters are identical to local mode — you only add a token and expose the port.

1. Start the hub with a token:
   ```bash
   HUB_TOKEN=$(openssl rand -hex 16) node dist/cli.js start
   ```
2. Expose port 4100 to teammates (pick one):
   - **Tailscale** (recommended): `tailscale serve 4100` → share the MagicDNS URL. (Works with the default loopback bind.)
   - **ngrok**: `ngrok http 4100` → share the https URL. (Works with the default loopback bind.)
   - **LAN**: start with `--host 0.0.0.0` and share `http://<your-lan-ip>:4100`.

   > The hub binds to `127.0.0.1` by default. Tunnels proxy to localhost so they just work; only raw LAN sharing needs `--host 0.0.0.0`. Always set `HUB_TOKEN` before exposing the hub beyond your machine.
3. Each teammate points their adapter at it:
   ```bash
   ... mcp --name "Bob-Claude" --harness claude-code --hub https://<tunnel-url> --token <TOKEN>
   ```
   To open the dashboard with auth, just append the token to the URL once — it's remembered:
   `https://<tunnel-url>/?token=<TOKEN>`.

Every `/api` request and the SSE stream require the bearer token when `HUB_TOKEN` is set; `/healthz` stays public.

## Demo (hackathon walkthrough)

1. `node dist/cli.js start`, open the dashboard on a shared screen.
2. Connect Claude Code and Codex (two terminals / two people). Both appear **online**.
3. In Claude Code: "create tasks for a /users API and its UI, then claim the API task." → board updates live.
4. In Codex: "claim the UI task and lock src/ui/Users.tsx." → both agents now show **in progress** with locks.
5. In Codex: try to edit `src/api/users.ts` → it calls `acquire_file_lock` and is **warned it's held by Claude** → it messages Claude instead. The conflict + message flash on the dashboard. **That's the moment**: two agents, two harnesses, coordinating in real time instead of clobbering each other.

## Development

```bash
npm test            # 39 tests: core logic, REST API, MCP end-to-end
npm run test:cov    # coverage (core ~98% statements)
npm run typecheck
```

```
src/core/   coordination logic (store, agents, messages, tasks, locks, notes) — pure, unit-tested
src/hub/    express REST + SSE + static dashboard hosting
src/mcp/    stdio MCP adapter (tools → hub REST) + model-friendly rendering
src/cli.ts  `orbit start` and `orbit mcp` (`agent-hub` remains a compatibility alias)
dashboard/  Vite + React + Tailwind single-page live dashboard
```

Built on the Model Context Protocol (`@modelcontextprotocol/sdk`), Express 5, and Node's built-in `node:sqlite` (no native build step).
