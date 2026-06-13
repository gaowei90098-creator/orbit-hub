import express, { type Express, type NextFunction, type Request, type Response } from "express";
import path from "node:path";
import fs from "node:fs";
import { CoordinationCore } from "../core/core.js";
import { mountRoutes } from "./routes.js";
import { mountSse } from "./sse.js";
import { RunManager, type DriverResolver } from "./run-manager.js";
import { Coordinator } from "./coordinator.js";
import { MessageRouter } from "./message-router.js";
import { IntegrationManager, type ValidationRunner } from "./integration-manager.js";
import { Supervisor } from "./supervisor.js";
import type { LeadPlannerFn } from "./lead-planner.js";

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
  /** 1.1 Lead Planner（claude headless 拆分）。CLI 启动时注入真实实现；不注入则一律走模板。 */
  leadPlanner?: LeadPlannerFn;
}

// Optional bearer-token gate. Off by default (local use); enabled for networked mode.
function authMiddleware(token: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    // 公开：健康检查、静态前端、A2A 服务发现（/.well-known）。受保护：/api 与 A2A 调用端点 /a2a
    // （能拉起协作，须与 /api/missions/launch 同等鉴权，不能因路径不在 /api 下就裸奔）。
    if (!req.path.startsWith("/api") && req.path !== "/a2a") return next();
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
  messageRouter: MessageRouter;
  integration: IntegrationManager;
  supervisor: Supervisor;
} {
  const core = new CoordinationCore(options.dbPath ?? ":memory:");
  const runs = new RunManager(core, options.driverResolver);
  // E02/E04：契约更新自动注入另一 Agent 会话。订阅自身事件总线。
  const coordinator = new Coordinator(core, runs);
  coordinator.start();
  // M2.2：消息路由——主动推送给目标 worker（orbit_wait + resume 双通道）。
  const messageRouter = new MessageRouter(core, runs);
  messageRouter.start();
  // 第四阶段：集成、验证、最终 Diff、审批编排。注入 runs 以支持集成冲突自动派回修复。
  const integration = new IntegrationManager(core, options.validationRunner, runs);
  integration.start();
  // M3.2c：监督循环——周期扫停滞 worker 并发系统告警进时间线。
  const supervisor = new Supervisor(core, runs);
  supervisor.start();
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  if (options.token) app.use(authMiddleware(options.token));

  mountRoutes(app, core, { tokenRequired: Boolean(options.token), leadPlanner: options.leadPlanner }, runs, integration, messageRouter);
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

  return { app, core, runs, coordinator, messageRouter, integration, supervisor };
}
