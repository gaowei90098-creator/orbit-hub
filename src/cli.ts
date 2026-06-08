#!/usr/bin/env node
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createHubApp } from "./hub/server.js";
import { startAdapter } from "./mcp/adapter.js";
import type { Harness } from "./core/types.js";

const HARNESSES: Harness[] = ["claude-code", "codex", "gemini", "opencode", "other"];
const DEFAULT_PORT = 4100;
const MCP_SERVER_ID = "orbit";

// Minimal flag parser: supports --key value, --key=value, and bare --flag.
function parseFlags(argv: string[]): Map<string, string> {
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg || !arg.startsWith("--")) continue;
    const eq = arg.indexOf("=");
    if (eq !== -1) {
      flags.set(arg.slice(2, eq), arg.slice(eq + 1));
    } else {
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        flags.set(arg.slice(2), next);
        i++;
      } else {
        flags.set(arg.slice(2), "true");
      }
    }
  }
  return flags;
}

// Structured launch parts so file paths containing spaces survive into the generated
// config (never join+split a path string).
function launchParts(): { command: string; baseArgs: string[] } {
  const self = fileURLToPath(import.meta.url);
  return self.endsWith(".ts") ? { command: "npx", baseArgs: ["tsx", self] } : { command: "node", baseArgs: [self] };
}

function startBanner(port: number, dbPath: string, token: string | undefined): string {
  const url = `http://localhost:${port}`;
  const { command, baseArgs } = launchParts();
  const mcpArgs = (name: string, harness: string): string[] => [
    ...baseArgs,
    "mcp",
    "--name",
    name,
    "--harness",
    harness,
    "--hub",
    url,
    ...(token ? ["--token", token] : []),
  ];
  const shellQuote = (s: string): string => (/\s/.test(s) ? JSON.stringify(s) : s);
  const claudeLine = `claude mcp add ${MCP_SERVER_ID} -- ${command} ${mcpArgs("Claude", "claude-code").map(shellQuote).join(" ")}`;
  const codexArgs = mcpArgs("Codex", "codex");
  return [
    ``,
    `  ┌───────────────────────────────────────────────┐`,
    `  │  Orbit is running                             │`,
    `  └───────────────────────────────────────────────┘`,
    ``,
    `  Dashboard:  ${url}`,
    `  Hub API:    ${url}/api`,
    `  Database:   ${dbPath}`,
    token ? `  Auth:       token required (HUB_TOKEN set)` : `  Auth:       open (local mode, no token)`,
    ``,
    `  Connect Claude Code (run inside the agent's project dir):`,
    `    ${claudeLine}`,
    ``,
    `  Connect Codex — add to ~/.codex/config.toml:`,
    `    [mcp_servers.${MCP_SERVER_ID}]`,
    `    command = ${JSON.stringify(command)}`,
    `    args = [${codexArgs.map((a) => JSON.stringify(a)).join(", ")}]`,
    ``,
    `  Full setup + the agent operating rules:  see integrations/`,
    `  Stop:  Ctrl+C`,
    ``,
  ].join("\n");
}

function startHub(flags: Map<string, string>): void {
  const port = Number(flags.get("port") ?? process.env.HUB_PORT ?? DEFAULT_PORT);
  const rawDb = flags.get("db") ?? process.env.HUB_DB ?? path.resolve(process.cwd(), ".orbit/hub.sqlite");
  const dbPath = rawDb === ":memory:" ? ":memory:" : rawDb;
  const token = flags.get("token") ?? process.env.HUB_TOKEN;
  // Bind to loopback by default (safe for local + tunnels that proxy to localhost).
  // Use --host 0.0.0.0 only for raw LAN sharing.
  const host = flags.get("host") ?? process.env.HUB_HOST ?? "127.0.0.1";

  if (dbPath !== ":memory:") fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const { app, core, runs, coordinator, integration } = createHubApp({ dbPath, token });
  const server = app.listen(port, host, () => {
    process.stdout.write(startBanner(port, dbPath, token));
  });

  // Periodically mark agents that stopped heart-beating offline (and free their locks).
  const reaper = setInterval(() => core.agents.reap(60_000), 30_000);
  reaper.unref();

  const shutdown = (): void => {
    clearInterval(reaper);
    coordinator.stop();
    integration.stop();
    runs.stopAll();
    server.close();
    core.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

async function startMcp(flags: Map<string, string>): Promise<void> {
  // stdio mode: stdout is reserved for the MCP protocol — all logs go to stderr.
  const hubUrl = flags.get("hub") ?? process.env.HUB_URL ?? `http://localhost:${DEFAULT_PORT}`;
  const agentName = flags.get("name") ?? process.env.AGENT_NAME ?? `agent-${os.hostname()}`;
  const rawHarness = flags.get("harness") ?? process.env.AGENT_HARNESS ?? "other";
  const harness = (HARNESSES as string[]).includes(rawHarness) ? (rawHarness as Harness) : "other";
  const token = flags.get("token") ?? process.env.HUB_TOKEN;
  const principal = flags.get("principal") ?? process.env.AGENT_PRINCIPAL ?? "本机";

  try {
    await startAdapter({ hubUrl, agentName, harness, token, principal });
  } catch (err) {
    process.stderr.write(`[orbit] failed to start adapter: ${(err as Error).message}\n`);
    process.exit(1);
  }
}

function usage(): string {
  return [
    `Orbit — local collaboration hub for AI coding agents`,
    ``,
    `Usage:`,
    `  orbit start [--port 4100] [--db PATH|:memory:] [--token TOKEN] [--host 127.0.0.1]`,
    `      Start the hub server + dashboard. Use --host 0.0.0.0 to share over a LAN.`,
    ``,
    `  orbit mcp --name NAME --harness claude-code|codex [--hub URL] [--token TOKEN]`,
    `      Run the stdio MCP adapter that an agent launches to connect to the hub.`,
    `      The old agent-hub command remains as a compatibility alias.`,
    ``,
    `Environment variables: HUB_PORT, HUB_DB, HUB_TOKEN, HUB_URL, AGENT_NAME, AGENT_HARNESS`,
    ``,
  ].join("\n");
}

async function main(): Promise<void> {
  const [, , command, ...rest] = process.argv;
  const flags = parseFlags(rest);
  switch (command) {
    case "start":
      return startHub(flags);
    case "mcp":
      return startMcp(flags);
    case "help":
    case "--help":
    case "-h":
    case undefined:
      process.stdout.write(usage());
      return;
    default:
      process.stderr.write(`Unknown command: ${command}\n\n${usage()}`);
      process.exit(1);
  }
}

void main();
