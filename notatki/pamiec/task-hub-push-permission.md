---
name: task-hub-push-permission
description: Task Hub repo is piotr-bialobrzeski-wrx/taskhub (private, saved to project); Piotr gave standing permission (2026-10-15) to push code and fixes without asking each time
metadata:
  type: feedback
  modified: 2026-10-15T10:06:13.806Z
---

Task Hub code lives in the private GitHub repo **piotr-bialobrzeski-wrx/taskhub** (branch main, first push 2026-10-15). It is saved to the project's repository list, so every new thread can attach it with add_repo (push access).

Piotr (2026-10-15, architecture thread) asked that pushing changes and fixes to this repo be a permanent, standing permission: Claude pushes commits whenever it builds or fixes something, without asking for approval each time.

**Why:** he does not want to set a permission every time a change is ready; he reads the project asynchronously and wants the code to keep moving. He first named a repo on his private GitHub account (piotrbsecondary-code/taskhub), which Claude cannot reach because Claude's GitHub connection is his work account; he chose the work account after learning the repo holds only code (private data stays in his Supabase database) and can be transferred later. He added a private e-mail alias to that GitHub account as a safeguard.

**How to apply:** commit and push directly to the repo (or open PRs and drive them green) without stopping to ask. Still ask before anything destructive (force-push over history, deleting branches or data). See [[task-hub-blank-sheet-design]] for the app's state.
