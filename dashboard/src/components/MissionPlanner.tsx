import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Brain,
  ChevronLeft,
  GripVertical,
  Loader2,
  Monitor,
  Pencil,
  Plus,
  Rocket,
  Server,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  Wrench,
} from "lucide-react";
import type { HubActions } from "../api";
import type { Agent, MissionPlan, TaskDraft, TemplateInfo, WorkerSpec } from "../types";
import { isOperator } from "../util";

type Step = "input" | "plan" | "launching";

const AREA_LABEL: Record<TaskDraft["area"], string> = {
  frontend: "前端",
  backend: "后端",
  general: "通用",
};

const AREA_ICON: Record<TaskDraft["area"], typeof Monitor> = {
  frontend: Monitor,
  backend: Server,
  general: Wrench,
};

// 逗号/换行分隔的字符串 ↔ string[]（fileScope 编辑用）。
function parseScopeList(value: string): string[] {
  return value
    .split(/[,，\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function TaskEditor({
  draft,
  index,
  onChange,
  onRemove,
}: {
  draft: TaskDraft;
  index: number;
  onChange: (index: number, updated: TaskDraft) => void;
  onRemove: (index: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  // fileScope 输入框的原始文本（失焦/提交时才 parse，避免输入逗号时跳动）。
  const [scopeText, setScopeText] = useState(draft.fileScope.join(", "));
  const Icon = AREA_ICON[draft.area];

  if (editing) {
    return (
      <div className="task-draft editing">
        <div className="task-draft-fields">
          <label>
            任务名称
            <input
              value={draft.title}
              onChange={(e) => onChange(index, { ...draft, title: e.target.value })}
            />
          </label>
          <label>
            描述
            <textarea
              rows={3}
              value={draft.description}
              onChange={(e) => onChange(index, { ...draft, description: e.target.value })}
            />
          </label>
          <label>
            分配方向
            <select
              value={draft.area}
              onChange={(e) => onChange(index, { ...draft, area: e.target.value as TaskDraft["area"] })}
            >
              <option value="frontend">前端</option>
              <option value="backend">后端</option>
              <option value="general">通用</option>
            </select>
          </label>
          <label>
            文件范围 fileScope（逗号分隔，worker 只许改这些）
            <input
              value={scopeText}
              placeholder="例：src/api/**, src/core/users.ts"
              onChange={(e) => {
                setScopeText(e.target.value);
                onChange(index, { ...draft, fileScope: parseScopeList(e.target.value) });
              }}
            />
          </label>
          <label>
            完成标准 doneWhen
            <input
              value={draft.doneWhen}
              placeholder="例：注册接口返回 201 且写入数据库"
              onChange={(e) => onChange(index, { ...draft, doneWhen: e.target.value })}
            />
          </label>
          <label>
            验证命令 verifyCommand（跑通才允许标记完成）
            <input
              value={draft.verifyCommand}
              placeholder="例：npm test"
              onChange={(e) => onChange(index, { ...draft, verifyCommand: e.target.value })}
            />
          </label>
          <label>
            共享接口 interfaceRef（与其他任务对接的部分）
            <input
              value={draft.interfaceRef}
              placeholder="例：POST /users 返回 { id, name }"
              onChange={(e) => onChange(index, { ...draft, interfaceRef: e.target.value })}
            />
          </label>
        </div>
        <button className="btn btn-small" type="button" onClick={() => setEditing(false)}>
          完成编辑
        </button>
      </div>
    );
  }

  const scopeSummary = draft.fileScope.length > 0 ? draft.fileScope.join(", ") : draft.files.join(", ");
  return (
    <div className="task-draft">
      <span className="task-draft-grip">
        <GripVertical size={14} />
      </span>
      <span className={`task-draft-area ${draft.area}`}>
        <Icon size={13} />
        {AREA_LABEL[draft.area]}
      </span>
      <div className="task-draft-body">
        <b>{draft.title}</b>
        {scopeSummary && <small>范围：{scopeSummary}</small>}
        {draft.verifyCommand && (
          <small className="task-draft-verify">
            <ShieldCheck size={12} />
            验证：{draft.verifyCommand}
          </small>
        )}
        {draft.doneWhen && <small>完成标准：{draft.doneWhen}</small>}
      </div>
      <div className="task-draft-actions">
        <button type="button" title="编辑" onClick={() => setEditing(true)}>
          <Pencil size={14} />
        </button>
        <button type="button" title="删除" onClick={() => onRemove(index)}>
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

export function MissionPlanner({
  agents,
  connected,
  workspace,
  actions,
}: {
  agents: Agent[];
  connected: boolean;
  workspace: string | null;
  actions: HubActions;
}) {
  const [step, setStep] = useState<Step>("input");
  const [goal, setGoal] = useState("");
  const [projectPath, setProjectPath] = useState("");
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<string>("");
  const [plan, setPlan] = useState<MissionPlan | null>(null);
  const [drafts, setDrafts] = useState<TaskDraft[]>([]);
  const [planning, setPlanning] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState("");
  const [postLaunchTip, setPostLaunchTip] = useState("");
  // 1.3 worker 规格（留空 = 用服务端默认值）。
  const [specOpen, setSpecOpen] = useState(false);
  const [model, setModel] = useState("");
  const [budgetUsd, setBudgetUsd] = useState("");
  const [timeoutMin, setTimeoutMin] = useState("");

  const peers = agents.filter((a) => !isOperator(a));
  const onlineAgents = peers.filter((a) => a.status === "online");

  useEffect(() => {
    actions.listTemplates().then(setTemplates).catch(() => {});
  }, [actions]);

  const doPlan = async () => {
    const trimmed = goal.trim();
    if (!trimmed) return;
    setError("");
    setPostLaunchTip("");
    setPlanning(true);
    try {
      const result = await actions.planMission({
        goal: trimmed,
        template: selectedTemplate || undefined,
        // 1.1：带上项目目录才会启用 lead 拆分（lead 要能读到真实仓库）；
        // 与 launch 一致，目录留空时回退统一工作区。
        projectPath: projectPath.trim() || workspace || undefined,
      });
      setPlan(result);
      setDrafts(result.tasks);
      setStep("plan");
    } catch {
      setError("规划失败，请确认 Hub 服务正在运行。");
    } finally {
      setPlanning(false);
    }
  };

  const buildWorkerSpec = (): WorkerSpec | undefined => {
    const spec: WorkerSpec = {};
    if (model.trim()) spec.model = model.trim();
    const budget = Number(budgetUsd);
    if (budgetUsd.trim() && Number.isFinite(budget) && budget > 0) spec.budgetUsd = budget;
    const minutes = Number(timeoutMin);
    if (timeoutMin.trim() && Number.isFinite(minutes) && minutes >= 1) spec.timeoutMs = Math.round(minutes * 60_000);
    return Object.keys(spec).length > 0 ? spec : undefined;
  };

  const canAutoExec = Boolean(projectPath.trim() || workspace);
  const doLaunch = async () => {
    if (!connected) {
      setError("未连接到枢纽服务。");
      return;
    }
    if (onlineAgents.length === 0 && !canAutoExec) {
      setError("请先连接智能体，或设置统一工作区让枢纽自动拉起执行助手。");
      return;
    }
    if (drafts.length === 0) {
      setError("至少需要一个任务。");
      return;
    }
    setError("");
    setPostLaunchTip("");
    setLaunching(true);
    setStep("launching");
    try {
      const { launchedRuns } = await actions.launchMission({
        goal: goal.trim(),
        projectPath: projectPath.trim() || undefined,
        customTasks: drafts,
        workerSpec: buildWorkerSpec(),
      });
      // 没有项目目录/工作区 → 枢纽不会自动拉起 worker，外部 Agent 也不会自己醒来干活。
      // 不提示的话任务会一直停在"已领取"，用户以为系统坏了。
      setPostLaunchTip(
        launchedRuns.length > 0
          ? `已自动拉起 ${launchedRuns.length} 个执行助手，进度会实时显示在下方"自动执行"面板。`
          : "任务已创建并指派，但外部接入的智能体不会自动开工——回到 Claude Code / Codex 各自的会话里说一句『查看 Orbit 任务板，开始执行你的任务』。想全自动执行，请先在上方设置统一工作区。",
      );
      setGoal("");
      setProjectPath("");
      setPlan(null);
      setDrafts([]);
      setStep("input");
    } catch {
      setError("启动失败，请确认 Hub 服务仍在运行。");
      setStep("plan");
    } finally {
      setLaunching(false);
    }
  };

  const updateDraft = (index: number, updated: TaskDraft) => {
    setDrafts((prev) => prev.map((d, i) => (i === index ? updated : d)));
  };

  const removeDraft = (index: number) => {
    setDrafts((prev) => prev.filter((_, i) => i !== index));
  };

  const addDraft = () => {
    setDrafts((prev) => [
      ...prev,
      {
        title: `新任务 · ${goal.trim()}`,
        description: `目标：${goal.trim()}`,
        area: "general",
        files: [],
        fileScope: [],
        doneWhen: "",
        verifyCommand: "",
        interfaceRef: "",
      },
    ]);
  };

  const canPlan = goal.trim().length > 0 && !planning;
  const canLaunch = connected && (onlineAgents.length > 0 || canAutoExec) && drafts.length > 0 && !launching;

  return (
    <section className="panel-card mission-planner" id="launch-mission">
      <div className="panel-head">
        <div>
          <h2>协作控制台</h2>
          <p>
            {step === "input"
              ? "描述目标。填了项目目录会由 Lead 读取真实仓库结构来拆分；否则按模板拆。草案生成后可编辑。"
              : step === "plan"
                ? "启动前的关键一步：检查并修正任务拆分（文件范围、完成标准、验证命令），比事后返工便宜得多。"
                : "正在启动..."}
          </p>
        </div>
        {step !== "input" && (
          <div className="planner-step-indicator">
            <span className="step-dot active" />
            <span className={step === "plan" || step === "launching" ? "step-dot active" : "step-dot"} />
          </div>
        )}
      </div>

      {step === "input" && (
        <div className="planner-input-step">
          <div className="planner-goal-row">
            <input
              className="planner-goal-input"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="描述这次要完成的目标，例如：做一个贪吃蛇小游戏"
              onKeyDown={(e) => { if (e.key === "Enter") void doPlan(); }}
            />
            <button className="btn btn-primary" disabled={!canPlan} onClick={() => void doPlan()}>
              {planning ? <Loader2 size={16} className="spin" /> : <Settings2 size={16} />}
              生成任务拆分
            </button>
          </div>

          <input
            className="project-path-input"
            value={projectPath}
            onChange={(e) => setProjectPath(e.target.value)}
            placeholder={
              workspace
                ? `项目目录（默认用统一工作区：${workspace}）`
                : "项目目录（可选，填了就自动派 Agent 去做，例：/Users/you/proj）"
            }
          />

          {planning && projectPath.trim() && (
            <p className="planner-lead-hint">
              <Brain size={13} />
              Lead 正在读取仓库结构并拆分任务，可能需要一两分钟……失败会自动回退到模板拆分。
            </p>
          )}

          {templates.length > 0 && (
            <div className="template-selector">
              <span className="template-label">拆分模板：</span>
              <div className="template-chips">
                <button
                  type="button"
                  className={!selectedTemplate ? "template-chip active" : "template-chip"}
                  onClick={() => setSelectedTemplate("")}
                >
                  自动检测
                </button>
                {templates.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={selectedTemplate === t.id ? "template-chip active" : "template-chip"}
                    onClick={() => setSelectedTemplate(t.id)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {step === "plan" && plan && (
        <div className="planner-plan-step">
          <div className="plan-header">
            <button className="btn btn-ghost" type="button" onClick={() => setStep("input")}>
              <ChevronLeft size={16} />
              返回修改目标
            </button>
            {plan.source === "lead" ? (
              <span className="plan-template-badge lead">
                <Brain size={13} />
                Lead 拆分（已读取仓库结构）
              </span>
            ) : (
              <span className="plan-template-badge">模板：{plan.templateLabel}</span>
            )}
          </div>

          {plan.note && (
            <p className="launcher-warning">
              <AlertTriangle size={14} />
              {plan.note}
            </p>
          )}

          <div className="plan-goal-display">
            <b>目标：</b>{goal}
          </div>

          <div className="task-draft-list">
            {drafts.map((draft, i) => (
              <TaskEditor
                key={i}
                draft={draft}
                index={i}
                onChange={updateDraft}
                onRemove={removeDraft}
              />
            ))}
          </div>

          <div className="worker-spec">
            <button className="worker-spec-toggle" type="button" onClick={() => setSpecOpen((v) => !v)}>
              <SlidersHorizontal size={14} />
              执行规格（模型 / 预算 / 超时）
              <span className="worker-spec-caret">{specOpen ? "收起" : "展开"}</span>
            </button>
            {specOpen && (
              <div className="worker-spec-fields">
                <label>
                  模型
                  <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="默认 sonnet，可填 opus" />
                </label>
                <label>
                  预算（美元 / worker）
                  <input
                    value={budgetUsd}
                    onChange={(e) => setBudgetUsd(e.target.value)}
                    placeholder="默认 10"
                    inputMode="decimal"
                  />
                </label>
                <label>
                  超时（分钟）
                  <input
                    value={timeoutMin}
                    onChange={(e) => setTimeoutMin(e.target.value)}
                    placeholder="默认 45"
                    inputMode="numeric"
                  />
                </label>
              </div>
            )}
          </div>

          <div className="plan-actions">
            <button className="btn btn-ghost" type="button" onClick={addDraft}>
              <Plus size={15} />
              添加任务
            </button>
            <button className="btn btn-primary btn-launch" disabled={!canLaunch} onClick={() => void doLaunch()}>
              <Rocket size={16} />
              确认启动（{drafts.length} 个任务）
            </button>
          </div>

          {!connected ? (
            <p className="launcher-warning">
              <AlertTriangle size={14} />
              未连接到枢纽服务。
            </p>
          ) : onlineAgents.length === 0 && !canAutoExec ? (
            <p className="launcher-warning">
              <AlertTriangle size={14} />
              还没有在线智能体，也没设置统一工作区——请先二选一，否则任务没人执行。
            </p>
          ) : onlineAgents.length === 0 ? (
            <p className="launcher-warning info">
              <AlertTriangle size={14} />
              没有在线智能体：启动后将由枢纽在工作区自动拉起执行助手。
            </p>
          ) : null}
        </div>
      )}

      {step === "launching" && (
        <div className="planner-launching">
          <Loader2 size={24} className="spin" />
          <span>正在创建任务并分配给智能体...</span>
        </div>
      )}

      {error && (
        <p className="launcher-error" role="alert">
          <AlertTriangle size={14} />
          {error}
        </p>
      )}

      {postLaunchTip && (
        <p className="launcher-tip" role="status">
          <Rocket size={14} />
          {postLaunchTip}
        </p>
      )}
    </section>
  );
}
