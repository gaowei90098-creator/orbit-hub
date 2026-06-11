import { create } from "zustand"

export type SettingsTab = "general" | "providers" | "thinking" | "routing"

interface UIStore {
  theme: "dark" | "light"
  sidebarOpen: boolean
  contextPanelOpen: boolean
  notifications: Array<{ id: string; type: "info" | "success" | "error" | "warning"; message: string; duration?: number }>
  onboardingDone: boolean
  settingsOpen: boolean
  settingsTab: SettingsTab
  commandPaletteOpen: boolean
  thinkingOverride: { mode: "off" | "auto" | "enabled"; level: "minimal" | "low" | "medium" | "high" | "xhigh"; budgetTokens?: number } | null
  providerConfig: any | null
  setTheme: (theme: "dark" | "light") => void
  toggleSidebar: () => void
  toggleContextPanel: () => void
  addNotification: (type: string, message: string, duration?: number) => void
  removeNotification: (id: string) => void
  setOnboardingDone: (done: boolean) => void
  setSettingsOpen: (open: boolean) => void
  setSettingsTab: (tab: SettingsTab) => void
  setCommandPaletteOpen: (open: boolean) => void
  setThinkingOverride: (t: UIStore["thinkingOverride"]) => void
  setProviderConfig: (cfg: any) => void
}

export const useUIStore = create<UIStore>((set) => ({
  theme: "dark",
  sidebarOpen: true,
  contextPanelOpen: true,
  notifications: [],
  onboardingDone: false,
  settingsOpen: false,
  settingsTab: "providers",
  commandPaletteOpen: false,
  thinkingOverride: null,
  providerConfig: null,
  setTheme: (theme) => {
    set({ theme })
    try { document.documentElement.setAttribute("data-theme", theme) } catch (e) {}
  },
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  toggleContextPanel: () => set((s) => ({ contextPanelOpen: !s.contextPanelOpen })),
  addNotification: (type, message, duration) => {
    const id = "notif-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6)
    set((s) => ({ notifications: [...s.notifications, { id, type: type as any, message }] }))
    setTimeout(() => set((s) => ({ notifications: s.notifications.filter(n => n.id !== id) })), duration || 4000)
  },
  removeNotification: (id) => set((s) => ({ notifications: s.notifications.filter(n => n.id !== id) })),
  setOnboardingDone: (done) => set({ onboardingDone: done }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  setSettingsTab: (tab) => set({ settingsTab: tab }),
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
  setThinkingOverride: (t) => set({ thinkingOverride: t }),
  setProviderConfig: (cfg) => set({ providerConfig: cfg })
}))