import React, { useState, useMemo, useEffect } from 'react'
import { Plus, MoveRight, X, User, Search, Flag, Tag as TagIcon, Edit3, Trash2, ListTodo, Clock } from 'lucide-react'
import { useAgentStore } from '../store/agents'
import { Modal } from './ui/Modal'
import { EmptyState } from './ui/EmptyState'
import { Tooltip } from './ui/Tooltip'
import { Kbd, KbdGroup } from './ui/Kbd'

export interface Task {
  id: string
  title: string
  description: string
  status: 'todo' | 'in-progress' | 'review' | 'done'
  assignee?: string
  priority: 'low' | 'medium' | 'high'
  createdAt: Date
  tags: string[]
}

const COLUMNS: Array<{ id: Task['status']; title: string; color: string; description: string }> = [
  { id: 'todo', title: '待办', color: '#5c6478', description: '准备好开始' },
  { id: 'in-progress', title: '进行中', color: '#f59e0b', description: '正在处理' },
  { id: 'review', title: '审查中', color: '#6366f1', description: '等待审核' },
  { id: 'done', title: '已完成', color: '#22c55e', description: '圆满完成' }
]

const priorityConfig: Record<string, { label: string; color: string; bg: string }> = {
  low: { label: '低', color: 'text-[#5c6478]', bg: 'bg-[#5c6478]/10 border-[#5c6478]/30' },
  medium: { label: '中', color: 'text-[#fbbf24]', bg: 'bg-[#f59e0b]/10 border-[#f59e0b]/30' },
  high: { label: '高', color: 'text-[#f87171]', bg: 'bg-[#ef4444]/10 border-[#ef4444]/30' }
}

interface TaskEditorProps {
  open: boolean
  task: Task | null
  onClose: () => void
  onSave: (data: Omit<Task, 'id' | 'createdAt'>) => void
}

function TaskEditor({ open, task, onClose, onSave }: TaskEditorProps) {
  const { agents } = useAgentStore()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<Task['priority']>('medium')
  const [assignee, setAssignee] = useState<string | undefined>(undefined)
  const [tagsInput, setTagsInput] = useState('')

  useEffect(() => {
    if (open) {
      setTitle(task?.title || '')
      setDescription(task?.description || '')
      setPriority(task?.priority || 'medium')
      setAssignee(task?.assignee)
      setTagsInput(task?.tags.join(', ') || '')
    }
  }, [open, task])

  const handleSave = () => {
    if (!title.trim()) return
    const tags = tagsInput.split(',').map(t => t.trim()).filter(Boolean)
    onSave({ title: title.trim(), description: description.trim(), priority, assignee, tags, status: task?.status || 'todo' })
  }

  return (
    <Modal open={open} onClose={onClose} title={task ? '编辑任务' : '新建任务'} width='max-w-lg'
      footer={
        <div className='flex justify-end gap-2 px-5 py-3'>
          <button onClick={onClose} className='px-3 py-1.5 rounded-md text-xs text-[#a0a8ba] hover:text-[#e2e6ef] hover:bg-[#1a1f2e]'>取消</button>
          <button
            onClick={handleSave}
            disabled={!title.trim()}
            className='px-3 py-1.5 rounded-md text-xs font-medium gradient-accent text-white shadow-lg shadow-[#6366f1]/20 disabled:opacity-50 disabled:cursor-not-allowed'
          >
            {task ? '保存' : '创建'}
          </button>
        </div>
      }
    >
      <div className='space-y-4'>
        <div>
          <label className='text-[10px] font-semibold uppercase tracking-wider text-[#5c6478] mb-1.5 block'>标题</label>
          <input
            autoFocus
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder='任务名称…'
            className='w-full bg-[#0a0c12] text-sm text-[#e2e6ef] placeholder-[#3f4758] px-3 py-2 rounded-md border border-[#262d3d] outline-none focus:border-[#6366f1]/50 focus:ring-2 focus:ring-[#6366f1]/15 transition-all'
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSave() }}
          />
        </div>

        <div>
          <label className='text-[10px] font-semibold uppercase tracking-wider text-[#5c6478] mb-1.5 block'>描述</label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder='详细说明…'
            rows={3}
            className='w-full bg-[#0a0c12] text-xs text-[#e2e6ef] placeholder-[#3f4758] px-3 py-2 rounded-md border border-[#262d3d] outline-none focus:border-[#6366f1]/50 focus:ring-2 focus:ring-[#6366f1]/15 transition-all resize-none'
          />
        </div>

        <div className='grid grid-cols-2 gap-3'>
          <div>
            <label className='text-[10px] font-semibold uppercase tracking-wider text-[#5c6478] mb-1.5 flex items-center gap-1'>
              <Flag size={10} /> 优先级
            </label>
            <div className='grid grid-cols-3 gap-1'>
              {(['low', 'medium', 'high'] as const).map(p => {
                const cfg = priorityConfig[p]
                const isActive = priority === p
                return (
                  <button
                    key={p}
                    onClick={() => setPriority(p)}
                    className={[
                      'py-1.5 rounded-md text-[11px] font-medium border transition-all',
                      isActive ? cfg.bg + ' ' + cfg.color + ' ring-1 ring-current/30' : 'border-[#262d3d] text-[#5c6478] hover:text-[#a0a8ba] hover:bg-[#1a1f2e]'
                    ].join(' ')}
                  >
                    {cfg.label}
                  </button>
                )
              })}
            </div>
          </div>
          <div>
            <label className='text-[10px] font-semibold uppercase tracking-wider text-[#5c6478] mb-1.5 flex items-center gap-1'>
              <User size={10} /> 指派给
            </label>
            <select
              value={assignee || ''}
              onChange={e => setAssignee(e.target.value || undefined)}
              className='w-full bg-[#0a0c12] text-xs text-[#e2e6ef] px-3 py-2 rounded-md border border-[#262d3d] outline-none focus:border-[#6366f1]/50'
            >
              <option value=''>未指派</option>
              {agents.filter(a => a.status === 'idle' || a.status === 'busy').map(a => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className='text-[10px] font-semibold uppercase tracking-wider text-[#5c6478] mb-1.5 flex items-center gap-1'>
            <TagIcon size={10} /> 标签 (逗号分隔)
          </label>
          <input
            value={tagsInput}
            onChange={e => setTagsInput(e.target.value)}
            placeholder='frontend, urgent, refactor…'
            className='w-full bg-[#0a0c12] text-xs text-[#e2e6ef] placeholder-[#3f4758] px-3 py-2 rounded-md border border-[#262d3d] outline-none focus:border-[#6366f1]/50 focus:ring-2 focus:ring-[#6366f1]/15 transition-all'
          />
          {tagsInput && (
            <div className='flex flex-wrap gap-1 mt-1.5'>
              {tagsInput.split(',').map(t => t.trim()).filter(Boolean).map(t => (
                <span key={t} className='text-[9px] px-1.5 py-0.5 rounded bg-[#6366f1]/15 text-[#a5b4fc] border border-[#6366f1]/30'>{t}</span>
              ))}
            </div>
          )}
        </div>

        <div className='flex items-center justify-between text-[10px] text-[#3f4758] pt-2 border-t border-[#1a1f2e]'>
          <span className='flex items-center gap-1'><KbdGroup keys={['Ctrl', 'Enter']} /> 保存</span>
          <span className='flex items-center gap-1'><Kbd>esc</Kbd> 取消</span>
        </div>
      </div>
    </Modal>
  )
}

function TaskCard({
  task, agents, onStatusChange, onDelete, onEdit
}: {
  task: Task
  agents: ReturnType<typeof useAgentStore.getState>['agents']
  onStatusChange: (id: string, newStatus: Task['status']) => void
  onDelete: (id: string) => void
  onEdit: (task: Task) => void
}) {
  const assigneeAgent = task.assignee ? agents.find(a => a.id === task.assignee) : undefined
  const nextStatus: Record<string, Task['status']> = {
    'todo': 'in-progress', 'in-progress': 'review', 'review': 'done', 'done': 'todo'
  }
  const priority = priorityConfig[task.priority]

  return (
    <div
      className='group relative bg-gradient-to-b from-[#1a1f2e] to-[#0f1117] border border-[#262d3d] rounded-lg p-2.5 cursor-grab active:cursor-grabbing hover:border-[#6366f1]/40 transition-all hover:-translate-y-0.5 hover:shadow-lg hover:shadow-[#6366f1]/5 animate-fade-in'
    >
      <div className='flex items-start justify-between mb-1.5 gap-1.5'>
        <div className='flex items-start gap-1.5 flex-1 min-w-0'>
          <span className={'shrink-0 w-1.5 h-1.5 rounded-full mt-1.5 ' + priority.bg} />
          <h4 className='text-xs font-medium text-[#e2e6ef] leading-snug'>{task.title}</h4>
        </div>
        <div className='flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0'>
          <Tooltip content='编辑'>
            <button onClick={(e) => { e.stopPropagation(); onEdit(task) }} className='p-1 rounded text-[#5c6478] hover:text-[#a5b4fc] hover:bg-[#6366f1]/10'>
              <Edit3 size={10} />
            </button>
          </Tooltip>
          <Tooltip content='删除'>
            <button onClick={(e) => { e.stopPropagation(); onDelete(task.id) }} className='p-1 rounded text-[#5c6478] hover:text-[#ef4444] hover:bg-[#ef4444]/10'>
              <Trash2 size={10} />
            </button>
          </Tooltip>
        </div>
      </div>

      {task.description && <p className='text-[10px] text-[#5c6478] mb-2 line-clamp-2 leading-relaxed pl-3'>{task.description}</p>}

      {task.tags.length > 0 && (
        <div className='flex gap-1 flex-wrap mb-1.5 pl-3'>
          {task.tags.slice(0, 3).map(tag => (
            <span key={tag} className='text-[9px] px-1.5 py-px rounded bg-[#6366f1]/10 text-[#a5b4fc] border border-[#6366f1]/20'>{tag}</span>
          ))}
          {task.tags.length > 3 && <span className='text-[9px] text-[#3f4758]'>+{task.tags.length - 3}</span>}
        </div>
      )}

      <div className='flex items-center justify-between mt-2 pt-2 border-t border-[#262d3d]/40'>
        <div className='flex items-center gap-1.5 min-w-0'>
          {assigneeAgent ? (
            <div className='flex items-center gap-1 text-[9px] text-[#a0a8ba]'>
              <div
                className='w-3.5 h-3.5 rounded-sm flex items-center justify-center text-[7px] font-bold'
                style={{ background: assigneeAgent.color + '20', color: assigneeAgent.color, border: '1px solid ' + assigneeAgent.color + '30' }}
              >
                {assigneeAgent.name.charAt(0)}
              </div>
              <span className='truncate max-w-[80px]'>{assigneeAgent.name}</span>
            </div>
          ) : (
            <span className='text-[9px] text-[#3f4758] flex items-center gap-1'><User size={8} />未指派</span>
          )}
        </div>
        {task.status !== 'done' && (
          <Tooltip content={'移到 ' + (COLUMNS.find(c => c.id === nextStatus[task.status])?.title || '')}>
            <button
              onClick={(e) => { e.stopPropagation(); onStatusChange(task.id, nextStatus[task.status]) }}
              className='opacity-0 group-hover:opacity-100 p-1 rounded text-[#5c6478] hover:text-[#a5b4fc] hover:bg-[#6366f1]/10 transition-all'
            >
              <MoveRight size={11} />
            </button>
          </Tooltip>
        )}
      </div>
    </div>
  )
}

interface TaskBoardProps {
  tasks: Task[]
  onAddTask: () => void
  onAddTaskWithData: (data: Omit<Task, 'id' | 'createdAt'>) => void
  onUpdateTask: (task: Task) => void
  onStatusChange: (id: string, newStatus: Task['status']) => void
  onDeleteTask: (id: string) => void
}

export function TaskBoard({ tasks, onAddTask, onAddTaskWithData, onUpdateTask, onStatusChange, onDeleteTask }: TaskBoardProps) {
  const { agents } = useAgentStore()
  const [search, setSearch] = useState('')
  const [filterPriority, setFilterPriority] = useState<'all' | Task['priority']>('all')
  const [editingTask, setEditingTask] = useState<Task | null>(null)
  const [showEditor, setShowEditor] = useState(false)
  const [dragging, setDragging] = useState<{ id: string; from: Task['status'] } | null>(null)
  const [dragOver, setDragOver] = useState<Task['status'] | null>(null)

  const filteredTasks = useMemo(() => {
    let out = tasks
    if (search.trim()) {
      const q = search.toLowerCase()
      out = out.filter(t => t.title.toLowerCase().includes(q) || t.description.toLowerCase().includes(q) || t.tags.some(tag => tag.toLowerCase().includes(q)))
    }
    if (filterPriority !== 'all') {
      out = out.filter(t => t.priority === filterPriority)
    }
    return out
  }, [tasks, search, filterPriority])

  const stats = useMemo(() => ({
    total: tasks.length,
    todo: tasks.filter(t => t.status === 'todo').length,
    progress: tasks.filter(t => t.status === 'in-progress').length,
    review: tasks.filter(t => t.status === 'review').length,
    done: tasks.filter(t => t.status === 'done').length,
    high: tasks.filter(t => t.priority === 'high' && t.status !== 'done').length
  }), [tasks])

  const openEditor = (task: Task | null) => {
    setEditingTask(task)
    setShowEditor(true)
  }

  const handleSave = (data: Omit<Task, 'id' | 'createdAt'>) => {
    if (editingTask) {
      const updated: Task = { ...editingTask, ...data }
      onUpdateTask(updated)
    } else {
      onAddTaskWithData(data)
    }
    setShowEditor(false)
  }

  const onDragStart = (e: React.DragEvent, task: Task) => {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', task.id)
    setDragging({ id: task.id, from: task.status })
  }

  const onDragEnd = () => { setDragging(null); setDragOver(null) }

  const onColumnDragOver = (e: React.DragEvent, status: Task['status']) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOver(status)
  }

  const onColumnDrop = (e: React.DragEvent, status: Task['status']) => {
    e.preventDefault()
    const id = e.dataTransfer.getData('text/plain')
    if (id) onStatusChange(id, status)
    setDragging(null)
    setDragOver(null)
  }

  return (
    <>
      <div className='flex-1 flex flex-col overflow-hidden bg-aurora-soft'>
        <div className='flex items-center gap-2 px-4 py-2.5 border-b border-[#1a1f2e] bg-[#0a0c12]/50 backdrop-blur-sm'>
          <ListTodo size={14} className='text-[#6366f1]' />
          <h2 className='text-sm font-semibold text-[#e2e6ef]'>任务看板</h2>
          <div className='flex items-center gap-1.5 ml-3 text-[10px]'>
            <span className='px-1.5 py-0.5 rounded bg-[#1a1f2e] text-[#a0a8ba]'>{stats.total} 总</span>
            {stats.high > 0 && <span className='px-1.5 py-0.5 rounded bg-[#ef4444]/10 text-[#f87171] border border-[#ef4444]/30'>{stats.high} 高优</span>}
            {stats.done > 0 && <span className='px-1.5 py-0.5 rounded bg-[#22c55e]/10 text-[#4ade80] border border-[#22c55e]/30'>{stats.done} 完成</span>}
          </div>
          <div className='ml-auto flex items-center gap-2'>
            <div className='relative'>
              <Search size={11} className='absolute left-2 top-1/2 -translate-y-1/2 text-[#3f4758] pointer-events-none' />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder='搜索任务…'
                className='bg-[#0a0c12] text-[11px] text-[#e2e6ef] placeholder-[#3f4758] pl-7 pr-2 py-1.5 rounded-md border border-[#1a1f2e] outline-none focus:border-[#6366f1]/40 w-44 transition-all'
              />
            </div>
            <div className='flex gap-0.5 p-0.5 rounded-md bg-[#0a0c12] border border-[#1a1f2e]'>
              {(['all', 'high', 'medium', 'low'] as const).map(p => (
                <button
                  key={p}
                  onClick={() => setFilterPriority(p as any)}
                  className={[
                    'px-2 py-0.5 rounded text-[10px] font-medium transition-colors',
                    filterPriority === p
                      ? (p === 'all' ? 'bg-[#6366f1]/20 text-[#a5b4fc]' : priorityConfig[p].bg + ' ' + priorityConfig[p].color)
                      : 'text-[#5c6478] hover:text-[#a0a8ba]'
                  ].join(' ')}
                >
                  {p === 'all' ? '全部' : priorityConfig[p].label}
                </button>
              ))}
            </div>
            <button
              onClick={() => openEditor(null)}
              className='flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[11px] font-medium gradient-accent text-white shadow-md shadow-[#6366f1]/20 hover:brightness-110 transition-all'
            >
              <Plus size={11} />
              新建任务
            </button>
          </div>
        </div>

        <div className='flex-1 flex gap-3 p-4 overflow-x-auto'>
          {COLUMNS.map(col => {
            const colTasks = filteredTasks.filter(t => t.status === col.id)
            return (
              <div
                key={col.id}
                onDragOver={(e) => onColumnDragOver(e, col.id)}
                onDrop={(e) => onColumnDrop(e, col.id)}
                onDragLeave={() => setDragOver(null)}
                className={['flex-1 min-w-[220px] max-w-[320px] flex flex-col', dragOver === col.id ? 'animate-glow' : ''].join(' ')}
              >
                <div className='flex items-center gap-2 mb-2.5 px-0.5'>
                  <div className='w-2 h-2 rounded-full' style={{ background: col.color, boxShadow: '0 0 8px ' + col.color + '60' }} />
                  <span className='text-[11px] font-semibold text-[#e2e6ef]'>{col.title}</span>
                  <span className='text-[10px] text-[#5c6478] bg-[#1a1f2e] px-1.5 py-0.5 rounded'>{colTasks.length}</span>
                  <span className='text-[9px] text-[#3f4758] ml-auto'>{col.description}</span>
                </div>
                <div className={[
                  'flex-1 space-y-1.5 overflow-y-auto p-1.5 rounded-xl border-2 border-dashed transition-colors min-h-[200px]',
                  dragOver === col.id ? 'border-[#6366f1] bg-[#6366f1]/5' : 'border-transparent'
                ].join(' ')}>
                  {colTasks.map(task => (
                    <div
                      key={task.id}
                      draggable
                      onDragStart={(e) => onDragStart(e, task)}
                      onDragEnd={onDragEnd}
                      className={dragging?.id === task.id ? 'dragging' : ''}
                    >
                      <TaskCard
                        task={task}
                        agents={agents}
                        onStatusChange={onStatusChange}
                        onDelete={onDeleteTask}
                        onEdit={openEditor}
                      />
                    </div>
                  ))}
                  {col.id === 'todo' && (
                    <button
                      onClick={() => openEditor(null)}
                      className='w-full flex items-center justify-center gap-1 py-2 rounded-lg border border-dashed border-[#262d3d] text-[#5c6478] hover:text-[#a5b4fc] hover:border-[#6366f1]/40 transition-all text-[11px] hover:bg-[#6366f1]/5'
                    >
                      <Plus size={12} /> 添加任务
                    </button>
                  )}
                  {colTasks.length === 0 && col.id !== 'todo' && (
                    <div className='flex flex-col items-center justify-center h-[80px] text-[10px] text-[#3f4758] gap-1'>
                      <Clock size={14} />
                      <span>暂无任务</span>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {tasks.length === 0 && (
          <div className='absolute inset-0 flex items-center justify-center pointer-events-none'>
            <EmptyState
              icon={<ListTodo size={28} />}
              title='开始规划你的工作'
              description='将任务拖到不同的列来跟踪进度,或点击右上角新建第一个任务。'
              className='pointer-events-auto'
            />
          </div>
        )}
      </div>

      <TaskEditor
        open={showEditor}
        task={editingTask}
        onClose={() => { setShowEditor(false); setEditingTask(null) }}
        onSave={handleSave}
      />
    </>
  )
}
