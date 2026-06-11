import { AgentInfo } from './registry'

interface RouteRule {
  patterns: string[]
  targetId: string
  priority: number
}

export class KeywordRouter {
  private rules: RouteRule[] = []

  constructor() {
    this.initDefaultRules()
  }

  private initDefaultRules(): void {
    this.addRule({
      patterns: ['写代码', 'debug', '修复', '重构', '实现', '函数', 'api', 'bug', 'coding', 'implement', 'fix'],
      targetId: 'codex',
      priority: 10
    })
    this.addRule({
      patterns: ['分析', '总结', '解释', '文档', '写作', '翻译', '报告', 'analyze', 'summary', 'explain', 'document'],
      targetId: 'claude',
      priority: 10
    })
    this.addRule({
      patterns: ['自动化', '部署', '运行', '脚本', '任务', '流程', 'pipeline', 'deploy', 'automation', 'script'],
      targetId: 'openclaw',
      priority: 10
    })
    this.addRule({
      patterns: ['工具', '调用', '系统', '操作', '命令', '配置', '检测', 'tool', 'system', 'command', 'config'],
      targetId: 'hermes',
      priority: 10
    })
  }

  addRule(rule: RouteRule): void {
    this.rules.push(rule)
    this.rules.sort((a, b) => b.priority - a.priority)
  }

  route(text: string, availableAgents: AgentInfo[]): string | null {
    const lowerText = text.toLowerCase()
    const availableIds = new Set(availableAgents.map(a => a.id))

    for (const rule of this.rules) {
      if (!availableIds.has(rule.targetId)) continue
      for (const pattern of rule.patterns) {
        if (lowerText.includes(pattern.toLowerCase())) {
          return rule.targetId
        }
      }
    }

    // Default to first available agent
    return availableAgents[0]?.id || null
  }

  routeWithMention(text: string): string | null {
    const mentionMatch = text.match(/@(\w+)/)
    return mentionMatch ? mentionMatch[1].toLowerCase() : null
  }
}
