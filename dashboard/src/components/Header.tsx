import { Wifi, WifiOff } from "lucide-react";
import type { Agent } from "../types";
import { isOperator } from "../util";

export function Header({
  agents,
  connected,
  conflicts,
}: {
  agents: Agent[];
  connected: boolean;
  conflicts: number;
}) {
  const online = agents.filter((a) => !isOperator(a) && a.status === "online").length;
  return (
    <header className="top-header">
      <div className="top-left">
        <span className="top-breadcrumb">协作控制台</span>
      </div>

      <div className="top-actions">
        <span className={connected ? "status-pill connected" : "status-pill"}>
          {connected ? <Wifi size={14} /> : <WifiOff size={14} />}
          {connected ? "已连接" : "未连接"}
        </span>
        {conflicts > 0 && <span className="status-pill danger">{conflicts} 个冲突</span>}
        <span className="status-pill quiet">在线 {online}</span>
        <span className="operator-pill">
          <span>操</span>
          操作员
        </span>
      </div>
    </header>
  );
}
