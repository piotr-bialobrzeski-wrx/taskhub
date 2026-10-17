---
name: task-hub-architecture
description: Proposed Task Hub architecture (2026-10-14) and link to the architecture Claude Doc; not yet approved by Piotr
metadata:
  type: project
  modified: 2026-10-14T20:50:39.061Z
---

On 2026-10-14 Claude proposed the Task Hub architecture in a Claude Doc:
https://claude.ai/code/artifact/f5579ea5-fb7c-4e1f-80d6-0e365c652b16

Proposal (awaiting Piotr's confirmation): Next.js on Vercel + Supabase (Postgres + pgvector, Auth, Storage, region Frankfurt); own remote MCP server with OAuth for Claude and ChatGPT; Quick Add API with inbox; three data layers (tables, summary "cards", chunked originals) with hybrid full-text + vector search; OpenAI text-embedding-3-small with model name stored per vector; nightly encrypted pg_dump via GitHub Actions to Backblaze B2 + Piotr's PC, embeddings excluded from backups; later a local Docker copy + local agent.

Hard requirement from Piotr (2026-10-14): Claude and GPT agents must be interchangeable, no single-provider lock-in. Covered via MCP for agents, a provider-agnostic AI layer (e.g. Vercel AI SDK) with fallback for in-app AI, and per-vector embedding model name so embeddings can be re-computed with another provider.

Core idea (Piotr, 2026-10-14): like Project Hub, tasks are split into steps and delegated to a connected agent (Claude or GPT) that acts in other apps (Slack, mail, ClickUp). Proposed: MVP = agent in Piotr's own client pulls steps via MCP; stage 3 = background agent via API + job queue; outbound actions are drafts needing approval; external items stored with jsonb fields. Canvas like Project Hub but agent-driven: agent picks prebuilt UI blocks/fields per source type (JSON layout), templates per type, user pins/hides fields.

Images (Piotr decided 2026-10-14): originals are TEMPORARY by default (7 days, then deleted; the text analysis always stays); he marks an image "keep" to store it permanently. Kept originals: (re-encoded to max 2000 px, ~200-400 KB) in Supabase Storage (1 GB free; move to Cloudflare R2, 10 GB free, if it fills) AND the agent's analysis (caption, verbatim text/numbers, conclusions) as text in Postgres + embedding. Agents read the text by default (cheap); open the original only when detail is needed. Images included in the B2 backup. Prototype does this with assets + sample images.

Hand-off to Claude (Piotr approved 2026-10-14): rule "Task Hub prowadzi, Claude wykonuje". Prototypes, code and long creative work happen in claude.ai / Claude Code, not in the Task Hub chat (TapET used to open native app windows with a prefilled prompt and got status back). Step tools "claudeapp" and "code": button "Otwórz w Claude" opens claude.ai/new?q=<prompt> (unofficial prefill) or copies a `claude "..."` command; step goes to state "W Claude" (handoff) with time and a "brak wyniku" nudge after 3 h; result returns via pasted report (prototype) and, in the real app, via Task Hub's own remote MCP server (`complete_step(id, status, summary, link)`) added as a connector in Claude and Claude Code. Prototype has no server, so MCP return is real-app only.

**Why:** Piotr wants cheap, safe, fast, single-user, not dependent on one cloud, and a local-agent path later. He is not experienced with hosting/databases, so give one concrete recommendation.
**How to apply:** Treat as the working baseline; open questions in the doc: what TapET, Project Hub and Quick do today and their data format, GitHub account for the repo, his PC specs. Piotr writes in Polish.
