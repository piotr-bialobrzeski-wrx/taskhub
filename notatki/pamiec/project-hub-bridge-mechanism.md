---
name: project-hub-bridge-mechanism
description: How Piotr's existing Project Hub app starts Claude immediately (read from its code on his Mac 2026-10-16): local queue + Node "bridge" polling every 2 s + `claude -p` on subscription with bypassPermissions; what Task Hub copies from it
metadata:
  type: project
  modified: 2026-10-16T10:37:50.212Z
---

Verified 2026-10-16 by reading `~/Applications/Project Hub.app/Contents/Resources/app/bridge/{bridge.mjs,limits.mjs,README.md}` and the bundled server on Piotr's home Mac ("mbp-piotr-home", macOS arm64, user folder /Users/osobiste; Project Hub also runs on his work Mac /Users/piotrbialobrzeski). Folder access was granted through the Claude desktop app (connect_device + device_request_folder_access).

Mechanism: Project Hub is fully local (Express on localhost:4820 + SQLite). Work modes: offline (local LM), online (API key), bridge (Claude Code). In bridge mode every intake (chat, ticket analysis, inbox webhook from Claude Code Quick, plan) only inserts a `chat_jobs` row (status pending) and marks the ticket "Analiza w trakcie". The app spawns `bridge.mjs` (Node, zero deps) which polls `GET /public/chat/pending?token=` every 2 s (no tokens spent), sends a heartbeat every 10 s (UI warns when the bridge is dead), and for each job runs `claude -p <prompt> --output-format stream-json --verbose --permission-mode bypassPermissions --append-system-prompt <persona> [--resume <session per project>] [--model]`, relays tool_use events as progress, posts the reply. ANTHROPIC_API_KEY deliberately unset (subscription billing). Handles usage limits (parseLimit → job waits until reset), logged-out CLI (jobs wait for /login), lost session (fresh), 10-min stall watchdog, single-instance lock, sequential jobs. Sending to Slack/ClickUp only after Piotr approves a proposal in the app. Separate `~/world/automation/runner/heartbeat.js` (launchd every 15 min) runs cron/inbox jobs with `claude -p`, caffeinate and pmset wake.

Gaps vs Task Hub requirements: everything depends on the Mac being awake and the app running; bridge is Claude-only. Decision (thread "Architektura aplikacji Task Hub", 2026-10-16): Task Hub copies the bridge pattern (local runner polls the cloud app over HTTPS with a dedicated bridge token, runs `claude -p` with the Task Hub MCP via --mcp-config, bypassPermissions, swappable engine incl. Codex), keeps the hourly scheduled task as fallback when the bridge is silent, and makes `list_work` tell non-bridge callers to stand down while the bridge is alive. Piotr's question "60 staggered scheduled tasks for minute polling" was answered: possible but each run is a full Claude session (tokens + a project thread), so no.

**Why:** Piotr wants work to start the moment a task lands, without paying per token; Project Hub proves the pattern on his machine.
**How to apply:** when touching Task Hub automation, keep polling token-free (plain HTTP by a program), wake Claude only for real work, never add API-key billing. See [[task-hub-automation]], [[task-hub-canvas-app]].
