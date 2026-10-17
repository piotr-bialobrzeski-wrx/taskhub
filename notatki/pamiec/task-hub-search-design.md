---
name: task-hub-search-design
description: Task Hub global search (2026-10-16): server-built index of tasks/steps/projects/archive/rules/settings, one SearchPill on every screen, sections ordered by the current screen, in-place handling vs. URL navigation, hash anchors open collapsed settings
metadata:
  type: project
  modified: 2026-10-16T08:14:45.662Z
---

Search lives in `src/lib/search-core.ts` (client-safe: types, `norm`, `tokens`, `matches`, `ORDER` per screen, `sections()`) and `src/lib/search.ts` (server: `indexFrom(bundle)`, `searchIndex(ownerId)`, static settings entries with synonyms, `agentLabel`). Every page passes `index` to `SearchPill` (`src/components/canvas/SearchPill.tsx`), which renders one pill in the top-right corner with results grouped by kind: first section up to 6 rows, others 3, "…i jeszcze N".

Order by screen (`ORDER`): canvas task→step→project→done→trash→rule→setting; task page steps first (own task's steps on top via `here`); projects first on Projekty; done/trash first in Archiwum; settings/rules first on their pages.

Click handling: Board's `onPick` handles task (set `focus` → `centerOn` after the canvas mounts), project (`view=projects`, `p` highlight) and done/trash (archive tab + row highlight) in place; everything else goes to `href`: `/?focus=<id>`, `/?view=projects&p=`, `/?view=done|trash&t=`, `/tasks/<id>?step=<id>`, `/settings#<anchor>`, `/rules#rule-<id>`. Board reads these from `searchParams` (prop `initial`), applies once (ref guard) and cleans the URL with `history.replaceState`. `HashOpener` (PageBar.tsx) opens the `<details>` for the hash, scrolls and adds `.hl`; same-page anchors set `location.hash` directly because `router.push` does not fire `hashchange`.

**Why:** Piotr asked (2026-10-16) for one search field in the same place on every screen, "intelligent" (results of the current screen first) and showing different kinds of things, not only tasks.
**How to apply:** when adding a screen or a new kind of thing, add items in `search.ts`, a `Screen` entry in `ORDER`, and handle the kind in `onPick` or via `href`. Related: [[task-hub-canvas-app]].
