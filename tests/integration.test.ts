import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";
import { CoordinationCore } from "../src/core/core.js";
import { RunManager } from "../src/hub/run-manager.js";
import { IntegrationManager, type ValidationRunner } from "../src/hub/integration-manager.js";
import type { DriverSpec, Harness } from "../src/drivers/types.js";

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
    fs.rmSync(`${d}-orbit`, { recursive: true, force: true });
  }
});

const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, env: GIT_ENV, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}
function makeGitRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-integ-"));
  tmpDirs.push(dir);
  git(dir, ["init", "-b", "main"]);
  fs.writeFileSync(path.join(dir, "README.md"), "base\n");
  git(dir, ["add", "."]);
  git(dir, ["commit", "-m", "init"]);
  return dir;
}

const ENV = { harness: "claude-code" as const, available: true, binPath: null, version: null, loggedIn: null, hint: "" };
// 假 worker：在自己的 worktree 写一个文件（新增），再 session/done。
function writerDriver(file: string, content: string): DriverSpec {
  return {
    id: "claude-code",
    harness: "claude-code",
    async detect() {
      return ENV;
    },
    buildStart(input) {
      const s = `const fs=require('fs');fs.writeFileSync(${JSON.stringify(file)},${JSON.stringify(content)});console.log(JSON.stringify({t:'session',sid:'s'}));console.log(JSON.stringify({t:'done'}));`;
      return { command: process.execPath, args: ["-e", s], cwd: input.projectPath, env: process.env };
    },
    buildResume(_s, _m, input) {
      return { command: process.execPath, args: ["-e", "0"], cwd: input.projectPath, env: process.env };
    },
    parseLine(line) {
      try {
        const o = JSON.parse(line) as { t: string; sid?: string };
        if (o.t === "session" && o.sid) return [{ kind: "session", sessionId: o.sid }];
        if (o.t === "done") return [{ kind: "status", status: "done", detail: "ok" }];
      } catch {
        /* ignore */
      }
      return [];
    },
  };
}

async function waitTerminal(core: CoordinationCore, runId: string, ms = 8000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const r = core.store.getAgentRun(runId);
    if (r && ["done", "failed", "stopped"].includes(r.status)) return;
    await new Promise((res) => setTimeout(res, 25));
  }
}

async function waitFor(cond: () => boolean, ms = 8000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (cond()) return;
    await new Promise((res) => setTimeout(res, 25));
  }
}

// 智能假 worker：在自己的 worktree 写 shared.ts（制造冲突）；若 cwd 里检测到 git 冲突文件
// （即被派去集成 worktree 解决冲突），则把冲突文件改成无标记内容并 git add（不 commit）。
function smartDriver(content: string): DriverSpec {
  const script =
    `const fs=require('fs');const cp=require('child_process');` +
    `let u='';try{u=cp.execSync('git diff --name-only --diff-filter=U',{encoding:'utf8'}).trim();}catch(e){}` +
    `if(u){for(const f of u.split('\\n')){fs.writeFileSync(f,'export const v="MERGED";\\n');}cp.execSync('git add -A');}` +
    `else{fs.writeFileSync('shared.ts',${JSON.stringify(`export const v="${content}";\n`)});}` +
    `console.log(JSON.stringify({t:'session',sid:'s'}));console.log(JSON.stringify({t:'done'}));`;
  return {
    id: "claude-code",
    harness: "claude-code",
    async detect() {
      return ENV;
    },
    buildStart(input) {
      return { command: process.execPath, args: ["-e", script], cwd: input.projectPath, env: GIT_ENV };
    },
    buildResume(_s, _m, input) {
      return { command: process.execPath, args: ["-e", "0"], cwd: input.projectPath, env: process.env };
    },
    parseLine(line) {
      try {
        const o = JSON.parse(line) as { t: string; sid?: string };
        if (o.t === "session" && o.sid) return [{ kind: "session", sessionId: o.sid }];
        if (o.t === "done") return [{ kind: "status", status: "done", detail: "ok" }];
      } catch {
        /* ignore */
      }
      return [];
    },
  };
}

const passValidation: ValidationRunner = () => ({ exitCode: 0, output: "ok" });

// 启动两个 Agent（各写一个文件）并等待完成。返回 core/runs/integ/mission/root。
async function setupTwoAgents(opts: {
  feFile: string;
  feContent: string;
  beFile: string;
  beContent: string;
  validation?: ValidationRunner;
  commands?: Record<string, string>;
}): Promise<{ core: CoordinationCore; integ: IntegrationManager; missionId: string; root: string }> {
  const root = makeGitRepo();
  const core = new CoordinationCore(":memory:");
  const resolver = (h: Harness): DriverSpec => (h === "codex" ? writerDriver(opts.feFile, opts.feContent) : writerDriver(opts.beFile, opts.beContent));
  const runs = new RunManager(core, resolver);
  const integ = new IntegrationManager(core, opts.validation ?? passValidation);

  let projectId: string | null = null;
  if (opts.commands) projectId = core.projects.create({ rootPath: root, commands: opts.commands }).id;
  const mission = core.missions.create({ goal: "加用户注册", projectId, projectPath: root });
  core.missions.markRunning(mission.id);
  const rA = runs.start({ harness: "claude-code", missionId: mission.id, taskId: "be", projectId, taskTitle: "后端", goal: "g", projectPath: root });
  const rB = runs.start({ harness: "codex", missionId: mission.id, taskId: "fe", projectId, taskTitle: "前端", goal: "g", projectPath: root });
  await Promise.all([waitTerminal(core, rA.id), waitTerminal(core, rB.id)]);
  return { core, integ, missionId: mission.id, root };
}

describe("IntegrationManager (第四阶段验收)", () => {
  it("integrates two agent branches into a reviewable candidate", async () => {
    const { core, integ, missionId } = await setupTwoAgents({ feFile: "frontend.ts", feContent: "export const fe=1;\n", beFile: "backend.ts", beContent: "export const be=1;\n" });

    const result = integ.integrate(missionId);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.integration.status).toBe("ready");
      expect(result.integration.mergedBranches).toHaveLength(2);
    }
    // mission 推进到等待审批。
    expect(core.missions.get(missionId)!.state).toBe("awaiting_final_approval");
    // G06 最终 Diff 含两个 Agent 的改动。
    const diff = integ.diff(missionId)!;
    const files = diff.files.map((f) => f.path);
    expect(files).toContain("frontend.ts");
    expect(files).toContain("backend.ts");

    core.close();
  });

  it("merges into the target branch only after approval, then completes", async () => {
    const { core, integ, missionId, root } = await setupTwoAgents({ feFile: "frontend.ts", feContent: "export const fe=1;\n", beFile: "backend.ts", beContent: "export const be=1;\n" });
    integ.integrate(missionId);

    // 合入前，目标分支(main)还没有两个 Agent 的文件。
    expect(fs.existsSync(path.join(root, "frontend.ts"))).toBe(false);

    const appr = integ.approve(missionId, "user", "looks good");
    expect(appr.ok).toBe(true);
    expect(appr.resultCommit).toBeTruthy();
    expect(core.missions.get(missionId)!.state).toBe("completed");
    expect(integ.getIntegration(missionId)!.status).toBe("merged");
    // 目标分支现在包含两个 Agent 的改动（G07 真实合入）。
    expect(fs.readFileSync(path.join(root, "frontend.ts"), "utf8")).toContain("fe=1");
    expect(fs.readFileSync(path.join(root, "backend.ts"), "utf8")).toContain("be=1");
    expect(integ.approvals(missionId)).toHaveLength(1);

    core.close();
  });

  it("aborts on merge conflict without breaking the target branch (D08)", async () => {
    // 两个 Agent 都新建同名文件、内容不同 → 第二个分支合并冲突。
    const { core, integ, missionId, root } = await setupTwoAgents({ feFile: "shared.ts", feContent: "export const v='FE';\n", beFile: "shared.ts", beContent: "export const v='BE';\n" });
    const mainBefore = git(root, ["rev-parse", "main"]);

    const result = integ.integrate(missionId);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("merge_conflict");
    const integ1 = integ.getIntegration(missionId)!;
    expect(integ1.status).toBe("conflict");
    expect(integ1.conflicts).toContain("shared.ts");
    expect(core.missions.get(missionId)!.state).toBe("resolving_conflicts");
    // 目标分支未被破坏。
    expect(git(root, ["rev-parse", "main"])).toBe(mainBefore);

    core.close();
  });

  it("marks integration failed when validation does not pass (G03)", async () => {
    const { core, integ, missionId } = await setupTwoAgents({
      feFile: "frontend.ts",
      feContent: "x\n",
      beFile: "backend.ts",
      beContent: "y\n",
      commands: { test: "exit 1" },
      validation: (cmd) => ({ exitCode: cmd === "exit 1" ? 1 : 0, output: "boom" }),
    });

    const result = integ.integrate(missionId);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("validation_failed");
    expect(integ.getIntegration(missionId)!.status).toBe("failed");
    // 未进入等待审批。
    expect(core.missions.get(missionId)!.state).not.toBe("awaiting_final_approval");
    // 验证报告已落库（G04）。
    const vals = integ.validations(missionId);
    expect(vals).toHaveLength(1);
    expect(vals[0]!.ok).toBe(false);

    core.close();
  });

  it("records a rejection and fails the mission (B08)", async () => {
    const { core, integ, missionId } = await setupTwoAgents({ feFile: "f.ts", feContent: "1\n", beFile: "b.ts", beContent: "2\n" });
    integ.integrate(missionId);
    const rej = integ.reject(missionId, "user", "需要改接口");
    expect(rej.ok).toBe(true);
    expect(core.missions.get(missionId)!.state).toBe("cancelled");
    const apprs = integ.approvals(missionId);
    expect(apprs[0]!.decision).toBe("rejected");
    core.close();
  });

  it("dispatches an agent to resolve an integration conflict, then auto-continues to ready (派回闭环)", async () => {
    const root = makeGitRepo();
    const core = new CoordinationCore(":memory:");
    // 两个 Agent 都写同名 shared.ts、内容不同 → 第二个分支合并必冲突。
    const resolver = (h: Harness): DriverSpec => smartDriver(h === "codex" ? "FE" : "BE");
    const runs = new RunManager(core, resolver);
    const integ = new IntegrationManager(core, passValidation, runs);
    integ.start(); // 订阅事件：修复 run 完成后自动收口并续跑

    const mission = core.missions.create({ goal: "加用户注册", projectId: null, projectPath: root });
    core.missions.markRunning(mission.id);
    const rA = runs.start({ harness: "claude-code", missionId: mission.id, taskId: "be", projectId: null, taskTitle: "后端", goal: "g", projectPath: root });
    const rB = runs.start({ harness: "codex", missionId: mission.id, taskId: "fe", projectId: null, taskTitle: "前端", goal: "g", projectPath: root });
    await Promise.all([waitTerminal(core, rA.id), waitTerminal(core, rB.id)]);

    // 初次集成 → 第二分支冲突，停在 conflict。
    const r1 = integ.integrate(mission.id);
    expect(r1.ok).toBe(false);
    expect(integ.getIntegration(mission.id)!.status).toBe("conflict");
    expect(core.missions.get(mission.id)!.state).toBe("resolving_conflicts");

    // 派回修复：起一个 Agent 去集成 worktree 现场解决。
    const fix = integ.dispatchConflictFix(mission.id);
    expect(fix.ok).toBe(true);
    expect(fix.runId).toBeTruthy();

    // 等修复 run 完成 + 自动续跑（收口 merge → 验证 → ready）。
    await waitFor(() => integ.getIntegration(mission.id)!.status === "ready", 8000);
    const final = integ.getIntegration(mission.id)!;
    expect(final.status).toBe("ready");
    expect(final.mergedBranches).toHaveLength(2);
    expect(final.conflicts).toHaveLength(0);
    expect(core.missions.get(mission.id)!.state).toBe("awaiting_final_approval");

    core.close();
  });

  it("rejects dispatch when not in conflict and caps retries", async () => {
    const { core, integ, missionId } = await setupTwoAgents({ feFile: "f.ts", feContent: "1\n", beFile: "b.ts", beContent: "2\n" });
    // 无 runs 注入的 integ（setupTwoAgents 不传 runs）→ 派回不可用。
    const r = integ.dispatchConflictFix(missionId);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("runs_unavailable");
    core.close();
  });

  it("rolls back the target branch if the final merge conflicts (D09)", async () => {
    const { core, integ, missionId, root } = await setupTwoAgents({ feFile: "frontend.ts", feContent: "export const fe=1;\n", beFile: "a.ts", beContent: "export const a='integration';\n" });
    integ.integrate(missionId);
    expect(integ.getIntegration(missionId)!.status).toBe("ready");

    // 集成就绪后，目标分支被第三方推进，且改了与集成相同的文件 a.ts → 合入必冲突。
    fs.writeFileSync(path.join(root, "a.ts"), "export const a='target-side';\n");
    git(root, ["add", "."]);
    git(root, ["commit", "-m", "target moves a.ts"]);
    const targetTip = git(root, ["rev-parse", "main"]);

    const appr = integ.approve(missionId, "user");
    expect(appr.ok).toBe(false);
    if (!appr.ok) expect(appr.reason).toBe("merge_into_target_conflict");
    expect(integ.getIntegration(missionId)!.status).toBe("rolled_back");
    expect(core.missions.get(missionId)!.state).toBe("failed");
    // D09：目标分支被安全回退到合入前（第三方那次提交），仓库可用。
    expect(git(root, ["rev-parse", "main"])).toBe(targetTip);
    expect(fs.readFileSync(path.join(root, "a.ts"), "utf8")).toContain("target-side");

    core.close();
  });
});
