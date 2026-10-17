---
name: task-hub-vision-long-term
description: Piotr's long-term vision for Task Hub (2026-10-17): lifelong employer-independent assistant, multi-company and own projects, many connectors per kind, morning planning, self-evolving rules
metadata:
  type: project
  modified: 2026-10-17T15:28:18.975Z
---

Piotr's requirements stated 2026-10-17 15:26 UTC in thread "Architektura aplikacji Task Hub" (message cmsg_01JjjhxUvUoqDvZtMHn9rgA9RQtLNw8PgRWs8tveCmit7Q); he asked the thread to judge whether the current rules architecture (profile/rule/procedure, see [[task-hub-rules-proposal]]) and the integration architecture match them:

- Task Hub is HIS assistant for years, independent of any company. He is a private contractor, may work with several companies at once (Pirxey, Widelab, Veloza, others); good practices and rules he develops stay with him and he shares them with companies. Rules must not be owned by a company context.
- Two kinds of projects: external (per company) and his own (e.g. 3D board game "Shattered Lands"). Private vs professional must be distinguishable.
- Store transcripts of conversations for self-reflection (what went well/badly, what to work on): needs connectors for ingest, storage, later analysis.
- Insights from all projects feed texts for LinkedIn and Medium (personal brand).
- Connectors: Pirxey/Widelab resources may come through the "Pirxey World" connector (aggregates many connections), but he must be able to add other connections, and SEVERAL of the same kind (multiple Gmail, Figma, Slack, calendars), since each company uses different ones and he uses many at once.
- Task Hub should see all his data (all calendars, all skills) to advise on tasks.
- Rules, procedures and profiles should evolve automatically with him based on inputs (analysis that learns), not require manual edits.
- Every morning: collect new to-dos, triage (important/unimportant, do/reject), build a work plan fitted to his calendar gaps (90 min free: urgent big task; 30 min: something that fits) and his energy: mornings for already-decomposed work, ~16:00 creativity/analysis window.

**Why:** these are the acceptance criteria for the rules/integration architecture and for future features (morning brief, transcripts, multi-account connectors, auto-evolving rules).
**How to apply:** check new design decisions against this list; anything tied to one company account or one connector per kind contradicts it. See [[task-hub-blank-sheet-design]], [[task-hub-projects-time-due]].
