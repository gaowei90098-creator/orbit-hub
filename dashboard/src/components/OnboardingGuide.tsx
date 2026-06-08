import { useState } from "react";
import { Bot, Loader2, Rocket, Eye, CheckCircle2, Sparkles } from "lucide-react";
import type { HubActions } from "../api";
import type { Agent } from "../types";
import { isOperator } from "../util";

export function OnboardingGuide({
  agents,
  hasTasks,
  actions,
}: {
  agents: Agent[];
  hasTasks: boolean;
  actions: HubActions;
}) {
  const [seeding, setSeeding] = useState(false);
  const [seeded, setSeeded] = useState(false);

  const peers = agents.filter((a) => !isOperator(a));
  const hasAgents = peers.length > 0;

  // Hide when user has connected agents AND has tasks — they've figured it out.
  if (hasAgents && hasTasks) return null;

  const seedDemo = async () => {
    setSeeding(true);
    try {
      await actions.seedDemo();
      setSeeded(true);
    } catch {
      // ignore
    } finally {
      setSeeding(false);
    }
  };

  const steps = [
    {
      icon: Bot,
      title: "连接智能体",
      description: "让 Claude Code 和 Codex 通过 MCP 接入协作枢纽。",
      done: hasAgents,
    },
    {
      icon: Rocket,
      title: "输入协作目标",
      description: "描述要做的事，系统会自动拆分任务并分配给智能体。",
      done: hasTasks,
    },
    {
      icon: Eye,
      title: "观察协作过程",
      description: "任务状态、文件锁、消息和冲突都会实时更新在面板中。",
      done: false,
    },
  ];

  return (
    <section className="panel-card onboarding-guide">
      <div className="panel-head">
        <div>
          <h2>欢迎使用 Orbit</h2>
          <p>三步开始多智能体协作开发。</p>
        </div>
        <Sparkles size={20} className="onboarding-sparkle" />
      </div>

      <div className="onboarding-steps">
        {steps.map((step, i) => {
          const Icon = step.icon;
          return (
            <div key={i} className={`onboarding-step ${step.done ? "done" : ""}`}>
              <span className="onboarding-step-number">
                {step.done ? <CheckCircle2 size={18} /> : i + 1}
              </span>
              <Icon size={20} className="onboarding-step-icon" />
              <div>
                <b>{step.title}</b>
                <span>{step.description}</span>
              </div>
            </div>
          );
        })}
      </div>

      {!hasAgents && !seeded && (
        <div className="onboarding-demo">
          <span>还没有真实的智能体？</span>
          <button
            className="btn btn-small"
            type="button"
            disabled={seeding}
            onClick={() => void seedDemo()}
          >
            {seeding ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />}
            加载演示数据
          </button>
        </div>
      )}
    </section>
  );
}
