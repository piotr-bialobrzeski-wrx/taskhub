---
name: task-hub-production-diag
description: How to check Task Hub production (taskhub-lac.vercel.app) from a cloud thread, which cannot reach vercel.app: the diag.yml GitHub workflow posts a smoke test as a commit comment after every Vercel deploy
metadata:
  type: project
  modified: 2026-10-16T12:22:33.284Z
---

Neither cloud sessions nor the device VM (device_bash on Piotr's Mac) can reach `taskhub-lac.vercel.app` (proxy allowlist, HTTP 403; WebFetch fails too). GitHub Actions runners can. `.github/workflows/diag.yml` ("Diagnostyka produkcji", added 2026-10-16) runs after every successful Vercel *Production* deployment (deployment_status event), on workflow_dispatch, or when the file itself changes. It curls /api/health, the OAuth well-known URLs, POST /api/mcp without and with a wrong token (expects 401), GET /api/bridge/work (expects 401), and posts the result as a comment on the deployed commit.

Read it with `gh api repos/piotr-bialobrzeski-wrx/taskhub/commits/<sha>/comments --jq '.[].body'`; Vercel deploy state with `gh api repos/…/commits/<sha>/status --jq .state` (deploy takes 2–3 min, the comment ~30 s after). The Actions API itself is blocked, so trigger the workflow by pushing a change to diag.yml if a run is needed outside a deploy.

**Why:** on 2026-10-16 production was fully 404 for an hour (root `app/` folder shadowed `src/app`) and nobody noticed until the Claude connector failed; this makes every deploy self-reporting.
**How to apply:** after any push that touches src/, next.config.ts, vercel.json or package.json, wait for the deploy and read the comment before telling Piotr it is live. See [[task-hub-mac-app-ci]].
