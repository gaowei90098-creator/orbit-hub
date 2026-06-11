import { useEffect, useRef, useCallback } from 'react'
import { useChatStore } from '../store/chat'
import { useAgentStore } from '../store/agents'

export function useWebSocket(url: string = 'ws://localhost:9527') {
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<any>(null)
  const { addMessage } = useChatStore()
  const { updateAgentStatus } = useAgentStore()

  const connect = useCallback(() => {
    try {
      const ws = new WebSocket(url)
      ws.onopen = () => {
        console.log('[WebSocket] Connected to Hub')
        addMessage({ type: 'system', content: '已连接到 AgentHub Hub' })
      }
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          handleMessage(data)
        } catch {}
      }
      ws.onclose = () => {
        console.log('[WebSocket] Disconnected')
        addMessage({ type: 'system', content: '与 Hub 断开连接，10秒后重试...' })
        reconnectTimer.current = setTimeout(connect, 10000)
      }
      ws.onerror = () => { ws.close() }
      wsRef.current = ws
    } catch {
      reconnectTimer.current = setTimeout(connect, 10000)
    }
  }, [url])

  const handleMessage = (data: any) => {
    switch (data.type) {
      case 'hub:connected':
        if (data.agents) {
          data.agents.forEach((a: any) => updateAgentStatus(a.id, a.status))
        }
        break
      case 'agent:status':
        updateAgentStatus(data.payload?.id, data.payload?.status)
        break
      case 'chat:response':
        if (data.payload?.results) {
          for (const r of data.payload.results) {
            addMessage({ type: 'agent', content: r.content, agentId: r.agentId, status: 'complete', taskId: data.payload.taskId })
          }
        }
        if (data.payload?.error) {
          addMessage({ type: 'error', content: data.payload.error })
        }
        break
    }
  }

  const send = useCallback((message: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message))
    }
  }, [])

  useEffect(() => {
    connect()
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
      wsRef.current?.close()
    }
  }, [connect])

  return { send, isConnected: wsRef.current?.readyState === WebSocket.OPEN }
}
