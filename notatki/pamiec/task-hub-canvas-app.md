---
name: task-hub-canvas-app
description: Task Hub real app state (2026-10-17, commit da40d64): canvas UI, Kafelek/Grupa pill bottom-right, one search pill on every screen, menu under the logo, Ułóż/Cofnij, chat history overlay, rules in three kinds with history, companies over projects
metadata:
  type: project
  modified: 2026-10-17T16:18:36.458Z
---

Repo piotr-bialobrzeski-wrx/taskhub main auto-deploys to https://taskhub-lac.vercel.app. Rounds: 221d491…e91ffe5 (settings, Projects view, search, groups, answer card, history, inline step editing, connector work queue; see [[task-hub-automation]]), b258204 (Kafelek/Grupa pill bottom-right, task-added message with title, MCP list_projects/create_project), fb2f25e (rules in three kinds, [[task-hub-rules-proposal]]), da40d64 (companies, sphere, rule origin, [[task-hub-companies-layer]]).

What exists now:
- Level 1 `/`: pannable canvas; pill bar: left `.pl` = logo "Task Hub" = menu button (no hamburger, no chevron); centre Kanwa/Lista; right SearchPill + Agent pill. `.mkpill` [Kafelek | Grupa] fixed bottom-right (canvas view only), `.namer` opens above it; zoom pill bottom-left. CSS vars on `.app`: `--side` (280px at 861–1240px) and `--mk-h` (56px on ≤860px). Menu: Projekty, Ustawienia, Zasady pracy, Archiwum, Wyloguj. After "Ułóż" the zoom-pill button is "Cofnij" for 8 s. Selection bar: "<n> zadania", pickers, "Oznacz jako gotowe" / "Wróć do pracy", X far right; width 720 = dock.
- Search: [[task-hub-search-design]].
- Level 2 `/tasks/[id]`: BackPill, MakePill, search with this task's steps first. Step panel (`StepFields.tsx`): title/detail/link edited in place, meta row Narzędzie/Szacunek/Rzeczywiście/Zgoda, deps chips; actions per status: Uruchom · Claude pracuje + Zatrzymaj · Zatwierdź i wyślij/Zatwierdź + Odłóż · Cofnij gotowe; prompt only in a collapsed "Awaryjnie" PromptBox. GrowTextarea everywhere.
- Projects view (`Projects.tsx`, `.listview.wide` 1080 px): company sections with project rows underneath (details in [[task-hub-companies-layer]]); project row: colour dot (palette Picker), inline rename, company / ważność / język pickers, stats, trash with confirm popover, fold; "Nowa firma" and "Nowy projekt" become an inline input in the title row; `focus` highlights `#proj-<id>`.
- `/settings`, `/rules`: `main.page.withbar` + PageBar (fixed pillbar: history-back, search, agent). Rules: grouped Profile / Zasady / Procedury, chips for scope, "gdy: <trigger>", "z: <firma>", "Historia zmian (n)"; RuleForm: Rodzaj + Zakres pickers, target picker per scope, Pochodzenie, Skrót + Wyzwalacz only for procedure.
- Dock: clock button toggles ChatHistory; task chat lives with the task; global chat deleted after 180 days. Placeholders talk about value, never mechanics.
- Tests: vitest (63). Gotchas + preview recipe: [[task-hub-canvas-engine-notes]]; groups: [[task-hub-group-membership-rules]].

Open: agent-driven "center on tile X". Connector tool lists are cached at connect time: reconnect to see tools added after connecting.

**Why:** Piotr wants one consistent UI (same corners, colours, pickers) matching the prototype, everything inside Task Hub.
**How to apply:** new screens use PageBar or the three-zone pillbar; every dropdown is the app's Picker; every textarea is GrowTextarea; new searchable things go into search.ts. See [[task-hub-design-rules]], [[task-hub-minimal-cards]].
