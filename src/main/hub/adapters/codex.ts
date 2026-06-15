import { StdioAgentAdapter } from './stdio-adapter'
import { locateCodexBinary } from '../agent-locator'

/**
 * Codex（桌面版/CLI）直连适配器 — oneshot
 *
 * `codex exec --sandbox workspace-write --skip-git-repo-check -`
 *   - --sandbox workspace-write：允许在当前工作区（agent 派发时按 WorkspaceManager 注入的 cwd）写入/修改文件，
 *     不允许动 git 仓库外；agent 真正能"做"（读、写、跑命令）的最低权限档。
 *     若用户改 args 为 `danger-full-access` 则完全放开（不推荐）。
 *   - --skip-git-repo-check：避免非 git 目录直接拒绝（agent 在任意项目目录都能工作）。
 *   - `-` 显式从 stdin 读 prompt（规避引号/换行转义）。
 * 登录态/默认模型继承 ~/.codex/config.toml（或桌面版配置）。
 */
export class CodexAdapter extends StdioAgentAdapter {
  constructor() {
    super('codex', 'Codex CLI', locateCodexBinary() || 'codex', ['exec', '--sandbox', 'workspace-write', '--skip-git-repo-check', '-'])
  }
}
