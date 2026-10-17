---
name: task-hub-six-questions-answers-2026-10-17
description: Piotr's answers (2026-10-17) to the architecture thread's six questions: company-paid Claude account and migration plan, learning loop after his touch, varied transcript sources, Pirxey & Widelab one company, day plan only in Task Hub, Task Hub connects via MCP protocols (Q4 approved)
metadata:
  type: project
  modified: 2026-10-17T15:59:44.502Z
---

**Answers so far (2026-10-17 15:34 UTC):** Q1: the Claude account piotr.bialobrzeski@pirxey.com is paid by the company and tied to the company mailbox, so it will be lost sooner or later (cloud account cannot be moved to another email). Consequence (thread reply 15:35): this Claude project, its threads and memory, the hourly routine, the Task Hub connector authorisation and the Mac Claude Code login (used by the bridge) disappear with it; Task Hub (DB, rules), the Mac app with its bridge token and the repo survive. The thread backed up notes, screenshots and Claude project memory into the repo under notatki/ (commit 201e67d) and will refresh them at milestones. Migration to a private account (~30 min): add the Task Hub connector in the new account, `claude` + `/login` on the Mac, point a thread in a new project at notatki/pamiec to recreate routine and context. Only "zatwierdzam" for rules v3 is still open.

**Answers Q2-Q6 (Piotr 2026-10-17 15:36 UTC):** Q2: learning loop as the thread recommended (rule changes applied only after his touch). Q3: transcripts will come from varied, not yet configured sources (MCP or API to Fireflies, Google Drive, files sent by others); the NDA part was not answered. Q4: he did not understand the question about protocols (MCP, iCal, IMAP) inside Task Hub and asked for a better explanation; the thread owes him that. Q5: Pirxey and Widelab = one company with two brands. Q6: day plan only as a proposal inside Task Hub for now; calendar blocks may be added later.

**Why:** these decisions shape the company model, learning loop, journal intake and account migration.
**How to apply:** treat them as settled; Q4 APPROVED by Piotr 2026-10-17 15:59 UTC: protocols yes (Task Hub connects through MCP, iCal, IMAP as a generic client), per-app integrations and field mappings no. See [[task-hub-integrations-verdict-2026-10-17]], [[task-hub-vision-long-term]].
