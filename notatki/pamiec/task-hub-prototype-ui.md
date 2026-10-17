---
name: task-hub-prototype-ui
description: Task Hub canvas prototype artifact link and Piotr's UI/interaction decisions (2026-10-14)
metadata:
  type: project
  modified: 2026-10-14T20:10:45.214Z
---

Prototype artifact (private, db + sample capabilities): https://claude.ai/artifact/HWrKZw4sugfknXHXoeGKsL, built in thread "Architektura aplikacji Task Hub". See [[task-hub-architecture]].

Piotr's decisions (2026-10-14):
- Two canvas levels: level 1 = all tasks and their order; double-click a tile to enter its steps. Top-left: hamburger menu on level 1, back button + task name on level 2. Kanwa/Lista switch.
- Tiles like TapET: priority is a separate 5-segment bar (1–5, more = more important), plus progress bar, source icon, summary.
- Wide, resizable detail panel.
- Mouse control like Project Hub: wheel zooms, middle button pans, left click selects one tile, left drag on empty space = marquee multi-select (RTS style). Batch bar: priority, mark done, delete; more actions later.
- Groups (2026-10-14): abstract rectangles on either canvas level for visual organisation (e.g. "rano", "trudne"). Membership = tile centre inside rect (drag in/out, resize to absorb). Creating a group never moves tiles; "Ułóż" keeps groups and refits them. Buttons "Kafelek"/"Grupa" in the top-left pill; "Zgrupuj" in the batch bar.
- Smart chat dock (2026-10-14): context follows location. Main canvas = all tasks; inside a task = that task first (chip "W kontekście: …", × switches to all tasks for one message), but the agent can still act across the board, e.g. create linked tasks on the main canvas (after/before current). Agent actions: create_task, add_steps, update_task, update_step; never deletes. Chat history kept per task and per main canvas so context resumes.
- Archive (Piotr approved 2026-10-14): menu "Archiwum" with tabs Ukończone and Kosz. Completed tasks stay on canvas until end of the day, then move to Ukończone (kept forever, searchable, "Otwórz ponownie" reopens last step). Deleted tasks go to Kosz for 30 days (restore / purge / empty), then purged with images; agents never see trash. On completion the agent writes a closing note (what, result, who, decisions); notes of completed tasks are given to the agent as compact context (real app: vector search).
- Completion summary (2026-10-14): Piotr wants a plain-language summary for himself, not only agent notes. On completion the agent writes both: "summary" (1-2 human sentences, shown on the done tile, task panel "Co zostało zrobione", archive rows) and "note" (facts for agents, collapsed). Pasted hand-off reports get an agent "odbiór": one-sentence summary, link chips, warning when the report does not fit the step or mentions a problem. Report is memory, not verification; closing without a report is allowed ("Gotowe bez raportu").
- Tile state ring (2026-10-14): status shown by the tile outline, not only the tag: done = green, in progress/ready = accent, draft = amber, "W Claude" = Claude orange, new/blocked = neutral. Clicking empty canvas closes the detail panel, same as its X.
- Step links (2026-10-14): a step with no dependency = "start od razu"; the arrow from the origin tile is only a hint (faint dotted), not a stored link, and a step with no arrow at all is impossible by design (it could never start). New step tile goes after the single selected/open step, otherwise free. Clicking a dependency arrow removes it; dragging a port adds one; chips "Czeka na" × also remove.
- No on-canvas hint texts; he finds them useless clutter.
- Projects, estimates, time tracking, due dates, agent "mam 1,5 h" group: see [[task-hub-projects-time-due]].

**Why:** these are his explicit requests while reviewing the prototype.
**How to apply:** carry these into the real app's canvas; don't reintroduce hint text.
