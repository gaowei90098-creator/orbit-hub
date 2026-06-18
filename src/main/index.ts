import { app, BrowserWindow, Tray, Menu, nativeImage, Notification, ipcMain, shell, dialog } from "electron"
import { join, resolve } from "path"
import { existsSync, readFileSync } from "fs"
import { homedir } from "os"
import { HubServer } from "./hub/server"
import { AgentRegistry } from "./hub/registry"
import { EventPipeline } from "./hub/pipeline"
import { KeywordRouter } from "./hub/router"
import { Dispatcher, StreamEvent } from "./hub/dispatcher"
import { store } from "./store"
import { detectAgentsAsync } from "./hub/agent-detector"
import { getProviderManager } from "./providers/manager"
import { getLocalProxy } from "./routing/proxy"
import { locateAgentCandidates } from "./hub/agent-locator"
import { takeoverStatus, takeoverApply, takeoverRestore } from "./routing/takeover"
import { syncRegistryFromBindings } from "./hub/agent-connections"
import { routePreview } from "./hub/route-preview"
import { MemoryCategory, MemoryLibrary } from "./memory-library"
import { getWorkspaceManager, WorkspaceNotFoundError, WorkspacePathInvalidError } from "./hub/workspace"
import { MissionStore } from "./hub/mission-store"
import { Supervisor } from "./hub/supervisor"
import { CollaborationBus } from "./hub/collaboration-bus"
import { checkOpenAgentsCompatibility, defaultOpenAgentsConfigDir } from "./openagents/bridge"
// --- AgentHub skills + native agentic (Claude-B 新增) ---
import { getSkillManager } from "./skills/manager"
import { BUILTIN_SKILLS } from "./skills/types"
import { getCapabilityMatrix } from "./agentic/capabilities"
import { getAgenticConfig } from "./agentic/config"
import { getApprovalConfig, GuardedTool, ApprovalPolicy } from "./agentic/approval"
// --- /AgentHub skills + native agentic ---

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let hub: HubServer | null = null
const registry = new AgentRegistry()
const pipeline = new EventPipeline()
const router = new KeywordRouter()
app.setName("Orbit")
try {
  app.setPath("userData", join(app.getPath("appData"), "agenthub"))
} catch {
  // Keep the default Electron path if the platform refuses early path changes.
}
const providerMgr = getProviderManager()
let dispatcher: Dispatcher | null = null
const proxy = getLocalProxy()
let memoryLibrary: MemoryLibrary | null = null
let missionStore: MissionStore | null = null
let collaborationBus: CollaborationBus | null = null

function prepareLocalCliEnvironment(): void {
  const home = homedir()
  const extraPaths = [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    join(home, ".volta", "bin"),
    join(home, ".npm-global", "bin"),
    join(home, ".local", "bin"),
    join(home, ".cargo", "bin")
  ]
  const currentPath = process.env.PATH || ""
  process.env.PATH = [...extraPaths, currentPath].filter(Boolean).join(":")

  // Claude Code headless mode may need the subscription OAuth token exported.
  // Users can create either file locally; the token never leaves this process.
  if (!process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    for (const fileName of [".agenthub-oauth-token", ".orbit-oauth-token"]) {
      const filePath = join(home, fileName)
      try {
        if (!existsSync(filePath)) continue
        const token = readFileSync(filePath, "utf-8").trim()
        if (token) {
          process.env.CLAUDE_CODE_OAUTH_TOKEN = token
          break
        }
      } catch {
        // Ignore unreadable token files; dispatch will surface auth errors.
      }
    }
  }
}

function memory(): MemoryLibrary {
  if (!memoryLibrary) memoryLibrary = new MemoryLibrary(app.getPath("userData"))
  return memoryLibrary
}

function missions(): MissionStore {
  if (!missionStore) missionStore = new MissionStore(app.getPath("userData"))
  return missionStore
}

function collaboration(): CollaborationBus {
  if (!collaborationBus) collaborationBus = new CollaborationBus(app.getPath("userData"))
  return collaborationBus
}

function seedCoreMemories(): void {
  const entries = [
    {
      id: "system:agenthub-main-agent-principle",
      category: "system" as MemoryCategory,
      title: "AgentHub is the main orchestrator agent",
      summary: "User intent: accept a project goal, decompose it, coordinate sub-agents, then verify and synthesize.",
      content: [
        "AgentHub is not primarily a multi-model chat shell.",
        "It is the main Agent / Orchestrator for project collaboration.",
        "The main Agent reads the project, uses memory, creates a task DAG, assigns bounded task contracts to sub-agents, supervises progress, resolves coordination issues, and produces a final acceptance summary.",
      ].join("\n"),
      tags: ["architecture", "main-agent", "orchestrator"]
    },
    {
      id: "procedure:sub-agent-task-contract",
      category: "procedure" as MemoryCategory,
      title: "Sub-agent task contract",
      summary: "Every worker task should carry file scope, done criteria, verify command, and interface reference.",
      content: [
        "Each sub-agent receives a bounded contract:",
        "- title and concrete detail",
        "- fileScope / ownership boundary",
        "- dependsOn / task DAG ordering when work cannot safely run in parallel",
        "- doneWhen acceptance criteria",
        "- verifyCommand where available",
        "- interfaceRef for shared API, data shape, UI, naming, or design decisions",
        "This keeps task granularity aligned and prevents workers from implementing mismatched specs.",
      ].join("\n"),
      tags: ["task-contract", "coordination", "granularity"]
    },
    {
      id: "semantic:memory-layering",
      category: "semantic" as MemoryCategory,
      title: "Three-layer memory model",
      summary: "STM for active mission, episodic LTM for outcomes, semantic/procedure LTM for project rules and reusable skills.",
      content: [
        "STM: active mission context, current task DAG, worker state, recent decisions, and message routing context.",
        "Episodic LTM: past mission outcomes, failures, repairs, verification results, and lessons.",
        "Semantic/procedure LTM: project conventions, Agent capabilities, reusable commands, operating rules, and architecture decisions.",
        "Planner startup must read recent mission outcomes before proposing a new PlanArtifact.",
        "Workers keep private execution history; only results, contract changes, blockers, and lessons are promoted to shared memory.",
      ].join("\n"),
      tags: ["memory", "stm", "ltm", "episodic", "semantic"]
    },
    {
      id: "semantic:user-bridge-agent-boundary",
      category: "semantic" as MemoryCategory,
      title: "Hermes and OpenClaw are user bridges, not execution workers",
      summary: "Hermes/OpenClaw notify the user, receive remote instructions, and relay approvals; they should not receive coding, deployment, database, or file-writing contracts.",
      content: [
        "Orbit can let the user choose Hermes or OpenClaw as the user progress bridge.",
        "The selected bridge receives notification events such as plan proposed, contract completed/failed, and mission completed/failed.",
        "Remote user requirements arriving through the bridge should be recorded into STM or decisions before Orbit replans.",
        "Do not route coding, deployment, database, or workspace mutation tasks to Hermes/OpenClaw by default.",
        "Execution workers are Codex CLI, Claude Code, Marvis, and MiniMax Code unless the user explicitly changes roles."
      ].join("\n"),
      tags: ["agent-roles", "user-bridge", "hermes", "openclaw", "routing"]
    }
  ]
  for (const entry of entries) memory().upsertEntry(entry)
}

function recordDispatchOutcome(task: any): void {
  try {
    const results = task?.results instanceof Map ? Object.fromEntries(task.results) : task?.results || {}
    const errors = task?.errors instanceof Map ? Object.fromEntries(task.errors) : task?.errors || {}
    const agentIds = Array.from(new Set([...Object.keys(results), ...Object.keys(errors)]))
    memory().upsertEntry({
      id: `episodic:dispatch:${task.id}`,
      category: "episodic",
      title: `Dispatch outcome: ${String(task.text || task.id).slice(0, 80)}`,
      summary: `${task.status || "unknown"} · ${agentIds.join(", ") || "no agents"} · ${Object.keys(errors).length} error(s)`,
      content: JSON.stringify({
        taskId: task.id,
        missionId: task.missionId,
        text: task.text,
        mode: task.mode,
        status: task.status,
        targetAgent: task.targetAgent,
        planArtifact: task.planArtifact,
        agents: agentIds,
        resultPreview: Object.fromEntries(Object.entries(results).map(([agentId, value]) => [agentId, String(value).slice(0, 1200)])),
        errors
      }, null, 2),
      tags: ["dispatch", "outcome", task.mode, task.status].filter(Boolean),
      metadata: { taskId: task.id, missionId: task.missionId, mode: task.mode, status: task.status, agentIds }
    })
  } catch (e) {
    console.warn("[Memory] failed to record dispatch outcome:", e)
  }
}

function appAssetPath(fileName: string): string {
  const packaged = join(process.resourcesPath, "build", fileName)
  if (app.isPackaged && existsSync(packaged)) return packaged

  const fromAppPath = join(app.getAppPath(), "build", fileName)
  if (existsSync(fromAppPath)) return fromAppPath

  return join(process.cwd(), "build", fileName)
}

function createWindow(): void {
  const iconPath = appAssetPath(process.platform === "win32" ? "icon.ico" : "icon.png")
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    title: "Orbit",
    icon: iconPath,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    show: false,
    frame: false,
    backgroundColor: "#101319"
  })
  mainWindow.on("ready-to-show", () => mainWindow?.show())
  mainWindow.on("maximize", () => mainWindow?.webContents.send("win:maximized", true))
  mainWindow.on("unmaximize", () => mainWindow?.webContents.send("win:maximized", false))
  mainWindow.on("close", (event) => {
    if (store.get("minimizeToTray") !== false) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"))
  }
}

function createTray(): void {
  const trayIcon = nativeImage.createFromPath(appAssetPath("icon.png"))
  tray = new Tray(trayIcon)
  const contextMenu = Menu.buildFromTemplate([
    { label: "Open Orbit", click: () => mainWindow?.show() },
    { type: "separator" },
    { label: "Status: Running", enabled: false },
    { type: "separator" },
    { label: "Quit", click: () => { (app as any).isQuitting = true; app.quit() } }
  ])
  tray.setToolTip("Orbit - Multi-Agent Workspace")
  tray.setContextMenu(contextMenu)
  tray.on("double-click", () => mainWindow?.show())
}

function registerAgentsFromBindings(): void {
  syncRegistryFromBindings(registry, providerMgr.getBindings())
}

async function initHub(): Promise<void> {
  registerAgentsFromBindings()
  pipeline.register({
    name: "rate-limiter",
    type: "guard",
    handle: async (event) => event
  })
  pipeline.register({
    name: "logger",
    type: "observe",
    handle: async (event) => {
      console.log("[Pipeline] " + event.source + " -> " + event.target)
      return event
    }
  })
  dispatcher = new Dispatcher(
    registry,
    pipeline,
    () => memory().getCatalog().entries.slice(0, 12),
    missions(),
    new Supervisor(),
    collaboration()
  )
  hub = new HubServer(registry)

  hub.on("client:message", async ({ clientId: _clientId, message }) => {
    if (message.type === "chat:message") {
      const task = await dispatcher!.dispatch(
        message.payload.text,
        message.payload.mode || "auto",
        message.payload.targetAgent,
        {
          thinking: message.payload.thinking,
          workspaceId: message.payload.workspaceId ?? null,
          requirePlanApproval: !!message.payload.requirePlanApproval
        }
      )
      recordDispatchOutcome(task)
      hub?.broadcast("chat:response", {
        taskId: task.id,
        status: task.status,
        results: Array.from(task.results.entries()).map(([agentId, content]) => ({
          agentId, content, thinking: task.thinking.get(agentId) || ""
        })),
        errors: Array.from(task.errors.entries()),
        thinkingSummary: Array.from(task.thinkingSummary.entries()),
        error: task.error
      })
      if (task.status === "completed") {
        const agents = Array.from(task.results.keys()).join(", ")
        if (agents) {
          new Notification({ title: "AgentHub", body: "Task done by " + agents, silent: true }).show()
        }
      }
    }
  })

  dispatcher.on("stream", (event: StreamEvent) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("dispatch:stream", event)
    }
  })

  try {
    await proxy.start()
    console.log("[Proxy] Local Chat Completions:", proxy.getUrl())
  } catch (e) {
    console.error("[Proxy] Failed to start:", e)
  }

  hub.start()
  detectAgentsAsync()
    .then(() => console.log("[Hub] Initial agent detection complete"))
    .catch(e => console.error("[Hub] Initial detection failed:", e))
}

ipcMain.handle("hub:status", () => ({
  running: hub !== null,
  url: hub?.getUrl() || "",
  proxyUrl: proxy.getUrl(),
  clientCount: hub?.getClientCount() || 0,
  agents: registry.getAll().map(a => ({
    id: a.id, name: a.name, status: a.status, capabilities: a.capabilities,
    providerId: a.providerId, modelId: a.modelId, errorCount: a.errorCount
  })),
  tasks: dispatcher?.getRecentTasks(10).map(t => ({
    id: t.id, text: t.text.slice(0, 50), mode: t.mode, status: t.status, createdAt: t.createdAt
  })) || []
}))

ipcMain.handle("hub:dispatch", async (_event, payload) => {
  const task = await dispatcher?.dispatch(payload.text, payload.mode || "auto", payload.targetAgent, {
    thinking: payload.thinking,
    workspaceId: payload.workspaceId ?? null,
    requirePlanApproval: !!payload.requirePlanApproval
  })
  if (task) recordDispatchOutcome(task)
  return task
})
ipcMain.handle("hub:approvePlan", async (_event, taskId: string, approved: boolean) =>
  dispatcher?.resolvePlanApproval(taskId, approved) ?? false)
ipcMain.handle("hub:routePreview", async (_event, text: string) => routePreview(text, registry, router, missions().getRouterContext()))

ipcMain.handle("hub:rescan", async () => {
  const agents = await detectAgentsAsync()
  return agents.map(d => ({
    id: d.id, name: d.name, found: d.found, 
    capabilities: d.capabilities, providerId: d.providerId, modelId: d.modelId,
    baseUrl: d.baseUrl, reachable: d.reachable, error: d.error
  }))
})

ipcMain.handle("hub:cancel", async (_event, taskId: string) => dispatcher?.cancel(taskId))
ipcMain.handle("store:get", async (_event, key: string) => store.get(key))
ipcMain.handle("store:set", async (_event, key: string, value: any) => { store.set(key, value); return true })
ipcMain.handle("memory:catalog", async () => memory().getCatalog())
ipcMain.handle("memory:list", async (_event, category?: MemoryCategory) => memory().listEntries(category))
ipcMain.handle("memory:addEntry", async (_event, entry) => memory().upsertEntry(entry))
ipcMain.handle("memory:loadState", async () => memory().loadRuntimeState())
ipcMain.handle("memory:saveState", async (_event, state) => memory().saveRuntimeState(state))
ipcMain.handle("missions:plans", async () => missions().listPlans())
ipcMain.handle("missions:outcomes", async (_event, limit?: number) => missions().listOutcomes(limit || 50))
ipcMain.handle("missions:active", async () => missions().getActivePlan())
ipcMain.handle("missions:stm", async () => missions().getSTM())
ipcMain.handle("collaboration:events", async (_event, filter?: any) => collaboration().list(filter || {}))
ipcMain.handle("collaboration:timeline", async (_event, missionId: string, limit?: number) =>
  collaboration().buildMissionTimeline(missionId, limit || 50))
ipcMain.handle("openagents:compatibility", async () => checkOpenAgentsCompatibility({
  configDir: defaultOpenAgentsConfigDir(app.getPath("userData")),
  endpoint: process.env.OPENAGENTS_ENDPOINT,
  projectRoot: process.env.AGENTFORGE_PROJECT_ROOT || process.cwd()
}))

ipcMain.handle("providers:get", async () => providerMgr.getConfig())
ipcMain.handle("providers:upsert", async (_e, p) => { providerMgr.upsertProvider(p); registerAgentsFromBindings(); return providerMgr.getConfig() })
ipcMain.handle("providers:delete", async (_e, id) => { const ok = providerMgr.deleteProvider(id); if (ok) registerAgentsFromBindings(); return ok })
ipcMain.handle("providers:setEnabled", async (_e, id, enabled) => { providerMgr.setProviderEnabled(id, enabled); return providerMgr.getConfig() })
ipcMain.handle("providers:setKey", async (_e, id, key) => {
  providerMgr.setProviderApiKey(id, key)
  registerAgentsFromBindings()
  // 配好 Key 后自动拉取模型列表（后台进行，不阻塞返回）
  if (key) providerMgr.fetchModels(id).catch(() => {})
  return providerMgr.getConfig()
})
ipcMain.handle("providers:fetchModels", async (_e, id) => {
  const r = await providerMgr.fetchModels(id)
  return { ...r, config: providerMgr.getConfig() }
})
ipcMain.handle("providers:health", async (_e, id) => providerMgr.checkProviderHealth(id))
ipcMain.handle("providers:healthAll", async () => {
  const results: any = {}
  for (const p of providerMgr.getProviders()) {
    results[p.id] = await providerMgr.checkProviderHealth(p.id)
  }
  return results
})
ipcMain.handle("routing:setBinding", async (_e, b) => { providerMgr.upsertBinding(b); registerAgentsFromBindings(); return providerMgr.getBindings() })
ipcMain.handle("routing:removeBinding", async (_e, agentId) => { providerMgr.removeBinding(agentId); registerAgentsFromBindings(); return providerMgr.getBindings() })
ipcMain.handle("routing:setFallback", async (_e, chain) => { providerMgr.setFallbackChain(chain); return providerMgr.getConfig().routing })
ipcMain.handle("routing:setStrategy", async (_e, s) => { providerMgr.setStrategy(s); return providerMgr.getConfig().routing })
ipcMain.handle("routing:setBindingThinking", async (_e, agentId, t) => { providerMgr.setBindingThinking(agentId, t); return providerMgr.getBindings() })
ipcMain.handle("routing:setProviderThinking", async (_e, id, t) => { providerMgr.setProviderThinking(id, t); return providerMgr.getConfig() })
ipcMain.handle("routing:activeBinding", async (_e, agentId) => { providerMgr.setActiveBinding(agentId); return providerMgr.getConfig().activeBindingId })
ipcMain.handle("proxy:info", async () => ({
  url: proxy.getUrl(),
  openaiUrl: proxy.getUrl(),
  anthropicUrl: proxy.getOrigin(),
  running: true
}))
ipcMain.handle("takeover:status", async () => takeoverStatus())
ipcMain.handle("takeover:apply", async (_e, app2: string, modelRef: string) =>
  takeoverApply(app2, modelRef, proxy.getUrl(), proxy.getOrigin()))
ipcMain.handle("takeover:restore", async (_e, app2: string) => takeoverRestore(app2))
// 每个 Agent 返回全部已检测安装（桌面版/终端版，按路径去重）
ipcMain.handle("agents:locate", async () => locateAgentCandidates())

ipcMain.handle("app:openExternal", async (_e, url: string) => {
  if (/^https?:\/\//.test(url) || /^mailto:/.test(url)) await shell.openExternal(url)
})
ipcMain.handle("app:pickFolder", async () => {
  if (!mainWindow) return null
  const r = await dialog.showOpenDialog(mainWindow, { properties: ["openDirectory"] })
  return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0]
})

// 工作区：CRUD + 活动态；落盘在 store.workspaces.v1（与 providers.config.v1 同级）
ipcMain.handle("workspaces:list", () => getWorkspaceManager().list())
ipcMain.handle("workspaces:create", (_e, input: { name: string; rootPath: string }) => {
  try { return getWorkspaceManager().create(input) } catch (e) { throw serialiseWsError(e) }
})
ipcMain.handle("workspaces:update", (_e, id: string, patch: { name?: string; rootPath?: string; bootstrapFiles?: string[] }) => {
  try { return getWorkspaceManager().update(id, patch) } catch (e) { throw serialiseWsError(e) }
})
ipcMain.handle("workspaces:remove", (_e, id: string) => {
  try { return getWorkspaceManager().remove(id) } catch (e) { throw serialiseWsError(e) }
})
ipcMain.handle("workspaces:getActive", () => getWorkspaceManager().getActive())
ipcMain.handle("workspaces:setActive", (_e, id: string | null) => {
  try { getWorkspaceManager().setActive(id); return getWorkspaceManager().getActive() } catch (e) { throw serialiseWsError(e) }
})

function serialiseWsError(e: unknown): Error {
  if (e instanceof WorkspaceNotFoundError || e instanceof WorkspacePathInvalidError) {
    const err = new Error(e.message); (err as any).code = (e as any).code; return err
  }
  return e as Error
}

// --- AgentHub skills + native agentic（Claude-B 新增）：技能 CRUD / 安装 + 能力矩阵 / agentic 开关 ---
ipcMain.handle("skills:list", () => getSkillManager().list())
ipcMain.handle("skills:builtins", () => BUILTIN_SKILLS)
ipcMain.handle("skills:add", (_e, input) => getSkillManager().add(input))
ipcMain.handle("skills:update", (_e, id: string, patch) => getSkillManager().update(id, patch))
ipcMain.handle("skills:remove", (_e, id: string) => getSkillManager().remove(id))
ipcMain.handle("skills:getInstalls", () => getSkillManager().getInstalls())
ipcMain.handle("skills:install", (_e, agentId: string, skillId: string) => getSkillManager().install(agentId, skillId))
ipcMain.handle("skills:uninstall", (_e, agentId: string, skillId: string) => getSkillManager().uninstall(agentId, skillId))
ipcMain.handle("agentic:capabilities", () => getCapabilityMatrix())
ipcMain.handle("agentic:getEnabled", () => getAgenticConfig().getEnabled())
ipcMain.handle("agentic:setEnabled", (_e, agentId: string, on: boolean) => getAgenticConfig().setEnabled(agentId, on))
ipcMain.handle("agentic:getMode", () => getAgenticConfig().getMode())
ipcMain.handle("agentic:setMode", (_e, mode: 'all' | 'selected') => getAgenticConfig().setMode(mode))
// 写/执行审批门禁：策略读写 + 运行时决策回传
ipcMain.handle("agentic:getApprovalConfig", () => getApprovalConfig().getConfig())
ipcMain.handle("agentic:setApprovalDefault", (_e, tool: GuardedTool, policy: ApprovalPolicy) => getApprovalConfig().setDefault(tool, policy))
ipcMain.handle("agentic:setApprovalOverride", (_e, agentId: string, tool: GuardedTool, policy: ApprovalPolicy | null) => getApprovalConfig().setOverride(agentId, tool, policy))
ipcMain.handle("agentic:resolveApproval", (_e, requestId: string, approved: boolean) => dispatcher?.resolveApproval(requestId, approved) ?? false)
// --- /AgentHub skills + native agentic ---

ipcMain.handle("win:minimize", () => { mainWindow?.minimize() })
ipcMain.handle("win:maximizeToggle", () => {
  if (!mainWindow) return false
  if (mainWindow.isMaximized()) mainWindow.unmaximize()
  else mainWindow.maximize()
  return mainWindow.isMaximized()
})
ipcMain.handle("win:isMaximized", () => mainWindow?.isMaximized() ?? false)
ipcMain.handle("win:close", () => { mainWindow?.close() })


function parseDeepLink(url: string): { action: string; params: Record<string, string> } | null {
  if (!url || !url.startsWith('agenthub://')) return null
  try {
    const stripped = url.startsWith('agenthub://') ? url.slice('agenthub://'.length).replace(/^[/]+/, '') : url
    const [actionPath, query] = stripped.split('?')
    const action = actionPath.split('/')[0] || 'open'
    const params: Record<string, string> = {}
    if (query) {
      for (const part of query.split('&')) {
        const [k, v] = part.split('=')
        if (k) params[decodeURIComponent(k)] = v ? decodeURIComponent(v) : ''
      }
    }
    return { action, params }
  } catch {
    return null
  }
}

function handleDeepLink(url: string): void {
  const link = parseDeepLink(url)
  if (!link) return
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
    mainWindow.webContents.send('app:deep-link', link)
  } else {
    pendingDeepLink = link
  }
}

let pendingDeepLink: { action: string; params: Record<string, string> } | null = null

if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('agenthub', process.execPath, [resolve(process.argv[1])])
  }
} else {
  app.setAsDefaultProtocolClient('agenthub')
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    const url = argv.find(a => a.startsWith('agenthub://'))
    if (url) handleDeepLink(url)
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })
}

app.on('open-url', (event, url) => {
  event.preventDefault()
  handleDeepLink(url)
})

const initialDeepLink = process.argv.find(a => a.startsWith('agenthub://'))
if (initialDeepLink) pendingDeepLink = parseDeepLink(initialDeepLink)

app.whenReady().then(async () => {
  if (process.platform === "win32") app.setAppUserModelId("dev.agenthub.desktop")
  prepareLocalCliEnvironment()
  providerMgr.unlockSecrets()   // app ready 后解密落盘的 apiKey 到内存（safeStorage 此时可用）
  seedCoreMemories()
  createWindow()
  createTray()
  await initHub()
  if (pendingDeepLink) {
    mainWindow?.webContents.once("did-finish-load", () => {
      mainWindow?.webContents.send("app:deep-link", pendingDeepLink)
      pendingDeepLink = null
    })
  }
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
  else mainWindow?.show()
})

app.on("before-quit", async () => {
  (app as any).isQuitting = true
  await registry.stopAll()
  hub?.stop()
  proxy.stop()
})
