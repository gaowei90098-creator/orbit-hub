import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Agent,
  Conflict,
  ConnectInfo,
  Contract,
  FileLock,
  InstallResult,
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
  planMission: (input: { goal: string; template?: string }) => Promise<MissionPlan>;
  launchMission: (input: { goal: string; projectPath?: string; customTasks?: TaskDraft[] }) => Promise<void>;
  listTemplates: () => Promise<TemplateInfo[]>;
  installCodexConfig: () => Promise<InstallResult>;
  setRole: (agentId: string, role: string | null) => Promise<void>;
  resolveConflict: (id: string, resolution: string) => Promise<void>;
  dismissConflict: (id: string, resolution: string) => Promise<void>;
  updateContract: (fields: { apiContract?: string; designSpec?: string; expectedVersion?: number }) => Promise<boolean>;
  seedDemo: () => Promise<void>;
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

  const planMission = useCallback(async (input: { goal: string; template?: string }) => {
    const { plan } = await api<{ plan: MissionPlan }>("/api/missions/plan", {
      method: "POST",
      body: JSON.stringify({ goal: input.goal, template: input.template }),
    });
    return plan;
  }, []);

  const launchMission = useCallback(async (input: { goal: string; projectPath?: string; customTasks?: TaskDraft[] }) => {
    const goal = input.goal.trim();
    if (!goal) return;
    await api("/api/missions/launch", {
      method: "POST",
      body: JSON.stringify({
        goal,
        projectPath: input.projectPath,
        createdBy: operatorRef.current,
        customTasks: input.customTasks,
      }),
    });
  }, []);

  const fetchTemplates = useCallback(async () => {
    const { templates } = await api<{ templates: TemplateInfo[] }>("/api/templates");
    return templates;
  }, []);

  const installCodexConfig = useCallback(async () => {
    return api<InstallResult>(`/api/connect/install/codex${qs()}`, { method: "POST" });
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
    connected,
    operatorId,
    connectInfo,
    actions: {
      send,
      createTask,
      planMission,
      launchMission,
      listTemplates: fetchTemplates,
      installCodexConfig,
      setRole,
      resolveConflict,
      dismissConflict,
      updateContract,
      seedDemo,
    },
  };
}
