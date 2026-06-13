/* ============================================================
   AgentHub 玻璃拟态 UI — 总览页
   Agent 卡片网格（三条对齐线：头部 48px / 模型栏 37px / 按钮贴底）
   + 最近任务（前 4 条）
   ============================================================ */

import React from 'react'
import { Icon, IC, AgentMark, StatusDot, Enter, SectionTitle, TaskStatusBadge } from '../glass/ui'
import { AGENT_META, AGENT_IDS, AgentUIStatus, BindingDef, ProviderDef, TaskItem } from '../glass/meta'
import { tr, statusLabel, modeLabel, agentDesc } from '../glass/i18n'

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

  return (
    <div data-screen-label="总览" style={{ padding: '6px 4px 30px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.01em' }}>{greeting()}</h1>
          <div style={{ color: 'var(--tx-2)', marginTop: 3 }}>
            {tr(`${onlineCount} 个 Agent 在线 · ${runningCount} 个任务运行中 · 今日完成 ${doneToday} 个`,
                `${onlineCount} agents online · ${runningCount} running · ${doneToday} done today`)}
          </div>
        </div>
        <button className="ah-btn primary" onClick={() => goChat(null)}>
          <Icon d={IC.bolt} size={15} /> {tr('新建派发', 'New dispatch')}
        </button>
      </div>

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
