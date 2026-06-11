import { create } from 'zustand'
import type { Task } from '../components/TaskBoard'

interface TaskStore {
  tasks: Task[]
  showTaskBoard: boolean
  addTask: (task: Omit<Task, 'id' | 'createdAt'>) => void
  updateTask: (task: Task) => void
  updateTaskStatus: (id: string, status: Task['status']) => void
  deleteTask: (id: string) => void
  setShowTaskBoard: (show: boolean) => void
  loadTasks: () => void
  saveTasks: () => void
}

export const useTaskStore = create<TaskStore>((set, get) => ({
  tasks: [],
  showTaskBoard: false,

  addTask: (taskData) => {
    const task: Task = {
      ...taskData,
      id: 'task-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      createdAt: new Date()
    }
    set((s) => ({ tasks: [...s.tasks, task] }))
    setTimeout(() => get().saveTasks(), 0)
  },

  updateTask: (task) => {
    set((s) => ({ tasks: s.tasks.map(t => t.id === task.id ? task : t) }))
    setTimeout(() => get().saveTasks(), 0)
  },

  updateTaskStatus: (id, status) => {
    set((s) => ({
      tasks: s.tasks.map(t => t.id === id ? { ...t, status } : t)
    }))
    setTimeout(() => get().saveTasks(), 0)
  },

  deleteTask: (id) => {
    set((s) => ({ tasks: s.tasks.filter(t => t.id !== id) }))
    setTimeout(() => get().saveTasks(), 0)
  },

  setShowTaskBoard: (show) => set({ showTaskBoard: show }),

  loadTasks: () => {
    try {
      const raw = localStorage.getItem('agenthub-tasks')
      if (raw) {
        const data = JSON.parse(raw)
        set({ tasks: data.map((t: any) => ({ ...t, createdAt: new Date(t.createdAt) })) })
      }
    } catch (e) {}
  },

  saveTasks: () => {
    try {
      localStorage.setItem('agenthub-tasks', JSON.stringify(get().tasks))
    } catch (e) {}
  }
}))
export type { Task }