import { StdioAgentAdapter } from './stdio-adapter'
import { locateHermesBinary } from '../agent-locator'

/**
 * Hermes 本地 CLI 直连适配器 — oneshot
 *
 * 默认无参数、prompt 经 stdin 传入；
 * 若你的 hermes CLI 需要子命令/flag（或要求 prompt 作为参数，用 {prompt} 占位符），
 * 在 设置→路由→StdIO 的"附加参数"里配置。
 */
export class HermesAdapter extends StdioAgentAdapter {
  constructor() {
    super('hermes', 'Hermes', locateHermesBinary() || 'hermes', [])
  }
}
