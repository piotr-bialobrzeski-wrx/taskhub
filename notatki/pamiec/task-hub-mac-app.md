---
name: task-hub-mac-app
description: Task Hub na Maca (2026-10-16): native Swift app in repo macos/ (web app in a window + bridge + ⌃⌥T quick entry + self-update); what it does, Mac paths, install steps; CI and releases are in task-hub-mac-app-ci
metadata:
  type: project
  modified: 2026-10-16T12:22:18.660Z
---

Piotr asked (2026-10-16 10:44Z) for a macOS app like Claude Code Quick in Project Hub: installed with a macOS installer (no Terminal), visible in Applications, web-app design, bridge built in. Built in the architecture thread; releases 0.1.0, 0.1.1 (settings window fix), 0.1.2 (self-update) the same day.

What it is (told to Piotr 11:55Z): the WEB app in a native WKWebView window (cookies persist, outside links to browser) plus what a browser cannot do: the bridge that runs Claude Code on his Mac, menu-bar icon with bridge state, quick-entry panel ⌃⌥T (⌘N) posting to POST /api/bridge/task, Settings ⌘, (URL, bridge token, Claude Code path auto-detected in ~/.local/bin, /opt/homebrew/bin, /usr/local/bin, model, login item, updates, log), `taskhub://connect?url&token` link from Task Hub Settings that fills URL + token. Logic and data stay in the cloud; it does not work offline (by design: one UI, reachable anywhere). Bridge = same protocol as public/bridge/taskhub-bridge.mjs (work/run/touch/end, stream-json, stall 10 min, limit/auth regex, no ANTHROPIC_API_KEY, MCP config at `~/Library/Application Support/Task Hub/work/mcp.json`). Runs with the window closed; quitting stops it (hourly scheduled task is the fallback).

Self-update (Updater.swift, since 0.1.2): every 6 h and 20 s after launch it reads GitHub releases/latest, downloads `Task-Hub-<v>.zip` (app-downloaded files carry no quarantine, so no Gatekeeper), replaces the bundle (old to Trash), relaunches quietly when windows are closed and the bridge is idle, otherwise asks; falls back to the .pkg (password) if /Applications is not writable. Toggle + "Sprawdź teraz" in Settings → Aktualizacje.

Mac paths: config `~/Library/Application Support/Task Hub/config.json` (0600, holds the token; decoding tolerates missing keys), log `~/Library/Logs/Task Hub.log`. Not notarized: the one manual install needs Ustawienia systemowe → Prywatność i ochrona → „Otwórz mimo to” (Piotr hit this 11:41Z). Claude Code must be logged in once in Terminal (`claude` → `/login`); the bridge only has the connectors configured in that Claude Code plus Task Hub.

**Why:** one installable app with the bridge inside; Piotr prefers updates without reinstalling.
**How to apply:** app code only under macos/ (a root `app/` folder kills the Next.js web app, see [[task-hub-mac-app-ci]]); user-facing release = bump macos/VERSION. See [[task-hub-automation]], [[project-hub-bridge-mechanism]].
