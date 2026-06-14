import { contextBridge, ipcRenderer } from 'electron'

const api = {
  hub: {
    getStatus: () => ipcRenderer.invoke('hub:status'),
    routePreview: (text: string) => ipcRenderer.invoke('hub:routePreview', text),
    dispatch: (text: string, mode?: string, targetAgent?: string, opts?: { thinking?: any }) =>
      ipcRenderer.invoke('hub:dispatch', { text, mode: mode || 'auto', targetAgent, thinking: opts?.thinking }),
    cancel: (taskId: string) => ipcRenderer.invoke('hub:cancel', taskId),
    onStatus: (callback: (data: any) => void) => {
      const handler = (_event: any, data: any) => callback(data)
      ipcRenderer.on('hub:status-update', handler)
      return () => ipcRenderer.removeListener('hub:status-update', handler)
    },
    onStream: (callback: (data: any) => void) => {
      const handler = (_event: any, data: any) => callback(data)
      ipcRenderer.on('dispatch:stream', handler)
      return () => ipcRenderer.removeListener('dispatch:stream', handler)
    }
  },
  proxy: {
    info: () => ipcRenderer.invoke('proxy:info')
  },
  agents: {
    locate: () => ipcRenderer.invoke('agents:locate')
  },
  win: {
    minimize: () => ipcRenderer.invoke('win:minimize'),
    maximizeToggle: () => ipcRenderer.invoke('win:maximizeToggle'),
    isMaximized: () => ipcRenderer.invoke('win:isMaximized'),
    close: () => ipcRenderer.invoke('win:close'),
    onMaximized: (callback: (maximized: boolean) => void) => {
      const handler = (_event: any, v: boolean) => callback(v)
      ipcRenderer.on('win:maximized', handler)
      return () => ipcRenderer.removeListener('win:maximized', handler)
    }
  },
  providers: {
    get: () => ipcRenderer.invoke('providers:get'),
    upsert: (p: any) => ipcRenderer.invoke('providers:upsert', p),
    delete: (id: string) => ipcRenderer.invoke('providers:delete', id),
    setEnabled: (id: string, enabled: boolean) => ipcRenderer.invoke('providers:setEnabled', id, enabled),
    setKey: (id: string, key: string) => ipcRenderer.invoke('providers:setKey', id, key),
    health: (id: string) => ipcRenderer.invoke('providers:health', id),
    healthAll: () => ipcRenderer.invoke('providers:healthAll'),
    fetchModels: (id: string) => ipcRenderer.invoke('providers:fetchModels', id)
  },
  takeover: {
    status: () => ipcRenderer.invoke('takeover:status'),
    apply: (app: string, modelRef: string) => ipcRenderer.invoke('takeover:apply', app, modelRef),
    restore: (app: string) => ipcRenderer.invoke('takeover:restore', app)
  },
  routing: {
    setBinding: (b: any) => ipcRenderer.invoke('routing:setBinding', b),
    removeBinding: (agentId: string) => ipcRenderer.invoke('routing:removeBinding', agentId),
    setFallback: (chain: string[]) => ipcRenderer.invoke('routing:setFallback', chain),
    setStrategy: (s: string) => ipcRenderer.invoke('routing:setStrategy', s),
    setBindingThinking: (agentId: string, t: any) => ipcRenderer.invoke('routing:setBindingThinking', agentId, t),
    setProviderThinking: (id: string, t: any) => ipcRenderer.invoke('routing:setProviderThinking', id, t),
    activeBinding: (agentId: string) => ipcRenderer.invoke('routing:activeBinding', agentId)
  },
  onChatResponse: (callback: (data: any) => void) => {
    const handler = (_event: any, data: any) => callback(data)
    ipcRenderer.on('chat:response', handler)
    return () => ipcRenderer.removeListener('chat:response', handler)
  },
  store: {
    get: (key: string) => ipcRenderer.invoke('store:get', key),
    set: (key: string, value: any) => ipcRenderer.invoke('store:set', key, value)
  },
  app: {
    openExternal: (url: string) => ipcRenderer.invoke('app:openExternal', url),
    onDeepLink: (callback: (link: { action: string; params: Record<string, string> }) => void) => {
      const handler = (_event: any, link: any) => callback(link)
      ipcRenderer.on('app:deep-link', handler)
      return () => ipcRenderer.removeListener('app:deep-link', handler)
    }
  },
  platform: process.platform
}

contextBridge.exposeInMainWorld('electronAPI', api)
