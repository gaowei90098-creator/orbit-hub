import type { Agent } from "../core/types.js";

export interface TaskDraft {
  title: string;
  description: string;
  area: "frontend" | "backend" | "general";
  files: string[];
  // 1.2 Task contract（lead planner 必填；模板回退时尽量给出合理默认）。
  fileScope: string[];
  doneWhen: string;
  verifyCommand: string;
  interfaceRef: string;
}

export interface MissionPlan {
  template: string;
  templateLabel: string;
  tasks: TaskDraft[];
  // 1.1 拆分来源：lead = claude headless 真实读仓库拆的；template = 关键词模板回退。
  source: "lead" | "template";
  note?: string; // 回退原因等给用户看的说明
}

// 模板内的任务草稿：契约字段可省（由 applyGoalToTasks 填默认值）。
type TemplateTaskDraft = Omit<TaskDraft, "fileScope" | "doneWhen" | "verifyCommand" | "interfaceRef"> &
  Partial<Pick<TaskDraft, "fileScope" | "doneWhen" | "verifyCommand" | "interfaceRef">>;

interface Template {
  id: string;
  label: string;
  keywords: string[];
  tasks: TemplateTaskDraft[];
}

const TEMPLATES: Template[] = [
  {
    id: "fullstack",
    label: "全栈应用",
    keywords: ["全栈", "full-stack", "fullstack", "应用", "app", "网站", "web"],
    tasks: [
      {
        title: "前端 UI 与交互",
        description: "负责页面结构、组件、样式和用户交互逻辑。开工前先 get_contract 读取接口约定，再 acquire_file_lock 锁定要改的文件。",
        area: "frontend",
        files: ["src/components/**", "src/pages/**", "public/**"],
      },
      {
        title: "后端 API 与数据",
        description: "负责 API 接口、数据模型和业务逻辑。开工前先 update_contract 写入接口约定，再 acquire_file_lock 锁定后端文件；接口有变要 send_message 通知前端。",
        area: "backend",
        files: ["src/api/**", "src/server/**", "src/core/**"],
      },
    ],
  },
  {
    id: "frontend",
    label: "纯前端",
    keywords: ["前端", "页面", "UI", "组件", "component", "游戏", "game", "动画", "canvas", "样式", "css", "html"],
    tasks: [
      {
        title: "核心逻辑与渲染",
        description: "实现核心功能逻辑和主要渲染。acquire_file_lock 锁定核心文件后开始。",
        area: "frontend",
        files: ["src/**"],
      },
      {
        title: "样式与交互打磨",
        description: "负责样式、动画、响应式适配和用户交互细节。与核心逻辑开发者保持 send_message 同步。",
        area: "frontend",
        files: ["src/styles/**", "public/**"],
      },
    ],
  },
  {
    id: "backend",
    label: "API / 后端服务",
    keywords: ["后端", "API", "接口", "服务", "server", "数据库", "database", "微服务"],
    tasks: [
      {
        title: "API 接口与路由",
        description: "设计并实现 API 端点、请求验证和响应格式。先 update_contract 写入接口定义。",
        area: "backend",
        files: ["src/routes/**", "src/api/**"],
      },
      {
        title: "数据层与业务逻辑",
        description: "实现数据模型、数据库操作和核心业务逻辑。与 API 层保持 send_message 同步。",
        area: "backend",
        files: ["src/models/**", "src/core/**", "src/services/**"],
      },
    ],
  },
  {
    id: "cli",
    label: "CLI 工具",
    keywords: ["CLI", "命令行", "脚本", "script", "工具", "tool", "自动化"],
    tasks: [
      {
        title: "核心逻辑",
        description: "实现工具的核心功能模块，纯逻辑，不涉及 CLI 交互层。",
        area: "backend",
        files: ["src/core/**", "src/lib/**"],
      },
      {
        title: "CLI 入口与参数解析",
        description: "实现命令行入口、参数解析、帮助信息和输出格式化。依赖核心逻辑模块的接口。",
        area: "general",
        files: ["src/cli/**", "bin/**"],
      },
    ],
  },
  {
    id: "refactor",
    label: "重构 / 优化",
    keywords: ["重构", "refactor", "优化", "整理", "清理", "性能", "迁移"],
    tasks: [
      {
        title: "结构调整与重构",
        description: "执行主要的代码结构调整。开工前 declare_intent 声明修改范围，避免与其他人冲突。",
        area: "general",
        files: [],
      },
      {
        title: "测试补全与验证",
        description: "为重构后的代码补充测试，确保行为不变。在重构完成后开始。",
        area: "general",
        files: ["tests/**", "src/**/*.test.*"],
      },
    ],
  },
  {
    id: "bugfix",
    label: "修 Bug",
    keywords: ["修复", "修", "bug", "fix", "问题", "报错", "异常", "crash"],
    tasks: [
      {
        title: "定位并修复问题",
        description: "分析问题原因，定位到具体代码，实施修复。acquire_file_lock 锁定修改文件。",
        area: "general",
        files: [],
      },
      {
        title: "回归测试",
        description: "为修复的问题编写回归测试，确保不会再次出现。在修复完成后开始。",
        area: "general",
        files: ["tests/**"],
      },
    ],
  },
];

const CJK_RANGE = /[一-鿿㐀-䶿]/;

function matchesKeyword(text: string, keyword: string): boolean {
  const kw = keyword.toLowerCase();
  if (CJK_RANGE.test(kw)) return text.toLowerCase().includes(kw);
  const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[\\s,;.!?/\\-_])${escaped}(?:$|[\\s,;.!?/\\-_])`, "i").test(text);
}

function detectTemplate(goal: string): Template {
  let best: Template | null = null;
  let bestScore = 0;
  for (const tpl of TEMPLATES) {
    const score = tpl.keywords.filter((kw) => matchesKeyword(goal, kw)).length;
    if (score > bestScore) {
      bestScore = score;
      best = tpl;
    }
  }
  return best ?? TEMPLATES[0]!;
}

function applyGoalToTasks(tasks: TemplateTaskDraft[], goal: string): TaskDraft[] {
  return tasks.map((t) => ({
    ...t,
    title: `${t.title} · ${goal}`,
    description: `目标：${goal}\n\n${t.description}`,
    // 模板没有仓库知识：fileScope 退化为 files 的 advisory 范围，其余契约字段留待用户在预览里补。
    fileScope: t.fileScope ?? t.files,
    doneWhen: t.doneWhen ?? "",
    verifyCommand: t.verifyCommand ?? "",
    interfaceRef: t.interfaceRef ?? "",
  }));
}

export function planTasks(goal: string): MissionPlan {
  const tpl = detectTemplate(goal);
  return {
    template: tpl.id,
    templateLabel: tpl.label,
    tasks: applyGoalToTasks(tpl.tasks, goal),
    source: "template",
  };
}

export function listTemplates(): { id: string; label: string }[] {
  return TEMPLATES.map((t) => ({ id: t.id, label: t.label }));
}

export function planWithTemplate(goal: string, templateId: string): MissionPlan {
  const tpl = TEMPLATES.find((t) => t.id === templateId) ?? TEMPLATES[0]!;
  return {
    template: tpl.id,
    templateLabel: tpl.label,
    tasks: applyGoalToTasks(tpl.tasks, goal),
    source: "template",
  };
}

export interface AssignedDraft extends TaskDraft {
  assignee: string | null;
}

export function assignDraftsToAgents(drafts: TaskDraft[], onlineAgents: Agent[]): AssignedDraft[] {
  const peers = onlineAgents.filter((a) => a.harness !== "other" && a.status === "online");

  function agentArea(agent: Agent): "frontend" | "backend" | "general" {
    const role = (agent.role ?? "").toLowerCase();
    if (role) {
      if (role.includes("前端") || role.includes("ui") || role.includes("front")) return "frontend";
      if (role.includes("后端") || role.includes("api") || role.includes("back") || role.includes("服务")) return "backend";
      return "general";
    }
    if (agent.harness === "codex") return "frontend";
    if (agent.harness === "claude-code") return "backend";
    return "general";
  }

  const frontendAgent = peers.find((a) => agentArea(a) === "frontend") ?? null;
  const backendAgent = peers.find((a) => agentArea(a) === "backend") ?? null;
  const taken = new Set([frontendAgent?.id, backendAgent?.id].filter((x): x is string => Boolean(x)));
  const generalAgents = peers.filter((a) => !taken.has(a.id));
  let generalIdx = 0;

  return drafts.map((draft) => {
    let assignee: string | null = null;
    if (draft.area === "frontend") assignee = frontendAgent?.id ?? null;
    else if (draft.area === "backend") assignee = backendAgent?.id ?? null;
    else if (generalAgents.length > 0) {
      assignee = generalAgents[generalIdx % generalAgents.length]!.id;
      generalIdx++;
    }
    return { ...draft, assignee };
  });
}
