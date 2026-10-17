---
name: task-hub-design-rules
description: Task Hub UI design rules doc (spacing/radius tokens, nested-radius rule) — follow for every new UI element
metadata:
  type: project
  modified: 2026-10-14T20:30:27.429Z
---

Piotr asked (2026-10-14) for shared UI design rules after spotting misaligned group header input and a square resize handle. Doc: "Task Hub: zasady designu UI" https://claude.ai/code/artifact/093f93ea-76e9-4475-bbd3-3ca413206173

Core rules: spacing scale 4/6/8/12/16/20/24 px (tokens --s-1..--s-7, 6 px only for controls inset in pills); equal inset top and sides; text aligns to the container's inner line (16 px in tiles and groups); radii --r-pill 999, --r-lg 20 (group, panel), --r-md 14 (tile), --r-sm 12 (textarea, list rows); nested radius = outer radius minus gap (so group resize handle = arc inset 6, radius 14); colors/strokes/states from tokens; no on-canvas hint text; hit area >= 32 px.

**Why:** Piotr is detail-sensitive about UI consistency and wants these as the standard for the real app too.
**How to apply:** check every new element against the doc's checklist before showing it; tokens live in :root of the prototype. See [[task-hub-prototype-ui]].
