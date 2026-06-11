import { create } from 'zustand'

export interface Workspace {
  id: string
  name: string
  description: string
  createdAt: Date
  agentIds: string[]
  stats: { messageCount: number; taskCount: number; lastActive: Date | null }
}

interface WorkspaceStore {
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  createWorkspace: (name: string, desc?: string) => Workspace
  deleteWorkspace: (id: string) => void
  renameWorkspace: (id: string, name: string) => void
  setActiveWorkspace: (id: string) => void
  incrementMessageCount: (id: string) => void
  incrementTaskCount: (id: string) => void
}

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => {
  let initial: Workspace[] = []
  try {
    const raw = localStorage.getItem('agenthub-workspaces')
    if (raw) { initial = JSON.parse(raw).map((w: any) => ({ ...w, createdAt: new Date(w.createdAt), stats: { ...w.stats, lastActive: w.stats?.lastActive ? new Date(w.stats.lastActive) : null } })) }
  } catch (e) {}
  if (initial.length === 0) {
    initial = [{ id: 'default', name: '默认工作区', description: '主工作区', createdAt: new Date(), agentIds: ['codex', 'claude'], stats: { messageCount: 0, taskCount: 0, lastActive: null } }]
  }
  return {
    workspaces: initial,
    activeWorkspaceId: 'default',
    createWorkspace: (name, desc) => {
      const ws: Workspace = { id: 'ws-' + Date.now(), name, description: desc || '', createdAt: new Date(), agentIds: ['claude', 'codex'], stats: { messageCount: 0, taskCount: 0, lastActive: null } }
      set((s) => ({ workspaces: [...s.workspaces, ws], activeWorkspaceId: ws.id }))
      try { localStorage.setItem('agenthub-workspaces', JSON.stringify(get().workspaces)) } catch (e) {}
      return ws
    },
    deleteWorkspace: (id) => {
      set((s) => { const ws = s.workspaces.filter(w => w.id !== id); return { workspaces: ws, activeWorkspaceId: s.activeWorkspaceId === id ? (ws[0]?.id || null) : s.activeWorkspaceId } })
      try { localStorage.setItem('agenthub-workspaces', JSON.stringify(get().workspaces)) } catch (e) {}
    },
    renameWorkspace: (id, name) => { set((s) => ({ workspaces: s.workspaces.map(w => w.id === id ? { ...w, name } : w) })) },
    setActiveWorkspace: (id) => set({ activeWorkspaceId: id }),
    incrementMessageCount: (id) => {
      set((s) => ({ workspaces: s.workspaces.map(w => w.id === id ? { ...w, stats: { ...w.stats, messageCount: w.stats.messageCount + 1, lastActive: new Date() } } : w) }))
      try { localStorage.setItem('agenthub-workspaces', JSON.stringify(get().workspaces)) } catch (e) {}
    },
    incrementTaskCount: (id) => {
      set((s) => ({ workspaces: s.workspaces.map(w => w.id === id ? { ...w, stats: { ...w.stats, taskCount: w.stats.taskCount + 1, lastActive: new Date() } } : w) }))
      try { localStorage.setItem('agenthub-workspaces', JSON.stringify(get().workspaces)) } catch (e) {}
    }
  }
})
