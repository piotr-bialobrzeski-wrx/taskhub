---
name: task-hub-canvas-app
description: Task Hub real app state (2026-10-16, commit fb2f25e): canvas UI, Kafelek/Grupa pill bottom-right, one search pill on every screen, menu under the logo, Ułóż/Cofnij, chat history overlay, MCP project tools, rules in three kinds with history
metadata:
  type: project
  modified: 2026-10-16T08:14:34.191Z
---

Repo piotr-bialobrzeski-wrx/taskhub main auto-deploys to https://taskhub-lac.vercel.app. Rounds: 221d491…e91ffe5 (settings, Projects view, search, groups, answer card, history, inline step editing, connector work queue; see [[task-hub-automation]]), b258204 (Kafelek/Grupa pill bottom-right, no chevron, task-added message with title, MCP list_projects/create_project), fb2f25e (rules in three kinds).

What exists now:
- Level 1 `/`: pannable canvas; pill bar: left `.pl` = logo "Task Hub" = menu button (no hamburger, no chevron); centre Kanwa/Lista; right SearchPill + Agent pill. `.mkpill` [Kafelek | Grupa] is fixed bottom-right (canvas view only), `.namer` opens above it; zoom pill bottom-left. CSS vars on `.app`: `--side` (dock/answer/selbar side margin, 280px at 861–1240px so corner pills never overlap the dock) and `--mk-h` (56px on ≤860px: answer card, selbar and toast sit above the mkpill, which sits above the dock). Menu: Projekty, Ustawienia, Zasady pracy, Archiwum, Wyloguj. Zoom pill: after "Ułóż" the button is "Cofnij" for 8 s (`restoreLayout` action). Selection bar: "<n> zadania", pickers, "Oznacz jako gotowe" or "Wróć do pracy" when all selected are done, X far right; width 720 = dock.
- Search: [[task-hub-search-design]].
- Level 2 `/tasks/[id]`: BackPill (→ "/"), MakePill, search with this task's steps first. Step panel (`StepFields.tsx`): title/detail/link edited in place (InlineText → `patchStep`), meta row Narzędzie/Szacunek/Rzeczywiście/Zgoda (Pickers + NumChip), deps chips + "+ po kroku"; actions per status: Uruchom (todo+ready) · Claude pracuje + Zatrzymaj (handoff) · Zatwierdź i wyślij/Zatwierdź + Odłóż (draft) · Cofnij gotowe (done); prompt only in a collapsed "Awaryjnie" PromptBox; delete via ConfirmButton. Runbar only for "Czeka na zadanie" and "Bez kroków". GrowTextarea everywhere (Cel, raport, wynik, rule body).
- Projects view (`.listview.wide` 1080 px): one-line header: colour dot (Picker `menuCls="palette"`, 5 swatches), inline rename, ważność + język (`.pp.boxed`), stats, trash with portal confirm popover, fold; "Nowy projekt" becomes an inline input in the title row; `focus` highlights a card (`.hl`).
- `/settings`, `/rules`: `main.page.withbar` + PageBar (fixed pillbar: history-back, search, agent). Settings anchors #agent, #connections, #agent-key, #connect, #token, #tools. Rules (fb2f25e): grouped Profile / Zasady / Procedury, chips for scope and "gdy: <trigger>", "Historia zmian (n)" details from rule_versions; RuleForm: Rodzaj + Zakres pickers, Skrót do spisu + Wyzwalacz inputs only for procedure; visibility hidden. Details: [[task-hub-rules-proposal]].
- Dock: clock button toggles ChatHistory inside .dockwrap (glass over the canvas, close by X / same icon / click beside / Esc), 50 per page, scoped to the dock's taskId. Task chat lives with the task; global chat deleted after 180 days in `purgeExpired`. Placeholders talk about value, never mechanics.
- Tests: vitest. Gotchas + preview recipe: [[task-hub-canvas-engine-notes]]; groups: [[task-hub-group-membership-rules]].

Open: agent-driven "center on tile X". Connector tool lists are cached at connect time: a thread connected before b258204 does not see list_projects/create_project until reconnected.

**Why:** Piotr wants one consistent UI (same corners, colours, pickers) matching the prototype, everything inside Task Hub.
**How to apply:** new screens use PageBar or the three-zone pillbar; every dropdown is the app's Picker; every textarea is GrowTextarea; new searchable things go into search.ts. See [[task-hub-design-rules]], [[task-hub-minimal-cards]].
