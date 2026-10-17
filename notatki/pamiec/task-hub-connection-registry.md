---
name: task-hub-connection-registry
description: Task Hub connection registry (phase 2, commit 8571f8e, 2026-10-17): connections table (app, label, account, company, sphere, provider claude|claude-code|taskhub, kind, state, source manual|bridge), bridge POST /api/bridge/connections from `claude mcp list`, MCP list_connections + step connection, Settings "Do czego agent ma dostęp", Mac app 0.1.4
metadata:
  type: project
  modified: 2026-10-17T16:44:17.997Z
---

Phase 2 of [[task-hub-vision-2026-10-17]] after [[task-hub-companies-layer]]; shipped in commit 8571f8e (2026-10-17 ~16:55Z). "Rura, nie klucz": the registry says what the agent can reach and through what, never holds other services' tokens (URL query strings are stripped on ingest).

Data: migration 0009 `connections` (owner, app, label, account, company_id → set null, sphere work|private, provider claude|claude-code|taskhub, kind app|mcp|ical|imap, state active|expired|off, source manual|bridge, host, url, meta, seen_at); unique (owner, host, lower(label)) for source bridge; `steps.connection_id` (set null on delete). `appOfLabel(label)` in schema.ts guesses the app key from a connector name (slack, gmail|mail|poczta|outlook → gmail, clickup, calendar, figma, github, notion, hubspot, clockify, fireflies, drive, linkedin, jira, taskhub).

Bridge: Mac app 0.1.4 runs `claude mcp list` on bridge start, every 6 h and after "Sprawdź teraz" (`ClaudeCLI.mcpList` parses lines `name: target (TRANSPORT) - ✓ Connected`), POSTs `{host, servers[{name,url|command,transport,ok,status}]}` to `/api/bridge/connections` with the bridge token. Server (`repo.upsertBridgeConnections`): skips server "task-hub", failed → expired, servers of that host missing from the list → off, new entry inherits account/company/sphere from an existing entry with the same label or app (so a manual "Slack" pinned to a company tags the bridge's "slack" too).

Agent: context head gets a POŁĄCZENIA section (inside a task only connections of the task's sphere plus provider taskhub; expired/off marked WYGASŁO/WYŁĄCZONE); step line adds `| połączenie: label (account)`. MCP: `list_connections`; `create_task`/`add_steps`/`update_step` take `connection` (label or id; "" clears; unknown name on update_step returns an error). Bridge prompt: do the step with its connection, otherwise pick the company's account, never another company's or private for professional work.

UI: Settings → Połączenia → "Do czego agent ma dostęp" (`ConnectionsPanel.tsx`, `#registry`): table with inline label/account, company Picker (sets sphere too), sphere and state Pickers, RemovePop; "Nowe połączenie" form; "Konfiguracja dla nowego silnika" = `claude mcp add` lines + Kopiuj. Step panel gains a "Połączenie" Picker (task's sphere, same-app first, default "agent wybierze"). Search indexes connections. Screenshots /mnt/project-files/zrzuty/2026-10-17-polaczenia-*.png, -krok-polaczenie.png.

**Why:** when Piotr leaves a company he must see what access disappears, and a new engine (new Claude account, Codex) must get a ready config; the agent must write from the right account.
**How to apply:** new integrations register as connections, not per-app code; iCal calendars (phase 3) are connections of kind ical with a URL; the MCP client gateway (phase 6) reads connections of kind mcp. Piotr has not yet seen the registry live: the bridge fills it once the Mac app self-updates to 0.1.4 (within 6 h) and connects. See [[task-hub-mac-app-ci]], [[task-hub-automation]].
