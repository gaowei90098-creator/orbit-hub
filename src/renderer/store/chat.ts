import { create } from "zustand"

export interface ThinkingSummary {
  enabled: boolean
  level?: string
  budget?: number
  preview?: string
  durationMs?: number
}

export interface ChatMessage {
  id: string
  type: "user" | "agent" | "system" | "error"
  content: string
  agentId?: string
  agentName?: string
  providerId?: string
  modelId?: string
  timestamp: Date
  status?: "sending" | "streaming" | "complete" | "error"
  taskId?: string
  thinking?: ThinkingSummary
  thinkingContent?: string
  streamingContent?: string
  streamingThinking?: string
}

export type DispatchMode = "auto" | "broadcast" | "chain"

interface ChatStore {
  messages: ChatMessage[]
  sessions: Array<{ id: string; title: string; messageCount: number; lastActive: Date }>
  activeSession: string | null
  dispatchMode: DispatchMode
  isProcessing: boolean
  currentTaskId: string | null
  streamingAgentIds: string[]
  addMessage: (msg: Omit<ChatMessage, "id" | "timestamp">) => string
  updateMessage: (id: string, updates: Partial<ChatMessage>) => void
  appendStreamDelta: (id: string, channel: "content" | "thinking", delta: string) => void
  finalizeStream: (id: string, content: string, thinking?: ThinkingSummary) => void
  failStream: (id: string, error: string) => void
  deleteMessage: (id: string) => void
  resendMessage: (id: string) => string | null
  setDispatchMode: (mode: DispatchMode) => void
  setIsProcessing: (processing: boolean) => void
  setCurrentTask: (taskId: string | null) => void
  setStreamingAgents: (ids: string[]) => void
  clearMessages: () => void
  createSession: () => string
  switchSession: (id: string) => void
  renameSession: (id: string, title: string) => void
  deleteSession: (id: string) => void
  saveSessions: () => void
  loadSessions: () => void
}

const persistSessions = (sessions: Array<{ id: string; title: string; messageCount: number; lastActive: Date }>, active: string | null) => {
  try {
    localStorage.setItem("agenthub-sessions", JSON.stringify({
      sessions: sessions.map(s => ({ id: s.id, title: s.title, messageCount: s.messageCount, lastActive: s.lastActive })),
      activeSession: active
    }))
  } catch (e) {}
}

export const useChatStore = create<ChatStore>((set, get) => ({
  messages: [],
  sessions: [{ id: "default", title: "New chat", messageCount: 0, lastActive: new Date() }],
  activeSession: "default",
  dispatchMode: "auto",
  isProcessing: false,
  currentTaskId: null,
  streamingAgentIds: [],

  addMessage: (msg) => {
    const message: ChatMessage = {
      ...msg,
      id: "msg-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6),
      timestamp: new Date()
    }
    set((state) => {
      const nextSessions = state.sessions.map(s => s.id === state.activeSession
        ? { ...s, messageCount: s.messageCount + 1, lastActive: new Date(), title: s.messageCount === 0 && msg.type === "user" ? (msg.content.slice(0, 30) || s.title) : s.title }
        : s)
      persistSessions(nextSessions, state.activeSession)
      return { messages: [...state.messages, message], sessions: nextSessions }
    })
    return message.id
  },

  updateMessage: (id, updates) => set((state) => ({
    messages: state.messages.map(m => m.id === id ? { ...m, ...updates } : m)
  })),

  appendStreamDelta: (id, channel, delta) => set((state) => ({
    messages: state.messages.map(m => {
      if (m.id !== id) return m
      if (channel === "content") {
        return { ...m, streamingContent: (m.streamingContent || "") + delta }
      }
      return { ...m, streamingThinking: (m.streamingThinking || "") + delta }
    })
  })),

  finalizeStream: (id, content, thinking) => set((state) => ({
    messages: state.messages.map(m => m.id === id ? {
      ...m,
      content: content || m.streamingContent || "",
      streamingContent: undefined,
      streamingThinking: undefined,
      thinking,
      status: "complete"
    } : m)
  })),

  failStream: (id, error) => set((state) => ({
    messages: state.messages.map(m => m.id === id ? { ...m, type: "error", content: error, status: "error", streamingContent: undefined, streamingThinking: undefined } : m)
  })),

  deleteMessage: (id) => set((state) => {
    const idx = state.messages.findIndex(m => m.id === id)
    if (idx === -1) return state
    const removed = state.messages[idx]
    const next = [...state.messages.slice(0, idx), ...state.messages.slice(idx + 1)]
    const nextSessions = state.sessions.map(s => s.id === state.activeSession
      ? { ...s, messageCount: Math.max(0, s.messageCount - 1) }
      : s)
    persistSessions(nextSessions, state.activeSession)
    return { messages: next, sessions: nextSessions, _removed: removed }
  }),

  resendMessage: (id) => {
    const msg = get().messages.find(m => m.id === id)
    if (!msg || msg.type !== "user") return null
    set((state) => ({ messages: state.messages.filter(m => m.id !== id) }))
    return get().addMessage({ type: "user", content: msg.content })
  },

  setDispatchMode: (mode) => set({ dispatchMode: mode }),
  setIsProcessing: (processing) => set({ isProcessing: processing }),
  setCurrentTask: (taskId) => set({ currentTaskId: taskId }),
  setStreamingAgents: (ids) => set({ streamingAgentIds: ids }),
  clearMessages: () => set({ messages: [] }),

  createSession: () => {
    const id = "session-" + Date.now()
    set((state) => {
      const next = [...state.sessions, { id, title: "New chat", messageCount: 0, lastActive: new Date() }]
      persistSessions(next, id)
      return { sessions: next, activeSession: id, messages: [] }
    })
    return id
  },

  switchSession: (id) => {
    set({ activeSession: id, messages: [] })
    persistSessions(get().sessions, id)
  },

  renameSession: (id, title) => {
    set((state) => {
      const next = state.sessions.map(s => s.id === id ? { ...s, title } : s)
      persistSessions(next, state.activeSession)
      return { sessions: next }
    })
  },

  deleteSession: (id) => {
    set((state) => {
      const remaining = state.sessions.filter(s => s.id !== id)
      const wasActive = state.activeSession === id
      const nextActive = wasActive ? (remaining[0]?.id || null) : state.activeSession
      persistSessions(remaining, nextActive)
      return { sessions: remaining, activeSession: nextActive, messages: wasActive ? [] : state.messages }
    })
  },

  saveSessions: () => {
    const state = get()
    persistSessions(state.sessions, state.activeSession)
  },

  loadSessions: () => {
    try {
      const raw = localStorage.getItem("agenthub-sessions")
      if (raw) {
        const data = JSON.parse(raw)
        if (data.sessions) {
          set({
            sessions: data.sessions.map((s: any) => ({ ...s, lastActive: new Date(s.lastActive) })),
            activeSession: data.activeSession
          })
        }
      }
    } catch (e) {}
  }
}))