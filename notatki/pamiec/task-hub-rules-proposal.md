---
name: task-hub-rules-proposal
description: Task Hub rules v3 (2026-10-17): 1 company, 7 projects, 35 entries (12 profiles, 12 rules, 11 procedures) await Piotr's "zatwierdzam" in /mnt/project-files/notatki; nothing uploaded to Task Hub yet; how to upload via MCP
metadata:
  type: project
  modified: 2026-10-17T16:18:22.710Z
---

Piotr asked (2026-10-16 12:53Z) to copy his Claude Code rules into Task Hub and create projects from his Claude Code projects, showing everything first for approval. v1 and v2 are superseded by **v3**: `/mnt/project-files/notatki/2026-10-16-zasady-task-hub-v3.md` (generator scratchpad `zasady3.py` → `propozycja-v3.json`; v2 text unchanged, re-tagged; regenerated 2026-10-17 with companies): 12 profiles, 12 always-on rules, 11 procedures with triggers. Per step ~11-17k chars instead of 19-23k. Approval protocol: "zatwierdzam" or numbers from section C to change. The split into profile / rule / procedure shipped in fb2f25e; the company layer in da40d64 ([[task-hub-companies-layer]]).

v3 mapping: company "Pirxey & Widelab" (sphere work, note "jedna firma, dwa brandy"); projects Shiftwow, Custom Cookies, PirxeyOS, Call Companion, Pirxey & Widelab → that company; Task Hub, Shattered Lands → no company (private). Entries nr 2 (profile "Firma: Pirxey & Widelab") and nr 33 (procedure "pytanie o firmę i mapa kompetencji") have scope company. Origin = Pirxey & Widelab for company-scoped entries and entries of that company's projects; global and tool entries are "moja".

Still to ask Piotr: content of two new profiles "Mój rytm" (draft from his message: mornings for structured work on known topics, creative window around 16:00) and "Kompetencje"; NDA part of question 3 (whether client conversations may be stored whole).

**Why:** rules are the agent's instructions on his real work; he wants to review before they go live.
**How to apply:** after "zatwierdzam", from a thread with the Task Hub connector (reconnect if list_companies is missing from the cached tool list): `create_company`, `create_project` for the 7 projects (name, weight, language, company), then `add_rule` per entry of propozycja-v3.json with kind, scope, title, body, summary, trigger, tool / project / company and origin; report the count. Never upload unapproved rules. Production has no rules yet. Later: validators for mechanical rules, "to jest wzór" button, learning loop. See [[task-hub-automation]], [[piotr-mac-claude-workspace]].
