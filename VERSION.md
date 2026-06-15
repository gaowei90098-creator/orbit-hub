# AgentHub 版本文件（共享）

> 本文件是多个 Claude / Codex 并行协作时的共享版本空间。任何 Agent 计划发版、升版、打 tag、提交发布说明前，先读取并更新本文件；不要各自维护私有版本口径。

## 当前版本

- 当前代码版本：`0.3.0`
- 当前发布状态：`0.3.0` 已完成本地验证并推送到 GitHub（全员 Agent 能力对齐）
- 版本来源：以 `package.json` 的 `version` 与 `build.buildVersion` 为准；两者必须同步

## 升版规则

- 补丁/小修复：按补丁位递增，例如 `0.2.0` -> `0.2.1`
- 同一功能线的较小增强：继续按补丁位递增，例如 `0.2.1` -> `0.2.2`
- 较大功能版本：按 minor 位递增，例如 `0.3.0` -> `0.4.0`
- 不允许只改 `package.json.version` 而不改 `build.buildVersion`
- 不允许未完成验证就登记为已发布版本

## 发版前检查

发版 Agent 必须完成：

- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run build`

若某项因本机环境失败，必须在版本记录中写明失败命令、失败原因和是否阻塞发布。

## 并行协作约束

- 当前项目有两个 Claude 和至少两个 Codex 并行工作。
- 改动前先读 `COLLAB.md` 和本文件。
- 只暂存/提交自己改的具体文件，禁止 `git add -A`。
- 发现他人未提交改动时，不回滚、不格式化、不重排，除非用户明确要求。
- 发版前确认工作树中是否混有他人改动；无法区分时停止并让用户确认。

## 版本记录

### 0.2.0

- 状态：当前开发基线。
- 备注：Agent 能力、工作区流程、agentic 活动展示仍在并行完善中。

### 0.2.1

- 状态：已完成本地验证，准备推送到 GitHub。
- 摘要：修复 Windows 任务栏/托盘图标透明占位问题，使用用户确认的新 AgentHub 图标；补充共享版本文件和发版协作规则。
- 验证：
  - `npm run typecheck`
  - `npm run lint`
  - `npm test`
  - `npm run build`

### 0.2.3

- 状态：已完成本地验证，推送到 GitHub（tag `v0.2.3`）。
- 摘要：统一 Agent 能力 + 跨 Agent 技能(Skill)系统 —— 技能子系统（按 agent 单独/集体安装、派发时注入系统提示）、AgentHub 原生 agentic 工具回环（让 HTTP 模型也能在工作区读写文件/跑命令，对齐 codex/claude）、能力矩阵 UI（设置 → 技能）、跨 provider（OpenAI/Anthropic/Gemini）工具调用。
- 主要文件：`src/main/skills/*`、`src/main/agentic/*`、`src/renderer/screens/Skills.tsx`，以及 dispatcher/index/preload/Settings/vite-env/client/agent-runtime 的接线（基于 `b864497` 干净叠加，未混入他人未提交改动）。
- 验证（全绿）：
  - `npm run typecheck`
  - `npm run lint`
  - `npm test`（117 passed）
  - `npm run build`

### 0.2.4

- 状态：已完成本地验证，推送到 GitHub（tag `v0.2.4`）。
- 摘要：修复开发模式（`npm run dev`）渲染黑屏 —— `src/renderer/index.html` 的 CSP `script-src 'self'` 会拦截 `@vitejs/plugin-react` 在 dev 注入的 inline Fast Refresh 预置脚本，导致 React 无法挂载、窗口仅剩深色背景。新增仅开发（`apply: 'serve'`）生效的 `dev-csp-relax` 渲染插件，在 dev 放行 `'unsafe-inline' 'unsafe-eval'`；生产构建（loadFile）不注入该脚本，CSP 保持严格，安全性不受影响。
- 主要文件：`electron.vite.config.ts`（renderer 新增 `dev-csp-relax` 插件）。
- 验证：
  - `npm run typecheck`（exit 0）
  - `npx eslint src`（exit 0；`eslint .` 报的错误全部位于未跟踪的本机目录 `.cc-switch-src/`、`output/playwright/`，属另一项目，不在 AgentHub 源码内）
  - `npx vitest run --exclude '**/.cc-switch-src/**' --exclude '**/output/**'`（108 passed，exit 0；未限定时的 53 个失败套件均为 `.cc-switch-src/`，其依赖未在本仓库安装）
  - `npm run build`（exit 0）

### 0.3.0

- 状态：已完成本地验证，推送到 GitHub（tag `v0.3.0`）。
- 摘要：**全员 Agent 能力对齐**。让所有接入 agent（openclaw/hermes/marvis/minimax-code）在能力上对齐 codex/claude，并补齐审计发现的全部缺口：
  - HTTP 原生 agentic 回环**默认对所有 agent 开启**（`agentic/config.ts` 升 v2：`mode='all'` + 显式停用名单 + v1 迁移）——HTTP 模型默认可在工作区读写文件/执行命令；未绑定工作区时只读。
  - 工作区 `bootstrapFiles` 真正作为项目级上下文注入（`hub/workspace.ts#bootstrapContext`，路径沙箱 + 字符上限），全 agent、三派发路径通用。
  - 多行提示词保真（`stdio-adapter.ts`：仅 cmd.exe 路径压平换行，直接 spawn 保留）。
  - thinking 对齐到 stdio 路径（`dispatcher.ts` 以 prompt 指令注入）。
  - 技能可在 UI 编辑（`Skills.tsx` 接 `skills.update`）；能力矩阵新增「默认全员 Agentic」总开关（`agentic:getMode/setMode`）。
  - 文档/注释纠偏到实现现状（`docs/AGENTIC.md` §0、`executor.ts` 注释）。
- 主要文件：`agentic/config.ts`、`agentic/capabilities.ts`、`agentic/executor.ts`、`hub/workspace.ts`、`hub/dispatcher.ts`、`hub/adapters/stdio-adapter.ts`、`index.ts`、`preload/index.ts`、`renderer/vite-env.d.ts`、`renderer/screens/Skills.tsx`、`docs/AGENTIC.md`、`docs/DESIGN-0.3.0-capability-parity.md`，以及 5 个新测试。设计方案见 `docs/DESIGN-0.3.0-capability-parity.md`。
- 未覆盖（列入后续）：写/执行的逐次审批；openclaw/hermes/minimax-code 的 CLI 活动解析器（需输出样本）；proxy Anthropic 入站工具透传。
- 验证（全绿）：
  - `npm run typecheck`（exit 0）
  - `npx eslint src`（exit 0；`eslint .` 的报错全在未跟踪的本机目录 `.cc-switch-src/`、`output/playwright/`，属另一项目）
  - `npx vitest run --exclude '**/.cc-switch-src/**' --exclude '**/output/**'`（126 passed / 25 files，exit 0）
  - `npm run build`（exit 0）

### 下一个候选版本

- 默认候选：`0.3.1`（小修复/小增强）；下一个较大功能版本 `0.4.0`。
- 适用范围：后续 agentic / 工作区 / 技能流程修复、验证和小增强。
- 登记要求：完成后补充改动摘要、验证命令、提交哈希或发布 tag。
