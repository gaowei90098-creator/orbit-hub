import { StdioAgentAdapter } from './stdio-adapter'
import { locateCodexBinary } from '../agent-locator'

/**
 * Codex（桌面版/CLI）直连适配器 — oneshot
 *
 * codex exec --skip-git-repo-check -
 * prompt 经 stdin 传入（"-" 显式声明从 stdin 读，规避引号/换行转义），
 * 沙箱与审批策略继承用户 ~/.codex/config.toml（登录态/模型同理）。
 */
export class CodexAdapter extends StdioAgentAdapter {
  constructor() {
    super('codex', 'Codex CLI', locateCodexBinary() || 'codex', ['exec', '--skip-git-repo-check', '-'])
  }
}
