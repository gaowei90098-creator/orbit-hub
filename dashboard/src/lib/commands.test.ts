import { describe, it, expect } from "vitest";
import {
  parseCommand,
  pickLatestMission,
  renderStatus,
  renderResult,
  SLASH_COMMANDS,
} from "./commands";
import type { IntegrationDetail, Mission, Worker } from "../types";

const T0 = 1_000_000;

function mission(over: Partial<Mission> = {}): Mission {
  return {
    id: "ms1",
    goal: "加用户注册",
    projectPath: "/p",
    status: "active",
    state: "running",
    taskIds: [],
    worktrees: [],
    createdBy: null,
    createdAt: T0,
    updatedAt: T0,
    ...over,
  };
}

function worker(over: Partial<Worker> = {}): Worker {
  return {
    id: "w1",
    missionId: "ms1",
    taskId: null,
    taskTitle: "后端",
    harness: "claude-code",
    status: "running",
    projectPath: "/p",
    lastActivity: "写接口",
    error: "",
    costUsd: 0,
    startedAt: T0,
    updatedAt: T0,
    ...over,
  };
}

describe("parseCommand", () => {
  it("parses command name + args + spec, lowercasing the verb", () => {
    const p = parseCommand("/Status foo bar");
    expect(p.cmd).toBe("/status");
    expect(p.args).toEqual(["foo", "bar"]);
    expect(p.spec?.kind).toBe("readonly");
  });

  it("returns null spec for unknown commands", () => {
    expect(parseCommand("/nope").spec).toBeNull();
  });

  it("exposes every known command in SLASH_COMMANDS", () => {
    expect(SLASH_COMMANDS).toContain("/integrate");
    expect(SLASH_COMMANDS).toContain("/cancel");
  });
});

describe("pickLatestMission", () => {
  it("returns null when there are no missions", () => {
    expect(pickLatestMission([])).toBeNull();
  });

  it("prefers the newest non-archived mission", () => {
    const old = mission({ id: "old", createdAt: T0 });
    const fresh = mission({ id: "fresh", createdAt: T0 + 5000 });
    const archived = mission({ id: "arch", createdAt: T0 + 9999, status: "archived" });
    expect(pickLatestMission([old, fresh, archived])!.id).toBe("fresh");
  });

  it("falls back to archived missions when none are active", () => {
    const a = mission({ id: "a", createdAt: T0, status: "archived" });
    const b = mission({ id: "b", createdAt: T0 + 1, status: "archived" });
    expect(pickLatestMission([a, b])!.id).toBe("b");
  });
});

describe("renderStatus", () => {
  it("explains when there is no mission", () => {
    expect(renderStatus(null, [])).toContain("还没有进行中的协作");
  });

  it("summarizes the mission and its workers", () => {
    const m = mission();
    const out = renderStatus(m, [
      worker({ id: "w1", status: "running", taskTitle: "后端", lastActivity: "写接口" }),
      worker({ id: "w2", status: "done", taskTitle: "前端" }),
      worker({ id: "wOther", missionId: "other" }),
    ]);
    expect(out).toContain("加用户注册");
    expect(out).toContain("1/2 在跑"); // 只算本 mission 的 2 个，1 个在跑
    expect(out).toContain("后端");
    expect(out).toContain("写接口");
    expect(out).not.toContain("wOther"); // 别的 mission 的 worker 不计入
  });

  it("notes when a mission has no workers yet", () => {
    expect(renderStatus(mission(), [])).toContain("暂无执行中的 Agent");
  });
});

describe("renderResult", () => {
  it("guides the user when there is no integration yet", () => {
    expect(renderResult(null)).toContain("/integrate");
  });

  it("summarizes integration status and diff", () => {
    const detail: IntegrationDetail = {
      integration: {
        id: "i1",
        missionId: "ms1",
        branch: "orbit/integration",
        worktreePath: "/p-int",
        targetBranch: "main",
        baseCommit: "abc",
        resultCommit: "deadbeefcafe",
        mergedBranches: ["orbit/be", "orbit/fe"],
        conflicts: [],
        status: "merged",
        validationRunIds: [],
        createdAt: T0,
        updatedAt: T0,
      },
      diff: { base: "main", files: [], untracked: [], filesChanged: 3, insertions: 40, deletions: 5 },
      validations: [],
      approvals: [],
    };
    const out = renderResult(detail);
    expect(out).toContain("merged");
    expect(out).toContain("orbit/be, orbit/fe");
    expect(out).toContain("3 个文件 +40/-5");
    expect(out).toContain("deadbeef"); // 短 commit
  });
});
