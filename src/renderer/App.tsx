/* ============================================================
   AgentHub — 玻璃拟态壳层（design_handoff_glass_ui 实现）
   背景光斑 + 标题栏 + 侧边栏 + 四页（总览/会话/任务/设置）
   真实 IPC：hub:status / hub:dispatch / dispatch:stream /
             providers:* / routing:setBinding / proxy:info
   ============================================================ */

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Titlebar } from './glass/Titlebar'
import { Sidebar, PageId } from './glass/Sidebar'
import { Enter } from './glass/ui'
import {
  AGENT_IDS, AgentUIStatus, BindingDef, ProviderDef, TaskItem, ChatMessage,
  DispatchMode, nowHHMM, sumTokens, sumCost
} from './glass/meta'
import { HomeScreen } from './screens/Home'
import { ChatScreen } from './screens/Chat'
import { TasksScreen } from './screens/Tasks'
import { SettingsScreen, MotionLevel } from './screens/Settings'
import { useLang, tr } from './glass/i18n'
import { getBudget, getBudgetMode } from './glass/budget'
import { applyOrchestrateEvent } from './glass/orchestrate-reducer'
import { upsertStep } from './glass/chat-transcript'
import { SetupTab, summarizeAgentConnections } from './glass/connection-status'

type AgentMap = Record<string, { status: AgentUIStatus }>

const asRecord = (v: any): Record<string, string> => {
  if (!v) return {}
  if (v instanceof Map) return Object.fromEntries(v)
  if (Array.isArray(v)) return Object.fromEntries(v)
  return v
}

export default function App() {
  const [page, setPage] = useState<PageId>('home')
  const [search, setSearch] = useState('')
  const [activeAgent, setActiveAgent] = useState<string | null>(null)
  const [settingsTab, setSettingsTab] = useState<SetupTab | 'appearance'>('providers')
  const [hubRunning, setHubRunning] = useState(false)
  const [proxyHost, setProxyHost] = useState('127.0.0.1:9528')
  const [hubAgents, setHubAgents] = useState<Record<string, string>>({})   // 注册表原始状态
  const [busyOverride, setBusyOverride] = useState<Record<string, AgentUIStatus | undefined>>({}) // 流式期间的即时状态
  const [providers, setProviders] = useState<ProviderDef[]>([])
  const [bindings, setBindings] = useState<BindingDef[]>([])
  const [fallbackChain, setFallbackChain] = useState<string[]>([])
  const [tasks, setTasks] = useState<TaskItem[]>([])
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [streaming, setStreaming] = useState(false)
  const [motion, setMotion] = useState<MotionLevel>(() => {
    try { return (localStorage.getItem('ah-motion') as MotionLevel) || 'rich' } catch { return 'rich' }
  })

  /* 流式派发簿记 */
  const taskToMsg = useRef<Map<string, string>>(new Map())
  const pendingMsgId = useRef<string | null>(null)
  const ignoredTasks = useRef<Set<string>>(new Set())
  const ignoredMsgs = useRef<Set<string>>(new Set())
  const activeTaskIds = useRef<Set<string>>(new Set())
  const localTaskId = useRef<Map<string, string>>(new Map()) // 后端 taskId → 本地任务行 id
  const currentMsgId = useRef<string | null>(null)
  const cancelGen = useRef(0)
  const memoryReady = useRef(false)
  const orchestrateTasks = useRef<Set<string>>(new Set())  // 编排模式任务 id（其内部 agent 事件不渲染气泡）

  /* 动效档位 → html[data-motion] */
  useEffect(() => {
    document.documentElement.dataset.motion = motion
    try { localStorage.setItem('ah-motion', motion) } catch { /* noop */ }
  }, [motion])

  useEffect(() => {
    let alive = true
    const memoryApi = window.electronAPI?.memory
    if (!memoryApi?.loadState) {
      memoryReady.current = true
      return () => { alive = false }
    }
    memoryApi.loadState()
      .then(state => {
        if (!alive) return
        if (Array.isArray(state?.messages) && state.messages.length > 0) setMessages(state.messages as ChatMessage[])
        if (Array.isArray(state?.tasks) && state.tasks.length > 0) setTasks(state.tasks as TaskItem[])
      })
      .catch(() => {})
      .finally(() => { if (alive) memoryReady.current = true })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    if (!memoryReady.current) return
    const memoryApi = window.electronAPI?.memory
    if (!memoryApi?.saveState) return
    const timer = setTimeout(() => {
      memoryApi.saveState({ messages, tasks }).catch(() => {})
    }, 450)
    return () => clearTimeout(timer)
  }, [messages, tasks])

  /* ---------- 数据加载 ---------- */
  const loadConfig = useCallback(async () => {
    try {
      const cfg = await window.electronAPI.providers.get()
      setProviders(cfg?.providers ?? [])
      setBindings(cfg?.routing?.bindings ?? [])
      setFallbackChain(cfg?.routing?.fallbackChain ?? [])
    } catch { /* main 进程未就绪 */ }
  }, [])

  const refreshStatus = useCallback(async () => {
    try {
      const st = await window.electronAPI.hub.getStatus()
      setHubRunning(!!st?.running)
      const m: Record<string, string> = {}
      for (const a of st?.agents ?? []) m[a.id] = a.status
      setHubAgents(m)
      if (st?.tasks) {
        setTasks(prev => {
          const known = new Set(prev.map(t => t.id))
          const fromHub: TaskItem[] = (st.tasks as any[])
            .filter(t => !known.has(t.id) && ![...localTaskId.current.values()].includes(t.id) && !taskToMsg.current.has(t.id))
            .map(t => ({
              id: t.id, text: t.text, mode: (t.mode || 'auto') as DispatchMode,
              status: t.status === 'pending' ? 'running' : t.status,
              agents: [], durationMs: null,
              createdAt: t.createdAt ? new Date(t.createdAt).toTimeString().slice(0, 5) : ''
            }))
          return fromHub.length ? [...prev, ...fromHub] : prev
        })
      }
    } catch { /* noop */ }
  }, [])

  useEffect(() => {
    loadConfig()
    refreshStatus()
    window.electronAPI?.proxy?.info().then(info => {
      try {
        const u = new URL(info.url)
        setProxyHost(u.host)
      } catch { /* noop */ }
    }).catch(() => {})
    const poll = setInterval(refreshStatus, 8000)
    return () => clearInterval(poll)
  }, [loadConfig, refreshStatus])

  /* 深链 */
  useEffect(() => {
    const off = window.electronAPI?.app?.onDeepLink?.((link) => {
      if (link.action === 'tasks' || link.action === 'board') setPage('tasks')
      else if (link.action === 'settings') setPage('settings')
      else {
        setPage('chat')
        if (link.params.agent && AGENT_IDS.includes(link.params.agent)) setActiveAgent(link.params.agent)
      }
    })
    return off
  }, [])

  /* ---------- 流式事件 ---------- */
  useEffect(() => {
    const off = window.electronAPI?.hub?.onStream?.((e: any) => {
      const tid: string = e.taskId
      if (!tid || ignoredTasks.current.has(tid)) return

      let msgId = taskToMsg.current.get(tid)
      if (!msgId && pendingMsgId.current) {
        msgId = pendingMsgId.current
        taskToMsg.current.set(tid, msgId)
        activeTaskIds.current.add(tid)
      }
      if (!msgId || ignoredMsgs.current.has(msgId)) return
      const localId = localTaskId.current.get(tid) ?? tid

      // 编排模式：orchestrate:* 事件经 reducer 聚合到该消息的 orchestration；标记该任务
      if (typeof e.kind === 'string' && e.kind.startsWith('orchestrate:')) {
        orchestrateTasks.current.add(tid)
        setMessages(ms => ms.map(m => m.id === msgId
          ? { ...m, orchestration: applyOrchestrateEvent(m.orchestration, e) } : m))
        if (e.kind === 'orchestrate:final' || e.kind === 'orchestrate:error') {
          setBusyOverride(o => ({ ...o }))
          setTasks(ts => ts.map(t => t.id === localId
            ? { ...t, results: { ...(t.results || {}), orchestrate: e.content || t.results?.orchestrate || '' } } : t))
        }
        return
      }
      // 编排任务的内部 agent 事件（lead 分解/子任务/汇总）不渲染为普通气泡
      if (orchestrateTasks.current.has(tid)) return

      if (e.kind === 'start') {
        setBusyOverride(o => ({ ...o, [e.agentId]: 'busy' }))
        setMessages(ms => ms.map(m => {
          if (m.id !== msgId) return m
          if (m.replies.some(r => r.agentId === e.agentId)) return m
          return { ...m, replies: [...m.replies, { agentId: e.agentId, thinking: '', text: '', done: false }] }
        }))
        setTasks(ts => ts.map(t => t.id === localId && !t.agents.includes(e.agentId)
          ? { ...t, agents: [...t.agents, e.agentId] } : t))
      } else if (e.kind === 'delta') {
        setMessages(ms => ms.map(m => m.id === msgId
          ? {
              ...m,
              replies: m.replies.map(r => r.agentId === e.agentId
                ? (e.channel === 'thinking'
                    ? { ...r, thinking: r.thinking + e.text }
                    : { ...r, text: r.text + e.text })
                : r)
            }
          : m))
      } else if (e.kind === 'activity' && e.step) {
        // Track A/B：结构化活动步骤（工具调用/思考），按 step.id upsert 进对应 reply 的 steps[]
        setMessages(ms => ms.map(m => {
          if (m.id !== msgId) return m
          const exists = m.replies.some(r => r.agentId === e.agentId)
          const replies = exists
            ? m.replies.map(r => r.agentId === e.agentId ? { ...r, steps: upsertStep(r.steps, e.step) } : r)
            : [...m.replies, { agentId: e.agentId, thinking: '', text: '', done: false, steps: upsertStep(undefined, e.step) }]
          return { ...m, replies }
        }))
      } else if (e.kind === 'done') {
        setBusyOverride(o => ({ ...o, [e.agentId]: undefined }))
        setMessages(ms => ms.map(m => m.id === msgId
          ? { ...m, replies: m.replies.map(r => r.agentId === e.agentId ? { ...r, done: true } : r) }
          : m))
        setTasks(ts => ts.map(t => t.id === localId
          ? {
              ...t,
              results: { ...(t.results || {}), [e.agentId]: e.content },
              usage: e.usage ? { ...(t.usage || {}), [e.agentId]: { ...e.usage, modelId: e.modelId } } : t.usage
            }
          : t))
      } else if (e.kind === 'error') {
        setBusyOverride(o => ({ ...o, [e.agentId]: undefined }))
        setMessages(ms => ms.map(m => m.id === msgId
          ? { ...m, replies: m.replies.map(r => r.agentId === e.agentId ? { ...r, done: true, error: e.error } : r) }
          : m))
        setTasks(ts => ts.map(t => t.id === localId
          ? { ...t, errors: { ...(t.errors || {}), [e.agentId]: e.error } }
          : t))
      }
    })
    return off
  }, [])

  /* ---------- 派发 ---------- */
  const runDispatch = useCallback(async (msgId: string, localId: string, text: string, mode: DispatchMode, targetAgent?: string, workspaceId?: string | null) => {
    pendingMsgId.current = msgId
    try {
      const task = await window.electronAPI.hub.dispatch(text, mode, targetAgent || undefined, { workspaceId: workspaceId ?? null })
      if (task?.id) {
        taskToMsg.current.set(task.id, msgId)
        localTaskId.current.set(task.id, localId)
        activeTaskIds.current.delete(task.id)
      }
      return task
    } finally {
      pendingMsgId.current = null
    }
  }, [])

  const onSend = useCallback(async (text: string, mode: DispatchMode, targetAgent: string | null, workspaceId?: string | null) => {
    if (streaming) return
    // 预算软上限：本次会话用量（按 token 或估算费用口径）达上限时确认后才继续（A2/B1）
    const budget = getBudget()
    if (budget > 0) {
      const used = getBudgetMode() === 'cost'
        ? tasks.reduce((s, t) => s + (sumCost(t.usage) || 0), 0)
        : tasks.reduce((s, t) => s + sumTokens(t.usage), 0)
      if (used >= budget &&
          !window.confirm(tr('本次会话用量已达预算上限，仍要继续派发吗？', 'Session usage reached the budget limit. Dispatch anyway?'))) {
        return
      }
    }
    const msgId = 'm' + Date.now()
    const localId = 'local-' + Date.now()
    const gen = cancelGen.current
    const isChain = !targetAgent && mode === 'chain'
    const preTargets = targetAgent ? [targetAgent]
      : mode === 'broadcast' ? bindings.map(b => b.agentId)
      : isChain ? ['codex', 'claude']
      : [] // auto：由后端路由，start 事件补卡

    currentMsgId.current = msgId
    setMessages(ms => [...ms, {
      id: msgId, role: 'user', text, mode, taskId: localId,
      replies: preTargets.map(a => ({ agentId: a, thinking: '', text: '', done: false }))
    }])
    setTasks(ts => [{
      id: localId, text, mode, status: 'running', agents: preTargets,
      durationMs: null, createdAt: nowHHMM(), results: {}, errors: {}
    }, ...ts])
    setStreaming(true)
    const start = Date.now()

    const finalize = (status: TaskItem['status'], globalError?: string) => {
      setTasks(ts => ts.map(t => t.id === localId
        ? { ...t, status, durationMs: Date.now() - start, ...(globalError ? { errors: { ...(t.errors || {}), 系统: globalError } } : {}) }
        : t))
      setMessages(ms => ms.map(m => m.id === msgId
        ? {
            ...m,
            replies: m.replies.length === 0 && globalError
              ? [{ agentId: '系统', thinking: '', text: '', done: true, error: globalError }]
              : m.replies.map(r => r.done ? r : { ...r, done: true, error: r.error ?? globalError })
          }
        : m))
      currentMsgId.current = null
      setStreaming(false)
      refreshStatus()
    }

    try {
      if (isChain) {
        const t1 = await runDispatch(msgId, localId, text, 'auto', 'codex', workspaceId)
        if (cancelGen.current !== gen) return // 已手动停止
        const out = asRecord(t1?.results)['codex'] || ''
        const firstFailed = t1?.status === 'failed' || !out
        if (firstFailed) {
          finalize('failed', t1?.error || asRecord(t1?.errors)['codex'] || '链式第一步无输出')
          return
        }
        const t2 = await runDispatch(msgId, localId, out, 'auto', 'claude', workspaceId)
        if (cancelGen.current !== gen) return
        finalize(t2?.status === 'failed' ? 'failed' : 'completed', t2?.error)
      } else {
        const task = await runDispatch(msgId, localId, text, mode, targetAgent || undefined, workspaceId)
        if (cancelGen.current !== gen) return
        const errs = asRecord(task?.errors)
        const status: TaskItem['status'] = task?.status === 'failed' ? 'failed'
          : task?.status === 'cancelled' ? 'cancelled' : 'completed'
        finalize(status, task?.error || (status === 'failed' ? Object.values(errs)[0] : undefined))
      }
    } catch (e: any) {
      if (cancelGen.current === gen) finalize('failed', e?.message || String(e))
    }
  }, [streaming, bindings, runDispatch, refreshStatus, tasks])

  const onCancel = useCallback(() => {
    cancelGen.current++
    for (const tid of activeTaskIds.current) {
      ignoredTasks.current.add(tid)
      window.electronAPI.hub.cancel(tid).catch(() => {})
    }
    activeTaskIds.current.clear()
    if (currentMsgId.current) {
      ignoredMsgs.current.add(currentMsgId.current)
      currentMsgId.current = null
    }
    pendingMsgId.current = null
    setMessages(ms => ms.map(m => ({
      ...m,
      replies: m.replies.map(r => r.done ? r : { ...r, done: true, cancelled: true })
    })))
    setTasks(ts => ts.map(t => t.status === 'running' && t.id.startsWith('local-')
      ? { ...t, status: 'cancelled' } : t))
    setBusyOverride({})
    setStreaming(false)
    refreshStatus()
  }, [refreshStatus])

  const onCancelTask = useCallback((id: string) => {
    const backendIds = [...localTaskId.current.entries()].filter(([, l]) => l === id).map(([b]) => b)
    const targets = backendIds.length ? backendIds : [id]
    for (const tid of targets) {
      ignoredTasks.current.add(tid)
      window.electronAPI.hub.cancel(tid).catch(() => {})
    }
    setTasks(ts => ts.map(t => t.id === id ? { ...t, status: 'cancelled' } : t))
  }, [])

  /* ---------- 设置操作 ---------- */
  const onSetEnabled = useCallback(async (id: string, enabled: boolean) => {
    setProviders(ps => ps.map(p => p.id === id ? { ...p, enabled } : p))
    try { await window.electronAPI.providers.setEnabled(id, enabled) } catch { /* noop */ }
    loadConfig(); refreshStatus()
  }, [loadConfig, refreshStatus])

  const onSetKey = useCallback(async (id: string, key: string) => {
    setProviders(ps => ps.map(p => p.id === id ? { ...p, apiKey: key, enabled: p.enabled || !!key } : p))
    try { await window.electronAPI.providers.setKey(id, key) } catch { /* noop */ }
    loadConfig(); refreshStatus()
  }, [loadConfig, refreshStatus])

  const onSetBinding = useCallback(async (b: BindingDef) => {
    setBindings(bs => bs.map(x => x.agentId === b.agentId ? b : x))
    try { await window.electronAPI.routing.setBinding(b) } catch { /* noop */ }
    loadConfig(); refreshStatus()
  }, [loadConfig, refreshStatus])

  const onSetFallback = useCallback(async (chain: string[]) => {
    setFallbackChain(chain)
    try { await window.electronAPI.routing.setFallback(chain) } catch { /* noop */ }
    loadConfig()
  }, [loadConfig])

  const onUpsertProvider = useCallback(async (p: any) => {
    try { await window.electronAPI.providers.upsert(p) } catch { /* noop */ }
    loadConfig(); refreshStatus()
  }, [loadConfig, refreshStatus])

  const onDeleteProvider = useCallback(async (id: string) => {
    try { await window.electronAPI.providers.delete(id) } catch { /* noop */ }
    loadConfig(); refreshStatus()
  }, [loadConfig, refreshStatus])

  /* ---------- Agent 展示状态 ----------
     off：HTTP 绑定的提供商未启用或无 Key（如 hermes/gemini）；stdio 绑定不受影响 */
  const agents: AgentMap = {}
  for (const id of AGENT_IDS) {
    const b = bindings.find(x => x.agentId === id)
    const prov = providers.find(p => p.id === b?.providerId)
    const isStdio = b?.protocol === 'stdio-plain'
    const providerUsable = !!prov && prov.enabled && !!prov.apiKey
    let st: AgentUIStatus
    if (isStdio && !b?.binary?.trim()) st = 'off'
    else if (!isStdio && b && !providerUsable) st = 'off'
    else {
      const hub = hubAgents[id]
      st = hub === 'busy' ? 'busy' : hub === 'error' ? 'error' : hub === 'offline' ? 'off' : 'idle'
    }
    const ov = busyOverride[id]
    if (ov && st !== 'off') st = ov
    agents[id] = { status: st }
  }

  const connectionSummary = summarizeAgentConnections({ agents, bindings, providers })

  const goChat = (agentId: string | null) => { setActiveAgent(agentId); setPage('chat') }
  const openSetup = (tab: SetupTab | 'appearance' = 'providers') => {
    setSettingsTab(tab)
    setPage('settings')
  }

  const lang = useLang() // 语言切换时整树重挂载（key），组件内 tr() 直接生效

  return (
    <>
      <div className="ah-backdrop"><div className="blob3"></div></div>
      <div key={lang} style={{ position: 'relative', zIndex: 1, height: '100vh', display: 'flex', flexDirection: 'column' }}>
        <Titlebar search={search} onSearch={v => { setSearch(v); if (v && page !== 'tasks') setPage('tasks') }} hubRunning={hubRunning} />
        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          <Sidebar page={page} setPage={setPage} agents={agents}
            activeAgent={activeAgent} setActiveAgent={setActiveAgent}
            providerCount={providers.length || 4} proxyHost={proxyHost} />
          <div style={{ flex: 1, minWidth: 0, padding: '0 18px 14px 16px', overflowY: page === 'chat' ? 'hidden' : 'auto', display: 'flex', flexDirection: 'column' }}>
            <Enter key={page} style={page === 'chat' ? { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } : undefined}>
              {page === 'home' && <HomeScreen agents={agents} bindings={bindings} providers={providers} tasks={tasks} goChat={goChat}
                connectionSummary={connectionSummary} openSetup={openSetup} />}
              {page === 'chat' && <ChatScreen activeAgent={activeAgent} setActiveAgent={setActiveAgent}
                messages={messages} streaming={streaming} onSend={onSend} onCancel={onCancel}
                connectionSummary={connectionSummary} openSetup={openSetup} />}
              {page === 'tasks' && <TasksScreen tasks={tasks} search={search} onCancelTask={onCancelTask}
                openSetup={openSetup} />}
              {page === 'settings' && <SettingsScreen providers={providers} bindings={bindings}
                onSetEnabled={onSetEnabled} onSetKey={onSetKey} onSetBinding={onSetBinding}
                fallbackChain={fallbackChain} onSetFallback={onSetFallback} onReload={loadConfig}
                onUpsertProvider={onUpsertProvider} onDeleteProvider={onDeleteProvider}
                motion={motion} setMotion={setMotion} initialTab={settingsTab}
                connectionSummary={connectionSummary} goChat={goChat} openSetup={openSetup} />}
            </Enter>
          </div>
        </div>
      </div>
    </>
  )
}
