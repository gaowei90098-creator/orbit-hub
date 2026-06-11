# AgentHub

> 多 Agent 协同桌面工作台 - Multi-Agent Collaboration Desktop Workbench

AgentHub 让多个 AI Agent (Codex CLI / Claude Code / OpenClaw / Hermes ...) 在同一工作台中协同工作,像管理一个团队一样管理你的 Agent。

## 核心特性

- **多 Agent 协同**:在同一会话中调度多个 AI Agent,支持自动分配 / 广播 / 链式三种模式
- **统一 Provider 配置**:OpenAI / Anthropic / Google / DeepSeek / OpenRouter / 自定义 OpenAI 兼容端点
- **思考控制**:为每个 Agent 精细调控推理深度 (off / auto / enabled × 5 级预算)
- **任务看板**:拖拽式 Kanban,支持搜索、优先级筛选、任务编辑器
- **多工作区**:在不同项目间隔离会话和任务
- **本地 Chat Completions 代理**:其他工具可以指向 AgentHub 作为它们的 provider (端口 9528)
- **键盘友好**:完整快捷键支持,命令面板 (Ctrl+K)
- **深色主题**:Hermes 设计语言,玻璃态 / 渐变 / glow / spring 缓动

## 系统要求

- Windows 10 / 11 (x64)
- macOS 11+ (Intel / Apple Silicon)
- Linux (x64) - Ubuntu 20.04+ / Debian 11+ / Fedora 35+
- 至少 4 GB RAM,推荐 8 GB+

## 快速开始

1. 从 Releases 下载对应平台的安装包
2. 运行安装程序
3. 打开 AgentHub,进入 **设置 → Providers** 添加至少一个 API key
4. 在对话框输入消息,使用 @codex / @claude 等指定 Agent,或使用 /broadcast 开启广播模式

## 键盘快捷键

| 快捷键 | 功能 |
|---|---|
| Ctrl + K | 打开命令面板 |
| Ctrl +  | 切换 Agent 侧栏 |
| Ctrl + / | 切换上下文面板 |
| Enter | 发送消息 |
| Shift + Enter | 换行 |
| @ | 提及 Agent |
| / | 运行命令 (/broadcast, /chain, /clear, /thinking) |
| Esc | 关闭弹窗 / 取消编辑 |
| Shift + ? | 打开快捷键帮助 |

## 本地开发

`bash
git clone https://github.com/agenthub/agenthub.git
cd agenthub
npm install
npm run dev
`

## 打包

`bash
npm run build:win   # Windows NSIS 安装程序
npm run build:mac   # macOS DMG (universal)
npm run build:linux # Linux AppImage / deb
`

## 协议

AgentHub 注册了 agenthub: 协议,可以处理:
- agenthub://open?workspace=<id> - 打开指定工作区
- agenthub://chat?agent=<id> - 直接打开与指定 Agent 的对话

## 许可

本项目基于 MIT 许可证开源,详见 LICENSE。
