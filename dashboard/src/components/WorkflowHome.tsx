import { useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Bot,
  Check,
  CheckCircle2,
  CircleDot,
  ClipboardList,
  Copy,
  FileLock2,
  FileText,
  Loader2,
  MessageSquare,
  PlugZap,
  Settings,
  Terminal,
} from "lucide-react";
import type { HubActions } from "../api";
import type { Agent, Conflict, ConnectInfo, Contract, FileLock, Message, Mission, Task, Worker, WorkerStatus } from "../types";
import { isOperator, timeAgo } from "../util";
import { MissionPlanner } from "./MissionPlanner";

const STATUS_LABEL: Record<Task["status"], string> = {
  todo: "待认领",
  claimed: "已领取",
  in_progress: "进行中",
  done: "已完成",
};

const STATUS_CLASS: Record<Task["status"], string> = {
  todo: "neutral",
  claimed: "warning",
  in_progress: "info",
  done: "success",
};

const WORKER_LABEL: Record<WorkerStatus, string> = {
  starting: "启动中",
  running: "执行中",
  done: "已完成",
  failed: "失败",
};

const WORKER_TONE: Record<WorkerStatus, string> = {
  starting: "neutral",
  running: "info",
  done: "success",
  failed: "danger",
};

function agentDisplayName(agent: Agent, index: number): string {
  if (agent.role) return `${agent.role}助手`;
  if (agent.harness === "codex") return "前端助手";
  if (agent.harness === "claude-code") return "后端助手";
  if (agent.harness === "gemini") return "测试助手";
  return `智能体 ${index + 1}`;
}

function shortPath(path: string): string {
  const parts = path.split("/");
  return parts.length > 3 ? `…/${parts.slice(-3).join("/")}` : path;
}

async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

function CopyCommand({ title, description, value }: { title: string; description: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await copyText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1300);
  };

  return (
    <div className="command-box">
      <div className="command-head">
        <span>
          <Terminal size={15} />
          {title}
        </span>
        <button className="btn btn-small" type="button" onClick={() => void copy()}>
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? "已复制" : "复制"}
        </button>
      </div>
      <p>{description}</p>
      <pre>{value}</pre>
    </div>
  );
}

function ConnectionGuide({
  agents,
  connectInfo,
  actions,
}: {
  agents: Agent[];
  connectInfo: ConnectInfo | null;
  actions: HubActions;
}) {
  const [installing, setInstalling] = useState(false);
  const [installedPath, setInstalledPath] = useState("");
  const [copiedCodex, setCopiedCodex] = useState(false);
  const peers = agents.filter((agent) => !isOperator(agent));
  const online = peers.filter((agent) => agent.status === "online");
  const claudeOnline = peers.some((agent) => agent.harness === "claude-code" && agent.status === "online");
  const codexOnline = peers.some((agent) => agent.harness === "codex" && agent.status === "online");

  const installCodex = async () => {
    setInstalling(true);
    try {
      const result = await actions.installCodexConfig();
      setInstalledPath(result.path);
    } finally {
      setInstalling(false);
    }
  };

  const copyCodex = async () => {
    if (!connectInfo) return;
    await copyText(connectInfo.codexToml);
    setCopiedCodex(true);
    setTimeout(() => setCopiedCodex(false), 1300);
  };

  return (
    <section className="panel-card connect-guide" id="connect-agents">
      <div className="panel-head">
        <div>
          <h2>先连接智能体</h2>
          <p>这个软件是协作枢纽，不会自动控制 Claude Code 和 Codex。你需要让两个智能体通过 MCP 接入这里。</p>
        </div>
        <span className={online.length >= 2 ? "mini-badge success" : "mini-badge warning"}>
          已在线 {online.length}/{Math.max(peers.length, 2)}
        </span>
      </div>

      <div className="connection-status-row">
        <div className={claudeOnline ? "agent-connect-status online" : "agent-connect-status"}>
          <Bot size={17} />
          <div>
            <b>Claude Code</b>
            <span>{claudeOnline ? "已接入，可以接收任务" : "未接入，需要在 Claude Code 里执行连接命令"}</span>
          </div>
        </div>
        <div className={codexOnline ? "agent-connect-status online" : "agent-connect-status"}>
          <Bot size={17} />
          <div>
            <b>Codex</b>
            <span>{codexOnline ? "已接入，可以接收任务" : "未接入，需要写入 Codex MCP 配置并重启会话"}</span>
          </div>
        </div>
      </div>

      {connectInfo ? (
        <div className="connect-grid">
          <CopyCommand
            title="连接 Claude Code"
            description="在 Claude Code 项目目录里运行这条命令，然后重启/继续 Claude Code 会话。"
            value={connectInfo.claudeCommand}
          />
          <div className="command-box">
            <div className="command-head">
              <span>
                <Settings size={15} />
                连接 Codex
              </span>
              <div className="command-actions">
                <button className="btn btn-small" type="button" onClick={() => void installCodex()}>
                  <Settings size={14} />
                  {installing ? "写入中" : "一键写入"}
                </button>
                <button className="btn btn-small" type="button" onClick={() => void copyCodex()}>
                  {copiedCodex ? <Check size={14} /> : <Copy size={14} />}
                  {copiedCodex ? "已复制" : "复制配置"}
                </button>
              </div>
            </div>
            <p>推荐点击“一键写入”，然后重启 Codex 线程或让 Codex 重新读取配置。</p>
            {installedPath && <div className="installed-line">已写入：{installedPath}</div>}
            <pre>{connectInfo.codexToml}</pre>
          </div>
        </div>
      ) : (
        <div className="empty-soft">正在读取连接信息。如果一直为空，请确认 Hub 服务仍在运行。</div>
      )}

      <div className="connect-next">
        <PlugZap size={16} />
        <span>连接成功后，回到 Claude Code 和 Codex 各自会话，让它们调用 Orbit 工具，例如：先调用 `whoami`，再调用 `list_tasks`。</span>
      </div>
    </section>
  );
}

function SummaryCard({
  icon,
  title,
  value,
  detail,
  tone,
}: {
  icon: ReactNode;
  title: string;
  value: number;
  detail: string;
  tone: "blue" | "green" | "amber" | "red";
}) {
  return (
    <section className="summary-card">
      <span className={`summary-icon ${tone}`}>{icon}</span>
      <div>
        <span>{title}</span>
        <b>{value}</b>
        <p>{detail}</p>
      </div>
    </section>
  );
}

export function WorkflowHome({
  agents,
  tasks,
  locks,
  messages,
  conflicts,
  contract,
  missions,
  workers,
  connected,
  connectInfo,
  actions,
}: {
  agents: Agent[];
  tasks: Task[];
  locks: FileLock[];
  messages: Message[];
  conflicts: Conflict[];
  contract: Contract;
  missions: Mission[];
  workers: Worker[];
  connected: boolean;
  connectInfo: ConnectInfo | null;
  actions: HubActions;
}) {
  /* goal/projectPath/launching/error state moved to MissionPlanner */
  const peers = agents.filter((agent) => !isOperator(agent));
  const onlineAgents = peers.filter((agent) => agent.status === "online");
  const activeTasks = tasks.filter((task) => task.status !== "done");
  const visibleTasks = tasks.slice().sort((a, b) => b.updatedAt - a.updatedAt);
  const agentLabels = new Map(peers.map((agent, index) => [agent.id, agentDisplayName(agent, index)]));
  const agentById = new Map(agents.map((agent) => [agent.id, agent]));
  const openConflicts = conflicts.filter((conflict) => conflict.status === "open");
  const noAgentConnected = connected && peers.length === 0;
  const allAgentsOffline = connected && peers.length > 0 && onlineAgents.length === 0;
  const offlineAssignedTasks = activeTasks.filter((task) => {
    const assignee = task.assignee ? agentById.get(task.assignee) : null;
    return assignee?.status === "offline";
  });

  const recentEvents = useMemo(() => {
    const taskEvents = tasks.map((task) => ({
      id: `task-${task.id}`,
      ts: task.updatedAt,
      icon: <ClipboardList size={15} />,
      title: `任务「${task.title}」${STATUS_LABEL[task.status]}`,
      detail: `${task.assignee ? (agentLabels.get(task.assignee) ?? "负责人") : "未分配"} · ${timeAgo(task.updatedAt)}`,
    }));
    const messageEvents = messages.slice(-4).map((message) => ({
      id: `message-${message.id}`,
      ts: message.ts,
      icon: <MessageSquare size={15} />,
      title: "收到新消息",
      detail: `${timeAgo(message.ts)} · ${message.content.slice(0, 32)}`,
    }));
    return [...taskEvents, ...messageEvents]
      .sort((a, b) => b.ts - a.ts)
      .slice(0, 5);
  }, [agentLabels, messages, tasks]);

  return (
    <div className="workspace-home">
      <ConnectionGuide agents={agents} connectInfo={connectInfo} actions={actions} />

      <MissionPlanner agents={agents} connected={connected} actions={actions} />

      <section className="summary-grid" aria-label="关键状态">
        <SummaryCard
          icon={<Bot size={20} />}
          title="在线智能体"
          value={onlineAgents.length}
          detail={`共 ${peers.length} 个智能体`}
          tone="blue"
        />
        <SummaryCard
          icon={<ClipboardList size={20} />}
          title="未完成任务"
          value={activeTasks.length}
          detail={`其中 ${tasks.filter((task) => task.status === "in_progress").length} 个正在处理`}
          tone="green"
        />
        <SummaryCard icon={<FileLock2 size={20} />} title="文件锁定" value={locks.length} detail="避免多人改同一文件" tone="amber" />
        <SummaryCard
          icon={<AlertTriangle size={20} />}
          title="待处理冲突"
          value={openConflicts.length}
          detail={openConflicts.length > 0 ? "需要先裁决" : "暂无明显风险"}
          tone="red"
        />
      </section>

      {workers.length > 0 && (
        <section className="panel-card worker-panel">
          <div className="panel-head">
            <div>
              <h2>自动执行</h2>
              <p>枢纽已在本地拉起 Claude Code 去做这些任务，进度实时回流到这里。</p>
            </div>
            <span className="mini-badge">
              {workers.filter((w) => w.status === "running" || w.status === "starting").length} 个进行中
            </span>
          </div>
          <div className="worker-list">
            {workers.slice(0, 5).map((worker) => (
              <div key={worker.id} className={`worker-row ${worker.status}`}>
                <span className="worker-icon">
                  {worker.status === "done" ? (
                    <CheckCircle2 size={17} />
                  ) : worker.status === "failed" ? (
                    <AlertTriangle size={17} />
                  ) : (
                    <Loader2 size={17} className="spin" />
                  )}
                </span>
                <div className="worker-main">
                  <b>{worker.taskTitle}</b>
                  <small>{worker.status === "failed" ? worker.error : worker.lastActivity}</small>
                </div>
                <div className="worker-meta">
                  {worker.costUsd > 0 && <span className="worker-cost">${worker.costUsd.toFixed(2)}</span>}
                  <span className={`state-badge ${WORKER_TONE[worker.status]}`}>{WORKER_LABEL[worker.status]}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="home-grid">
        <section className="panel-card overview-panel">
          <div className="panel-head">
            <div>
              <h2>协作概览</h2>
              <p>观察智能体是否在线，避免任务分给不可用的人。</p>
            </div>
            <span className={connected ? "mini-badge success" : "mini-badge danger"}>{connected ? "已连接" : "未连接"}</span>
          </div>
          <div className="agent-overview">
            <div className="agent-hub">
              <CircleDot size={22} />
              <b>协作中心</b>
            </div>
            <div className="agent-list">
              {peers.length === 0 ? (
                <div className="empty-soft">还没有智能体接入。连接后这里会显示在线状态。</div>
              ) : (
                peers.slice(0, 4).map((agent, index) => (
                  <div key={agent.id} className="agent-pill">
                    <span className={agent.status === "online" ? "status-dot online" : "status-dot"} />
                    <div>
                      <b>{agentDisplayName(agent, index)}</b>
                      <small>{agent.status === "online" ? "在线" : "离线"}</small>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>

        <section className="panel-card attention-panel" id="risk-panel">
          <div className="panel-head">
            <div>
              <h2>需要关注</h2>
              <p>这里优先显示可能拖慢效率或造成错误的情况。</p>
            </div>
          </div>
          <div className="attention-list">
            {openConflicts.length === 0 &&
            offlineAssignedTasks.length === 0 &&
            locks.length === 0 &&
            !noAgentConnected &&
            !allAgentsOffline ? (
              <div className="empty-soft success">当前没有明显风险，可以继续推进。</div>
            ) : (
              <>
                {noAgentConnected && (
                  <div className="attention-row warning">
                    <Bot size={16} />
                    <div>
                      <b>还没有智能体接入</b>
                      <span>先连接智能体，否则任务无法自动分配。</span>
                    </div>
                  </div>
                )}
                {allAgentsOffline && (
                  <div className="attention-row warning">
                    <Bot size={16} />
                    <div>
                      <b>智能体全部离线</b>
                      <span>先恢复连接，再启动或继续任务。</span>
                    </div>
                  </div>
                )}
                {openConflicts.slice(0, 3).map((conflict) => (
                  <div key={conflict.id} className="attention-row danger">
                    <AlertTriangle size={16} />
                    <div>
                      <b>{conflict.kind === "file" ? "文件冲突" : "约定冲突"}</b>
                      <span>{conflict.resource}</span>
                    </div>
                  </div>
                ))}
                {offlineAssignedTasks.slice(0, 2).map((task) => (
                  <div key={task.id} className="attention-row warning">
                    <Bot size={16} />
                    <div>
                      <b>负责人离线</b>
                      <span>{task.title}</span>
                    </div>
                  </div>
                ))}
                {locks.slice(0, 2).map((lock) => (
                  <div key={lock.path} className="attention-row">
                    <FileLock2 size={16} />
                    <div>
                      <b>文件正在锁定</b>
                      <span>
                        {shortPath(lock.path)} · {agentLabels.get(lock.holder) ?? "智能体"}
                      </span>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        </section>
      </section>

      <section className="home-grid lower">
        <section className="panel-card task-panel" id="task-board">
          <div className="panel-head">
            <div>
              <h2>任务列表</h2>
              <p>按更新时间排序，最新的在最前；列表过长时可在框内滚动。</p>
            </div>
            <span className="mini-badge">{tasks.length} 个任务</span>
          </div>
          <div className="simple-table-wrap">
            <table className="simple-table">
              <thead>
                <tr>
                  <th>当前任务</th>
                  <th>负责人</th>
                  <th>状态</th>
                  <th>更新时间</th>
                </tr>
              </thead>
              <tbody>
                {visibleTasks.length === 0 ? (
                  <tr>
                    <td colSpan={4}>
                      <div className="empty-soft">还没有任务。输入目标后点击“启动任务”。</div>
                    </td>
                  </tr>
                ) : (
                  visibleTasks.map((task) => (
                    <tr key={task.id}>
                      <td>
                        <div className="task-title">
                          <span>{task.title}</span>
                          {task.files.length > 0 && <small>{task.files.length} 个文件</small>}
                        </div>
                      </td>
                      <td>{task.assignee ? (agentLabels.get(task.assignee) ?? "智能体") : "未分配"}</td>
                      <td>
                        <span className={`state-badge ${STATUS_CLASS[task.status]}`}>{STATUS_LABEL[task.status]}</span>
                      </td>
                      <td>{timeAgo(task.updatedAt)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="side-stack">
          <section className="panel-card">
            <div className="panel-head compact">
              <h2>最近动态</h2>
            </div>
            <div className="activity-list">
              {recentEvents.length === 0 ? (
                <div className="empty-soft">暂无动态。</div>
              ) : (
                recentEvents.map((event) => (
                  <div key={event.id} className="activity-row">
                    <span>{event.icon}</span>
                    <div>
                      <b>{event.title}</b>
                      <small>{event.detail}</small>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="panel-card" id="contract-panel">
            <div className="panel-head compact">
              <h2>共享约定</h2>
              <span className="mini-badge">v{contract.version}</span>
            </div>
            <div className="contract-summary">
              <FileText size={18} />
              <div>
                <b>{contract.version > 0 ? "约定已更新" : "暂无共享约定"}</b>
                <p>
                  {contract.version > 0
                    ? `最近更新于 ${timeAgo(contract.updatedAt)}，用于减少接口和设计不一致。`
                    : "建议在多人并行前先写清接口和设计边界。"}
                </p>
              </div>
            </div>
            {contract.apiContract && <pre>{contract.apiContract.slice(0, 160)}</pre>}
          </section>
        </aside>
      </section>

      <section className="principle-strip">
        <CheckCircle2 size={16} />
        首页只展示会影响协作效率的信息；详细消息、动画和完整约定已收进下方高级信息。
      </section>
    </div>
  );
}
