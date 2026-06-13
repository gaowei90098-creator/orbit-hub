import { useState } from "react";
import { useHubState } from "./api";
import { Header } from "./components/Header";
import { ContractCard } from "./components/ContractCard";
import { AgentsCard } from "./components/AgentsCard";
import { ConflictsCard } from "./components/ConflictsCard";
import { IntentsCard } from "./components/IntentsCard";
import { ActivityCard } from "./components/ActivityCard";
import { MissionCanvas } from "./components/MissionCanvas";
import { ConsoleHome } from "./components/ConsoleHome";
import { ClipboardList, FileText, PlugZap, Rocket, ShieldAlert, TriangleAlert } from "lucide-react";

const navItems = [
  { label: "连接智能体", icon: PlugZap, href: "#connect-agents" },
  { label: "启动协作", icon: Rocket, href: "#launch-mission" },
  { label: "任务状态", icon: ClipboardList, href: "#task-board" },
  { label: "风险检查", icon: ShieldAlert, href: "#risk-panel" },
  { label: "共享约定", icon: FileText, href: "#contract-panel" },
];

function AppSidebar({
  openConflicts,
  open,
  activeHref,
  onNavigate,
}: {
  openConflicts: number;
  open: boolean;
  activeHref: string;
  onNavigate: (href: string) => void;
}) {
  return (
    <aside className={open ? "app-sidebar open" : "app-sidebar"}>
      <div className="sidebar-brand">
        <div className="sidebar-logo">协</div>
        <div>
          <b>协作枢纽</b>
          <span>本地工作区</span>
        </div>
      </div>

      <nav className="sidebar-nav" aria-label="主导航">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <a
              key={item.label}
              className={activeHref === item.href ? "sidebar-item active" : "sidebar-item"}
              href={item.href}
              onClick={() => onNavigate(item.href)}
            >
              <Icon size={17} />
              <span>{item.label}</span>
            </a>
          );
        })}
      </nav>

      <div className={openConflicts > 0 ? "sidebar-alert danger" : "sidebar-alert"}>
        <TriangleAlert size={15} />
        <div>
          <b>{openConflicts > 0 ? "有冲突待处理" : "当前无冲突"}</b>
          <span>{openConflicts > 0 ? "先处理冲突再继续合并" : "可以继续推进任务"}</span>
        </div>
      </div>

      <div className="sidebar-user">
        <div className="avatar">操</div>
        <div>
          <b>操作员</b>
          <span>系统管理员</span>
        </div>
      </div>
    </aside>
  );
}

export function App() {
  const { agents, tasks, locks, messages, intents, conflicts, contract, missions, workers, workspace, connected, connectInfo, actions } =
    useHubState();
  const openConflicts = conflicts.filter((c) => c.status === "open").length;
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeHref, setActiveHref] = useState(navItems[0].href);

  // 窄屏抽屉：点击导航后定位锚点并自动收起侧栏。
  const navigate = (href: string) => {
    setActiveHref(href);
    setSidebarOpen(false);
  };

  return (
    <div className="app-shell">
      <AppSidebar openConflicts={openConflicts} open={sidebarOpen} activeHref={activeHref} onNavigate={navigate} />
      {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}

      <div className="app-content">
        <Header
          agents={agents}
          connected={connected}
          conflicts={openConflicts}
          onToggleSidebar={() => setSidebarOpen((v) => !v)}
        />

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
