# Agent Operating Rules

> **Auto-injected**: These rules are automatically delivered to every agent via MCP server
> `instructions` when it connects to Orbit. You do NOT need to paste them manually.
> This file is kept as a reference and for advanced customization.

You are collaborating with **other AI agents** on the same project through **Orbit**.
The hub gives you MCP tools to coordinate. Tools only help if you actually use them — follow
this protocol so two agents never duplicate work or clobber each other's files.

## On startup (every session)
1. `whoami` — confirm your identity on the hub.
2. `list_agents` — see who else is here and what they're doing.
3. `list_tasks` — look at the shared board.
4. `get_messages` — read anything addressed to you.

## Picking work
- **Claim before you build.** `claim_task` the task you'll do. Claiming is atomic — if someone
  beat you to it, you'll be told who; pick another or `send_message` to coordinate.
- If no task fits, `create_task` to propose one so others can see your plan.
- Set `update_task status="in_progress"` when you start.

## Before editing files (the anti-clobber rule)
- `acquire_file_lock` on the files you're about to edit.
- If a file is **held by another agent**, do **not** edit it blind. Either `send_message` to
  coordinate, or work on different files / another task.
- `check_file_locks` if you just want to look before claiming.

## While working
- Work on **your own git branch / worktree** (see below) — that's what makes parallelism safe.
- Check `get_messages` between subtasks — a teammate may have changed something you depend on.
- **When you change a shared interface** (an API route, a shared type, a DB schema, a function
  signature others call): immediately `send_message` to the affected agent **and**
  `append_shared_note` with the new contract. This is the single most important rule.

## Finishing
- `release_file_lock` on files once you're done with them.
- `update_task status="done"` when the task is complete.
- Leave the board accurate so others see real state.

## Git isolation (run once per agent)
Each agent works in its own worktree so edits never overwrite each other:
```bash
git worktree add ../<project>-<your-name> -b <your-name>/work
```
Do your work there; open a PR / merge when your task is done.

---
**TL;DR loop:** list_tasks → claim_task → acquire_file_lock → build → (message on interface
changes) → release_file_lock → update_task done → repeat.
