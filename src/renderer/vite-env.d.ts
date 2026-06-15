/// <reference types="vite/client" />

interface ElectronAPI {
  hub: {
    getStatus: () => Promise<any>
    dispatch: (text: string, mode?: string, targetAgent?: string, opts?: { thinking?: any; workspaceId?: string | null }) => Promise<any>
    cancel: (taskId: string) => Promise<boolean>
    onStatus: (callback: (data: any) => void) => () => void
    onStream: (callback: (data: any) => void) => () => void
  }
  providers: {
    get: () => Promise<any>
    upsert: (p: any) => Promise<any>
    delete: (id: string) => Promise<boolean>
    setEnabled: (id: string, enabled: boolean) => Promise<any>
    setKey: (id: string, key: string) => Promise<any>
    health: (id: string) => Promise<any>
    healthAll: () => Promise<any>
    fetchModels: (id: string) => Promise<{ ok: boolean; count?: number; error?: string; config?: any }>
  }
  takeover: {
    status: () => Promise<Record<string, {
      supported: boolean; configPath: string; configExists: boolean
      takenOver: boolean; model: string | null; current: string | null
    }>>
    apply: (app: string, modelRef: string) => Promise<any>
    restore: (app: string) => Promise<any>
  }
  routing: {
    setBinding: (b: any) => Promise<any>
    removeBinding: (agentId: string) => Promise<any>
    setFallback: (chain: string[]) => Promise<any>
    setStrategy: (s: string) => Promise<any>
    setBindingThinking: (agentId: string, t: any) => Promise<any>
    setProviderThinking: (id: string, t: any) => Promise<any>
    activeBinding: (agentId: string) => Promise<any>
  }
  proxy: {
    info: () => Promise<{ url: string; openaiUrl?: string; anthropicUrl?: string; running: boolean }>
  }
  agents: {
    locate: () => Promise<Record<string, Array<{ source: 'desktop' | 'terminal'; label: string; path: string }>>>
  }
  win: {
    minimize: () => Promise<void>
    maximizeToggle: () => Promise<boolean>
    isMaximized: () => Promise<boolean>
    close: () => Promise<void>
    onMaximized: (callback: (maximized: boolean) => void) => () => void
  }
  onChatResponse: (callback: (data: any) => void) => () => void
  store: {
    get: (key: string) => Promise<any>
    set: (key: string, value: any) => Promise<boolean>
  }
  memory: {
    catalog: () => Promise<any>
    list: (category?: 'conversation' | 'task' | 'skill' | 'file' | 'system') => Promise<any[]>
    addEntry: (entry: any) => Promise<any>
    loadState: () => Promise<{ messages?: any[]; tasks?: any[] }>
    saveState: (state: { messages: any[]; tasks: any[] }) => Promise<any>
  }
  app: {
    openExternal: (url: string) => Promise<void>
    pickFolder: () => Promise<string | null>
    onDeepLink: (callback: (link: { action: string; params: Record<string, string> }) => void) => () => void
  }
  workspaces: {
    list: () => Promise<Array<{ id: string; name: string; rootPath: string; createdAt: number; updatedAt: number }>>
    create: (input: { name: string; rootPath: string }) => Promise<{ id: string; name: string; rootPath: string }>
    update: (id: string, patch: { name?: string; rootPath?: string; bootstrapFiles?: string[] }) => Promise<any>
    remove: (id: string) => Promise<boolean>
    getActive: () => Promise<string | null>
    setActive: (id: string | null) => Promise<string | null>
  }
  platform: string
}

interface Window {
  electronAPI: ElectronAPI
}
