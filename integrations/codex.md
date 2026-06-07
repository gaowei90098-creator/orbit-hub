# Connect Codex to Orbit

Codex launches MCP servers over **stdio** (it spawns a command), which is exactly what the
adapter provides — so the same `orbit mcp` command works. `agent-hub` remains a compatibility alias.

## 1. Start the hub
See [claude-code.md](./claude-code.md) step 1 (one hub serves all agents).

## 2. Add the MCP server to `~/.codex/config.toml`
```toml
[mcp_servers.orbit]
command = "node"
args = [
  "/ABS/PATH/orbit/dist/cli.js",
  "mcp", "--name", "Codex", "--harness", "codex",
  "--hub", "http://localhost:4100"
]
# Networked hub: add the token via env instead of a flag if you prefer
# env = { HUB_TOKEN = "your-token" }
```

- Use a **unique `--name`** per agent.
- Dev without building: `command = "npx"`, `args = ["tsx", "/ABS/PATH/orbit/src/cli.ts", "mcp", …]`.
- The `orbit start` banner prints this exact block with the right path — copy it.

> The `[mcp_servers.<name>]` table with `command` / `args` / `env` is Codex's standard stdio
> MCP format. If your Codex version's keys differ, check `codex --help` / its config docs;
> the adapter itself is a plain stdio MCP server and works with any compliant client.

## 3. Verify
Launch Codex and have it call `list_agents` — you should show as online, alongside any other
connected agents. Watch the dashboard at http://localhost:4100.

## 4. Load the operating rules
Paste [`agent-operating-rules.md`](./agent-operating-rules.md) into the project's `AGENTS.md`
(or Codex's instruction prompt) so it follows the collaboration protocol.
