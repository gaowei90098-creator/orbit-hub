import type { Harness } from "../core/types.js";
import type { DriverId, DriverSpec } from "./types.js";
import { claudeDriver } from "./claude-driver.js";
import { codexDriver } from "./codex-driver.js";

// 按 harness 选择 Driver。第一阶段只支持 claude-code / codex；其余返回 null。
const DRIVERS: Record<DriverId, DriverSpec> = {
  "claude-code": claudeDriver,
  codex: codexDriver,
};

export function getDriver(harness: Harness): DriverSpec | null {
  if (harness === "claude-code") return DRIVERS["claude-code"];
  if (harness === "codex") return DRIVERS["codex"];
  return null;
}

export function isDrivableHarness(harness: Harness): harness is DriverId {
  return harness === "claude-code" || harness === "codex";
}

export { DRIVERS };
