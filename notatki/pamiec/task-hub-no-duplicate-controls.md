---
name: task-hub-no-duplicate-controls
description: Piotr's UI rule (2026-10-14): never show two controls that do the same thing; make the existing element the control instead
metadata:
  type: feedback
  modified: 2026-10-14T22:48:24.691Z
---

Piotr (2026-10-14) saw the task panel show priority twice: a static label in the header and an editable picker below. He wants one: the header priority is clickable and opens the picker; the lower block was removed.

**Why:** he dislikes repetition; if an action already exists somewhere, a second button for the same thing is clutter unless he explicitly asks for it.
**How to apply:** before adding a control to the Task Hub prototype (or the real app), check whether the same action is already reachable in that view; if so, make the existing element interactive rather than adding a duplicate. See [[task-hub-design-rules]].
