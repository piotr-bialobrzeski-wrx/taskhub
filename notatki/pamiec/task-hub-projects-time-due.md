---
name: task-hub-projects-time-due
description: Task Hub decisions (2026-10-14) on projects, step estimates in 15-min units, automatic time tracking, due dates with priority boost, and the agent "mam 1,5 h" group
metadata:
  type: project
  modified: 2026-10-14T23:15:33.556Z
---

Piotr's request (2026-10-14, prototype Version 23, see [[task-hub-prototype-ui]]):
- Projects: every task may belong to one project (labels stored in the board doc, with colour). Menu "Projekty" view lists projects and their tasks; membership changed from the task panel picker, batch bar picker, or Projects view; rename/delete there.
- Estimates: per step, in 15-min units, minimum 15 (default 15). Tile shows remaining sum "~1 h 30 min".
- Actual time: measured automatically, no manual start. Timer follows the open step (pauses when the tab is hidden); a step handed off to Claude counts wall time until the report. Manual correction with +/−15 min stepper sets `spentManual`.
- Due date optional; shown as a chip on the tile ("do 15 paź" / "po terminie"). Effective priority = level + boost: late/today +2, within 2 days +1, +1 when remaining estimate exceeds ~60% of available work hours (6 h/day) before the deadline, capped at 5. Tile shows "↑" with explanation. Canvas auto-layout sorts by effective priority, most important on top.
- Project weight (2026-10-14, v24): each project has "ważność" 1–5 (default 3) set via a picker in the Projects view; project name there is itself the rename control. Effective priority = set level + (weight−3)×0.5 + deadline (late/today +2, ≤2 days +1) + workload (+1 when calibrated remaining work > 60% of 6 h/day until due) + 0.5 when the task blocks other tasks, rounded and clamped 1–5. Every factor is listed in the task panel ("Priorytet X/5, bo") and in tooltips; the agent gets the same reasons.
- Learning (v24): every finished step with measured time is logged into board doc `stats` {tool, projectId, est, spent}; calibration = median spent/est per tool (≥3 samples) or overall (≥5). Shown under the step's estimate ("takie kroki trwają zwykle ×1,5") and given to the agent as KALIBRACJA so its estimates improve. Reopening a step un-logs it.
- Step panel (v24): action buttons sit at the top right under the title; the panel is the only scroll, text areas auto-grow. Each step has a "Link" field (URL to the item in the external app, e.g. ClickUp ticket); when set, an "Otwórz w ClickUp"/"Otwórz link" button appears next to the actions and the step tile shows "· link". Agent can set link via update_step/KROK; drafts and hand-off reports auto-fill it from the first URL.
- Agent: "mam 1,5 h, wybierz zadania" → action create_group {name, taskIds}; the chosen tiles are moved into their own column to the right of the board, then grouped (so unrelated tiles are not captured by the bounding box). Agent can set due/project/est on create_task and update_task.

**Why:** Piotr wants the app to plan his day from estimates and deadlines, not only list tasks.
**How to apply:** keep these rules when building the real app's scheduler; the agent must see remaining estimate, due date and today's date in its context.
