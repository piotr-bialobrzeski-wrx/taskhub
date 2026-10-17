---
name: task-hub-minimal-cards
description: Piotr's UI rule (2026-10-16): pop-up cards show only their content, no label line; the close X sits in the top-right corner (inset 6 px) and may stick out if there is no room
metadata:
  type: feedback
  modified: 2026-10-16T07:36:30.558Z
---

Piotr (2026-10-16) saw the agent answer card spend a whole line on the word "Agent" plus an X. He wants cards minimal: drop the label, show just the text, put the X in the top-right corner (or slightly outside the card when there is no room), styled like the rest of the app.

Applied in commit d19c554: `.answer.plain` has a 44 px right column for `.ans-x` (28 px pill, inset 6 px = card radius 20 minus button radius 14); long text scrolls inside the card while the X stays put. The agent question card keeps its header because the header carries information (which step, how many more).

**Why:** he dislikes chrome that exists only to hold a control; a line with one word reads as waste.
**How to apply:** for any new card, toast or panel in Task Hub, do not add a title line unless it carries information the body lacks; place the close control in the corner with the nested-radius inset. See [[task-hub-design-rules]], [[task-hub-no-duplicate-controls]].
