---
name: task-hub-architecture-status-2026-10-17
description: Status after the 2026-10-17 vision review: Q4 protocols approved, stage 1 companies deployed, profiles deferred, notes backed up in repo; v3 rules uploaded and live
metadata:
  type: project
  modified: 2026-10-17T16:27:12.158Z
---

Status of thread "Architektura aplikacji Task Hub" after the vision review in [[task-hub-vision-2026-10-17]] (rules model: [[task-hub-rules-proposal]]). Only facts the vision note does not carry:

- Q4 APPROVED by Piotr 15:59 UTC: MCP, iCal and IMAP inside Task Hub as a generic client; no per-app field mappings.
- Company Claude account ([[piotr-claude-account-company]]): migration plan ~30 min: connector in the new account, `claude /login` on the Mac, new project reads notatki/ and pamiec/ from the repo.
- Notes, screenshots and memory backed up in the repo under notatki/ (commit 201e67d).
- Stage 1 DEPLOYED 16:19 UTC: company entity above projects (sphere professional/private, collaboration active/ended) shown as a section in the Projects view; projects without a company are private; a rule may have scope "for company" and origin ("mine" or "developed at: company"); the agent gets company and sphere in its context; connector gains list_companies and create_company (reconnect older threads to see them). Screenshots /mnt/project-files/zrzuty/2026-10-17-projekty-firmy.png and ...-zasady-firma-form.png. Rules v3 doc has a company section (A). Details: [[task-hub-companies-layer]].
- Profiles "Mój rytm" and "Kompetencje" DEFERRED by Piotr 16:20 UTC: no content yet, to be worked out later.
- v3 UPLOADED 2026-10-17 16:26 UTC (thread verified on production): company Pirxey & Widelab (professional sphere); 7 projects (Shiftwow, Custom Cookies, PirxeyOS, Call Companion, Pirxey & Widelab under the company; Task Hub and Shattered Lands private); 35 entries = 12 profiles, 12 rules, 11 procedures, each with origin. From now on rules are edited in Task Hub (Rules page or connector), the v3 document is only a record. A leftover project "test" is for Piotr to delete himself (agents never delete). Thread moved to stage 2: connection registry.
- v3 UPLOADED 16:25Z (verified on production: 1 company, 7 projects, 35 entries).
- Stage 2 DEPLOYED (commit 8571f8e, ~16:55Z): connection registry, details [[task-hub-connection-registry]]; Mac app 0.1.4 reports `claude mcp list` to it. Next: stage 3 iCal calendars + morning run + "Dzień" view (needs Piotr's answer to Q6 plan-in-calendar; default proposal only in Task Hub).

**Why:** without these a session may re-ask Piotr for approvals he already gave, or assume the companies layer and the v3 upload are still pending.
**How to apply:** before touching rules or companies, check Task Hub for the uploaded 35 entries; treat the two deferred profiles as not existing; design integrations as connection registry first. See [[task-hub-vision-2026-10-17]], [[task-hub-rules-proposal]].
