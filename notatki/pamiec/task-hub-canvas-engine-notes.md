---
name: task-hub-canvas-engine-notes
description: Task Hub Canvas.tsx and CSS gotchas (pointer capture breaks click targets, optimistic drop positions, group membership rules, free-pan margins, backdrop-filter lost by the CSS minifier) and the local preview + Playwright recipe
metadata:
  type: project
  modified: 2026-10-15T21:53:53.620Z
---

Learned 2026-10-15 while fixing Piotr's canvas/UI bugs (commits 221d491 and 700e638, repo piotr-bialobrzeski-wrx/taskhub):
- `.world` and `.canvas` call `setPointerCapture` on pointerdown, so DOM `click`/`dblclick` target the capturing element. Double-click is detected from two pointerups on the same id within 400 ms (`isDouble`), and `onCanvasDown` returns early for `button, input, a, .zoom`. Never reintroduce `onDoubleClick` handlers on nodes.
- Dropped tiles/groups keep an optimistic `override` until the server layout (`sLayout`) differs from the position recorded at grab time (`dropped`/`gDropped` refs); `saveTaskPositions`/`saveStepPositions` call `refresh()`.
- Group membership rules and auto-group pinning: [[task-hub-group-membership-rules]].
- Free panning: the stage has a margin equal to the visible canvas on every side (`pad` state, measured with ResizeObserver in a layout effect); the world sits at `left/top = pad`, initial scroll = pad. Zoom keeps the point under the cursor by storing an anchor in a ref and applying the scroll in `useLayoutEffect([zoom])` (never in rAF before commit). Anything overlaid inside `.canvas` (zoom pill, empty card) must be `position: fixed`, otherwise it scrolls away with the stage and focusing it jumps the scroll.
- CSS: write only `backdrop-filter` (no `-webkit-` line). Next's minifier dropped the unprefixed declaration when both were present, so Chrome had no blur. Elements with backdrop-filter are containing blocks for `position: fixed` descendants: the priority/project Picker menu is rendered through `createPortal(document.body)`.
- Vercel+Supabase latency was simulated with a Playwright route delaying POSTs by 1.5 s; snap-back only shows when positions are measured without reloading.

Local preview recipe: `pg_ctlcluster 16 main start` (it can stop between turns); verify.mjs has a stale hard-coded task id, read ids from seed.out instead; DATABASE_URL=postgres://taskhub:taskhub@localhost:5432/taskhub_test; run `npx tsx scripts/migrate.ts` after adding a migration; vitest with TEST_DATABASE_URL on the same DB wipes the seed, so re-seed after tests (seed copy in the thread scratchpad `seed.ts`, run with TASKHUB_OWNER_EMAIL/NAME via `npx tsx scripts/_seed_preview.ts`, then delete it); `npx next build && npx next start` with TASKHUB_* env; stop with `for p in $(pgrep -f "[n]ext-server"); do kill $p; done`; Playwright via `/opt/node-tools/node_modules/playwright/index.mjs` + `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`; wait for `networkidle` after login, drag tiles not covered by the dock, use `fill()` for inputs that select-all on focus. MCP tools can be exercised over HTTP with a token from `repo.createApiToken` (POST /api/mcp, JSON-RPC `tools/call`, accept json + event-stream).

**Why:** these behaviours are invisible in code review and cost an hour to rediscover.
**How to apply:** when touching pointer handling, positions, overlays or glass styles, re-run a browser check that measures positions right after the drop and inspects computed `backdropFilter`. See [[task-hub-canvas-app]].
