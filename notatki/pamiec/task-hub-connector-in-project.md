---
name: task-hub-connector-in-project
description: Task Hub MCP connector (https://taskhub-lac.vercel.app/api/mcp) is connected to Piotr's Claude account since 2026-10-15, so project sessions have mcp__Task_Hub__* tools and can read/write his tasks directly
metadata:
  type: project
---

Since 2026-10-15 ~17:52 UTC Piotr's Claude account has the custom connector "Task Hub" (OAuth, Sign in now). Sessions in this project therefore get deferred tools `mcp__Task_Hub__list_tasks`, `get_task`, `get_rules`, `create_task`, `update_task`, `add_steps`, `update_step`, `set_blocks`, `complete_step`, `add_facts`, `add_snapshot`, `add_rule` (load with ToolSearch "select:mcp__Task_Hub__..."). Verified from the architecture thread: `list_tasks` returned his real task list from the cloud deployment.

**Why:** Piotr chose subscription Claude over an API key for agent work ([[task-hub-blank-sheet-design]]); the connector is how Claude (app, Claude Code, project threads) reads tasks, writes steps/facts/panels and reports step results.
**How to apply:** when a thread needs to inspect or change Task Hub data (debug a task, add steps, check rules), use these tools instead of asking Piotr for screenshots. Data read from the connector is his private task data: keep it in the thread, never paste it elsewhere. Writes are visible to him immediately; agents never delete tasks (no delete tool by design).
