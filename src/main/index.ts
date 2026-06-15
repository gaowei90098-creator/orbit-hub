import { app, BrowserWindow, Tray, Menu, nativeImage, Notification, ipcMain, shell, dialog } from "electron"
import { join, resolve } from "path"
import { existsSync } from "fs"
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

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let hub: HubServer | null = null
const registry = new AgentRegistry()
const pipeline = new EventPipeline()
const router = new KeywordRouter()
const providerMgr = getProviderManager()
let dispatcher: Dispatcher | null = null
const proxy = getLocalProxy()
let memoryLibrary: MemoryLibrary | null = null

function memory(): MemoryLibrary {
  if (!memoryLibrary) memoryLibrary = new MemoryLibrary(app.getPath("userData"))
  return memoryLibrary
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
    title: "AgentHub",
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
    { label: "Open AgentHub", click: () => mainWindow?.show() },
    { type: "separator" },
    { label: "Status: Running", enabled: false },
    { type: "separator" },
    { label: "Quit", click: () => { (app as any).isQuitting = true; app.quit() } }
  ])
  tray.setToolTip("AgentHub - Multi-Agent Workbench")
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
  dispatcher = new Dispatcher(registry, pipeline, () => memory().getCatalog().entries.slice(0, 12))
  hub = new HubServer(registry)

  hub.on("client:message", async ({ clientId: _clientId, message }) => {
    if (message.type === "chat:message") {
      const task = await dispatcher!.dispatch(
        message.payload.text,
        message.payload.mode || "auto",
        message.payload.targetAgent,
        { thinking: message.payload.thinking, workspaceId: message.payload.workspaceId ?? null }
      )
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
    await detectAgentsAsync()
    console.log("[Hub] Initial agent detection complete")
  } catch (e) {
    console.error("[Hub] Initial detection failed:", e)
  }

  try {
    await proxy.start()
    console.log("[Proxy] Local Chat Completions:", proxy.getUrl())
  } catch (e) {
    console.error("[Proxy] Failed to start:", e)
  }

  hub.start()
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
  return dispatcher?.dispatch(payload.text, payload.mode || "auto", payload.targetAgent, { thinking: payload.thinking, workspaceId: payload.workspaceId ?? null })
})
ipcMain.handle("hub:routePreview", async (_event, text: string) => routePreview(text, registry, router))

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
  providerMgr.unlockSecrets()   // app ready 后解密落盘的 apiKey 到内存（safeStorage 此时可用）
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
