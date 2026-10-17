---
name: task-hub-group-membership-rules
description: Task Hub canvas groups (2026-10-16): one tile per group enforced in repo, membership changes only for what was dragged (reassign in layout.ts), agent-made auto groups pinned on first render
metadata:
  type: project
---

Groups (2026-10-16, Piotr: "grupy nie działają"): a tile is in one group only. repo.createGroup/updateGroup remove the ids from sibling groups (`releaseMembers`), because computePositions draws a tile only in the first group listing it. After a drop `reassign()` (layout.ts) changes membership only for what was dragged: a dropped tile goes to the smallest group under its centre, a moved group keeps its members and takes free tiles under its rect, a resized group also drops tiles that fell out. Never go back to geometry-only `membership()` for every tile: overlapping rects stole each other's tiles. Auto groups (agent-made, auto=true) are pinned by Board on first render (positions + rect saved, auto=false) so they stop jumping when free tiles change; "Ułóż" sets auto=true again and the pin repeats.

**Why:** Piotr reported "grupy nie działają" (2026-10-15): a tile selected into a new group vanished from it because it was still listed in an older group, and agent-made groups moved whenever free tiles changed.
**How to apply:** keep `releaseMembers` in repo.createGroup/updateGroup and `reassign()` in Canvas.endDrag; test group changes in the browser with two overlapping groups (see verify3/shift scripts in [[task-hub-canvas-engine-notes]]). Related: [[task-hub-canvas-app]].
