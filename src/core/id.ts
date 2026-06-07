import { randomUUID } from "node:crypto";

const slug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24) || "agent";

// Human-readable but unique: "claude-code-a1b2"
export const newAgentId = (name: string): string => `${slug(name)}-${randomUUID().slice(0, 4)}`;

// Prefixed short id: "t_1a2b3c4d"
export const newId = (prefix: string): string => `${prefix}_${randomUUID().slice(0, 8)}`;
