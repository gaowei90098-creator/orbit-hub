// Populate a running hub with a realistic two-agent scenario — handy for demos and
// for eyeballing the dashboard without launching real agents.
//
//   node examples/seed-demo.mjs [hubUrl] [token]
//
// Defaults to http://localhost:4100 with no token.

const base = (process.argv[2] ?? "http://localhost:4100").replace(/\/+$/, "");
const token = process.argv[3] ?? process.env.HUB_TOKEN ?? "";

const post = async (path, body) => {
  const res = await fetch(base + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${await res.text()}`);
  return res.json();
};

const claude = (await post("/api/agents", { name: "Claude", harness: "claude-code" })).agent;
const codex = (await post("/api/agents", { name: "Codex", harness: "codex" })).agent;

const api = (await post("/api/tasks", { title: "Design /users API", description: "REST endpoints for users", files: ["src/api/users.ts"], createdBy: claude.id })).task;
const ui = (await post("/api/tasks", { title: "Build users UI", description: "List + form components", files: ["src/ui/Users.tsx"], createdBy: claude.id })).task;
await post("/api/tasks", { title: "Write integration tests", description: "Cover the /users endpoints", dependsOn: [api.id], createdBy: claude.id });
const ci = (await post("/api/tasks", { title: "Set up CI pipeline", createdBy: codex.id })).task;

await post(`/api/tasks/${ci.id}/claim`, { agent: codex.id });
await post(`/api/tasks/${ci.id}/update`, { status: "done" });
await post(`/api/tasks/${api.id}/claim`, { agent: claude.id });
await post(`/api/tasks/${api.id}/update`, { status: "in_progress" });
await post(`/api/tasks/${ui.id}/claim`, { agent: codex.id });
await post(`/api/tasks/${ui.id}/update`, { status: "in_progress" });

await post("/api/locks/acquire", { agent: claude.id, paths: ["src/api/users.ts"] });
await post("/api/locks/acquire", { agent: codex.id, paths: ["src/ui/Users.tsx"] });

await post("/api/messages", { from: claude.id, to: codex.id, content: "I'm adding an `email` field to the User type — update your form." });
await post("/api/messages", { from: codex.id, to: "all", content: "UI scaffold pushed to my branch, mocking the API for now." });
await post("/api/notes", { agent: claude.id, content: "API contract: GET /users → { id, name, email }[]" });

console.log(`Seeded ${base}. Open the dashboard to see it.`);
