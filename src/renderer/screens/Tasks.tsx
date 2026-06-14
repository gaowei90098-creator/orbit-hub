/* ============================================================
   AgentHub 玻璃拟态 UI — 任务历史页
   筛选分段 + 顶栏搜索联动 + 行展开详情 + 运行中可取消
   ============================================================ */

import React, { useState } from 'react'
import { Icon, IC, AgentMark, Enter, Seg, SectionTitle, Collapse, TaskStatusBadge } from '../glass/ui'
import { TaskItem, fmtDur, sumTokens, fmtTokens, usageTotal } from '../glass/meta'
import { tr, modeLabel } from '../glass/i18n'

export function TasksScreen({ tasks, search, onCancelTask }: {
  tasks: TaskItem[]
  search: string
  onCancelTask: (id: string) => void
}) {
  const [open, setOpen] = useState<string | null>(null)
  const [filter, setFilter] = useState('all')

  const visible = tasks.filter(t =>
    (filter === 'all' || t.status === filter) &&
    (!search || t.text.toLowerCase().includes(search.toLowerCase()))
  )

  return (
    <div data-screen-label="任务" style={{ padding: '6px 4px 30px' }}>
      <SectionTitle right={
        <Seg value={filter} onChange={setFilter} options={[
          { value: 'all', label: tr('全部', 'All') }, { value: 'running', label: tr('运行中', 'Running') },
          { value: 'completed', label: tr('已完成', 'Done') }, { value: 'failed', label: tr('失败', 'Failed') }
        ]} />
      }>{tr('任务历史', 'Task history')}</SectionTitle>

      {visible.length === 0 && (
        <div className="glass" style={{ padding: 40, textAlign: 'center', color: 'var(--tx-3)' }}>{tr('没有匹配的任务', 'No matching tasks')}</div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {visible.map((t, i) => {
          const isOpen = open === t.id
          return (
            <Enter key={t.id} delay={i * 45} className="glass" style={{ overflow: 'hidden' }}>
              <div onClick={() => setOpen(isOpen ? null : t.id)} style={{
                display: 'flex', alignItems: 'center', gap: 13, padding: '13px 18px', cursor: 'pointer'
              }}>
                <TaskStatusBadge status={t.status} />
                <span style={{ flex: 1, fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.text}</span>
                <span className="ah-chip">{modeLabel(t.mode)}</span>
                <div style={{ display: 'flex', gap: 4 }}>
                  {t.agents.map(a => <AgentMark key={a} id={a} size={20} radius={6} />)}
                </div>
                {sumTokens(t.usage) > 0 && (
                  <span className="ah-chip" title={tr('Token 总用量', 'Total tokens')} style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                    {fmtTokens(sumTokens(t.usage))} tok
                  </span>
                )}
                <span className="ah-hint" style={{ width: 50, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                  {t.status === 'running' ? '…' : fmtDur(t.durationMs)}
                </span>
                <span className="ah-hint" style={{ width: 40, textAlign: 'right' }}>{t.createdAt}</span>
                {t.status === 'running'
                  ? <button className="ah-btn sm danger" onClick={e => { e.stopPropagation(); onCancelTask(t.id) }}>{tr('取消', 'Cancel')}</button>
                  : <Icon d={IC.chevDown} size={14} style={{ color: 'var(--tx-3)', transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />}
              </div>
              <Collapse open={isOpen}>
                <div style={{ borderTop: '1px solid var(--glass-border)', padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div className="ah-hint" style={{ fontFamily: 'var(--font-mono)' }}>{t.id} · {modeLabel(t.mode)} · {tr(`${t.agents.length} 个 Agent`, `${t.agents.length} agents`)}</div>
                  {sumTokens(t.usage) > 0 && (
                    <div className="ah-hint" style={{ fontFamily: 'var(--font-mono)', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                      <span style={{ color: 'var(--mint)' }}>{tr('Token 合计', 'Total tokens')} {fmtTokens(sumTokens(t.usage))}</span>
                      {Object.entries(t.usage!).map(([aid, u]) => (
                        <span key={aid} style={{ color: 'var(--tx-3)' }}>
                          {aid}: {fmtTokens(usageTotal(u))} (↑{fmtTokens(u.prompt_tokens || 0)} ↓{fmtTokens(u.completion_tokens || 0)})
                        </span>
                      ))}
                    </div>
                  )}
                  {t.results && Object.entries(t.results).map(([agentId, content]) => (
                    <div key={agentId} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                      <AgentMark id={agentId} size={24} radius={7} />
                      <div style={{ flex: 1, fontSize: 13, color: 'var(--tx-2)', background: 'rgba(0,0,0,0.18)', borderRadius: 10, padding: '9px 13px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{content}</div>
                    </div>
                  ))}
                  {t.errors && Object.entries(t.errors).map(([agentId, err]) => (
                    <div key={agentId} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                      <AgentMark id={agentId} size={24} radius={7} />
                      <div style={{ flex: 1, fontSize: 12.5, color: 'var(--st-error)', background: 'rgba(232,112,106,0.08)', border: '1px solid rgba(232,112,106,0.2)', borderRadius: 10, padding: '9px 13px', fontFamily: 'var(--font-mono)' }}>{err}</div>
                    </div>
                  ))}
                </div>
              </Collapse>
            </Enter>
          )
        })}
      </div>
    </div>
  )
}
