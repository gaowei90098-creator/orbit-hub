import type { Store } from "./store.js";
import type { EventBus } from "./events.js";
import type { Note } from "./types.js";
import { newId } from "./id.js";

// Shared notes: an append-only log of decisions and API contracts both agents read,
// so cross-agent agreements ("the User type now has an email field") are durable.
export class Notes {
  constructor(
    private readonly store: Store,
    private readonly events: EventBus,
  ) {}

  append(agentId: string, content: string): Note {
    const note: Note = { id: newId("n"), agentId, content, ts: Date.now() };
    this.store.insertNote(note);
    this.events.emit("note_added", note);
    return note;
  }

  list(): Note[] {
    return this.store.listNotes();
  }
}
