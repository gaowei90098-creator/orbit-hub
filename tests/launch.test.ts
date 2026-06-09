import { describe, it, expect } from "vitest";
import { launchParts } from "../src/launch.js";

describe("launchParts (连接命令生成)", () => {
  it("已构建的 .js 用稳定的 node，而非带版本号的绝对路径", () => {
    const p = launchParts("/Users/x/AgentHub/dist/cli.js");
    expect(p.command).toBe("node");
    expect(p.baseArgs).toEqual(["/Users/x/AgentHub/dist/cli.js"]);
    // 回归护栏：绝不能是 homebrew Cellar 之类的版本化 node 路径（升级即失效）。
    expect(p.command).not.toContain("Cellar");
    expect(p.command).not.toMatch(/\d+\.\d+\.\d+/);
  });

  it("开发期 .ts 入口用 npx tsx", () => {
    const p = launchParts("/Users/x/AgentHub/src/cli.ts");
    expect(p.command).toBe("npx");
    expect(p.baseArgs).toEqual(["tsx", "/Users/x/AgentHub/src/cli.ts"]);
  });

  it("路径含空格也按结构传递，不被拼接破坏", () => {
    const p = launchParts("/Users/My Apps/AgentHub/dist/cli.js");
    expect(p.baseArgs[0]).toBe("/Users/My Apps/AgentHub/dist/cli.js");
  });
});
