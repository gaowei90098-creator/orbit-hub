`# AgentHub Design — Codex End-to-End Wiring

> Architecture and design notes for routing `codex` (and other agents) either to an HTTP LLM provider or to a local CLI subprocess.

This document explains **why** the changes were made, **how** the pieces fit together, and **what invariants** must be preserved when extending the system.

---

## 1. Problem statement

Before this change, `agenthub` registered every `AgentInfo` through `registry.registerHttpAgent(...)` in `src/main/index.ts`. That adapter (`HttpAgentAdapter`) is a thin shim that does **no real I/O**; the actual dispatch path goes through `Dispatcher → ProviderClient → LLM HTTP API`.

**Consequence:** even though the source tree defines `ClaudeAdapter`, `HermesAdapter`, `OpenclawAdapter`, and `CodexAdapter` (all of which `spawn(...)` a real local CLI), **none of those classes are ever instantiated**. Every "agent" in the UI is just a name that routes to an HTTP LLM provider.

**User-visible symptom:** the Settings → Routing tab claims four agents exist, but Codex on the local machine is never actually invoked. Anything marketed as "codex" is a styled system prompt over a remote model.

## 2. Solution

Make the **binding** between an agent and its runtime carry the dispatch protocol. Two new optional fields were added to `AgentRouteBinding`:

```ts
interface AgentRouteBinding {
  // (existing fields)
  protocol?: 'http' | 'stdio-plain'   // default: 'http'
  binary?: string                    // optional absolute path to CLI
}
```

**Backward compatibility:**
- `protocol` and `binary` are **optional**. A binding without them behaves identically to the old wiring (HTTP route via `HttpAgentAdapter`).
- The whole refactor is **additive** — every changed line is either a new import, a new method, or a new branch that defaults to the old behavior.

---

## 3. Component map

```
+----------------------+         +----------------------------+
| Settings.tsx (React) |   IPC   | main process (Node)        |
| - BindingRow UI      | ------> |                            |
| - HTTP/StdIO toggle  |         |  src/main/index.ts         |
| - binary input       |         |  registerAgentsFrom-       |
+----------------------+         |  Bindings()                |
         |                       +----------------------------+
         v                                  |
  window.electronAPI                        v
                                  ProviderManager (binding)
                                              |
                                              v
                                    createAdapter()
                                  (hub/adapters/base.ts)
                                              |
                       +----------------------+----------------------+
                       |                                             |
                HttpAgentAdapter                             CodexAdapter
               (protocol='http')                       (protocol='stdio-plain')
                       |                                             |
                       v                                             v
                ProviderClient                              child_process.spawn
                  (HTTP LLM)                                  (codex CLI)
                       ^                                             ^
                       |                                             |
                       +------------- Dispatcher -------------------+
                                          (StreamEvent)
```

**Key files:**
- `src/main/providers/types.ts` — schema (`AgentRouteBinding` extension).
- `src/main/providers/manager.ts` — persistence + the cleaned-up `resolveBinding`.
- `src/main/hub/adapters/agent-adapter.ts` — **new** file holding the abstract `BaseAgentAdapter` (factored out to break a circular import).
- `src/main/hub/adapters/base.ts` — interface, `HttpAgentAdapter`, and the `createAdapter` factory.
- `src/main/hub/adapters/codex.ts` — real `spawn`-based adapter (claude/hermes/openclaw are placeholders ready to be wired up the same way).
- `src/main/hub/dispatcher.ts` — routes by adapter protocol; `sendToAgentStdio` is the new stdio branch.
- `src/main/index.ts` — `registerAgentsFromBindings` uses `createAdapter`; rebuilds adapter when `protocol` / `binary` change.
- `src/preload/index.ts` — already exposed `routing.setBinding` IPC handler.
- `src/renderer/pages/Settings.tsx` — `BindingRow` adds the **Backend** toggle (HTTP / StdIO) and a `binary` input.
- `src/main/hub/__tests__/*` — vitest coverage: factory behavior + real spawn end-to-end via `mock-codex.cmd` → node shim.

---

## 4. Data flow

### 4.1 Settings → main process (binding update)

1. User toggles **Backend = StdIO** and types `/usr/local/bin/codex` in the binary input on `Settings → Routing`.
2. React `BindingRow.onPickBackend(agentId, 'stdio-plain', binary)` calls `pickBindingBackend` (defined in the outer `Settings` component).
3. `pickBindingBackend` builds a fresh `AgentRouteBinding` object (defaults merged with user changes) and invokes `window.electronAPI.routing.setBinding(next)`.
4. The preload bridge calls IPC `routing:setBinding` → `ipcMain.handle('routing:setBinding', ...)` → `providerMgr.upsertBinding(b); registerAgentsFromBindings();`.
5. `registerAgentsFromBindings` compares the new binding's `protocol` and `binary` against the current adapter; if either changed, it calls `registry.unregister(agentId)`, stops the old adapter, then re-registers via `createAdapter`.

### 4.2 Dispatch (HTTP path — unchanged)

1. UI sends a chat message via `window.electronAPI.hub.dispatch(...)`.
2. `HubServer.client:message` handler → `dispatcher.dispatch(text, mode, targetAgent, ...)`.
3. `Dispatcher.sendToAgent` resolves the binding (`mgr.resolveBinding(agentId)`), then routes via `buildProviderClient(resolved)` (HTTP streaming).
4. Stream events (`start` / `delta` / `done` / `error`) are emitted to the renderer over `dispatch:stream`.

### 4.3 Dispatch (stdio path — new)

1. Same UI flow as 4.2.
2. `Dispatcher.sendToAgent` resolves binding → checks the registered adapter's `protocol`. If it's not `http` (e.g. `stdio-plain`), it delegates to `sendToAgentStdio(task, agentId, text, opts, resolved, adapter)`.
3. `sendToAgentStdio` sets `agentInfo.status = 'busy'`, emits `start`, then:
   - `adapter.start()` → `CodexAdapter.start()` → `child_process.spawn(this.binary, [], { stdio: ['pipe','pipe','pipe'], shell: true, env: ... })`.
   - hooks `adapter.onOutput` to convert stdout chunks into `delta` events + accumulate `content`.
   - hooks `adapter.onError` to capture any error.
   - `adapter.send(prompt)` writes the prompt to the child's stdin (with `\\n` appended for interactive shells).
   - polls every 200 ms for one of: proc exited, no output for 1.5 s with content seen, or 5-minute hard timeout.
   - on settle: emits `done`, restores `status = 'idle'`, returns the aggregated `content`.

---

## 5. Key invariants

1. **Default unchanged.** A binding without `protocol` continues to take the HTTP route via `HttpAgentAdapter`. The old system-prompt-as-Codex behavior is preserved when the user has not opted into stdio.
2. **Circular import broken.** `agent-adapter.ts` was extracted so that `codex.ts` imports the abstract class from a leaf, and `base.ts` imports `CodexAdapter` from `codex.ts` (instead of the other way around). `vitest` resolves both cleanly.
3. **Adapter identity is per-protocol.** When the user switches a codex binding from HTTP to StdIO, the registry rebuilds the adapter (stop + unregister + register). The renderer always re-pulls `hub:status` after a `setBinding` IPC, so the UI reflects the change without a page reload.
4. **StdIO is currently codex-only.** The factory explicitly checks `agentId === 'codex'` before constructing `CodexAdapter`. Other agent IDs requesting stdio fall back to `HttpAgentAdapter` with a `console.warn` (and the UI greys out the StdIO button for non-codex agents).
5. **No mock code in production paths.** `mock-codex.{js,cmd}` only live in `__tests__/` and are referenced solely by the e2e test.
6. **Failure modes surface to UI.** Adapter `onError` becomes a `StreamEvent({ kind: 'error', ...})`; the dispatcher never swallows a spawn / pipe failure.

---

## 6. Extending to other desktop agents

To wire `claude` / `hermes` / `openclaw` the same way:

1. Add an adapter file under `src/main/hub/adapters/` that extends `BaseAgentAdapter`, mirroring `codex.ts`'s spawn-and-stream pattern (the `claude` adapter already exists as a stub; flip its `protocol` to `stdio-ndjson` and wire `send` to wrap NDJSON messages around the prompt).
2. Add a case in `createAdapter` for the new `(agentId, protocol)` pair (currently only `stdio-plain && codex`).
3. Lift the `disabled={!stdioSupported}` guard in `BindingRow` to allow the new agent.
4. Add a vitest case under `__tests__/` mirroring `codexAdapter.test.ts`.

No other change is needed: `registerAgentsFromBindings`, `Dispatcher.sendToAgent`, and `AgentRouteBinding` schema are already generic over `protocol` / `binary`.

---

## 7. Tests

Two vitest files cover the new behavior:

### 7.1 `src/main/hub/__tests__/createAdapter.test.ts`

Pure factory assertions:
- Default → `HttpAgentAdapter`
- Explicit `http` → `HttpAgentAdapter`
- `stdio-plain` + `codex` → `CodexAdapter` with `protocol = 'stdio-plain'`
- `stdio-plain` with custom `binary` → `a.binary === '/custom/path/to/codex'`
- `stdio-plain` on `claude/hermes/openclaw` → falls back to `HttpAgentAdapter` + warns (or silent for hermes/openclaw which were always HTTP)

### 7.2 `src/main/hub/__tests__/codexAdapter.test.ts`

Real end-to-end via subprocess:
- Spawns `mock-codex.cmd` (which calls node on `mock-codex.js`)
- Sends `'hello from vitest'` to stdin
- Asserts `chunks.join('').includes('echo:hello from vitest')` (the mock echoed the input back through stdout)
- No `errors` reported by the adapter
- Constructor accepts `binary` override (defaults respected until overwritten)

Run with:
```bash
cd agenthub
npm run typecheck                     # tsc --noEmit
npx vitest run src/main/hub/__tests__ # 9/9 should pass
```

---

## 8. What was deliberately **not** changed

To minimize blast radius, the refactor leaves the following untouched:

- The existing `Dispatcher.sendToAgent` HTTP body (only a 6-line protocol branch was added at the top)
- The `claude.ts` / `hermes.ts` / `openclaw.ts` adapters (left as stubs; future work)
- The renderer `useAgentStore` (status colors + cap lists) — only the `BindingRow` got a UI block
- The `Aggregator`, `EventPipeline`, `KeywordRouter`, and `HubServer` — none of them touches the new `protocol` / `binary` fields
- `client.ts`, `presets.ts`, `routing/proxy.ts`

---

## 9. Open questions / next steps

- **NDJSON protocol for `claude` / `hermes` / `openclaw`.** Each CLI uses a different wire format; needs per-adapter parsing.
- **Done-signal detection.** Current stdio dispatch polls for `proc exit OR silence OR timeout`. For long-running CLIs that stream incrementally (codex exec, claude --print with a tool call), a heartbeat / final-event marker is more reliable.
- **Pre-flight check.** If `b.binary` is set but the file does not exist, `CodexAdapter.start` should fail fast with a clear IPC error, not spawn and crash mid-prompt.
- **Process lifecycle.** `registry.stopAll()` only kills the current adapter instance; if the user toggles protocols rapidly, orphans are possible.

---

## 10. Change manifest (one-liner per touched file)

| File | Change |
|---|---|
| `src/main/providers/types.ts` | `AgentRouteBinding` gets optional `protocol?` + `binary?` |
| `src/main/providers/manager.ts` | `resolveBinding` cleaned up: `isUsable` type guard, `fb`→`id`, `||`→`??` (separate commit) |
| `src/main/hub/adapters/agent-adapter.ts` | **new** — abstract class extracted to break circular import |
| `src/main/hub/adapters/base.ts` | adds `createAdapter` factory; re-exports `BaseAgentAdapter` |
| `src/main/hub/adapters/codex.ts` | spawn uses `shell: true` (Windows-friendly), stderr routed to `onError` |
| `src/main/hub/dispatcher.ts` | new `sendToAgentStdio`; protocol-aware routing in `sendToAgent` |
| `src/main/index.ts` | `registerAgentsFromBindings` uses factory; rebuilds adapter on protocol/binary change |
| `src/preload/index.ts` | (no change; `routing.setBinding` already exposed) |
| `src/renderer/pages/Settings.tsx` | `pickBindingBackend` + `BindingRow` HTTP/StdIO toggle + binary input |
| `src/main/hub/__tests__/createAdapter.test.ts` | **new** — 7 factory assertions |
| `src/main/hub/__tests__/codexAdapter.test.ts` | **new** — real spawn e2e via mock shim |
| `src/main/hub/__tests__/mock-codex.js` | **new** — Node child that echoes stdin to stdout |
| `src/main/hub/__tests__/mock-codex.cmd` | **new** — Windows shim that invokes node on mock-codex.js |
`