import { AgentInfo } from './registry'
import { AGENTS } from './agents'

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
    // 路由关键词派生自 agents manifest（单一事实源，自动覆盖全部 agent）
    for (const a of AGENTS) {
      if (a.routeKeywords.length) {
        this.addRule({ patterns: a.routeKeywords, targetId: a.id, priority: 10 })
      }
    }
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
