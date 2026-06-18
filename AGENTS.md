# AgentForge Mission Control Instructions

Always read `PROJECT_MEMORY.md` before changing this project.

This workspace is named `AgentForge-MissionControl`. It is the future source workspace for the AgentHub-to-main-Agent pivot.

This repository is being turned into a main Agent / Orchestrator product:

- AgentHub receives a project goal.
- The main Agent decomposes it into a task DAG.
- Sub-agents receive bounded task contracts and execute.
- Shared coordination state keeps task granularity, file scope, interface contracts, memory, and verification aligned.
- Every coding session must append or update `PROJECT_MEMORY.md` with completed changes and the next recommended work.

Do not treat AgentHub as only a multi-model chat shell. Preserve the original goal: project intake -> decomposition -> collaboration -> verification -> synthesis.
