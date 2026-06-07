import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import request from "supertest";
import type { Express } from "express";
import { createHubApp } from "../src/hub/server.js";
import { CoordinationCore } from "../src/core/core.js";

let app: Express;
const tmpDirs: string[] = [];

beforeEach(() => {
  app = createHubApp({ dbPath: ":memory:" }).app;
});
afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function mkTmp(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

function makeGitRepo(): string {
  const dir = mkTmp("orbit-git-");
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: "t",
    GIT_AUTHOR_EMAIL: "t@t",
    GIT_COMMITTER_NAME: "t",
    GIT_COMMITTER_EMAIL: "t@t",
  };
  execFileSync("git", ["init", "-b", "main"], { cwd: dir, env, stdio: "ignore" });
  fs.writeFileSync(path.join(dir, "README.md"), "hi");
  execFileSync("git", ["add", "."], { cwd: dir, env, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "init"], { cwd: dir, env, stdio: "ignore" });
  return dir;
}

describe("projects REST (A04)", () => {
  it("400s when the path does not exist", async () => {
    const res = await request(app).post("/api/projects").send({ rootPath: "/no/such/dir/orbit-xyz" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("path_not_found");
  });

  it("creates a project from a git repo with auto-detected branch", async () => {
    const dir = makeGitRepo();
    const res = await request(app).post("/api/projects").send({ rootPath: dir });
    expect(res.status).toBe(200);
    expect(res.body.project.isGitRepo).toBe(true);
    expect(res.body.project.targetBranch).toBe("main");
    expect(res.body.project.rootPath).toBe(path.resolve(dir));
    expect(res.body.suggestGitInit).toBe(false);
  });

  it("creates a non-git directory and suggests git init", async () => {
    const dir = mkTmp("orbit-plain-");
    const res = await request(app).post("/api/projects").send({ rootPath: dir });
    expect(res.status).toBe(200);
    expect(res.body.project.isGitRepo).toBe(false);
    expect(res.body.suggestGitInit).toBe(true);
  });

  it("reuses an existing project for the same root path", async () => {
    const dir = makeGitRepo();
    const first = await request(app).post("/api/projects").send({ rootPath: dir });
    const second = await request(app).post("/api/projects").send({ rootPath: dir });
    expect(second.body.reused).toBe(true);
    expect(second.body.project.id).toBe(first.body.project.id);
  });

  it("updates name, target branch and commands round-trip", async () => {
    const dir = makeGitRepo();
    const created = (await request(app).post("/api/projects").send({ rootPath: dir })).body.project;
    const upd = await request(app)
      .post(`/api/projects/${created.id}`)
      .send({ name: "My App", targetBranch: "develop", commands: { test: "npm test", build: "npm run build" } });
    expect(upd.status).toBe(200);
    expect(upd.body.project.name).toBe("My App");
    expect(upd.body.project.targetBranch).toBe("develop");

    const got = await request(app).get(`/api/projects/${created.id}`);
    expect(got.body.project.commands.test).toBe("npm test");
    expect(got.body.project.commands.build).toBe("npm run build");
  });

  it("git-init turns a plain dir into a repo", async () => {
    const dir = mkTmp("orbit-init-");
    const created = (await request(app).post("/api/projects").send({ rootPath: dir })).body.project;
    expect(created.isGitRepo).toBe(false);
    const res = await request(app).post(`/api/projects/${created.id}/git-init`).send();
    expect(res.status).toBe(200);
    expect(res.body.project.isGitRepo).toBe(true);
  });

  it("404s for an unknown project", async () => {
    expect((await request(app).get("/api/projects/nope")).status).toBe(404);
    expect((await request(app).post("/api/projects/nope").send({ name: "x" })).status).toBe(404);
  });

  it("lists created projects", async () => {
    await request(app).post("/api/projects").send({ rootPath: makeGitRepo() });
    const list = await request(app).get("/api/projects");
    expect(list.body.projects.length).toBeGreaterThanOrEqual(1);
  });
});

describe("environment REST (A01/A02)", () => {
  it("reports node, git, agents and ok", async () => {
    const res = await request(app).get("/api/environment");
    expect(res.status).toBe(200);
    expect(res.body.node.available).toBe(true);
    expect(res.body.git).toHaveProperty("available");
    expect(Array.isArray(res.body.agents)).toBe(true);
    expect(res.body.agents).toHaveLength(2);
    expect(res.body).toHaveProperty("ok");
  });
});

describe("mission ↔ project binding (A04)", () => {
  it("binds a mission to a projectId and persists it", () => {
    const core = new CoordinationCore(":memory:");
    const dir = makeGitRepo();
    const project = core.projects.create({ rootPath: dir });
    const mission = core.missions.create({ goal: "建用户注册", projectId: project.id, projectPath: project.rootPath });
    expect(mission.projectId).toBe(project.id);
    expect(core.store.getMission(mission.id)?.projectId).toBe(project.id);
    core.close();
  });
});
