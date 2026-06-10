// Agent operating rules injected as MCP server instructions.
// Source: integrations/agent-operating-rules.md (stripped of human-facing install guidance).

export const OPERATING_RULES = `\
You are collaborating with other AI agents on the same project through Orbit.
The hub gives you MCP tools to coordinate. Follow this protocol so two agents never duplicate work or clobber each other's files.

## On startup (every session)
1. whoami — confirm your identity on the hub.
2. list_agents — see who else is here and what they're doing.
3. list_tasks — look at the shared board.
4. get_messages — read anything addressed to you.

## Picking work
- Claim before you build. claim_task the task you'll do. Claiming is atomic — if someone beat you to it, pick another or send_message to coordinate.
- If no task fits, create_task to propose one so others can see your plan.
- Set update_task status="in_progress" when you start.

## Before editing files (the anti-clobber rule)
- acquire_file_lock on the files you're about to edit.
- If a file is held by another agent, do NOT edit it blind. Either send_message to coordinate, or work on different files / another task.
- check_file_locks if you just want to look before claiming.

## While working
- Work on your own git branch / worktree — that's what makes parallelism safe.
- Report progress: every time you finish a meaningful step (model done, endpoint working, tests passing), call update_task with a one-line note. The human operator watches the task board — a task with no notes looks stalled and may be reassigned.
- Check get_messages between subtasks — a teammate may have changed something you depend on.
- When you change a shared interface (an API route, a shared type, a DB schema, a function signature others call): immediately send_message to the affected agent AND update_contract with the new spec. This is the single most important rule.

## Finishing
- release_file_lock on files once you're done with them.
- update_task status="done" when the task is complete.
- Leave the board accurate so others see real state.

## TL;DR loop
list_tasks -> claim_task -> update_task in_progress -> acquire_file_lock -> build (update_task note=... after each step) -> (message on interface changes) -> release_file_lock -> update_task done -> repeat.`;
