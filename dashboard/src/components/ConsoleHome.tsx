import { useEffect, useMemo, useRef, useState } from "react";
import { ListTree, Columns2, Settings2 } from "lucide-react";
import type { HubActions } from "../api";
import type {
  Agent,
  Conflict,
  ConnectInfo,
  Contract,
  FileLock,
  Message,
  Mission,
  Task,
  Worker,
} from "../types";
import { buildTimeline, detectDecisions } from "../lib/timeline";
import { AgentSidebar } from "./AgentSidebar";
import { CommandInput } from "./CommandInput";
import { DecisionStrip } from "./DecisionStrip";
import { Timeline } from "./Timeline";
import { WorkerColumns } from "./WorkerColumns";
import { WorkflowHome } from "./WorkflowHome";

interface ConsoleHomeProps {
  agents: Agent[];
  tasks: Task[];
  locks: FileLock[];
  messages: Message[];
  conflicts: Conflict[];
  contract: Contract;
  missions: Mission[];
  workers: Worker[];
  workspace: string | null;
  connected: boolean;
  connectInfo: ConnectInfo | null;
  actions: HubActions;
}

type View = "timeline" | "columns";

// M1 统一控制台：左侧 Agent 名册，中间决策卡 + 时间线/并行栏，底部统一命令框。
// 现有整页 WorkflowHome（连接/工作区/拆分/集成/全部面板）原样收进底部「设置与经典视图」，功能零丢失。
export function ConsoleHome(props: ConsoleHomeProps) {
  const { agents, tasks, messages, workers, conflicts, contract, missions, locks, workspace, actions } = props;
  const [view, setView] = useState<View>("timeline");
  const [setupOpen, setSetupOpen] = useState(false);
  const setupRef = useRef<HTMLDetailsElement>(null);
  // SSE 静默时停滞判断需要本地时钟驱动。
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const timelineInput = useMemo(
    () => ({ tasks, messages, workers, conflicts, contract, missions, agents, locks, now }),
    [tasks, messages, workers, conflicts, contract, missions, agents, locks, now],
  );
  const events = useMemo(() => buildTimeline(timelineInput), [timelineInput]);
  const decisions = useMemo(() => detectDecisions(timelineInput), [timelineInput]);

  const activeWorkers = workers.filter(
    (w) => w.status === "starting" || w.status === "running" || w.status === "waiting_for_input",
  );
  const columnWorkers = activeWorkers.length > 0 ? activeWorkers : workers.slice(-4);
  const latestMission = missions.length > 0 ? missions[missions.length - 1] : null;

  const openSetup = () => {
    setSetupOpen(true);
    requestAnimationFrame(() => setupRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  return (
    <div className="console-shell">
      <AgentSidebar agents={agents} onConnect={openSetup} />

      <div className="console-main">
        <div className="console-main-head">
          <div className="console-mission">
            <b>{latestMission ? latestMission.goal : "协作控制台"}</b>
            {latestMission?.state && <span className="mini-badge">{latestMission.state}</span>}
          </div>
          <div className="console-view-tabs">
            <button
              type="button"
              className={view === "timeline" ? "active" : ""}
              onClick={() => setView("timeline")}
            >
              <ListTree size={14} />
              时间线
            </button>
            <button
              type="button"
              className={view === "columns" ? "active" : ""}
              onClick={() => setView("columns")}
            >
              <Columns2 size={14} />
              并行对比
            </button>
          </div>
        </div>

        <DecisionStrip decisions={decisions} actions={actions} onOpenSetup={openSetup} />

        <div className="console-content">
          {view === "timeline" ? (
            <Timeline events={events} />
          ) : columnWorkers.length > 0 ? (
            <WorkerColumns workers={columnWorkers} actions={actions} />
          ) : (
            <div className="empty-soft">还没有 worker 在执行。输入目标启动协作后，这里会并排显示各 Agent 的进度。</div>
          )}
        </div>

        <CommandInput agents={agents} workspace={workspace} actions={actions} />
      </div>

      <details className="console-setup" ref={setupRef} open={setupOpen}>
        <summary>
          <Settings2 size={15} />
          设置与经典视图：连接 Agent、工作区、拆分预览、任务板、集成审批
        </summary>
        <div className="console-setup-body">
          <WorkflowHome {...props} />
        </div>
      </details>
    </div>
  );
}
