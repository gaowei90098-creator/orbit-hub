import express, { type Express, type NextFunction, type Request, type Response } from "express";
import path from "node:path";
import fs from "node:fs";
import { CoordinationCore } from "../core/core.js";
import { mountRoutes } from "./routes.js";
import { mountSse } from "./sse.js";
import { RunManager, type DriverResolver } from "./run-manager.js";
import { Coordinator } from "./coordinator.js";
import { IntegrationManager, type ValidationRunner } from "./integration-manager.js";

export interface HubOptions {
  dbPath?: string;
  /** When set, every /api request must present this token (Bearer header or ?token=). */
  token?: string;
  /** Override the built dashboard directory; defaults to <repo>/dashboard/dist. */
  dashboardDir?: string;
  /** 注入自定义 Driver 解析（测试用假 Driver 验证并行编排，无需真实 CLI）。 */
  driverResolver?: DriverResolver;
  /** 注入验证命令执行器（测试用确定性假命令，无需真实 build/test）。 */
  validationRunner?: ValidationRunner;
}

// Optional bearer-token gate. Off by default (local use); enabled for networked mode.
function authMiddleware(token: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.path.startsWith("/api")) return next();
    const header = req.header("authorization") ?? "";
    const provided = header.startsWith("Bearer ") ? header.slice(7) : String(req.query.token ?? "");
    if (provided === token) return next();
    res.status(401).json({ error: "unauthorized" });
  };
}

// Builds the Express app wired to a fresh coordination core. Returns app + core + workers so
// tests can drive the core directly and the CLI can clean up spawned workers on shutdown.
export function createHubApp(options: HubOptions = {}): {
  app: Express;
  core: CoordinationCore;
  runs: RunManager;
  coordinator: Coordinator;
  integration: IntegrationManager;
} {
  const core = new CoordinationCore(options.dbPath ?? ":memory:");
  const runs = new RunManager(core, options.driverResolver);
  // E02/E04：契约更新自动注入另一 Agent 会话。订阅自身事件总线。
  const coordinator = new Coordinator(core, runs);
  coordinator.start();
  // 第四阶段：集成、验证、最终 Diff、审批编排。
  const integration = new IntegrationManager(core, options.validationRunner);
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  if (options.token) app.use(authMiddleware(options.token));

  mountRoutes(app, core, { tokenRequired: Boolean(options.token) }, runs, integration);
  mountSse(app, core);

  // Serve the built dashboard if present, with SPA fallback for client-side routing.
  const dashboardDir = options.dashboardDir ?? path.resolve(import.meta.dirname, "../../dashboard/dist");
  if (fs.existsSync(dashboardDir)) {
    app.use(express.static(dashboardDir));
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.method === "GET" && !req.path.startsWith("/api")) {
        res.sendFile(path.join(dashboardDir, "index.html"));
      } else {
        next();
      }
    });
  }

  return { app, core, runs, coordinator, integration };
}
