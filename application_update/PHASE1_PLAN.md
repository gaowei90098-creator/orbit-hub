# Orbit 第一阶段实现方案（待评审 · 不含源码）

> 范围：**Project 模型、ClaudeDriver、CodexDriver、ProcessManager**
> 完成标准：两个 CLI 均可由 Orbit 启动和监控。
> 原则：保留现有 54 个测试全绿，渐进式重构，新增模块补单元+e2e 测试。

---

## 0. 已落地的草稿（已写，未跑测试）

| 文件 | 状态 | 说明 |
|---|---|---|
| `src/drivers/types.ts` | ✅ 已草拟 | 统一 Driver 契约、`AgentRunEvent` 判别联合、`RunStatus`/`RunErrorCode`、`AgentRun`、`StartRunInput`、`SpawnSpec` |
| `src/drivers/process-manager.ts` | ✅ 已草拟 | H01 子进程生命周期：spawn / 按行读 stdout / stderr 尾部 / 超时 / SIGTERM→SIGKILL / PID / 退出码 |

> 这两个文件可保留作为方案的一部分；若评审后想改设计，直接在其上改或我删除重来。

---

## 0.1 已拍板的决策（评审确认）

| 议题 | 决定 | 影响 |
|---|---|---|
| 非 git 目录建项目 | **允许创建 + 返回"可一键 git init"提示标记**给前端 | `POST /api/projects` 不阻断；响应含 `suggestGitInit:true`；新增 `POST /api/projects/:id/git-init` 备用端点 |
| e2e 验收方式 | **默认跑真 Claude**（+ 保留假 CLI 确定性测试） | 真 claude e2e 默认执行，仅 `skipIf(!claudeAvailable)` 守卫；断言"可启动+可监控"（拿到 pid、≥1 个解析事件、到达终态、失败则有 errorCode），**对认证结果鲁棒、不 flaky** |
| 现有 mission 前/后端拆分 | **第一阶段不动** | `taskPlan()`/`agentArea()` 原样保留，属 B02/B03 第三阶段范围 |

## 1. 核心设计决策（先对齐再写码）

### 1.1 把规格的 `AgentDriver` 拆成两层（关键取舍）
规格给的接口是 `detect/start/resume/interrupt/stop/stream`。直接让每个 Driver 内部持有进程状态会**难以单测**（必须真的拉起 claude/codex、要网络要花钱）。方案改为：

- **`DriverSpec`（纯函数适配器，每个 CLI 一个）**：`detect()` + `buildStart()` + `buildResume()` + `parseLine()`。不 spawn、不持状态 → 命令构造和输出解析都能脱离真实 CLI 单测。
- **`RunManager`（生命周期编排，唯一一份）**：用 `DriverSpec` + `ProcessManager` 实现 `start/resume/interrupt/stop/list`，把统一事件落库并经 SSE 回流面板。

> "两个 CLI 均可由 Orbit 启动和监控" 的逻辑集中在 RunManager；Claude/Codex 的差异收敛进各自 DriverSpec。**可测性是这个拆分的主要理由。**

### 1.2 登录检测只跑官方命令，不读凭证（遵守约束 + 已被安全分类器确认）
- `claude`：无稳定零成本的登录诊断命令 → 只确认二进制可用，`loggedIn` 返回 **`null`（未知）** + 指引"跑一次 `claude` 登录"。**不臆测、不扫钥匙串/凭证文件。**
- `codex`：可用时跑 `codex login status`，按输出判 `true/false`；旧版/拿不到 → `null`。

### 1.3 codex 本机未安装 → 检测如实报缺失，代码就绪
CodexDriver 命令构造 + 解析照 `codex exec --json` 写齐并单测（用样例行），但 `detect()` 返回 `available:false`；真实拉起 codex 的 e2e 用 `describe.skipIf(!codexAvailable)` 守卫，**绝不假装成功**。

### 1.4 认证复用：保留 workers.ts 实测经验
ClaudeDriver 沿用现有 `workers.ts:104` 注释里的结论：**剥离会话级刷新标记（`CLAUDE_CODE_SDK_HAS_OAUTH_REFRESH` 等）、保留继承的 token**；支持 `ORBIT_WORKER_ANTHROPIC_API_KEY(+_BASE_URL)` 覆盖。不传模型 API Key、不保存账号 token。

### 1.5 向后兼容
- `/api/workers` 仍返回数组，字段**只增不减**（加 `driver/sessionId/errorCode/branch/worktreePath`）。
- `WorkerRun` 旧 4 态 `starting/running/done/failed` 保留为子集；新增 `waiting_for_input/stopped` 仅追加。
- mission 启动→自动拉起 worker 的现有行为不变，只是底层换成 RunManager。

---

## 2. 文件清单

### 新增
| 文件 | 职责 | 关键导出（设计层，非实现） |
|---|---|---|
| `src/drivers/types.ts` ✅ | 契约与统一事件 | `DriverSpec` `AgentDriver?` `AgentRunEvent` `AgentRun` `StartRunInput` `SpawnSpec` `RunStatus` `RunErrorCode` `AgentEnvironment` |
| `src/drivers/process-manager.ts` ✅ | H01 进程生命周期 | `ProcessManager.start/stop/kill/isRunning/pid/stopAll` `ExitInfo` |
| `src/drivers/detect.ts` | A01/A02 检测 | `detectEnvironment()` `detectClaude/Codex/Git/Node()` `runCapture()` |
| `src/drivers/claude-driver.ts` | C01 Claude 适配器 | `claudeDriver: DriverSpec`（`buildStart`/`buildResume`/`parseLine`）+ 导出纯 `parseClaudeLine()` 供单测 |
| `src/drivers/codex-driver.ts` | C02 Codex 适配器 | `codexDriver: DriverSpec` + 纯 `parseCodexLine()` |
| `src/drivers/registry.ts` | 按 harness 选 Driver | `getDriver(harness): DriverSpec \| null` |
| `src/core/projects.ts` | A04 Project 领域模块 | `Projects.create/list/get/update`，含 `inspectProject(path)`（探测 git/分支） |
| `src/hub/run-manager.ts` | C04/C06/C07 运行编排 | `RunManager.start/resume/stop/list/get/stopAll` |
| `tests/drivers.test.ts` | 单元+e2e | 见 §5 |
| `tests/projects.test.ts` | 单元+集成 | 见 §5 |

### 修改
| 文件 | 改动 |
|---|---|
| `src/core/types.ts` | `+Project` `+`（`AgentRun` 从 drivers 复用）`+` mission 增 `projectId?`，新增事件类型 `project_created/updated`、`agent_run_updated` |
| `src/core/store.ts` | 建 `projects`/`agent_runs` 表 + CRUD + `migrate()` 加列；mission 加 `project_id` |
| `src/core/core.ts` | wire `Projects`；`snapshot()` 增 `projects`/`agentRuns` |
| `src/hub/workers.ts` | 改为对 `RunManager` 的薄壳（保留 `Workers`/`WorkerRun` 导出与 `spawn/list/stopAll`，新增 `stop/resume`） |
| `src/hub/routes.ts` | `+GET /api/environment`、`+GET/POST /api/projects`、`+GET /api/projects/:id`、`+POST /api/projects/:id`、`+POST /api/agent-runs/:id/stop`；mission launch 经 RunManager |
| `src/hub/server.ts` | 构造 `RunManager`，注入 routes |
| `dashboard/src/types.ts` | `Worker` 增可选字段 + `WorkerStatus` 并入 `stopped/waiting_for_input`（一处，向后兼容） |

---

## 3. 数据库迁移（加表/加列式，幂等，旧 `.orbit/hub.sqlite` 平滑升级）

```sql
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, root_path TEXT NOT NULL,
  repository_url TEXT, target_branch TEXT,
  is_git_repo INTEGER NOT NULL DEFAULT 0,
  commands TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY, mission_id TEXT, task_id TEXT, project_id TEXT, agent_id TEXT,
  driver TEXT NOT NULL, harness TEXT NOT NULL, session_id TEXT, pid INTEGER,
  worktree_path TEXT, branch TEXT, status TEXT NOT NULL, error_code TEXT,
  cost_usd REAL NOT NULL DEFAULT 0, last_activity TEXT NOT NULL DEFAULT '',
  error TEXT NOT NULL DEFAULT '', task_title TEXT NOT NULL DEFAULT '',
  project_path TEXT NOT NULL DEFAULT '',
  started_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);

-- 旧库加列（包 try/catch，已存在则忽略，与现有 migrate() 一致）
ALTER TABLE missions ADD COLUMN project_id TEXT;
```
`commands` 存 JSON：`{ install?, build?, lint?, test? }`（A05 字段先建好，Phase 1 不强制用）。

---

## 4. REST 接口（第一阶段新增）

| 方法 路径 | 作用 | 响应（envelope 风格） |
|---|---|---|
| `GET /api/environment` | A01/A02 聚合检测 | `{ node, git, agents:[claude,codex], ok }` |
| `GET /api/projects` | 列项目 | `{ projects }` |
| `POST /api/projects` | 建项目（校验路径存在、探测 git/分支） | `{ project }` 或 400 `path_not_found` |
| `GET /api/projects/:id` | 取项目 | `{ project }` / 404 |
| `POST /api/projects/:id` | 改 targetBranch/commands/name | `{ project }` / 404 |
| `GET /api/agent-runs` | 列运行（= `/api/workers` 新别名） | `{ runs }` |
| `POST /api/agent-runs/:id/stop` | C07 停止运行 | `{ run }` / 404 |

---

## 5. 测试方案（新增模块补单元+e2e）

### `tests/drivers.test.ts`
**单元（纯函数，不 spawn 真 CLI）**
1. `parseClaudeLine`：`system/init` 行 → `{kind:"session"}`；`assistant` 工具/文本行 → `tool`/`activity`；`result` 行 → `cost` + 终态；`is_error`/401 文本 → `{kind:"error",code:"auth"}`。
2. `parseCodexLine`：`codex exec --json` 的会话/消息/完成样例行 → 对应统一事件。
3. `buildStart`/`buildResume`：断言生成的 `command/args/env`（claude 含 `-p --output-format stream-json --mcp-config`、剥离了会话刷新标记；codex 含 `exec --json`、resume 含 `exec resume <sid>`）。
4. `detectCodex()`：codex 未安装 → `available:false` + 安装指引（本机可真实跑，会真的返回 false）。
5. `detectClaude()`：claude 已安装 → `available:true`、`version` 非空、`loggedIn:null`。

**端到端（真实进程，但用便宜的 `node -e` 当假 CLI）**
6. ProcessManager e2e：spawn `node -e "console.log(JSON.stringify(...));"` 打印两行假 stream-json → 断言按行回调、PID 非空、退出码 0、`onExit` 触发。
7. ProcessManager 超时/停止：spawn 一个 `setInterval` 永不退出的 node 进程 → `stop()` 后 `onExit.stopped=true`；`timeoutMs` 到点 → `timedOut=true`。
8. RunManager e2e：用一个"假 DriverSpec"（buildStart 指向 `node -e` 吐统一可解析的行）跑完整 start→解析→落库→`status:done`，断言 `agent_runs` 行被写入、`sessionId` 被捕获、SSE `agent_run_updated` 事件发出。
9. （opt-in）真 Claude e2e：`describe.skipIf(!claudeAvailable)` —— 默认跳过，避免网络/计费。

### `tests/projects.test.ts`
1. `POST /api/projects` 路径不存在 → 400 `path_not_found`。
2. `POST /api/projects` 指向一个临时 `git init` 目录 → `isGitRepo:true`、`targetBranch` 自动识别当前分支。
3. 指向临时非 git 目录 → `isGitRepo:false`，仍可创建（第一阶段不阻断）。
4. `GET/POST /api/projects/:id` 改 `targetBranch`/`commands` 往返。
5. `GET /api/environment` 200 且含 `agents`、`git`、`node`、`ok` 字段。

---

## 6. 明确不做（留给后续阶段）
- D01 worktree **真实执行**、集成分支、合并/冲突/回滚（Phase 2/4）
- Coordinator / 状态机 / 阶段同步注入（Phase 3）
- 测试编排、集成验证、最终 Diff、人工审批（Phase 4）
- OpenAPI/JSON Schema/类型生成/破坏性变更（Phase 5）
- Runner / 设备配对 / 路径映射（Phase 6）

> 第一阶段交付后，"选项目→检测两端→拉起 Claude/Codex→实时监控→落库→可停止"这条主链路即可跑通；worktree 仍只给计划命令（保持现状），由 Phase 2 接管真实执行。
