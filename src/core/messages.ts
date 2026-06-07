import type { Store } from "./store.js";
import type { EventBus } from "./events.js";
import type { Message, MessageTarget } from "./types.js";
import { newId } from "./id.js";

// Message bus: point-to-point and broadcast, with per-agent read tracking so each
// agent's inbox only returns messages it hasn't seen yet.
export class Messages {
  constructor(
    private readonly store: Store,
    private readonly events: EventBus,
  ) {}

  send(from: string, to: MessageTarget, content: string): Message {
    const message: Message = { id: newId("m"), from, to, content, ts: Date.now() };
    this.store.insertMessage(message);
    this.events.emit("message_sent", message);
    return message;
  }

  // Returns unread messages addressed to the agent (or broadcast) and marks them read.
  inbox(agentId: string): Message[] {
    const unread = this.store.unreadFor(agentId);
    if (unread.length > 0) {
      this.store.markRead(
        unread.map((m) => m.id),
        agentId,
        Date.now(),
      );
    }
    return unread;
  }

  recent(limit = 100): Message[] {
    return this.store.recentMessages(limit);
  }
}
