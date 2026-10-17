---
name: task-hub-integrations-verdict-2026-10-17
description: Architecture thread verdict 2026-10-17 on Piotr's vision: rules model stays plus company level and learning loop; integrations REVERSED to connections owned by Task Hub (MCP gateway, iCal calendars); six open questions for Piotr
metadata:
  type: project
  modified: 2026-10-17T15:37:51.547Z
---

Verdict of thread "Architektura aplikacji Task Hub" (reply 2026-10-17 15:31 UTC, note /mnt/project-files/notatki/2026-10-17-wizja-task-hub-zgodnosc.md) on the vision in [[task-hub-vision-long-term]]:

- Rules model (profile / rule / procedure with version history, [[task-hub-rules-proposal]]) fits and stays; v3 content remains valid. Additions: a "company" level above project (Pirxey & Widelab, Veloza, others; today a company masquerades as a project), private vs professional sphere derived from company, rule origin ("mine" vs "developed at company X" so it can be exported to the company), two new data profiles ("Mój rytm", "Kompetencje"), and a learning loop: record signals (original draft next to approved one, chat remarks, reasons for handing a step back, journal insights), a weekly run, and an inbox of proposed rule changes with evidence.
- Integrations: REVERSES the 2026-10-16 verdict in the connectors note. Several accounts of the same app, several companies at once and all calendars cannot be done on Claude-client connectors (one account per app). Connections must be a Task Hub entity; goal = MCP gateway inside Task Hub, registry is stage one. Order: connection registry, calendars via private iCal URLs (no OAuth, any number of accounts, unlocks the day plan), MCP client with an approval gate in code (Pirxey World or ClickUp first), multi-account mail only when needed. "Blank sheet" principle refined: protocols yes, per-app mappings no.
- New entities: company, connection, journal with transcripts and analysis, insights with evidence, rule-change proposals, day plan; a step gets a connection and a mode (execution vs analysis/creation). Morning is a separate run: collects, asks one card about borderline items, builds the plan from free calendar windows and his rhythm, shows a "Dzień" view.
- Six questions awaiting Piotr (one word each): 1 Claude account his or company's; 2 rule changes only after his touch (recommended) or automatic with notification; 3 transcript sources and whether client conversations may be stored whole (NDA); 4 consent to protocols (MCP, iCal, IMAP) inside Task Hub (recommended yes); 5 Pirxey and Widelab as one company (recommended) or two; 6 day plan only in Task Hub (recommended) or also as calendar blocks. Answers: see [[task-hub-six-questions-answers-2026-10-17]].
- Uploading rules v3 does not wait for the answers: after "zatwierdzam" the thread uploads and adds company scope by script.

**Why:** this supersedes the "connector = pipe, option C now, B later" recommendation of 2026-10-16; future design work must not assume one account per app via Claude connectors.
**How to apply:** when Piotr answers the six questions (likely in the architecture thread or project chat), forward to that thread; record the answers here. See [[task-hub-blank-sheet-design]].
