---
name: task-hub-companies-layer
description: Task Hub companies over projects (shipped da40d64, 2026-10-17): sphere work/private derived from company, rule scope "company" and rule origin, Projects view grouped by company, MCP list_companies/create_company, add_rule company+origin
metadata:
  type: project
  modified: 2026-10-17T16:18:13.080Z
---

Shipped in commit da40d64 (deployed 2026-10-17 16:16Z, diag green) as phase 1 of the vision in [[task-hub-integrations-verdict-2026-10-17]].

Data: migration 0008 adds `companies` (name, sphere work|private, note, ended_at), `projects.company_id`, `rules.company_id` (new scope `company`), `rules.origin_company_id` (where the rule was developed; null = mine). Sphere is derived, never stored on a project: project with company → company sphere; project without company → private. Deleting a company unpins its projects (they become private) and deletes its company-scoped rules.

Agent context: `rulesFor(rules, projectId, tools, companyId)` includes company rules only for that company's projects; PROFIL header says "fakty o firmie, projekcie i narzędziach"; context head lists `Name 4/5 (Firma|prywatny)`; the task line adds `(firma X), sfera zawodowa|prywatna`. Handoff, breakdown, compose, draft and chat prompts all pass the project's companyId.

MCP (route.ts): `list_companies` (with projects), `create_company(name, sphere?, note?)` idempotent by name, `create_project(..., company?)` (company name; unknown name creates a work company; "" unpins), `list_projects` returns company + sphere, `add_rule(scope "company", company=name|id, origin=name|id)`, `update_rule(origin; "" = mine)`, `list_rules` returns company and origin names, `get_rules(projectId)` resolves the company itself (explicit `companyId` only when there is no project). Threads connected before da40d64 do not see list_companies/create_company until reconnected; live handlers already return company/sphere.

UI: Projects view (`Projects.tsx`) groups projects under company headers (`.crow` / `.c-head`: company icon, inline rename, picker "sfera zawodowa/prywatna", picker "współpraca trwa/zakończona", stats, trash with confirm popover, fold; projects indented in `.c-projects`), then a "Prywatne" section (projects without company + "Bez projektu"), ended companies last; each project row has a company picker ("prywatny (bez firmy)" / companies); title row has "Nowa firma" and "Nowy projekt". RuleForm: scope "dla firmy" (only when companies exist) with Firma picker, "Pochodzenie" picker (moja / wypracowana w: firma); rule cards show chips "firma: X" and "z: X". Search indexes companies as kind "project" with id `c-<id>`. Screenshots: /mnt/project-files/zrzuty/2026-10-17-projekty-firmy.png, -projekty-firma-lista.png, -zasady-firma-form.png.

**Why:** Piotr works for several companies at once and wants his own practices to stay with him when he leaves one, while company-developed rules can be handed back; private vs professional sphere must be visible to the agent.
**How to apply:** new rule-related features must carry companyId/origin through; company-level uploads go through create_company + create_project(company). Next phases: connection registry, iCal calendars + morning run, journal, learning loop. See [[task-hub-rules-proposal]], [[task-hub-canvas-app]].
