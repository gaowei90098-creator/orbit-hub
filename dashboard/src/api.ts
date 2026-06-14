import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Agent,
  Approval,
  Conflict,
  ConnectInfo,
  Contract,
  FileLock,
  InstallResult,
  IntegrationDetail,
  IntegrationRun,
  Intent,
  Message,
  Mission,
  MissionPlan,
  Note,
  Snapshot,
  Task,
  TaskDraft,
  TemplateInfo,
  Worker,
  WorkerSpec,
  WorktreeDiff,
} from "./types";
import { OPERATOR_NAME } from "./util";

// ---- token (for LAN/networked hubs) ----
const getToken = (): string => {
  const fromUrl = new URLSearchParams(location.search).get("token");
  if (fromUrl) localStorage.setItem("hubToken", fromUrl);
  return localStorage.getItem("hubToken") ?? "";
};
const qs = (): string => {
  const t = getToken();
  return t ? `?token=${encodeURIComponent(t)}` : "";
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return (await res.json()) as T;
}

// ---- 嵌入式终端（node-pty + xterm）----
export type TerminalCommand = "claude" | "codex";

export async function terminalsAvailable(): Promise<boolean> {
  try {
    const r = await api<{ available: boolean }>("/api/terminals");
    return r.available;
  } catch {
    return false;
  }
}

export async function createTerminal(
  command: TerminalCommand,
  opts: { cwd?: string; cols?: number; rows?: number } = {},
): Promise<{ id: string } | { error: string; detail?: string }> {
  try {
    return await api<{ id: string }>("/api/terminals", { method: "POST", body: JSON.stringify({ command, ...opts }) });
  } catch (e) {
    return { error: "create_failed", detail: (e as Error).message };
  }
}

// EventSource 不能带 Authorization 头，故走 ?token= 查询参数（authMiddleware 同时认这个）。
export function terminalStreamUrl(id: string): string {
  return `/api/terminals/${id}/stream${qs()}`;
}

export async function sendTerminalInput(id: string, data: string): Promise<void> {
  await api(`/api/terminals/${id}/input`, { method: "POST", body: JSON.stringify({ data }) });
}

export async function resizeTerminal(id: string, cols: number, rows: number): Promise<void> {
  try {
    await api(`/api/terminals/${id}/resize`, { method: "POST", body: JSON.stringify({ cols, rows }) });
  } catch {
    /* resize 失败不致命 */
  }
}

export async function killTerminal(id: string): Promise<void> {
  try {
    await api(`/api/terminals/${id}`, { method: "DELETE" });
  } catch {
    /* 已退出 */
  }
}

function upsert<T extends { id: string }>(arr: T[], item: T): T[] {
  const i = arr.findIndex((x) => x.id === item.id);
  if (i === -1) return [...arr, item];
  const copy = arr.slice();
  copy[i] = item;
  return copy;
}

const EMPTY_CONTRACT: Contract = { apiContract: "", designSpec: "", version: 0, updatedBy: null, updatedAt: 0 };

export interface HubActions {
  send: (to: string, content: string) => Promise<void>;
  createTask: (input: { title: string; description?: string; assignee?: string }) => Promise<void>;
  planMission: (input: { goal: string; template?: string; projectPath?: string }) => Promise<MissionPlan>;
  launchMission: (input: {
    goal: string;
    projectPath?: string;
    customTasks?: TaskDraft[];
    workerSpec?: WorkerSpec;
  }) => Promise<{ launchedRuns: string[] }>;
  injectWorkerInput: (runId: string, message: string) => Promise<{ ok: boolean; error?: string }>;
  listTemplates: () => Promise<TemplateInfo[]>;
  fetchConnect: (principal?: string) => Promise<ConnectInfo>;
  installCodexConfig: (principal?: string) => Promise<InstallResult>;
  setRole: (agentId: string, role: string | null) => Promise<void>;
  resolveConflict: (id: string, resolution: string) => Promise<void>;
  dismissConflict: (id: string, resolution: string) => Promise<void>;
  updateContract: (fields: { apiContract?: string; designSpec?: string; expectedVersion?: number }) => Promise<boolean>;
  seedDemo: () => Promise<void>;
  getIntegration: (missionId: string) => Promise<IntegrationDetail | null>;
  triggerIntegration: (missionId: string) => Promise<IntegrationRun>;
  approveMission: (missionId: string, note?: string) => Promise<{ approval: Approval; resultCommit: string | null }>;
  rejectMission: (missionId: string, note?: string) => Promise<{ approval: Approval }>;
  dispatchConflictFix: (missionId: string) => Promise<{ ok: boolean; runId?: string }>;
  getRunDiff: (runId: string) => Promise<WorktreeDiff | null>;
  setWorkspace: (path: string) => Promise<{ path: string }>;
  dispatchTask: (taskId: string, harness?: "claude-code" | "codex") => Promise<void>;
  cancelMission: (missionId: string) => Promise<{ stoppedRuns: string[]; transitioned: boolean }>;
  reviewMission: (missionId: string) => Promise<{ ok: boolean; runId?: string }>;
  rescueMission: (
    missionId: string,
  ) => Promise<{ rescued: string[]; skipped: { runId: string; reason: string }[]; scanned: number }>;
}

export interface HubState {
  agents: Agent[];
  tasks: Task[];
  locks: FileLock[];
  messages: Message[];
  notes: Note[];
  intents: Intent[];
  conflicts: Conflict[];
  contract: Contract;
  missions: Mission[];
  workers: Worker[];
  workspace: string | null;
  connected: boolean;
  operatorId: string;
  connectInfo: ConnectInfo | null;
  actions: HubActions;
}

export function useHubState(): HubState {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [locks, setLocks] = useState<FileLock[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [intents, setIntents] = useState<Intent[]>([]);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [contract, setContract] = useState<Contract>(EMPTY_CONTRACT);
  const [missions, setMissions] = useState<Mission[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [workspace, setWorkspaceState] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [operatorId, setOperatorId] = useState("");
  const [connectInfo, setConnectInfo] = useState<ConnectInfo | null>(null);
  const operatorRef = useRef("");

  useEffect(() => {
    let cancelled = false;

    api<{ agent: Agent }>("/api/agents", {
      method: "POST",
      body: JSON.stringify({ name: OPERATOR_NAME, harness: "other" }),
    })
      .then(({ agent }) => {
        if (cancelled) return;
        operatorRef.current = agent.id;
        setOperatorId(agent.id);
      })
      .catch(() => {});

    api<ConnectInfo>(`/api/connect${qs()}`)
      .then((info) => {
        if (!cancelled) setConnectInfo(info);
      })
      .catch(() => {});

    api<{ workers: Worker[] }>(`/api/workers${qs()}`)
      .then((d) => {
        if (!cancelled) setWorkers(d.workers);
      })
      .catch(() => {});

    const heartbeat = setInterval(() => {
      if (operatorRef.current) void api(`/api/agents/${operatorRef.current}/heartbeat`, { method: "POST" }).catch(() => {});
    }, 20_000);

    const es = new EventSource(`/api/events${qs()}`);
    const payloadOf = (e: Event): unknown => JSON.parse((e as MessageEvent).data).payload;

    es.addEventListener("open", () => setConnected(true));
    es.addEventListener("error", () => setConnected(false));
    es.addEventListener("snapshot", (e) => {
      const s = JSON.parse((e as MessageEvent).data) as Snapshot;
      setAgents(s.agents);
      setTasks(s.tasks);
      setLocks(s.locks);
      setMessages(s.messages);
      setNotes(s.notes);
      setIntents(s.intents ?? []);
      setConflicts(s.conflicts ?? []);
      setContract(s.contract ?? EMPTY_CONTRACT);
      setMissions(s.missions ?? []);
      setWorkspaceState(s.workspace ?? null);
    });

    const onAgent = (e: Event) => setAgents((a) => upsert(a, payloadOf(e) as Agent));
    es.addEventListener("agent_registered", onAgent);
    es.addEventListener("agent_updated", onAgent);
    es.addEventListener("agent_offline", onAgent);

    const onTask = (e: Event) => setTasks((t) => upsert(t, payloadOf(e) as Task));
    es.addEventListener("task_created", onTask);
    es.addEventListener("task_updated", onTask);

    es.addEventListener("message_sent", (e) => setMessages((m) => [...m, payloadOf(e) as Message]));
    es.addEventListener("note_added", (e) => setNotes((n) => [...n, payloadOf(e) as Note]));

    const onIntent = (e: Event) => setIntents((arr) => upsert(arr, payloadOf(e) as Intent));
    es.addEventListener("intent_announced", onIntent);
    es.addEventListener("intent_updated", onIntent);

    const onConflict = (e: Event) => setConflicts((arr) => upsert(arr, payloadOf(e) as Conflict));
    es.addEventListener("conflict_opened", onConflict);
    es.addEventListener("conflict_updated", onConflict);

    es.addEventListener("contract_updated", (e) => setContract(payloadOf(e) as Contract));

    const onMission = (e: Event) => setMissions((arr) => upsert(arr, payloadOf(e) as Mission));
    es.addEventListener("mission_created", onMission);
    es.addEventListener("mission_updated", onMission);

    const onWorker = (e: Event) => setWorkers((arr) => upsert(arr, payloadOf(e) as Worker));
    es.addEventListener("worker_updated", onWorker);

    es.addEventListener("workspace_updated", (e) => {
      const p = payloadOf(e) as { path: string | null };
      setWorkspaceState(p.path ?? null);
    });

    es.addEventListener("lock_changed", () => {
      void api<{ locks: FileLock[] }>(`/api/locks${qs()}`)
        .then((d) => setLocks(d.locks))
        .catch(() => {});
    });

    return () => {
      cancelled = true;
      clearInterval(heartbeat);
      es.close();
    };
  }, []);

  const send = useCallback(async (to: string, content: string) => {
    const from = operatorRef.current;
    if (!from || !content.trim()) return;
    await api("/api/messages", { method: "POST", body: JSON.stringify({ from, to, content }) });
  }, []);

  const createTask = useCallback(async (input: { title: string; description?: string; assignee?: string }) => {
    if (!input.title.trim()) return;
    const { task } = await api<{ task: Task }>("/api/tasks", {
      method: "POST",
      body: JSON.stringify({ title: input.title, description: input.description, createdBy: operatorRef.current }),
    });
    if (input.assignee) {
      await api(`/api/tasks/${task.id}/assign`, { method: "POST", body: JSON.stringify({ agent: input.assignee }) });
    }
  }, []);

  const planMission = useCallback(async (input: { goal: string; template?: string; projectPath?: string }) => {
    const { plan } = await api<{ plan: MissionPlan }>("/api/missions/plan", {
      method: "POST",
      body: JSON.stringify({ goal: input.goal, template: input.template, projectPath: input.projectPath }),
    });
    return plan;
  }, []);

  const launchMission = useCallback(
    async (input: { goal: string; projectPath?: string; customTasks?: TaskDraft[]; workerSpec?: WorkerSpec }) => {
      const goal = input.goal.trim();
      if (!goal) return { launchedRuns: [] as string[] };
      const { launchedRuns } = await api<{ launchedRuns: string[] }>("/api/missions/launch", {
        method: "POST",
        body: JSON.stringify({
          goal,
          projectPath: input.projectPath,
          createdBy: operatorRef.current,
          customTasks: input.customTasks,
          workerSpec: input.workerSpec,
        }),
      });
      return { launchedRuns };
    },
    [],
  );

  // 1.3 waiting_for_input 一键注入回复（复用 resume 通道）。
  const injectWorkerInput = useCallback(async (runId: string, message: string) => {
    try {
      await api(`/api/agent-runs/${runId}/input`, { method: "POST", body: JSON.stringify({ message }) });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }, []);

  const fetchTemplates = useCallback(async () => {
    const { templates } = await api<{ templates: TemplateInfo[] }>("/api/templates");
    return templates;
  }, []);

  // 拼接 token + 可选 principal 的查询串（团队/远程连接共用）。
  const connectQuery = (principal?: string): string => {
    const params = new URLSearchParams();
    const t = getToken();
    if (t) params.set("token", t);
    if (principal?.trim()) params.set("principal", principal.trim());
    const q = params.toString();
    return q ? `?${q}` : "";
  };

  const fetchConnect = useCallback(async (principal?: string) => {
    return api<ConnectInfo>(`/api/connect${connectQuery(principal)}`);
  }, []);

  const installCodexConfig = useCallback(async (principal?: string) => {
    return api<InstallResult>(`/api/connect/install/codex${connectQuery(principal)}`, { method: "POST" });
  }, []);

  const setRole = useCallback(async (agentId: string, role: string | null) => {
    await api(`/api/agents/${agentId}/role`, { method: "POST", body: JSON.stringify({ role }) });
  }, []);

  const resolveConflict = useCallback(async (id: string, resolution: string) => {
    await api(`/api/conflicts/${id}/resolve`, {
      method: "POST",
      body: JSON.stringify({ by: operatorRef.current, resolution }),
    });
  }, []);

  const dismissConflict = useCallback(async (id: string, resolution: string) => {
    await api(`/api/conflicts/${id}/dismiss`, {
      method: "POST",
      body: JSON.stringify({ by: operatorRef.current, resolution }),
    });
  }, []);

  const seedDemo = useCallback(async () => {
    await api<{ ok: boolean }>("/api/demo/seed", { method: "POST", body: "{}" });
  }, []);

  const getIntegration = useCallback(async (missionId: string): Promise<IntegrationDetail | null> => {
    try {
      return await api<IntegrationDetail>(`/api/missions/${missionId}/integration`);
    } catch {
      return null;
    }
  }, []);

  const triggerIntegration = useCallback(async (missionId: string) => {
    const r = await api<{ integration: IntegrationRun }>(`/api/missions/${missionId}/integrate`, {
      method: "POST", body: "{}",
    });
    return r.integration;
  }, []);

  const approveMission = useCallback(async (missionId: string, note?: string) => {
    return api<{ approval: Approval; resultCommit: string | null }>(`/api/missions/${missionId}/approve`, {
      method: "POST",
      body: JSON.stringify({ by: operatorRef.current, note: note ?? "" }),
    });
  }, []);

  const rejectMission = useCallback(async (missionId: string, note?: string) => {
    return api<{ approval: Approval }>(`/api/missions/${missionId}/reject`, {
      method: "POST",
      body: JSON.stringify({ by: operatorRef.current, note: note ?? "" }),
    });
  }, []);

  const dispatchConflictFix = useCallback(async (missionId: string) => {
    return api<{ ok: boolean; runId?: string }>(`/api/missions/${missionId}/dispatch-conflict-fix`, {
      method: "POST", body: "{}",
    });
  }, []);

  const getRunDiff = useCallback(async (runId: string): Promise<WorktreeDiff | null> => {
    try {
      const r = await api<{ diff: WorktreeDiff }>(`/api/agent-runs/${runId}/diff`);
      return r.diff;
    } catch {
      return null;
    }
  }, []);

  const setWorkspace = useCallback(async (wsPath: string) => {
    const r = await api<{ path: string }>("/api/workspace", {
      method: "POST",
      body: JSON.stringify({ path: wsPath }),
    });
    setWorkspaceState(r.path);
    return r;
  }, []);

  const dispatchTask = useCallback(async (taskId: string, harness?: "claude-code" | "codex") => {
    await api(`/api/tasks/${taskId}/dispatch`, { method: "POST", body: JSON.stringify({ harness }) });
  }, []);

  const cancelMission = useCallback(async (missionId: string) => {
    const r = await api<{ stoppedRuns: string[]; transitioned: boolean }>(`/api/missions/${missionId}/cancel`, {
      method: "POST", body: "{}",
    });
    return { stoppedRuns: r.stoppedRuns ?? [], transitioned: Boolean(r.transitioned) };
  }, []);

  const reviewMission = useCallback(async (missionId: string) => {
    return api<{ ok: boolean; runId?: string }>(`/api/missions/${missionId}/review`, {
      method: "POST", body: "{}",
    });
  }, []);

  const rescueMission = useCallback(async (missionId: string) => {
    const r = await api<{ rescued: string[]; skipped: { runId: string; reason: string }[]; scanned: number }>(
      `/api/missions/${missionId}/rescue`,
      { method: "POST", body: "{}" },
    );
    return { rescued: r.rescued ?? [], skipped: r.skipped ?? [], scanned: r.scanned ?? 0 };
  }, []);

  const updateContract = useCallback(
    async (fields: { apiContract?: string; designSpec?: string; expectedVersion?: number }) => {
      const r = await api<{ ok: boolean }>("/api/contract", {
        method: "POST",
        body: JSON.stringify({ by: operatorRef.current, ...fields }),
      });
      return r.ok;
    },
    [],
  );

  return {
    agents,
    tasks,
    locks,
    messages,
    notes,
    intents,
    conflicts,
    contract,
    missions,
    workers,
    workspace,
    connected,
    operatorId,
    connectInfo,
    actions: {
      send,
      createTask,
      planMission,
      launchMission,
      injectWorkerInput,
      listTemplates: fetchTemplates,
      fetchConnect,
      installCodexConfig,
      setRole,
      resolveConflict,
      dismissConflict,
      updateContract,
      seedDemo,
      getIntegration,
      triggerIntegration,
      approveMission,
      rejectMission,
      dispatchConflictFix,
      getRunDiff,
      setWorkspace,
      dispatchTask,
      cancelMission,
      reviewMission,
      rescueMission,
    },
  };
}
