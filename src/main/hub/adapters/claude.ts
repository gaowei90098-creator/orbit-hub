import { StdioAgentAdapter } from './stdio-adapter'
import { locateClaudeBinary } from '../agent-locator'

/**
 * Claude Code CLI 直连适配器 — oneshot
 *
 * `claude --print --permission-mode acceptEdits`
 *   - --print（-p）：非交互单次模式，prompt 经 stdin 传入。
 *   - --permission-mode acceptEdits：自动接受文件编辑、运行命令（Bash）—— agent 真正能动手
 *     （改文件、跑命令）。其它可选项：default（每次确认）/ plan（只读）/ bypassPermissions（全开无确认）。
 * 登录态/模型设置继承用户本机的 Claude Code 配置（~/.claude/settings.json 等）。
 */
export class ClaudeAdapter extends StdioAgentAdapter {
  constructor() {
    super('claude', 'Claude Code', locateClaudeBinary() || 'claude', ['--print', '--permission-mode', 'acceptEdits'])
  }
}
