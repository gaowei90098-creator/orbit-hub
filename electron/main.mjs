import { app, BrowserWindow, nativeTheme, screen, shell } from "electron";
import path from "node:path";
import fs from "node:fs";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.join(__dirname, ".."); // dev: project root; packaged: Resources/app
const HUB_CLI = path.join(APP_ROOT, "dist", "cli.js");
const PORT = 4100;
const DISPLAY_NAME = "协作枢纽";
// 历届应用名（userData 目录随应用名走）：AgentHub → Orbit → 协作枢纽。
const LEGACY_NAMES = ["Orbit", "AgentHub"];

app.setName(DISPLAY_NAME);

let hubProc = null;
let win = null;

function migrateLegacyUserData() {
  const appData = app.getPath("appData");
  const newDir = app.getPath("userData");
  const files = ["hub.sqlite", "hub.log"];
  for (const legacy of LEGACY_NAMES) {
    const oldDir = path.join(appData, legacy);
    if (oldDir === newDir || !fs.existsSync(oldDir)) continue;
    fs.mkdirSync(newDir, { recursive: true });
    for (const file of files) {
      const oldPath = path.join(oldDir, file);
      const newPath = path.join(newDir, file);
      if (fs.existsSync(oldPath) && !fs.existsSync(newPath)) fs.copyFileSync(oldPath, newPath);
    }
  }
}

// The hub runs in real system Node (built-in node:sqlite, no native build) rather than
// inside Electron — robust across Electron versions. Agents connect to localhost:4100.
function findNode() {
  const candidates = [
    "/opt/homebrew/bin/node",
    "/usr/local/bin/node",
    "/usr/bin/node",
    path.join(process.env.HOME || "", ".volta/bin/node"),
    path.join(process.env.HOME || "", ".nvm/current/bin/node"),
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  return "node";
}

function startHub() {
  const dbPath = path.join(app.getPath("userData"), "hub.sqlite");
  const logPath = path.join(app.getPath("userData"), "hub.log");
  const logFd = fs.openSync(logPath, "a");
  const node = findNode();
  hubProc = spawn(node, [HUB_CLI, "start", "--port", String(PORT), "--db", dbPath], {
    cwd: APP_ROOT,
    stdio: ["ignore", logFd, logFd],
    env: { ...process.env },
  });
  hubProc.on("error", (err) => console.error("[Orbit] failed to start hub:", err?.message));
}

function waitForHub(timeoutMs = 15000) {
  const start = Date.now();
  return new Promise((resolve) => {
    const tick = () => {
      const req = http.get(`http://127.0.0.1:${PORT}/healthz`, (res) => {
        res.resume();
        resolve(true);
      });
      req.on("error", () => {
        if (Date.now() - start > timeoutMs) return resolve(false);
        setTimeout(tick, 250);
      });
    };
    tick();
  });
}

function createWindow() {
  // 面板是深色主题：锁定深色外观，标题栏与内容一致（不跟随系统浅色模式）。
  nativeTheme.themeSource = "dark";
  // 默认窗口不超过屏幕可用区域，否则小屏上一打开就"铺满全屏"。
  const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize;
  win = new BrowserWindow({
    width: Math.min(1480, Math.round(screenW * 0.92)),
    height: Math.min(920, Math.round(screenH * 0.92)),
    minWidth: Math.min(1080, screenW),
    minHeight: Math.min(680, screenH),
    backgroundColor: "#262624",
    title: DISPLAY_NAME,
    show: false,
    center: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  win.once("ready-to-show", () => win.show());
  win.loadURL(`http://localhost:${PORT}`);
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
    migrateLegacyUserData();
    startHub();
    await waitForHub();
    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", () => {
    try {
      hubProc?.kill("SIGTERM");
    } catch {
      /* ignore */
    }
  });
}
