import path from "node:path";
import { execFileSync } from "node:child_process";
import type { Store } from "./store.js";
import type { EventBus } from "./events.js";
import type { Project, ProjectCommands } from "./types.js";
import { newId } from "./id.js";

// A04 Project 领域模块：登记本地 Git 项目，所有协作数据据此绑定 projectId。
// 第一阶段不阻断非 git 目录（决策：允许创建 + 提示可一键 git init），但会探测并记录
// is_git_repo / 当前分支 / 远端 URL，供后续阶段的健康检查与工作区隔离使用。

// 同步跑一条 git 命令并取 stdout；失败返回 null（不是 git 仓库/无该配置都走这里）。
function gitCapture(rootPath: string, args: string[]): string | null {
  try {
    return execFileSync("git", args, { cwd: rootPath, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

export interface ProjectInspection {
  isGitRepo: boolean;
  targetBranch: string | null;
  repositoryUrl: string | null;
}

// 探测目录的 git 状态（仓库?/当前分支/远端 URL）。不修改任何东西。
export function inspectProject(rootPath: string): ProjectInspection {
  const inside = gitCapture(rootPath, ["rev-parse", "--is-inside-work-tree"]);
  if (inside !== "true") return { isGitRepo: false, targetBranch: null, repositoryUrl: null };
  const branch = gitCapture(rootPath, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const url = gitCapture(rootPath, ["config", "--get", "remote.origin.url"]);
  return { isGitRepo: true, targetBranch: branch || null, repositoryUrl: url || null };
}

// 对非 git 目录执行 `git init`（决策：仅在用户显式触发时）。返回新的探测结果。
export function gitInit(rootPath: string): ProjectInspection {
  try {
    execFileSync("git", ["init"], { cwd: rootPath, stdio: ["ignore", "ignore", "ignore"] });
  } catch (err) {
    throw new Error(`git init 失败：${(err as Error).message}`);
  }
  return inspectProject(rootPath);
}

export interface CreateProjectInput {
  rootPath: string;
  name?: string;
  commands?: ProjectCommands;
}

export class Projects {
  constructor(
    private readonly store: Store,
    private readonly events: EventBus,
  ) {}

  create(input: CreateProjectInput): Project {
    const now = Date.now();
    const rootPath = path.resolve(input.rootPath);
    const insp = inspectProject(rootPath);
    const project: Project = {
      id: newId("proj"),
      name: input.name?.trim() || path.basename(rootPath),
      rootPath,
      repositoryUrl: insp.repositoryUrl,
      targetBranch: insp.targetBranch,
      isGitRepo: insp.isGitRepo,
      commands: input.commands ?? {},
      createdAt: now,
      updatedAt: now,
    };
    this.store.insertProject(project);
    this.events.emit("project_created", project);
    return project;
  }

  list(): Project[] {
    return this.store.listProjects();
  }

  get(id: string): Project | null {
    return this.store.getProject(id);
  }

  update(
    id: string,
    fields: Partial<Pick<Project, "name" | "targetBranch" | "repositoryUrl" | "isGitRepo" | "commands">>,
  ): Project | null {
    if (!this.store.getProject(id)) return null;
    this.store.updateProjectFields(id, fields, Date.now());
    const updated = this.store.getProject(id);
    if (updated) this.events.emit("project_updated", updated);
    return updated;
  }

  // 对已登记项目执行 git init 并刷新 is_git_repo / 分支 / 远端。
  initGit(id: string): Project | null {
    const project = this.store.getProject(id);
    if (!project) return null;
    const insp = gitInit(project.rootPath);
    return this.update(id, {
      isGitRepo: insp.isGitRepo,
      targetBranch: insp.targetBranch,
      repositoryUrl: insp.repositoryUrl,
    });
  }
}
