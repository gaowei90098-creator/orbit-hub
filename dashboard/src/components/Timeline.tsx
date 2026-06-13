import {
  AlertTriangle,
  Bot,
  ClipboardList,
  FileText,
  MessageSquare,
  Rocket,
  type LucideIcon,
} from "lucide-react";
import type { TimelineEvent } from "../lib/timeline";
import { timeAgo } from "../util";

const ICONS: Record<string, LucideIcon> = {
  "clipboard-list": ClipboardList,
  "message-square": MessageSquare,
  bot: Bot,
  "file-text": FileText,
  "alert-triangle": AlertTriangle,
  rocket: Rocket,
};

// 统一时间线：所有来源（任务/消息/worker/契约/冲突/mission）的事件按时间序铺成一条流。
export function Timeline({ events }: { events: TimelineEvent[] }) {
  if (events.length === 0) {
    return <div className="empty-soft">还没有动态。在下方输入目标启动协作，或 @某个 Agent 发消息。</div>;
  }
  return (
    <ol className="timeline">
      {events.map((event) => {
        const Icon = ICONS[event.icon] ?? ClipboardList;
        return (
          <li key={event.id} className={`timeline-row tone-${event.tone}`}>
            <span className="timeline-time">{timeAgo(event.ts)}</span>
            <span className={`timeline-icon tone-${event.tone}`}>
              <Icon size={15} />
            </span>
            <div className="timeline-body">
              <b>{event.title}</b>
              {event.detail && <span>{event.detail}</span>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
