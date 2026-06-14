# AgentHub 项目交接说明（给接手的 Claude）

> 你将接手继续开发 AgentHub。本文件是冷启动交接：读完即可上手。最后更新 2026-06-14。
> 配套文档：架构见 [DESIGN.md](./DESIGN.md)，源码逐文件索引见 [SOURCE.md](./SOURCE.md)。

---

## 0. 一句话
AgentHub 是 **Electron 33 + React 18 + TS** 的桌面工作台：把多个本地 AI Agent CLI
（Codex / Claude Code / Hermes / OpenClaw / Marvis / MiniMax Code）和 HTTP 大模型供应商
统一到一个玻璃拟态界面，支持 **智能路由 / 广播 / 链式 / 编排** 四种派发模式 + 本地路由代理 + Desktop Agent 接管。

## 1. 位置 / 命令（重要）
- **源码（实际工作目录）**：`C:\Users\Admin\Documents\安装与卸载\agenthub`（git 仓库，分支 `master`）。
  ⚠️ 会话默认 cwd `C:\Users\Admin\AgentHub项目文件1` 是空的——**不是源码**。git 操作一律用 `git -C "<源码路径>"`。
- **GitHub**：`origin` = https://github.com/hycailxy/agenthub（**私有**，默认分支 master）。git 身份 `hycailxy / 2674648836@qq.com`。
- **gh CLI**：`C:\Program Files\GitHub CLI\gh.exe`，已登录 `hycailxy`，token scopes 含 `repo, workflow`。
  推含 `.github/workflows/*` 的提交需 workflow scope；若推送报缺 scope：`gh auth refresh -h github.com -s workflow` 后 `gh auth setup-git`。
- **开发**：`npm run dev`（须在源码目录）。⚠️ 见 §6 端口/单实例坑。
- **校验**：`npm run typecheck`、`npm run lint`、`npm test`（vitest）、`npm run build`。
- **打包**：`npm run build:win` → `dist\AgentHub-Setup-<ver>.exe`。
- **CI**：`.github/workflows/ci.yml`（windows-latest 跑 typecheck+lint+test+build）。

## 2. 当前版本与进度
**版本 0.2.0**（`package.json` version + build.buildVersion 均 0.2.0）。tag `v0.1.0` 为完整功能基线；
**`v0.2.0` 尚未打 tag**（等公测前定稿/联机验证后再发版）。

0.2.0 已完成并提交（master 上，见 `git log`）：
- **修复/加固**：#1 Marvis 卡死候选禁用、#2 stdio-plain 绑定+健康检查鉴权感知、#5 代理 CORS+WS 绑环回鉴权、
  #7 API Key safeStorage 加密、#8 stdio oneshot 完成判定加固、#9 per-agent 元数据统一 manifest（`src/main/hub/agents.ts`）。
- **删死代码/质量门**：#3 删除旧 pre-glass UI 树、#4 test/lint/CI + 文档刷新。
- **计量/成本**：#6 从流解析真实内容+token 用量、A1 token 计量 UI、B1 费用估算 + 预算可按费用、A2 预算上限/告警。
- **路由**：A3 按任务类型加权打分路由（`router.routeScores`）、B2 Chat 路由预览（`hub:routePreview` IPC）。
- **编排模式（旗舰，端到端完成）**：O1 引擎（`src/main/hub/orchestrator.ts` + dispatcher `mode:'orchestrate'`：
  lead 分解→`routeScores` 指派→并行执行→lead 汇总）、O2 UI（`glass/orchestrate-view.tsx` + `orchestrate-reducer.ts`
  + Chat「编排」模式入口 + App onStream 处理 `orchestrate:*` 事件）、O3 校验+有界修复回环（verify agent 判 PASS/FAIL，
  失败自动重试 1 次，UI 显示 ✓/✗ 校验徽标）。
- 工具透传 #10 part1（stop-reason 映射 + 中止/超时/断开故障转移）已完成。
- 首次连接引导（connection-status，Codex 作品）：精确状态摘要 + 首跑引导 + 错误修复 CTA。

**待办（下一步候选，按社区反馈优先级见 §5）**：
- **#10 part2**：Anthropic 入站（Claude Code）工具块转码 + AnthropicWire tool_use/input_json_delta 重编码 +
  Gemini functionCall。**需真实 tool-calling 客户端联机验证**，未在无网环境做。
- **经济模式 / 派发前费用预估**：回应评论区最高频的“token 爆炸”恐慌（A1/A2/B1 已铺好基础）。
- 共享上下文/记忆 + skill；平台（Linux 构建、mac intel）；编排模式的更复杂依赖/串行执行。

## 3. 架构速览（细节见 DESIGN.md / SOURCE.md）
- `src/main/`（主进程）：`index.ts` 入口+IPC、`store.ts`（electron-store + safeStorage 加解密 + `getLocalToken`）、
  `hub/`（registry / dispatcher / router / orchestrator / agents 清单 / agent-connections / adapters/*）、
  `routing/`（proxy 9528 双协议 / takeover 配置接管）、`providers/`（presets / manager / client / types）。
- `src/preload/index.ts`：`window.electronAPI` 安全桥。
- `src/renderer/`（React）：`App.tsx`（根+IPC 监听+派发簿记）、`glass/`（设计系统 i18n/meta/ui/budget/
  connection-status/orchestrate-*）、`screens/`（Home/Chat/Tasks/Settings）。
- **关键不变量**：`adapter.protocol` 决定派发路径；stdio adapter 的 `proc` 字段名与 `mode='oneshot'` 被 dispatcher 轮询依赖勿改名；
  接管必留 `.agenthub-bak` 可还原；渲染层只走 IPC（旧 WebSocket 客户端已删）；API Key 落盘加密，内存明文，
  `unlockSecrets()` 在 app ready 后解密（勿在 ready 前解密）。

## 4. 协作模式（务必遵守）⭐
本项目由**两个 AI 会话并行开发**：**Claude（你）+ 一个 Codex 会话**，**共用同一磁盘上的同一个 git 仓库**（非两份克隆）。
- **职责**：Claude = UI/UX + 搜集评论建议 + 定方向 + 审查；Codex = 后端/主进程编码 + 测试，完成/遇阻向 Claude 汇报请审。
- **看板握手**：仓库根 `COLLAB.md`（已 gitignore，本地实时白板）。**每次操作前**先读它（看占用锁+留言），
  再留言登记你要做的事；改文件/提交/推送前都握手。看板被高频并发写时 Edit 会撞“读后被改”，可用 Bash `>> COLLAB.md` 原子追加。
- **git 卫生**：**只 `git add` 自己改的具体文件，绝不 `git add -A`**（否则会把对方未提交在制品卷进你的提交——已犯过一次）。
  提交信息标注作者区。不碰对方占用中的文件。
- 我（本 Claude）**无法**用会话工具直接联系 Codex（`list_sessions` 看不到它）；唯一异步通道就是 `COLLAB.md` + 用户转达。

## 5. 社区反馈 → 路线图（来自用户抖音 AgentHub 视频评论）
用户抖音号 `2026.11.28（AgentHub）`，主推视频 7.6万播放/130+评论。筛出的开发信号（按价值）：
1. **编排/总-agent 模式**（最高赞：雨若9赞、往家走4赞、大R…）→ **已做（O1/O2/O3）**。
2. **成本控制 / “token 爆炸”恐慌**（多条高频）→ A1/A2/B1 已做；**下一步建议**：派发前费用预估 + 经济模式（简单任务走便宜模型）。
3. 智能模型路由 + 可配置模型梯队（往家走）→ A3 已做，可加用户自定义规则。
4. 共享上下文/记忆 + skill（作者已回“可加 skill”）；防幻觉/校验 harness（O3 已部分回应）。
5. 平台：Linux 版、mac intel、手机版（三端在用户长期路线图）。
6. 最高频非开发诉求：**赶紧发公测 + 给下载入口**。

## 6. 已知坑 / 注意事项
- **CI 与 Node/npm 版本（重要）**：CI 用 **Node 24**（`.github/workflows/ci.yml`），因本仓 `package-lock.json` 由 Node 24/npm 11 生成；
  npm 10（Node 20）会对 lock 里的 `@esbuild/<其它平台>` optional 依赖报 EBADPLATFORM。**改 deps 后务必用 Node 24/npm 11 跑 `npm install` 更新 lock 并提交**，否则 CI 的 `npm ci` 会红。
  本地验证 CI 安装：`npm ci`（须先关掉占用 node_modules 的 electron，否则 EBUSY）。**不要只 `npm install`**——它可能不重算依赖图、lock 仍残缺。
- **electron 二进制下载（国内）**：`rm -rf node_modules` 后重装，electron postinstall 从 GitHub 下 ~190MB 二进制常被墙、静默失败（dist 只剩 ~8MB、无 electron.exe，`npm run dev` 报 `Error: Electron uninstall`）。
  解法：缓存里通常已有 `%LOCALAPPDATA%\electron\Cache\electron-v<ver>-win32-x64.zip`，手动 `Expand-Archive` 到 `node_modules\electron\dist\` 并写 `node_modules\electron\path.txt`=`electron.exe`；或设 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` 再 `npm rebuild electron`。
- **仓库外文件的测试**：`devLauncherScript.test.ts` 读仓库父目录的 `start_agenthub_dev.ps1`，已加 `existsSync` 守卫（CI 无该文件时跳过）。新增依赖仓库外资源的测试要照此守卫。
- **开发版 vs 安装版冲突**：安装版（`...\Programs\AgentHub\agenthub.exe`）占 9527/9528 且有 Electron 单实例锁 + 共用 userData。
  **要跑 `npm run dev` 看新代码，必须先关掉安装版**（`Stop-Process -Name AgentHub -Force`），否则开发版启动后立即退出。
  开发版进程是 `electron.exe`（computer-use 截图需对 `electron.exe` 授权，不是 `agenthub.exe`）。
- **agent 探测噪音**：dev 启动时一堆 `'opencode'/'claude'/'gemini' 不是内部命令` + GBK 乱码 stderr，是 CLI 探测正常输出，非错误。
- **#10 part2 / 费用单价**：工具透传 Anthropic 侧未完（需联机验证）；`glass/meta.ts` 的 `MODEL_PRICES` 是近似单价、会过期，集中可改。
- **行尾**：仓库混 CRLF/LF，提交时 git 提示 `LF will be replaced by CRLF` 是正常的，无害。
- **lint**：`npm run lint` 应 0 error（允许少量 unused-var warning）。提交前过四道门（typecheck/lint/test/build）。

## 7. 立刻可接手的事
1. 想验证编排：关安装版 → `npm run dev` → 会话页选「编排」→ 配好 Provider Key → 发个复杂任务，看分解/子任务/校验/合成。
2. 想推进路线图：做「派发前费用预估 + 经济模式」（命中最高频痛点，基础已具备）。
3. 想发版：补 #10 part2 联机验证 → 打 `v0.2.0` tag → `npm run build:win` 出安装包 → 推 GitHub。
4. **动手前先读 `COLLAB.md` 并留言**（§4）。
