/* ============================================================
   AgentHub — 本次会话 Token 预算（前端持久化，advisory + 软上限）
   照 i18n.ts 的 useSyncExternalStore + localStorage 模式。
   limit = 0 表示未设预算。
   ============================================================ */

import { useSyncExternalStore } from 'react'

let limit: number = (() => {
  try {
    const v = Number(localStorage.getItem('ah-budget-tokens'))
    return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0
  } catch { return 0 }
})()

const listeners = new Set<() => void>()

export function getBudget(): number { return limit }

export function setBudget(n: number): void {
  limit = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
  try { localStorage.setItem('ah-budget-tokens', String(limit)) } catch { /* noop */ }
  listeners.forEach(f => f())
}

export function useBudget(): number {
  return useSyncExternalStore(
    cb => { listeners.add(cb); return () => listeners.delete(cb) },
    () => limit
  )
}

/** 告警阈值：用量达预算的此比例即进入 warn */
export const ALERT_PCT = 0.8

/** 预算状态：none(未设) / ok / warn(≥80%) / over(≥100%) */
export function budgetLevel(used: number, lim: number): 'none' | 'ok' | 'warn' | 'over' {
  if (!lim || lim <= 0) return 'none'
  const r = used / lim
  if (r >= 1) return 'over'
  if (r >= ALERT_PCT) return 'warn'
  return 'ok'
}
