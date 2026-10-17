---
name: task-hub-automation
description: Task Hub automation without an API key (2026-10-16): bridge on Piotr's Mac works immediately, a scheduled task on his Claude account runs list_work hourly (7:07–22:07 Warsaw) as fallback and stands down when the bridge is alive; step states, approval flow, MCP tools
metadata:
  type: project
  modified: 2026-10-16T11:33:50.010Z
---

Decision (Piotr, 2026-10-16 08:41Z): anything he hands in must start being worked on automatically, with no Claude window and no prompt copying, like Project Hub. Analysis, research and drafts run on their own; publishing to external apps only after his approval (later maybe without). He accepts that editing steps may throw away draft work.

Two runners, same protocol (list_work order): (1) the BRIDGE in the Task Hub Mac app ([[task-hub-mac-app]]) polls every 15 s by day / 60 s at night and runs Claude Code immediately; (2) the scheduled task "Task Hub: automat (co godzinę)" on his Claude account, id trig_01BomyMEStNjX5gJAP9oTbVY (recreated 2026-10-16 11:32Z by thread "Automat co godzinę: odtworzenie" because update_trigger cannot change a fresh-session task and create_trigger is refused from device-linked sessions AND from the coordinator; only a plain cloud thread can create it). Cron `CRON_TZ=Europe/Warsaw 7 7-22 * * *`, fresh session per firing, notifications off; the `connectors` parameter is refused, but each run starts as a THREAD in this project with the project's connectors (verified 08:57Z). Every run appears as a project thread with that title. When the bridge was seen in the last 2 min, `list_work` (without force) answers "MOSTEK AKTYWNY…" and the prompt tells the run to reply "Mostek pracuje, nic nie robię." and stop. Old id trig_01EhEPYbm1fPA1vo6JSSEcbk is gone.

Work order from `list_work`: steps in progress (status handoff), approved drafts to send, tasks without steps (add_steps), Piotr's answers, ready steps without approval (start_step → do → add_facts → complete_step), steps needing approval (set_blocks with a `draft` block, status proposed → step "draft" = Do zatwierdzenia). `leave_step(stepId, reason)` gives a step back with a chat note. complete_step/add_steps/set_blocks write a line into the task's chat, so the answer card in Task Hub shows what happened.

App side: step status `handoff` = "Pracuje" (tile ring pulses, panel shows "Claude pracuje od HH:MM" + "Zatrzymaj"); "Uruchom" is only a fallback; "Zatwierdź i wyślij" on a draft step sets handoff + draft block approved; "Cofnij gotowe" only on done steps. Texts about the cadence come from `src/lib/auto.ts` (AUTO_EVERY, BRIDGE_TEXT) and must match the scheduled task.

**Why:** no prepaid API key; the runner is his subscription Claude. Hourly is the platform minimum, hence the bridge for immediacy; `fire_trigger` works only without extra text for this task.
**How to apply:** when changing the cadence, change both the scheduled task and AUTO_EVERY; to change its prompt, delete and recreate it from a cloud thread (not device-linked); new MCP tools must be read-safe (never delete). Related: [[task-hub-mac-app]], [[project-hub-bridge-mechanism]], [[task-hub-canvas-app]].
