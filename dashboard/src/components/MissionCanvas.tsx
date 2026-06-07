import { motion } from "motion/react";
import type { Agent, Message } from "../types";
import { harnessColor, harnessLabel, isOperator, nameOf } from "../util";

interface NodePoint {
  agent: Agent;
  x: number;
  y: number;
  color: string;
}

interface Pulse {
  id: string;
  from: NodePoint;
  to: NodePoint | { x: number; y: number; color: string };
  color: string;
  label: string;
}

const CENTER = { x: 500, y: 210 };
const RADIUS_X = 330;
const RADIUS_Y = 132;

function agentPoints(agents: Agent[]): NodePoint[] {
  const peers = agents.filter((a) => !isOperator(a));
  const count = Math.max(peers.length, 1);
  return peers.map((agent, index) => {
    const angle = -Math.PI / 2 + (index / count) * Math.PI * 2;
    return {
      agent,
      x: CENTER.x + Math.cos(angle) * RADIUS_X,
      y: CENTER.y + Math.sin(angle) * RADIUS_Y,
      color: harnessColor(agent.harness),
    };
  });
}

function buildPulses(messages: Message[], nodes: NodePoint[]): Pulse[] {
  const byId = new Map(nodes.map((n) => [n.agent.id, n]));
  const hubTarget = { ...CENTER, color: "#5b8cff" };

  return messages
    .slice(-12)
    .flatMap((message) => {
      const from = byId.get(message.from);
      if (!from) return [];

      const targets =
        message.to === "all"
          ? nodes.filter((node) => node.agent.id !== message.from)
          : [byId.get(message.to) ?? hubTarget];

      return targets.map((to, index) => ({
        id: `${message.id}-${index}`,
        from,
        to,
        color: from.color,
        label: message.to === "all" ? "broadcast" : "direct",
      }));
    })
    .slice(-18);
}

function linePath(from: { x: number; y: number }, to: { x: number; y: number }): string {
  const mx = (from.x + to.x) / 2;
  const my = (from.y + to.y) / 2 - 26;
  return `M ${from.x} ${from.y} Q ${mx} ${my} ${to.x} ${to.y}`;
}

export function MissionCanvas({ agents, messages }: { agents: Agent[]; messages: Message[] }) {
  const nodes = agentPoints(agents);
  const pulses = buildPulses(messages, nodes);
  const online = nodes.filter((n) => n.agent.status === "online").length;
  const latest = messages.at(-1);

  return (
    <section className="card mission-card">
      <div className="card-head">
        <span className="card-title">Mission Control</span>
        <span className="ml-auto text-[11px] text-[var(--muted)]">
          {online}/{nodes.length} online · {messages.length} messages
        </span>
      </div>
      <div className="mission-body">
        <svg className="mission-svg" viewBox="0 0 1000 420" role="img" aria-label="Orbit collaboration canvas">
          <defs>
            <filter id="nodeGlow" x="-80%" y="-80%" width="260%" height="260%">
              <feGaussianBlur stdDeviation="8" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <linearGradient id="hubRing" x1="0" x2="1">
              <stop offset="0%" stopColor="#5b8cff" />
              <stop offset="52%" stopColor="#2fe0c4" />
              <stop offset="100%" stopColor="#f4b340" />
            </linearGradient>
          </defs>

          <ellipse cx={CENTER.x} cy={CENTER.y} rx="362" ry="154" fill="none" stroke="rgba(255,255,255,0.1)" />
          <ellipse cx={CENTER.x} cy={CENTER.y} rx="245" ry="96" fill="none" stroke="rgba(255,255,255,0.06)" />

          {nodes.map((node) => (
            <path
              key={`link-${node.agent.id}`}
              d={linePath(CENTER, node)}
              fill="none"
              stroke="rgba(255,255,255,0.09)"
              strokeDasharray="4 9"
            />
          ))}

          {pulses.map((pulse, index) => {
            const path = linePath(pulse.from, pulse.to);
            return (
              <g key={pulse.id}>
                <path d={path} fill="none" stroke={pulse.color} strokeOpacity="0.24" strokeWidth="1.5" />
                <motion.circle
                  r="5"
                  fill={pulse.color}
                  filter="url(#nodeGlow)"
                  initial={{ offsetDistance: "0%", opacity: 0 }}
                  animate={{ offsetDistance: "100%", opacity: [0, 1, 1, 0] }}
                  transition={{
                    duration: 1.8,
                    repeat: Infinity,
                    repeatDelay: 2.2 + (index % 4) * 0.25,
                    delay: (index % 6) * 0.16,
                    ease: "easeInOut",
                  }}
                  style={{ offsetPath: `path("${path}")` }}
                />
              </g>
            );
          })}

          <motion.g
            animate={{ scale: [1, 1.025, 1] }}
            transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
            style={{ transformBox: "fill-box", transformOrigin: "center" }}
          >
            <circle cx={CENTER.x} cy={CENTER.y} r="58" fill="rgba(91,140,255,0.12)" stroke="url(#hubRing)" />
            <circle cx={CENTER.x} cy={CENTER.y} r="35" fill="#101827" stroke="rgba(255,255,255,0.16)" />
            <text x={CENTER.x} y={CENTER.y - 3} textAnchor="middle" className="mission-hub-text">
              HUB
            </text>
            <text x={CENTER.x} y={CENTER.y + 19} textAnchor="middle" className="mission-hub-subtext">
              REST · SSE · MCP
            </text>
          </motion.g>

          {nodes.map((node) => (
            <g key={node.agent.id}>
              <circle
                cx={node.x}
                cy={node.y}
                r="32"
                fill={node.agent.status === "online" ? `${node.color}24` : "rgba(255,255,255,0.05)"}
                stroke={node.agent.status === "online" ? node.color : "rgba(255,255,255,0.18)"}
                filter={node.agent.status === "online" ? "url(#nodeGlow)" : undefined}
              />
              <circle cx={node.x} cy={node.y} r="5" fill={node.agent.status === "online" ? node.color : "#6b7280"} />
              <text x={node.x} y={node.y + 48} textAnchor="middle" className="mission-node-name">
                {node.agent.name}
              </text>
              <text x={node.x} y={node.y + 64} textAnchor="middle" className="mission-node-meta">
                {node.agent.role ?? harnessLabel(node.agent.harness)}
              </text>
            </g>
          ))}
        </svg>

        <div className="mission-strip">
          <div>
            <span>latest</span>
            <strong>{latest ? `${nameOf(agents, latest.from)} → ${nameOf(agents, latest.to)}` : "waiting for traffic"}</strong>
          </div>
          <p>{latest?.content ?? "Connect Claude Code, Codex, or another MCP client to watch coordination pulses live."}</p>
        </div>
      </div>
    </section>
  );
}
