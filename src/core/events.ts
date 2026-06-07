import { EventEmitter } from "node:events";
import type { HubEvent, HubEventType } from "./types.js";

// Thin typed wrapper over EventEmitter. The hub's SSE endpoint subscribes here
// and forwards every mutation to connected dashboards in real time.
export class EventBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    // Many SSE clients + internal listeners may attach; lift the default cap.
    this.emitter.setMaxListeners(0);
  }

  emit(type: HubEventType, payload: unknown): HubEvent {
    const event: HubEvent = { type, ts: Date.now(), payload };
    this.emitter.emit("event", event);
    return event;
  }

  subscribe(listener: (event: HubEvent) => void): () => void {
    this.emitter.on("event", listener);
    return () => this.emitter.off("event", listener);
  }
}
