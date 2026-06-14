import { useHubState } from "./api";
import { Header } from "./components/Header";
import { ContractCard } from "./components/ContractCard";
import { AgentsCard } from "./components/AgentsCard";
import { ConflictsCard } from "./components/ConflictsCard";
import { IntentsCard } from "./components/IntentsCard";
import { ActivityCard } from "./components/ActivityCard";
import { MissionCanvas } from "./components/MissionCanvas";
import { ConsoleHome } from "./components/ConsoleHome";

// 控制台即主体：ConsoleHome 自带 Agent 花名册（左）+ 命令框 + 时间线/并行栏 + 经典视图抽屉。
// 旧的第二套左导航 AppSidebar 已移除（与花名册重复）；详细治理信息收进底部可折叠面板。
export function App() {
  const {
    agents,
    tasks,
    locks,
    messages,
    intents,
    conflicts,
    contract,
    missions,
    workers,
    workspace,
    connected,
    connectInfo,
    actions,
  } = useHubState();
  const openConflicts = conflicts.filter((c) => c.status === "open").length;

  return (
    <div className="app-shell">
      <div className="app-content">
        <Header agents={agents} connected={connected} conflicts={openConflicts} />

        <main className="app-main">
          <ConsoleHome
            agents={agents}
            tasks={tasks}
            locks={locks}
            messages={messages}
            conflicts={conflicts}
            contract={contract}
            missions={missions}
            workers={workers}
            workspace={workspace}
            connected={connected}
            connectInfo={connectInfo}
            actions={actions}
          />

          <details className="advanced-panel">
            <summary>可选高级信息：详细约定、冲突、动态和可视化</summary>
            <div className="advanced-grid">
              <div className="min-h-[280px]">
                <MissionCanvas agents={agents} messages={messages} />
              </div>
              <div className="min-h-[280px]">
                <ContractCard contract={contract} agents={agents} actions={actions} />
              </div>
              <div className="min-h-[260px]">
                <AgentsCard agents={agents} actions={actions} />
              </div>
              <div className="min-h-[260px]">
                <IntentsCard intents={intents} agents={agents} />
              </div>
              <div className="min-h-[260px]">
                <ConflictsCard conflicts={conflicts} intents={intents} agents={agents} actions={actions} />
              </div>
              <div className="min-h-[260px]">
                <ActivityCard messages={messages} agents={agents} actions={actions} />
              </div>
            </div>
          </details>
        </main>
      </div>
    </div>
  );
}
