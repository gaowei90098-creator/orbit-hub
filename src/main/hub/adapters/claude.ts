import { StdioAgentAdapter } from './stdio-adapter'
import { locateClaudeBinary } from '../agent-locator'

/**
 * Claude Code CLI 直连适配器 — oneshot
 *
 * claude --print（prompt 经 stdin 传入）
 * 登录态/模型设置继承用户本机的 Claude Code 配置。
 */
export class ClaudeAdapter extends StdioAgentAdapter {
  constructor() {
    super('claude', 'Claude Code', locateClaudeBinary() || 'claude', ['--print'])
  }
}
