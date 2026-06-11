import { create } from 'zustand'

export interface AgentState {
  id: string
  name: string
  status: 'idle' | 'busy' | 'error' | 'offline'
  capabilities: string[]
  color: string
  providerName?: string
}

interface AgentStore {
  agents: AgentState[]
  setAgents: (agents: AgentState[]) => void
  updateAgentStatus: (id: string, status: AgentState['status']) => void
  getAgent: (id: string) => AgentState | undefined
  getAvailable: () => AgentState[]
}

const AGENT_COLORS: Record<string, string> = {
  codex: '#22c55e',
  claude: '#8b5cf6',
  hermes: '#f59e0b',
  openclaw: '#06b6d4'
}

export const useAgentStore = create<AgentStore>((set, get) => ({
  agents: [
    { id: 'codex', name: 'Codex CLI', status: 'idle', capabilities: ['coding', 'debug', 'refactor', 'api'], color: AGENT_COLORS.codex },
    { id: 'claude', name: 'Claude Code', status: 'idle', capabilities: ['analysis', 'writing', 'translation', 'research'], color: AGENT_COLORS.claude },
    { id: 'hermes', name: 'Hermes', status: 'offline', capabilities: ['tools', 'system', 'automation'], color: AGENT_COLORS.hermes },
    { id: 'openclaw', name: 'OpenClaw', status: 'offline', capabilities: ['automation', 'deploy', 'pipeline', 'script'], color: AGENT_COLORS.openclaw }
  ],
  setAgents: (agents) => set({ agents }),
  updateAgentStatus: (id, status) => set((state) => ({
    agents: state.agents.map(a => a.id === id ? { ...a, status } : a)
  })),
  getAgent: (id) => get().agents.find(a => a.id === id),
  getAvailable: () => get().agents.filter(a => a.status === 'idle' || a.status === 'busy')
}))
