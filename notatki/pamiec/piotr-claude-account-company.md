---
name: piotr-claude-account-company
description: Piotr's Claude account (piotr.bialobrzeski@pirxey.com) is company-paid and tied to the company e-mail (confirmed 2026-10-17); this project, its memory, the hourly routine and connectors vanish with it; backup convention: repo folder notatki/ (notes, screenshots, memory)
metadata:
  type: project
---

Piotr confirmed on 2026-10-17 15:34Z: the company pays for his Claude account and it is the company e-mail, so when he loses the mailbox he can lose this Claude account; a Claude account cannot be moved to another e-mail, so a new private account is a matter of time.

What depends on that account: this Claude project (chat, threads, /mnt/project-files notes, team memory), the hourly routine trig_01BomyMEStNjX5gJAP9oTbVY, the Task Hub connector authorization (api_tokens row from OAuth), the Claude Code login on his Mac that the bridge uses, and the project connectors (Slack, ClickUp, Gmail, Calendar, Drive, Figma on work accounts). Independent of it: Task Hub itself (Vercel + Supabase on piotrbsecondary@gmail.com, repo piotr-bialobrzeski-wrx/taskhub with a private alias), the Mac app and bridge token, rules in the Task Hub DB.

Backup convention (commit 2026-10-17, repo folder `notatki/`): notes from /mnt/project-files/notatki, screenshots from /mnt/project-files/zrzuty under `notatki/zrzuty/`, and the team memory files under `notatki/pamiec/`. Refresh at milestones (copy, commit, push). A new Claude account bootstraps a project from that folder.

Migration when the time comes: create the private Claude account; add the Task Hub custom connector there (Settings → Connectors → Add custom connector → https://taskhub-lac.vercel.app/api/mcp, Sign in now; the old token stays in Task Hub Settings → Połączenia until removed); on the Mac run `claude` + `/login` with the new account (bridge unaffected, its token is Task Hub's); create a new project on the new account, point a thread at `notatki/pamiec/` and recreate the hourly routine from a plain cloud thread (create_trigger rules in [[task-hub-automation]]).

**Why:** Piotr wants Task Hub and its knowledge to outlive any company; the company-paid Claude account is the one piece of the setup that is not his.
**How to apply:** after each milestone in the architecture thread, refresh `notatki/` in the repo; never store secrets there; treat the Claude project as disposable and the Task Hub DB plus the repo as the durable home. See [[task-hub-vision-2026-10-17]].
