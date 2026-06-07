# Connect Claude Code to Orbit

## 1. Start the hub (once, by whoever hosts it)
```bash
cd orbit
npm install
npm run build          # optional but recommended (faster startup than tsx)
node dist/cli.js start  # or: npm run dev
```
The banner prints exact connect commands with the correct absolute path — copy from there.

## 2. Register Claude Code as an MCP server
Run this **inside the project the agent will work in**:

```bash
claude mcp add orbit -- node /ABS/PATH/orbit/dist/cli.js \
  mcp --name "Claude" --harness claude-code --hub http://localhost:4100
```

Or commit it to the project as `.mcp.json`:
```json
{
  "mcpServers": {
    "orbit": {
      "command": "node",
      "args": [
        "/ABS/PATH/orbit/dist/cli.js",
        "mcp", "--name", "Claude", "--harness", "claude-code",
        "--hub", "http://localhost:4100"
      ]
    }
  }
}
```

- Give each agent a **unique `--name`** (it's how teammates address you).
- Dev without building: use `npx tsx /ABS/PATH/orbit/src/cli.ts` instead of `node …/dist/cli.js`.
- Networked hub: change `--hub` to the tunnel/LAN URL and add `--token <TOKEN>` (see `../README.md`).

## 3. Verify
Start Claude Code, then ask it to run the `list_agents` tool — you should appear as online.
Open the dashboard at http://localhost:4100 to watch it live.

## 4. Load the operating rules
Paste [`agent-operating-rules.md`](./agent-operating-rules.md) into the project's `CLAUDE.md`
so Claude follows the claim → lock → message → done protocol.
