import type { ReplyState } from "./meta"
import type { OrchestrateState, OrchestrateSubtask } from "./orchestrate-view"

export type TranscriptReply = Pick<ReplyState, "agentId" | "thinking" | "text" | "done" | "cancelled" | "error">

const NOISE_LINE_RE =
  /^(starting|started|connecting|connected|loading|initializing|initialized|thinking|reasoning|processing|running|dispatching|routing|calling|using tool|tool call|准备|启动|连接|正在思考|思考中|分析中|处理中|执行中|开始执行|路由|调用工具|分解任务|汇总中)(\b|[：:.\s])/i

export function curateAgentReply(text: string): string {
  const withoutThinkingBlocks = String(text || "")
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")

  const lines = withoutThinkingBlocks
    .split(/\r?\n/)
    .map(line => line.trimEnd())
    .filter(line => line.trim().length > 0)

  const useful = lines.filter(line => !NOISE_LINE_RE.test(line.trim()))
  return (useful.length ? useful : lines).join("\n").trim()
}

export function visibleSequentialReplies<T extends TranscriptReply>(replies: T[]): T[] {
  const visible: T[] = []
  for (const reply of replies) {
    visible.push(reply)
    if (!reply.done) break
  }
  return visible
}

function subtaskReply(subtask: OrchestrateSubtask): TranscriptReply {
  return {
    agentId: subtask.agentId || "orchestrate",
    thinking: subtask.status === "running" || subtask.status === "pending" ? subtask.detail || subtask.title : "",
    text: subtask.status === "error"
      ? subtask.verdict?.note || subtask.content || subtask.title
      : curateAgentReply(subtask.content || ""),
    done: subtask.status === "done" || subtask.status === "error",
    error: subtask.status === "error" ? (subtask.verdict?.note || subtask.content || subtask.title) : undefined
  }
}

export function orchestrationReplies(state: OrchestrateState): TranscriptReply[] {
  if (state.error) {
    return [{ agentId: state.leadAgentId || "orchestrate", thinking: "", text: "", done: true, error: state.error }]
  }

  const subtasks = visibleSequentialReplies(state.subtasks.map(subtaskReply))

  if (state.final) {
    return [
      ...subtasks,
      {
        agentId: state.leadAgentId || "orchestrate",
        thinking: "",
        text: curateAgentReply(state.final),
        done: true
      }
    ]
  }

  if (subtasks.length > 0) return subtasks

  return [{
    agentId: state.leadAgentId || "orchestrate",
    thinking: state.phase === "synthesizing" ? "synthesizing" : "planning",
    text: "",
    done: false
  }]
}
