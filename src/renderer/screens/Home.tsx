/* ============================================================
   AgentHub 玻璃拟态 UI — 总览页
   Agent 卡片网格（三条对齐线：头部 48px / 模型栏 37px / 按钮贴底）
   + 最近任务（前 4 条）
   ============================================================ */

import React, { useState } from 'react'
import { Icon, IC, AgentMark, StatusDot, Enter, SectionTitle, TaskStatusBadge } from '../glass/ui'
import { AGENT_META, AGENT_IDS, AgentUIStatus, BindingDef, ProviderDef, TaskItem, sumTokens, fmtTokens } from '../glass/meta'
import { tr, statusLabel, modeLabel, agentDesc } from '../glass/i18n'
import { useBudget, setBudget, budgetLevel } from '../glass/budget'

/** 本次会话 Token 预算条：进度 + 分级告警（ok/warn≥80%/over≥100%）+ 可编辑上限 */
function BudgetBar({ used }: { used: number }) {
  const limit = useBudget()
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState('')
  const level = budgetLevel(used, limit)
  const color = level === 'over' ? 'var(--st-error)' : level === 'warn' ? 'var(--st-busy)' : 'var(--mint)'
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0
  const commit = () => {
    const n = Number(val.replace(/[,_\s]/g, ''))
    setBudget(Number.isFinite(n) ? n : 0)
    setEditing(false); setVal('')
  }
  return (
    <div className="glass" style={{ padding: '11px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 14 }}>
      <Icon d={IC.bolt} size={15} style={{ color }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: limit > 0 ? 5 : 0 }}>
          <span style={{ color: 'var(--tx-2)' }}>
            {tr('本次 Token 预算', 'Session token budget')}
            {level === 'over' && <span style={{ color: 'var(--st-error)', marginLeft: 8 }}>· {tr('已超预算', 'Over budget')}</span>}
            {level === 'warn' && <span style={{ color: 'var(--st-busy)', marginLeft: 8 }}>· {tr('接近预算', 'Near limit')}</span>}
          </span>
          <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--tx-3)' }}>
            {fmtTokens(used)}{limit > 0 ? ` / ${fmtTokens(limit)}` : tr(' · 未设', ' · not set')}
          </span>
        </div>
        {limit > 0 && (
          <div style={{ height: 5, borderRadius: 3, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: pct + '%', background: color, transition: 'width 0.3s' }} />
          </div>
        )}
      </div>
      {editing ? (
        <input className="ah-input mono" autoFocus style={{ width: 150, fontSize: 12, padding: '4px 8px' }}
          value={val} placeholder={tr('如 200000，空=关', 'e.g. 200000, empty=off')}
          onChange={e => setVal(e.target.value)}
          onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter') commit() }} />
      ) : (
        <button className="ah-btn sm" onClick={() => { setVal(limit ? String(limit) : ''); setEditing(true) }}>
          {limit > 0 ? tr('改预算', 'Edit') : tr('设预算', 'Set budget')}
        </button>
      )}
    </div>
  )
}

function greeting(): string {
  const h = new Date().getHours()
  if (h < 6) return tr('夜深了', 'Burning the midnight oil')
  if (h < 12) return tr('上午好', 'Good morning')
  if (h < 18) return tr('下午好', 'Good afternoon')
  return tr('晚上好', 'Good evening')
}

export function HomeScreen({ agents, bindings, providers, tasks, goChat }: {
  agents: Record<string, { status: AgentUIStatus }>
  bindings: BindingDef[]
  providers: ProviderDef[]
  tasks: TaskItem[]
  goChat: (agentId: string | null) => void
}) {
  const onlineCount = AGENT_IDS.filter(id => (agents[id]?.status ?? 'off') !== 'off').length
  const runningCount = tasks.filter(t => t.status === 'running').length
  const doneToday = tasks.filter(t => t.status === 'completed').length
  const sessionTokens = tasks.reduce((s, t) => s + sumTokens(t.usage), 0)
  const tokZh = sessionTokens > 0 ? ` · 本次 Token ${fmtTokens(sessionTokens)}` : ''
  const tokEn = sessionTokens > 0 ? ` · ${fmtTokens(sessionTokens)} tokens` : ''

  return (
    <div data-screen-label="总览" style={{ padding: '6px 4px 30px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.01em' }}>{greeting()}</h1>
          <div style={{ color: 'var(--tx-2)', marginTop: 3 }}>
            {tr(`${onlineCount} 个 Agent 在线 · ${runningCount} 个任务运行中 · 今日完成 ${doneToday} 个${tokZh}`,
                `${onlineCount} agents online · ${runningCount} running · ${doneToday} done today${tokEn}`)}
          </div>
        </div>
        <button className="ah-btn primary" onClick={() => goChat(null)}>
          <Icon d={IC.bolt} size={15} /> {tr('新建派发', 'New dispatch')}
        </button>
      </div>

      <BudgetBar used={sessionTokens} />

      {/* Agent 卡片网格 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 16 }}>
        {AGENT_IDS.map((id, idx) => {
          const meta = AGENT_META[id]
          const a = agents[id] || { status: 'off' as AgentUIStatus }
          const b = bindings.find(x => x.agentId === id)
          const prov = providers.find(p => p.id === b?.providerId)
          const model = prov?.models.find(m => m.id === b?.modelId)
          const isStdio = b?.protocol === 'stdio-plain'
          return (
            <Enter key={id} delay={idx * 70} style={{ display: 'flex' }}>
              <div className="glass hover-glow" style={{ flex: 1, padding: 18, display: 'flex', flexDirection: 'column', gap: 13, transition: 'border-color 0.2s, transform 0.2s', cursor: 'default' }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--glass-border-strong)'; e.currentTarget.style.transform = 'translateY(-2px)' }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--glass-border)'; e.currentTarget.style.transform = 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 13, height: 48 }}>
                  <AgentMark id={id} size={48} radius={13} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{meta.name}</div>
                    <div className="ah-hint" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{agentDesc(id, meta.desc)}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--tx-2)', flex: 'none' }}>
                    <StatusDot status={a.status} />{statusLabel(a.status)}
                  </div>
                </div>

                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, height: 37, flex: 'none',
                  background: 'rgba(0,0,0,0.2)', borderRadius: 10, padding: '0 12px',
                  fontFamily: 'var(--font-mono)', color: 'var(--tx-2)'
                }}>
                  <Icon d={isStdio ? IC.terminal : IC.link} size={13} style={{ color: meta.colorRaw, flex: 'none' }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {isStdio ? tr('本地 CLI · stdio', 'Local CLI · stdio') : `${prov?.name ?? tr('未绑定', 'Unbound')} · ${model?.label || b?.modelId || '–'}`}
                  </span>
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignContent: 'flex-start', flex: 1, minHeight: 24 }}>
                  {meta.caps.map(c => <span key={c} className="ah-chip">{c}</span>)}
                </div>

                <div style={{ display: 'flex', gap: 8, marginTop: 'auto' }}>
                  <button className="ah-btn sm" style={{ flex: 1 }} onClick={() => goChat(id)}>
                    <Icon d={IC.send} size={13} /> {tr('派发任务', 'Dispatch')}
                  </button>
                </div>
              </div>
            </Enter>
          )
        })}
      </div>

      {/* 最近任务 */}
      <Enter delay={320} style={{ marginTop: 28 }}>
        <SectionTitle right={<span className="ah-hint">{tr(`${tasks.length} 条记录`, `${tasks.length} records`)}</span>}>{tr('最近任务', 'Recent tasks')}</SectionTitle>
        <div className="glass" style={{ padding: '6px 0' }}>
          {tasks.length === 0 && (
            <div style={{ padding: '18px 18px', color: 'var(--tx-3)', fontSize: 13 }}>{tr('还没有任务 — 去会话页派发第一个任务吧', 'No tasks yet — dispatch your first one from Chat')}</div>
          )}
          {tasks.slice(0, 4).map((t, i) => (
            <div key={t.id} style={{
              display: 'flex', alignItems: 'center', gap: 13, padding: '11px 18px',
              borderTop: i === 0 ? 'none' : '1px solid var(--glass-border)'
            }}>
              <TaskStatusBadge status={t.status} />
              <span style={{ flex: 1, fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.text}</span>
              <span className="ah-chip">{modeLabel(t.mode)}</span>
              <div style={{ display: 'flex', gap: 4 }}>
                {t.agents.map(a => <AgentMark key={a} id={a} size={20} radius={6} />)}
              </div>
              <span className="ah-hint" style={{ width: 42, textAlign: 'right' }}>{t.createdAt}</span>
            </div>
          ))}
        </div>
      </Enter>
    </div>
  )
}
