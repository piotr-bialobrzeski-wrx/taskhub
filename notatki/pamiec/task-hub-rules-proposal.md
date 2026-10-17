---
name: task-hub-rules-proposal
description: Task Hub rules v3 UPLOADED to production 2026-10-17 16:25Z after Piotr's "zatwierdzam": 1 company, 7 projects, 35 entries (12 profiles, 12 rules, 11 procedures) live in the DB; rules now change in Task Hub, not in the doc
metadata:
  type: project
  modified: 2026-10-17T16:18:22.710Z
---

Piotr asked (2026-10-16 12:53Z) to copy his Claude Code rules into Task Hub and create projects from his Claude Code projects, showing everything first for approval. v1 and v2 are superseded by **v3**: `/mnt/project-files/notatki/2026-10-16-zasady-task-hub-v3.md` (generator scratchpad `zasady3.py` → `propozycja-v3.json`; v2 text unchanged, re-tagged; regenerated 2026-10-17 with companies): 12 profiles, 12 always-on rules, 11 procedures with triggers. Per step ~11-17k chars instead of 19-23k. Piotr approved ("Zatwierdzam.", 2026-10-17 16:20Z) and the architecture thread uploaded everything through the connector at 16:25Z: company "Pirxey & Widelab" (work), 7 projects (5 under the company), 35 rules; list_rules and get_rules on production verified (Shiftwow task gets the company profile). From now on the DB is master: edits happen on /rules or via update_rule, the doc is history. The split into profile / rule / procedure shipped in fb2f25e; the company layer in da40d64 ([[task-hub-companies-layer]]).

v3 mapping: company "Pirxey & Widelab" (sphere work, note "jedna firma, dwa brandy"); projects Shiftwow, Custom Cookies, PirxeyOS, Call Companion, Pirxey & Widelab → that company; Task Hub, Shattered Lands → no company (private). Entries nr 2 (profile "Firma: Pirxey & Widelab") and nr 34 (procedure "pytanie o firmę i mapa kompetencji") have scope company. The company row has no note (the cached connector in that thread lacked create_company; the fact is in the profile body anyway). Origin = Pirxey & Widelab for company-scoped entries and entries of that company's projects; global and tool entries are "moja".

Profiles "Mój rytm" and "Kompetencje": Piotr said 2026-10-17 16:20Z he does not have them yet, "wypracujemy sobie potem" (do not ask again; the day-plan phase can draft "Mój rytm" from his message: mornings for known topics, creative window around 16:00, and propose it). NDA part of question 3 still unanswered.

**Why:** rules are the agent's instructions on his real work; he wants to review before they go live.
**How to apply:** do not re-upload; propozycja-v3.json is only a record. Gotcha: a thread's cached connector schema is not enforced strictly, so new params (company, origin, scope "company") pass through even when the cached tool list is old; only tools missing from the list (create_company) cannot be called. Future rule changes go through update_rule or the UI, each leaving a version. Later: validators for mechanical rules, "to jest wzór" button, learning loop. See [[task-hub-automation]], [[piotr-mac-claude-workspace]].
