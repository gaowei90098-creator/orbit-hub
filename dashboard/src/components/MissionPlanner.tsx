import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ChevronLeft,
  GripVertical,
  Loader2,
  Monitor,
  Pencil,
  Plus,
  Rocket,
  Server,
  Settings2,
  Trash2,
  Wrench,
} from "lucide-react";
import type { HubActions } from "../api";
import type { Agent, MissionPlan, TaskDraft, TemplateInfo } from "../types";
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
        </div>
        <button className="btn btn-small" type="button" onClick={() => setEditing(false)}>
          完成编辑
        </button>
      </div>
    );
  }

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
        {draft.files.length > 0 && <small>{draft.files.join(", ")}</small>}
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
  actions,
}: {
  agents: Agent[];
  connected: boolean;
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

  const doLaunch = async () => {
    if (!connected || onlineAgents.length === 0) {
      setError("请先连接至少一个在线智能体。");
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
      });
      // 没有项目目录 → 枢纽不会自动拉起 worker，外部 Agent 也不会自己醒来干活。
      // 不提示的话任务会一直停在"已领取"，用户以为系统坏了。
      setPostLaunchTip(
        launchedRuns.length > 0
          ? `已自动拉起 ${launchedRuns.length} 个执行助手，进度会实时显示在下方"自动执行"面板。`
          : "任务已创建并指派，但外部接入的智能体不会自动开工——回到 Claude Code / Codex 各自的会话里说一句『查看 Orbit 任务板，开始执行你的任务』。想全自动执行，下次启动时填写项目目录。",
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
      },
    ]);
  };

  const canPlan = goal.trim().length > 0 && !planning;
  const canLaunch = connected && onlineAgents.length > 0 && drafts.length > 0 && !launching;

  return (
    <section className="panel-card mission-planner" id="launch-mission">
      <div className="panel-head">
        <div>
          <h2>协作控制台</h2>
          <p>
            {step === "input"
              ? "描述目标，选择拆分模板，系统会生成任务草案供你编辑。"
              : step === "plan"
                ? "检查并编辑任务拆分，确认后启动协作。"
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
            placeholder="项目目录（可选，填了就自动派 Agent 去做，例：/Users/you/proj）"
          />

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
            <span className="plan-template-badge">
              模板：{plan.templateLabel}
            </span>
          </div>

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

          {!connected || onlineAgents.length === 0 ? (
            <p className="launcher-warning">
              <AlertTriangle size={14} />
              还没有在线智能体，请先连接后再启动。
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
