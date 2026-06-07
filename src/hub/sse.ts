import type { Express } from "express";
import type { CoordinationCore } from "../core/core.js";

// Server-Sent Events: pushes every hub mutation to connected dashboards in real time.
// On connect we send the full snapshot, then a stream of typed events.
export function mountSse(app: Express, core: CoordinationCore): void {
  app.get("/api/events", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // disable proxy buffering
    res.flushHeaders();

    res.write(`event: snapshot\ndata: ${JSON.stringify(core.snapshot())}\n\n`);

    const unsubscribe = core.events.subscribe((event) => {
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    });

    // Comment ping keeps the connection alive through idle proxies.
    const ping = setInterval(() => res.write(`: ping\n\n`), 15_000);

    req.on("close", () => {
      clearInterval(ping);
      unsubscribe();
    });
  });
}
