/// <reference types="vite/client" />

interface ElectronAPI {
  hub: {
    getStatus: () => Promise<any>
    dispatch: (text: string, mode?: string, targetAgent?: string, opts?: { thinking?: any }) => Promise<any>
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
  onChatResponse: (callback: (data: any) => void) => () => void
  store: {
    get: (key: string) => Promise<any>
    set: (key: string, value: any) => Promise<boolean>
  }
  platform: string
}

interface Window {
  electronAPI: ElectronAPI
  app: {
    onDeepLink: (callback: (link: { action: string; params: Record<string, string> }) => void) => () => void
  }
  platform: string
}
