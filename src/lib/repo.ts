// Warstwa danych: proste funkcje na SQL. Bez ORM, żeby schemat był czytelny i łatwy do backupu.
import { randomUUID } from "node:crypto";
import { createHash, randomBytes } from "node:crypto";
import { sql } from "./db";
import { type Company, type Connection, Blocks, type Block, type Fact, type Project, type Question, type Rule, type Step, type Task, type TimeSample, appOfLabel, isOwnerStep, normalizeTool, toolLabel } from "./schema";
import { agentMinOf, elapsedSec, Q, roundQ, spentMin } from "./time";
import { isHttpUrl, sanitizeBlocks } from "./safeurl";
import { approvalSig, approvalValid, draftOf, draftsOf, isGitDraft, isSendable, shownSig, type Draft } from "./agent/approval";
import { doneChat, stepKind } from "./stepcard";
import { shortTitle } from "./auto";
import { guessProject } from "./project-guess";
import { isModelName, MAX_ESCALATION, normalizeLevel } from "./agent/models";
export { approvalSig, approvalValid, draftOf, draftsOf, isSendable, optionLabel, optionsOf } from "./agent/approval";

type Row = Record<string, unknown>;
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v));
const dateStr = (v: unknown) => (v == null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

// ---------- użytkownik ----------
export async function ensureOwner(): Promise<{ id: string; email: string; name: string | null; settings: Record<string, unknown> }> {
  const email = process.env.TASKHUB_OWNER_EMAIL;
  if (!email) throw new Error("Brak TASKHUB_OWNER_EMAIL");
  const name = process.env.TASKHUB_OWNER_NAME ?? null;
  const [u] = await sql()`
    insert into users (email, name) values (${email}, ${name})
    on conflict (email) do update set name = coalesce(excluded.name, users.name)
    returning id, email, name, settings`;
  return u as { id: string; email: string; name: string | null; settings: Record<string, unknown> };
}

// ---------- tokeny MCP ----------
export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");
// client: konektor OAuth i automat co godzinę; bridge: aplikacja mostka na Macu; run: krótki token jednego biegu mostka (Claude Code w tym biegu)
export type TokenKind = "client" | "bridge" | "run";
// zakres tokenu biegu: work = praca bez wysyłek, send = jeden zatwierdzony szkic (stepId w zadaniu taskId)
export type RunScope = { kind: "work" | "send"; runId: string; stepId?: string | null; taskId?: string | null };
export async function createApiToken(ownerId: string, name: string, kind: Exclude<TokenKind, "run"> = "client"): Promise<string> {
  const token = "th_" + randomBytes(24).toString("base64url");
  await sql()`insert into api_tokens (owner_id, name, token_hash, kind) values (${ownerId}, ${name}, ${hashToken(token)}, ${kind})`;
  return token;
}
export type TokenAuth = { id: string; ownerId: string; kind: TokenKind; name: string; scope: RunScope | null };
// użycie tokenu mostka (także przez Claude Code, który mostek uruchomił, tokenem biegu) jest zarazem jego pulsem.
// Token biegu działa tylko do wygaśnięcia i tylko póki jego bieg jest otwarty.
export async function tokenForSecret(token: string): Promise<TokenAuth | null> {
  const [r] = await sql()`update api_tokens set last_used_at = now(), seen_at = case when kind = 'bridge' then now() else seen_at end
    where token_hash = ${hashToken(token)} and (expires_at is null or expires_at > now())
      and (kind <> 'run' or exists (select 1 from bridge_runs b where b.id::text = api_tokens.scope->>'runId' and b.ended_at is null))
    returning id, owner_id, kind, name, scope`;
  if (!r) return null;
  const kind = (r.kind as TokenKind) ?? "client";
  const scope = kind === "run" ? ((r.scope as RunScope | null) ?? null) : null;
  if (kind === "run" && !scope?.runId) return null;
  if (scope) await sql()`update api_tokens set seen_at = now(), last_used_at = now() where kind = 'bridge' and id = (select token_id from bridge_runs where id::text = ${scope.runId})`;
  return { id: r.id as string, ownerId: r.ownerId as string, kind, name: r.name as string, scope };
}
// token biegu: sekret tylko raz (w bazie skrót), wygasa po minutes; stare wygasłe tokeny biegów sprzątamy przy okazji
export async function createRunToken(ownerId: string, scope: RunScope, minutes: number): Promise<string> {
  const token = "th_" + randomBytes(24).toString("base64url");
  const s: RunScope = { kind: scope.kind, runId: scope.runId, stepId: scope.stepId ?? null, taskId: scope.taskId ?? null };
  await sql()`delete from api_tokens where owner_id = ${ownerId} and kind = 'run' and expires_at < now() - interval '1 day'`;
  await sql()`insert into api_tokens (owner_id, name, token_hash, kind, expires_at, scope)
    values (${ownerId}, ${scope.kind === "send" ? "Bieg wysyłki" : "Bieg mostka"}, ${hashToken(token)}, 'run', now() + make_interval(mins => ${Math.max(1, Math.round(minutes))}), ${sql().json(s as never)})`;
  return token;
}
// koniec biegu: jego tokeny przestają działać od razu
export async function revokeRunTokens(ownerId: string, runId: string): Promise<number> {
  const rows = await sql()`delete from api_tokens where owner_id = ${ownerId} and kind = 'run' and scope->>'runId' = ${runId} returning id`;
  return rows.length;
}
export async function ownerForToken(token: string): Promise<string | null> {
  return (await tokenForSecret(token))?.ownerId ?? null;
}

// ---------- firmy ----------
const rowToCompany = (r: Row): Company => ({ id: r.id as string, name: r.name as string, sphere: (r.sphere as Company["sphere"]) ?? "work", note: (r.note as string) ?? null, endedAt: iso(r.endedAt) });
export async function listCompanies(ownerId: string): Promise<Company[]> {
  const rows = await sql()`select * from companies where owner_id = ${ownerId} order by created_at`;
  return rows.map(rowToCompany);
}
export async function createCompany(ownerId: string, name: string, sphere: Company["sphere"] = "work", note: string | null = null): Promise<Company> {
  const [r] = await sql()`insert into companies (owner_id, name, sphere, note) values (${ownerId}, ${name.trim().slice(0, 60)}, ${sphere}, ${note}) returning *`;
  return rowToCompany(r);
}
export async function updateCompany(ownerId: string, id: string, patch: Partial<Pick<Company, "name" | "sphere" | "note" | "endedAt">>): Promise<void> {
  const p: Row = {};
  if (patch.name !== undefined) p.name = patch.name.trim().slice(0, 60);
  if (patch.sphere !== undefined) p.sphere = patch.sphere;
  if (patch.note !== undefined) p.note = patch.note;
  if (patch.endedAt !== undefined) p.ended_at = patch.endedAt;
  if (!Object.keys(p).length) return;
  await sql()`update companies set ${sql()(p)} where id = ${id} and owner_id = ${ownerId}`;
}
// projekty zostają (tracą firmę), zasady o zakresie „firma” znikają razem z nią, pochodzenie zasad pustoszeje
export async function deleteCompany(ownerId: string, id: string): Promise<void> { await sql()`delete from companies where id = ${id} and owner_id = ${ownerId}`; }
export async function findCompanyByName(ownerId: string, name: string): Promise<Company | null> {
  const [r] = await sql()`select * from companies where owner_id = ${ownerId} and lower(name) = lower(${name.trim()}) limit 1`;
  return r ? rowToCompany(r) : null;
}

// ---------- projekty ----------
const rowToProject = (r: Row): Project => ({ id: r.id as string, name: r.name as string, color: Number(r.color), weight: Number(r.weight), language: r.language as string, companyId: (r.companyId as string) ?? null });
export async function listProjects(ownerId: string): Promise<Project[]> {
  const rows = await sql()`select * from projects where owner_id = ${ownerId} and archived_at is null order by created_at`;
  return rows.map(rowToProject);
}
export async function createProject(ownerId: string, name: string, weight = 3, companyId: string | null = null): Promise<Project> {
  const [{ n }] = await sql()`select count(*)::int as n from projects where owner_id = ${ownerId}`;
  const [r] = await sql()`insert into projects (owner_id, name, color, weight, company_id) values (${ownerId}, ${name.slice(0, 60)}, ${Number(n) % 8}, ${weight}, ${companyId}) returning *`;
  return rowToProject(r);
}
export async function updateProject(ownerId: string, id: string, patch: Partial<Pick<Project, "name" | "weight" | "language" | "color" | "companyId">>): Promise<void> {
  const p: Row = {};
  if (patch.name !== undefined) p.name = patch.name.slice(0, 60);
  if (patch.weight !== undefined) p.weight = patch.weight;
  if (patch.language !== undefined) p.language = patch.language;
  if (patch.color !== undefined) p.color = patch.color;
  if (patch.companyId !== undefined) p.company_id = patch.companyId;
  if (!Object.keys(p).length) return;
  const [cur] = patch.companyId !== undefined ? await sql()`select company_id from projects where id = ${id} and owner_id = ${ownerId}` : [];
  await sql()`update projects set ${sql()(p)} where id = ${id} and owner_id = ${ownerId}`;
  if (cur && ((cur.companyId as string) ?? null) !== (patch.companyId ?? null)) {
    await dropRoutedApprovals(ownerId, await sql()`select s.id, s.title from steps s join tasks t on t.id = s.task_id
      where t.project_id = ${id} and t.owner_id = ${ownerId} and s.approved_at is not null and s.send_started_at is null and s.status <> 'done' and s.connection_id is null`);
  }
}
export async function deleteProject(ownerId: string, id: string): Promise<void> {
  // zadania zostają, tracą tylko etykietę
  await sql()`delete from projects where id = ${id} and owner_id = ${ownerId}`;
}
export async function findProjectByName(ownerId: string, name: string): Promise<Project | null> {
  const [r] = await sql()`select * from projects where owner_id = ${ownerId} and archived_at is null and lower(name) = lower(${name.trim()}) limit 1`;
  return r ? rowToProject(r) : null;
}

// ---------- połączenia ----------
// Rura, nie klucz: rejestr mówi, do czego agent ma dostęp i przez co; żadnych sekretów cudzych usług.
const rowToConnection = (r: Row): Connection => ({
  id: r.id as string, app: r.app as string, label: r.label as string, account: (r.account as string) ?? null, companyId: (r.companyId as string) ?? null,
  sphere: (r.sphere as Connection["sphere"]) ?? "work", provider: (r.provider as Connection["provider"]) ?? "claude", kind: (r.kind as Connection["kind"]) ?? "mcp",
  state: (r.state as Connection["state"]) ?? "active", source: (r.source as Connection["source"]) ?? "manual", host: (r.host as string) ?? null, url: (r.url as string) ?? null,
  meta: (r.meta as Record<string, unknown>) ?? {}, seenAt: iso(r.seenAt),
});
export async function listConnections(ownerId: string): Promise<Connection[]> {
  const rows = await sql()`select * from connections where owner_id = ${ownerId} order by (state = 'active') desc, app, label`;
  return rows.map(rowToConnection);
}
export type ConnectionInput = { app?: string; label: string; account?: string | null; companyId?: string | null; sphere?: Connection["sphere"]; provider?: Connection["provider"]; kind?: Connection["kind"]; state?: Connection["state"]; url?: string | null; meta?: Record<string, unknown> };
export async function createConnection(ownerId: string, input: ConnectionInput): Promise<Connection> {
  const label = input.label.trim().slice(0, 80);
  const [r] = await sql()`insert into connections (owner_id, app, label, account, company_id, sphere, provider, kind, state, source, url, meta)
    values (${ownerId}, ${(input.app ?? appOfLabel(label)).slice(0, 30)}, ${label}, ${input.account?.trim().slice(0, 120) || null}, ${input.companyId ?? null}, ${input.sphere ?? (input.companyId ? "work" : "private")},
      ${input.provider ?? "claude"}, ${input.kind ?? "mcp"}, ${input.state ?? "active"}, 'manual', ${input.url?.trim().slice(0, 500) || null}, ${sql().json((input.meta ?? {}) as never)}) returning *`;
  return rowToConnection(r);
}
export async function updateConnection(ownerId: string, id: string, patch: Partial<ConnectionInput>): Promise<void> {
  const p: Row = {};
  if (patch.app !== undefined) p.app = patch.app.slice(0, 30);
  if (patch.label !== undefined) p.label = patch.label.trim().slice(0, 80);
  if (patch.account !== undefined) p.account = patch.account?.trim().slice(0, 120) || null;
  if (patch.companyId !== undefined) p.company_id = patch.companyId;
  if (patch.sphere !== undefined) p.sphere = patch.sphere;
  if (patch.provider !== undefined) p.provider = patch.provider;
  if (patch.kind !== undefined) p.kind = patch.kind;
  if (patch.state !== undefined) p.state = patch.state;
  if (patch.url !== undefined) p.url = patch.url?.trim().slice(0, 500) || null;
  if (patch.meta !== undefined) p.meta = sql().json(patch.meta as never);
  if (!Object.keys(p).length) return;
  p.updated_at = new Date();
  await sql()`update connections set ${sql()(p)} where id = ${id} and owner_id = ${ownerId}`;
}
export async function deleteConnection(ownerId: string, id: string): Promise<void> { await sql()`delete from connections where id = ${id} and owner_id = ${ownerId}`; }
// połączenie po id albo nazwie (bez wielkości liter); nazwa niejednoznaczna → pierwsze działające
export async function findConnection(ownerId: string, ref: string): Promise<Connection | null> {
  const q = ref.trim();
  if (!q) return null;
  const rows = await sql()`select * from connections where owner_id = ${ownerId} and (id::text = ${q} or lower(label) = lower(${q}) or (lower(app) = lower(${q}) and state = 'active')) order by (id::text = ${q}) desc, (lower(label) = lower(${q})) desc, (state = 'active') desc limit 1`;
  return rows[0] ? rowToConnection(rows[0]) : null;
}
// zgłoszenie mostka: lista serwerów MCP, które widzi Claude Code na tym komputerze. Wpisy tego komputera, których nie ma na liście, gasną (off);
// serwer bez połączenia = wygasły; nowe wpisy dostają sferę i firmę z istniejącego wpisu o tej samej nazwie (ręcznie przypisanych nie nadpisujemy).
// Konektory z konta Claude Claude Code wypisuje jako „claude.ai Gmail”; firma z nazwy: „slack-pirxey” należy do firmy, której nazwa ma słowo „Pirxey”.
export type BridgeServer = { name: string; url?: string | null; command?: string | null; transport?: string | null; ok: boolean; status?: string | null };
const CLAUDE_AI = /^claude\.ai\s+/i;
// Claude Code pisze „✔ Connected” (starsza aplikacja na Macu znała tylko ✓), więc stan czytamy też z napisu
export const bridgeServerOk = (s: BridgeServer) => s.ok || /^[^a-z]*connected\b/i.test(s.status?.trim() ?? "");
export const companyOfLabel = (label: string, companies: Company[]): Company | null => {
  const l = label.toLowerCase();
  return companies.find((c) => !c.endedAt && c.name.toLowerCase().split(/[^\p{L}\p{N}]+/u).some((w) => w.length >= 4 && l.includes(w))) ?? null;
};
export async function upsertBridgeConnections(ownerId: string, host: string, servers: BridgeServer[]): Promise<{ added: number; updated: number; off: number }> {
  const h = host.trim().slice(0, 80) || "komputer";
  const keep = servers.filter((s) => s.name && !/^task[-_ ]?hub$/i.test(s.name.trim().replace(CLAUDE_AI, "")));
  const existing = (await sql()`select * from connections where owner_id = ${ownerId} and source = 'bridge' and host = ${h}`).map(rowToConnection);
  const all = (await sql()`select * from connections where owner_id = ${ownerId}`).map(rowToConnection);
  const companies = await listCompanies(ownerId);
  let added = 0, updated = 0;
  for (const srv of keep) {
    const server = srv.name.trim().slice(0, 80), label = server.replace(CLAUDE_AI, "");
    const state: Connection["state"] = bridgeServerOk(srv) ? "active" : "expired";
    const provider: Connection["provider"] = CLAUDE_AI.test(server) ? "claude" : "claude-code";
    const named = companyOfLabel(label, companies);
    const url = (srv.url ?? srv.command ?? null)?.trim().slice(0, 500) || null;
    const meta = { server, transport: srv.transport ?? null, status: srv.status ?? null };
    // dopasowanie po nazwie serwera zapamiętanej w meta (etykietę Piotr może zmienić), awaryjnie po etykiecie
    const mine = existing.find((c) => String(c.meta.server ?? c.label).toLowerCase() === server.toLowerCase());
    if (mine) {
      // wpis bez firmy dostaje firmę z nazwy; firmy wybranej ręcznie nie ruszamy
      const fill = !mine.companyId && named ? named : null;
      await sql()`update connections set state = ${state}, url = ${url}, meta = meta || ${sql().json(meta as never)},
        company_id = coalesce(company_id, ${fill?.id ?? null}), sphere = ${fill ? fill.sphere : mine.sphere}, seen_at = now(), updated_at = now() where id = ${mine.id}`;
      updated++;
    } else {
      // ten sam konektor znany skądinąd (ręczny wpis o tej nazwie albo inny komputer) podpowiada konto, firmę i sferę; sama aplikacja to za mało (Gmail firmowy i prywatny)
      const twin = all.find((c) => c.label.toLowerCase() === label.toLowerCase() || String(c.meta.server ?? "").toLowerCase() === label.toLowerCase());
      await sql()`insert into connections (owner_id, app, label, account, company_id, sphere, provider, kind, state, source, host, url, meta, seen_at)
        values (${ownerId}, ${appOfLabel(label)}, ${label}, ${twin?.account ?? null}, ${twin?.companyId ?? named?.id ?? null}, ${twin?.sphere ?? named?.sphere ?? "work"}, ${provider}, 'mcp', ${state}, 'bridge', ${h}, ${url}, ${sql().json(meta as never)}, now())
        on conflict (owner_id, host, lower(label)) where source = 'bridge' do update set state = excluded.state, url = excluded.url, meta = connections.meta || excluded.meta, seen_at = now(), updated_at = now()`;
      added++;
    }
  }
  const names = new Set(keep.map((s) => s.name.trim().slice(0, 80).toLowerCase()));
  const gone = existing.filter((c) => !names.has(String(c.meta.server ?? c.label).toLowerCase()) && c.state !== "off");
  if (gone.length) await sql()`update connections set state = 'off', updated_at = now() where id in ${sql()(gone.map((c) => c.id))}`;
  return { added, updated, off: gone.length };
}

// ---------- zadania ----------
function rowToStep(r: Row, deps: string[]): Step {
  const blocks = r.blocks ? Blocks.safeParse(r.blocks) : null;
  return {
    id: r.id as string, taskId: r.taskId as string, position: Number(r.position), title: r.title as string, detail: (r.detail as string) ?? "",
    tool: r.tool as string, status: r.status as Step["status"], prevStatus: (r.prevStatus as string) ?? null, needsApproval: !!r.needsApproval,
    estMin: Number(r.estMin), spentSec: Number(r.spentSec), spentManual: !!r.spentManual, link: (r.link as string) ?? null,
    handoffAt: iso(r.handoffAt), doneAt: iso(r.doneAt), report: (r.report as string) ?? null, output: (r.output as string) ?? "",
    review: (r.review as Record<string, unknown>) ?? null, blocks: blocks && blocks.success ? blocks.data : null, blocksAt: iso(r.blocksAt), hasPrevBlocks: r.hasPrevBlocks != null ? !!r.hasPrevBlocks : r.blocksPrev != null, logged: !!r.logged,
    pos: (r.pos as { x: number; y: number }) ?? null, dependsOn: deps, connectionId: (r.connectionId as string) ?? null, filePath: (r.filePath as string) ?? null,
    approvedAt: iso(r.approvedAt), approvedSig: (r.approvedSig as string) ?? null, sendStartedAt: iso(r.sendStartedAt), approval: (r.approval as Step["approval"]) ?? null,
    agentSec: Number(r.agentSec ?? 0), agentStartedAt: iso(r.agentStartedAt), doneBy: (r.doneBy as "owner" | "agent") ?? null,
    agentAt: iso(r.agentAt), openedAt: iso(r.openedAt),
    workLevel: (r.workLevel as string) ?? null, modelPick: (r.modelPick as string) ?? null, escalation: Number(r.escalation ?? 0),
    lastRun: (r.lastRun as Step["lastRun"]) ?? null, cloud: (r.cloud as Step["cloud"]) ?? null, waitFor: (r.waitFor as string) ?? null,
    leftAt: iso(r.leftAt), need: (r.need as Step["need"]) ?? null,
  };
}
function rowToTask(r: Row, steps: Step[], deps: string[]): Task {
  return {
    id: r.id as string, ownerId: r.ownerId as string, projectId: (r.projectId as string) ?? null, title: r.title as string, titleOriginal: (r.titleOriginal as string) ?? null, summary: (r.summary as string) ?? "",
    source: (r.source as string) ?? "", level: Number(r.level), due: dateStr(r.due), doneAt: iso(r.doneAt), deletedAt: iso(r.deletedAt),
    noteText: (r.noteText as string) ?? null, noteSummary: (r.noteSummary as string) ?? null, noteAt: iso(r.noteAt),
    pos: (r.pos as { x: number; y: number }) ?? null, createdAt: iso(r.createdAt) as string, dependsOn: deps, steps,
  };
}
// kolumny do odczytu zadań i kroków: bez `search` (tsvector, sam tekst drugi raz) i bez `blocks_prev` (cała poprzednia kartka, tylko do „Cofnij”),
// bo listy zadań czyta się bardzo często (mostek, puls strony, konektor), a każdy bajt z bazy liczy się do transferu Supabase.
// Nowa kolumna potrzebna w rowToTask / rowToStep musi trafić też tutaj.
const TASK_COLS = ["id", "owner_id", "project_id", "title", "title_original", "summary", "source", "level", "due", "done_at", "deleted_at", "note_text", "note_summary", "note_at", "pos", "created_at"];
const STEP_COLS = ["id", "task_id", "position", "title", "detail", "tool", "status", "prev_status", "needs_approval", "est_min", "spent_sec", "spent_manual", "spent_at", "link", "handoff_at", "done_at",
  "report", "output", "review", "blocks", "blocks_at", "logged", "pos", "connection_id", "file_path", "approved_at", "approved_sig", "send_started_at", "agent_sec", "agent_started_at", "done_by",
  "agent_at", "opened_at", "work_level", "model_pick", "escalation", "last_run", "cloud", "wait_for", "left_at", "approval", "need"];
const taskCols = () => sql()(TASK_COLS);

async function hydrate(rows: Row[]): Promise<Task[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id as string);
  const [stepRows, sdeps, tdeps] = await Promise.all([
    sql()`select ${sql()(STEP_COLS)}, (blocks_prev is not null) as has_prev_blocks from steps where task_id in ${sql()(ids)} order by task_id, position, created_at`,
    sql()`select sd.* from step_dependencies sd join steps s on s.id = sd.step_id where s.task_id in ${sql()(ids)}`,
    sql()`select * from task_dependencies where task_id in ${sql()(ids)}`,
  ]);
  const sdep = new Map<string, string[]>(); sdeps.forEach((d) => sdep.set(d.stepId as string, [...(sdep.get(d.stepId as string) ?? []), d.dependsOnId as string]));
  const tdep = new Map<string, string[]>(); tdeps.forEach((d) => tdep.set(d.taskId as string, [...(tdep.get(d.taskId as string) ?? []), d.dependsOnId as string]));
  const byTask = new Map<string, Step[]>();
  stepRows.forEach((s) => { const st = rowToStep(s, sdep.get(s.id as string) ?? []); byTask.set(st.taskId, [...(byTask.get(st.taskId) ?? []), st]); });
  return rows.map((r) => rowToTask(r, byTask.get(r.id as string) ?? [], tdep.get(r.id as string) ?? []));
}
export async function listTasks(ownerId: string, opts: { trash?: boolean; all?: boolean } = {}): Promise<Task[]> {
  const rows = opts.all
    ? await sql()`select ${taskCols()} from tasks where owner_id = ${ownerId} order by created_at`
    : opts.trash
      ? await sql()`select ${taskCols()} from tasks where owner_id = ${ownerId} and deleted_at is not null order by deleted_at desc`
      : await sql()`select ${taskCols()} from tasks where owner_id = ${ownerId} and deleted_at is null order by created_at`;
  return hydrate(rows);
}
export async function getTask(ownerId: string, id: string): Promise<Task | null> {
  const rows = await sql()`select ${taskCols()} from tasks where owner_id = ${ownerId} and id = ${id}`;
  return (await hydrate(rows))[0] ?? null;
}
export type NewStep = { title: string; detail?: string; tool?: string; needsApproval?: boolean; estMin?: number; link?: string; dependsOn?: string[] /* indeksy lub id */; connectionId?: string | null; workLevel?: string | null };
export type NewTask = { title: string; summary?: string; source?: string; level?: number; due?: string | null; projectId?: string | null; steps?: NewStep[]; dependsOn?: string[] };

export async function createTask(ownerId: string, input: NewTask): Promise<Task> {
  // projekt z treści: gdy nikt go nie podał, a tytuł, cel albo źródło wymienia nazwę projektu, zadanie dostaje go od razu (także bez agenta, gdy mostek stoi)
  const projectId = input.projectId ?? guessProject([input.title, input.summary, input.source].filter(Boolean).join("\n"), await listProjects(ownerId))?.id ?? null;
  const [t] = await sql()`insert into tasks (owner_id, project_id, title, summary, source, level, due)
    values (${ownerId}, ${projectId}, ${input.title.slice(0, 200)}, ${input.summary ?? ""}, ${input.source ?? ""}, ${input.level ?? 3}, ${input.due ?? null}) returning id`;
  const id = t.id as string;
  if (input.dependsOn?.length) await sql()`insert into task_dependencies ${sql()(input.dependsOn.map((d) => ({ task_id: id, depends_on_id: d })))} on conflict do nothing`;
  if (input.steps?.length) await addSteps(id, input.steps);
  return (await getTask(ownerId, id))!;
}
// before: id kroku, przed którym nowe kroki mają wejść (np. przed publikacją): dostają jego miejsce w kolejności, dziedziczą jego pierwotne zależności
// (gdy nie podały własnych; bez kroków dopisanych przed nim wcześniej), a on zaczyna czekać na nie; kroki za nim przesuwają się dalej.
// dependsOn podane wprost (także pusta lista = krok niezależny) wygrywa z dziedziczeniem: agent wskazuje tylko prawdziwe zależności
export async function addSteps(taskId: string, steps: NewStep[], opts: { before?: string | null } = {}): Promise<Step[]> {
  const [bef] = opts.before ? await sql()`select id, position from steps where id = ${opts.before} and task_id = ${taskId}` : [];
  if (bef) await sql()`update steps set position = position + ${steps.length} where task_id = ${taskId} and position >= ${Number(bef.position)}`;
  const [{ n }] = await sql()`select coalesce(max(position), -1) + 1 as n from steps where task_id = ${taskId}`;
  let pos = bef ? Number(bef.position) : Number(n);
  const created: { id: string }[] = [];
  for (const s of steps) {
    const [r] = await sql()`insert into steps (task_id, position, title, detail, tool, needs_approval, est_min, link, connection_id, work_level)
      values (${taskId}, ${pos++}, ${s.title.slice(0, 200)}, ${s.detail ?? ""}, ${normalizeTool(s.tool)}, ${!!s.needsApproval && normalizeTool(s.tool) !== "file"}, ${roundQ(s.estMin ?? Q)}, ${isHttpUrl(s.link) ? s.link.trim() : null}, ${s.connectionId ?? null}, ${normalizeLevel(s.workLevel)}) returning id`;
    created.push({ id: r.id as string });
  }
  // zależności: "n2" / indeks w tej paczce albo id istniejącego kroku
  const existing = (await sql()`select id from steps where task_id = ${taskId}`).map((r) => r.id as string);
  const links: { step_id: string; depends_on_id: string }[] = [];
  steps.forEach((s, i) => (s.dependsOn ?? []).forEach((d) => {
    const m = /^(?:n|s)?(\d+)$/.exec(String(d));
    const target = m ? created[Number(m[1]) - 1]?.id : existing.includes(String(d)) ? String(d) : undefined;
    if (target && target !== created[i].id) links.push({ step_id: created[i].id, depends_on_id: target });
  }));
  if (links.length) await sql()`insert into step_dependencies ${sql()(links)} on conflict do nothing`;
  // nowe kroki to nowa praca: zadanie, które zamknęło się samo (wszystkie dotychczasowe kroki gotowe), wraca do pracy, inaczej list_work go nie widzi
  if (created.length) await sql()`update tasks set done_at = null where id = ${taskId} and done_at is not null`;
  if (bef) {
    // dziedziczenie: nowy krok bez własnych zależności czeka na to, na co czekał krok „before”; „before” czeka na ostatnie z nowych (te, na które żaden nowy nie czeka).
    // Dziedziczy tylko zależności starsze od kroku „before” (te, które miał przed pierwszym dopisaniem): kroki dopisane przed nim wcześniej to rodzeństwo, nie poprzednicy,
    // inaczej każde kolejne dopisanie tworzy fałszywy łańcuch (12 → 13 → 14 → 15)
    const inherited = (await sql()`select d.depends_on_id from step_dependencies d join steps s on s.id = d.depends_on_id join steps b on b.id = d.step_id
      where d.step_id = ${bef.id as string} and s.created_at <= b.created_at`).map((r) => r.dependsOnId as string);
    const own = new Set(created.filter((_, i) => steps[i].dependsOn !== undefined).map((c) => c.id));
    const inh = created.filter((c) => !own.has(c.id)).flatMap((c) => inherited.map((d) => ({ step_id: c.id, depends_on_id: d })));
    const needed = new Set(links.map((l) => l.depends_on_id));
    const tails = created.filter((c) => !needed.has(c.id)).map((c) => ({ step_id: bef.id as string, depends_on_id: c.id }));
    const extra = [...inh, ...tails];
    if (extra.length) await sql()`insert into step_dependencies ${sql()(extra)} on conflict do nothing`;
  }
  const rows = await sql()`select * from steps where id in ${sql()(created.map((c) => c.id))} order by position`;
  const deps = await sql()`select * from step_dependencies where step_id in ${sql()(created.map((c) => c.id))}`;
  return rows.map((r) => rowToStep(r, deps.filter((d) => d.stepId === r.id).map((d) => d.dependsOnId as string)));
}
export type TaskPatch = Partial<{ title: string; titleOriginal: string | null; summary: string; source: string; level: number; due: string | null; projectId: string | null; pos: { x: number; y: number } | null; deletedAt: string | null; noteText: string | null; noteSummary: string | null }>;
// firma zadania (przez projekt): od niej zależy konto wysyłki kroku bez wskazanego połączenia
const taskCompany = async (ownerId: string, id: string): Promise<string | null> =>
  ((await sql()`select p.company_id from tasks t left join projects p on p.id = t.project_id where t.id = ${id} and t.owner_id = ${ownerId}`)[0]?.companyId as string) ?? null;
// zatwierdzony szkic bez wskazanego połączenia wysyła konto firmy zadania: po zmianie projektu albo firmy projektu zgoda przepada
// (treść poleciałaby z konta innej firmy niż to, które Piotr widział na karcie); szkic w trakcie wysyłki zostaje
async function dropRoutedApprovals(ownerId: string, steps: Row[]): Promise<void> {
  for (const st of steps) {
    await clearApproval(ownerId, st.id as string, { note: `Zgoda na szkic „${shortTitle(st.title as string, 60)}” wygasła: zadanie zmieniło projekt albo firmę, więc wysyłka mogłaby pójść z innego konta. Sprawdź konto na karcie szkicu i zatwierdź go ponownie.` });
  }
}
export async function updateTask(ownerId: string, id: string, patch: TaskPatch): Promise<void> {
  const p: Row = {};
  if (patch.title !== undefined) p.title = patch.title.slice(0, 200);
  if (patch.titleOriginal !== undefined) p.title_original = patch.titleOriginal === null ? null : patch.titleOriginal.slice(0, 200);
  if (patch.summary !== undefined) p.summary = patch.summary;
  if (patch.source !== undefined) p.source = patch.source;
  if (patch.level !== undefined) p.level = patch.level;
  if (patch.due !== undefined) p.due = patch.due;
  if (patch.projectId !== undefined) p.project_id = patch.projectId;
  if (patch.pos !== undefined) p.pos = patch.pos === null ? null : sql().json(patch.pos);
  if (patch.deletedAt !== undefined) p.deleted_at = patch.deletedAt;
  if (patch.noteText !== undefined) { p.note_text = patch.noteText; p.note_at = new Date(); }
  if (patch.noteSummary !== undefined) p.note_summary = patch.noteSummary;
  if (!Object.keys(p).length) return;
  const before = patch.projectId !== undefined ? await taskCompany(ownerId, id) : undefined;
  await sql()`update tasks set ${sql()(p)} where id = ${id} and owner_id = ${ownerId}`;
  if (before !== undefined && before !== (await taskCompany(ownerId, id))) {
    await dropRoutedApprovals(ownerId, await sql()`select id, title from steps where task_id = ${id} and approved_at is not null and send_started_at is null and status <> 'done' and connection_id is null`);
  }
}
export async function setTaskDependencies(id: string, dependsOn: string[]): Promise<void> {
  await sql().begin(async (tx) => {
    await tx`delete from task_dependencies where task_id = ${id}`;
    if (dependsOn.length) await tx`insert into task_dependencies ${tx(dependsOn.filter((d) => d !== id).map((d) => ({ task_id: id, depends_on_id: d })))} on conflict do nothing`;
  });
}
export async function purgeTask(ownerId: string, id: string): Promise<void> {
  await sql()`delete from tasks where id = ${id} and owner_id = ${ownerId}`;
}

export type StepPatch = Partial<{ title: string; detail: string; tool: string; status: Step["status"]; prevStatus: string | null; needsApproval: boolean; estMin: number; spentSec: number; spentManual: boolean; link: string | null; doneAt: string | null; handoffAt: string | null; report: string | null; output: string; review: Record<string, unknown> | null; blocks: Block[] | null; position: number; logged: boolean; pos: { x: number; y: number } | null; connectionId: string | null; filePath: string | null; agentSec: number; agentStartedAt: string | null; doneBy: "owner" | "agent" | null; workLevel: string | null; modelPick: string | null }>;
const parseBlocks = (v: unknown): Block[] | null => { if (!v) return null; const p = Blocks.safeParse(v); return p.success ? p.data : null; };
const isApproved = (b: Block) => b.type === "draft" && b.status === "approved";
const demote = (blocks: Block[]) => blocks.map((b): Block => (b.type === "draft" && b.status === "approved" ? { ...b, status: "proposed" } : b));
// klocki przed zapisem: adresy tylko http(s); „zatwierdzony” zostaje tylko pierwszy szkic z ważnym podpisem Piotra (ta sama treść; przy opcjach
// wybraną poznaje podpis, nie pozycja), „wysłany” tylko przy zamknięciu kroku po wysyłce (sent) albo gdy to bez zmian szkic już wysłany; reszta to propozycja
function guardBlocks(stepId: string, cur: { blocks: Block[] | null; approvedSig: string | null } | null, next: Block[], sent: boolean): { blocks: Block[]; approved: boolean } {
  const sentSigs = new Set((cur?.blocks ?? []).filter((b): b is Draft => b.type === "draft" && b.status === "sent").map((d) => approvalSig({ id: stepId, blocks: cur?.blocks }, d)));
  let approved = false;
  const clean = sanitizeBlocks(next);
  const blocks = clean.map((b): Block => {
    if (b.type !== "draft") return b;
    if (b.status === "proposed") return b;
    const sig = approvalSig({ id: stepId, blocks: clean }, b);
    if (b.status === "approved" && !approved && !!cur?.approvedSig && sig === cur.approvedSig) { approved = true; return b; }
    if (b.status === "sent" && (sent || sentSigs.has(sig))) return b;
    return { ...b, status: "proposed" };
  });
  return { blocks, approved };
}
export async function updateStep(id: string, patch: StepPatch): Promise<void> { await writeStep(id, patch); }
// sent: zapis z completeStep (szkic zatwierdzony → wysłany); każdy inny zapis „wysłanego” szkicu to propozycja
async function writeStep(id: string, patch: StepPatch, opts: { sent?: boolean } = {}): Promise<void> {
  const p: Row = {};
  if (patch.title !== undefined) p.title = patch.title.slice(0, 200);
  if (patch.detail !== undefined) p.detail = patch.detail;
  if (patch.tool !== undefined) { p.tool = normalizeTool(patch.tool); if (p.tool === "file") p.needs_approval = false; }   // plik na Macu nigdy nie czeka na zgodę
  if (patch.status !== undefined) { p.status = patch.status; p.left_at = null; }   // nowy stan kroku: „Potrzebna pomoc” gaśnie
  if (patch.prevStatus !== undefined) p.prev_status = patch.prevStatus;
  if (patch.needsApproval !== undefined) p.needs_approval = patch.needsApproval;
  if (patch.estMin !== undefined) p.est_min = roundQ(patch.estMin);
  if (patch.spentSec !== undefined) { p.spent_sec = Math.max(0, Math.round(patch.spentSec)); p.spent_at = new Date(); }
  if (patch.spentManual !== undefined) p.spent_manual = patch.spentManual;
  if (patch.agentSec !== undefined) p.agent_sec = Math.max(0, Math.round(patch.agentSec));
  if (patch.agentStartedAt !== undefined) p.agent_started_at = patch.agentStartedAt;
  if (patch.doneBy !== undefined) p.done_by = patch.doneBy;
  if (patch.link !== undefined) p.link = isHttpUrl(patch.link) ? patch.link.trim() : null;   // link kroku tylko http(s)
  if (patch.handoffAt !== undefined) p.handoff_at = patch.handoffAt;
  if (patch.doneAt !== undefined) p.done_at = patch.doneAt;
  if (patch.report !== undefined) p.report = patch.report;
  if (patch.output !== undefined) p.output = patch.output;
  if (patch.review !== undefined) p.review = patch.review === null ? null : sql().json(patch.review as never);
  // zgoda Piotra trzyma się treści szkicu, stanu „czeka na wysyłkę”, narzędzia i połączenia; zmiana któregoś z nich ją kasuje
  const watch = patch.blocks !== undefined || patch.status !== undefined || patch.tool !== undefined || patch.connectionId !== undefined;
  const [cur] = watch ? await sql()`select blocks, approved_sig, status, tool, connection_id, cloud from steps where id = ${id}` : [];
  const curBlocks = cur ? parseBlocks(cur.blocks) : null;
  const approvedSig = (cur?.approvedSig as string) ?? null;
  let keep = !!approvedSig;
  let blocks: Block[] | null | undefined;
  if (patch.blocks !== undefined) {
    const g = patch.blocks === null ? { blocks: null, approved: false } : guardBlocks(id, { blocks: curBlocks, approvedSig }, patch.blocks, !!opts.sent);
    blocks = g.blocks; keep &&= g.approved;
  }
  if (patch.status !== undefined && patch.status !== "handoff") keep = false;
  // krok wraca do zrobienia (oddany, zatrzymany) albo się kończy: zlecenie do chmury gaśnie, chmura nie weźmie go drugi raz bez nowego kliknięcia
  if (patch.status !== undefined && patch.status !== "handoff" && cur?.cloud) p.cloud = null;
  if (patch.tool !== undefined && normalizeTool(patch.tool) !== cur?.tool) keep = false;
  if (patch.connectionId !== undefined && (patch.connectionId ?? null) !== ((cur?.connectionId as string) ?? null)) keep = false;
  if (approvedSig && !keep) {
    p.approved_at = null; p.approved_sig = null; p.send_started_at = null;
    // zapis zgody zostaje tylko przy zamknięciu kroku po wysyłce (completeStep); każde inne wygaśnięcie zgody kasuje też jej zapis
    if (!(opts.sent && patch.status === "done")) p.approval = null;
    if (blocks) blocks = demote(blocks);
    else if (blocks === undefined && curBlocks?.some(isApproved)) { p.blocks = sql().json(demote(curBlocks) as never); p.blocks_at = new Date(); }
    // krok czekał na wysyłkę: wraca do zatwierdzenia
    if (patch.status === undefined && cur?.status === "handoff") { p.status = "draft"; p.prev_status = null; p.handoff_at = null; }
  }
  if (blocks !== undefined) {
    // poprzednia wersja kartki zostaje do cofnięcia; zapis tej samej treści jej nie nadpisuje
    if (cur?.blocks && JSON.stringify(cur.blocks) !== JSON.stringify(blocks)) p.blocks_prev = sql().json(cur.blocks as never);
    p.blocks = blocks === null ? null : sql().json(blocks as never); p.blocks_at = blocks === null ? null : new Date();
  }
  if (patch.pos !== undefined) p.pos = patch.pos === null ? null : sql().json(patch.pos);
  if (patch.position !== undefined) p.position = patch.position;
  if (patch.logged !== undefined) p.logged = patch.logged;
  if (patch.connectionId !== undefined) p.connection_id = patch.connectionId;
  if (patch.filePath !== undefined) p.file_path = patch.filePath?.trim().slice(0, 500) || null;
  if (patch.workLevel !== undefined) p.work_level = normalizeLevel(patch.workLevel);
  if (patch.modelPick !== undefined) p.model_pick = isModelName(patch.modelPick) ? patch.modelPick.trim() : null;
  if (!Object.keys(p).length) return;
  const [u] = await sql()`update steps set ${sql()(p)} where id = ${id} returning task_id`;
  // zrobiony krok może odblokować krok zlecony do chmury w rozmowie (paczka 19, punkt 2)
  if (patch.status === "done" && u) await startAutoCloud(u.taskId as string);
}
export async function setStepDependencies(id: string, dependsOn: string[]): Promise<void> {
  await sql().begin(async (tx) => {
    await tx`delete from step_dependencies where step_id = ${id}`;
    if (dependsOn.length) await tx`insert into step_dependencies ${tx(dependsOn.filter((d) => d !== id).map((d) => ({ step_id: id, depends_on_id: d })))} on conflict do nothing`;
  });
  const [r] = await sql()`select task_id from steps where id = ${id}`;
  if (r) await startAutoCloud(r.taskId as string);
}
export async function deleteStep(id: string): Promise<void> { await sql()`delete from steps where id = ${id}`; }

// krok gotowy: zapis czasu do historii (uczenie), status, raport i link. by: kto zamknął (Piotr z aplikacji, agent przez MCP albo bieg wysyłki);
// addSpentSec = czas Piotra, addAgentSec = czas Claude'a; próbka do kalibracji: czas Piotra dla jego kroku, czas Claude'a dla reszty
export async function completeStep(ownerId: string, task: Task, step: Step, opts: { report?: string; link?: string; output?: string; addSpentSec?: number; addAgentSec?: number; by?: "owner" | "agent"; chosen?: number } = {}): Promise<void> {
  const spentSec = step.spentSec + (opts.addSpentSec ?? 0);
  const agentSec = (step.agentSec ?? 0) + Math.max(0, Math.round(opts.addAgentSec ?? 0));
  const patch: StepPatch = { status: "done", prevStatus: step.status === "done" ? step.prevStatus : step.status, handoffAt: null, doneAt: new Date().toISOString(), doneBy: opts.by ?? "owner", agentStartedAt: null, agentSec };
  if ((opts.addSpentSec ?? 0) > 0) patch.spentSec = spentSec;
  if (opts.report !== undefined) { patch.report = opts.report; patch.output = opts.report; }
  if (opts.output !== undefined) patch.output = opts.output;
  if (opts.link && isHttpUrl(opts.link)) patch.link = opts.link.trim();
  // zatwierdzony szkic, który krok właśnie wysłał, zostaje w zadaniu jako zapis wysyłki. Wołający pilnują, kto może tak zamknąć krok:
  // Piotr, mostek v1 przy ważnej zgodzie, bieg wysyłki tego kroku (MCP complete_step i czat w aplikacji odmawiają pozostałym).
  // chosen: krok bez zgody (szkic zostaje w zadaniu) tak samo zapisuje opcję, którą Piotr wybrał przyciskiem (indeks wśród szkiców)
  const pick = opts.chosen != null ? draftsOf(step)[opts.chosen] : undefined;
  if (step.blocks?.some(isApproved) || pick?.status === "proposed") patch.blocks = step.blocks!.map((b) => (b.type === "draft" && (b.status === "approved" || b === pick) ? { ...b, status: "sent" as const } : b));
  const own = isOwnerStep(step);
  const sm = own ? spentMin({ spentSec }) : agentMinOf({ agentSec });
  if (sm > 0 && !step.logged) {
    await sql()`insert into time_samples (owner_id, step_id, tool, project_id, est_min, spent_min, who) values (${ownerId}, ${step.id}, ${step.tool}, ${task.projectId}, ${step.estMin}, ${sm}, ${own ? "owner" : "agent"})`;
    patch.logged = true;
  }
  await writeStep(step.id, patch, { sent: true });
  // ostatni krok gotowy: zadanie kończy się samo, chyba że jakaś wiadomość Piotra czeka jeszcze na odpowiedź agenta (zamknie je reply_chat)
  await closeIfDone(ownerId, task.id);
}
export async function reopenStep(ownerId: string, taskId: string, step: Step): Promise<void> {
  const status = step.prevStatus === "handoff" ? "todo" : step.prevStatus && step.prevStatus !== "done" ? (step.prevStatus as Step["status"]) : step.output ? "draft" : "todo";
  await sql().begin(async (tx) => {
    // ponowne otwarcie nie przywraca zgody: szkic trzeba zatwierdzić od nowa
    await tx`update steps set status = ${status}, prev_status = null, logged = false, done_at = null, done_by = null, agent_started_at = null, approved_at = null, approved_sig = null, send_started_at = null, approval = null, cloud = null, left_at = null where id = ${step.id}`;
    // „Zmień odpowiedź”: pytania na kartce wracają do zadania, poprzednia odpowiedź zostaje w prev (agent widzi zmianę); cofanie kartki nie ma do czego wracać
    if (stepKind(step) === "decision") {
      // paczka 22: zgoda z tej decyzji przechodziła na kroki po niej; zlecone, a jeszcze niewzięte przez chmurę czekają znowu na nową odpowiedź
      await tx`update steps s set cloud = s.cloud || jsonb_build_object('state', 'auto') where s.task_id = ${taskId} and s.status = 'todo' and s.cloud->>'state' in ('queued', 'rung')
        and exists (select 1 from step_dependencies d where d.step_id = s.id and d.depends_on_id = ${step.id})`;
      const blocks = (step.blocks ?? []).map((b): Block => (b.type === "question" && b.answer ? { ...b, answer: undefined, prev: b.answer } : b));
      await tx`update steps set blocks = ${tx.json(sanitizeBlocks(blocks) as never)}, blocks_prev = null where id = ${step.id}`;
    }
    await tx`delete from time_samples where step_id = ${step.id}`;
    await tx`update tasks set done_at = null where id = ${taskId} and owner_id = ${ownerId}`;
  });
}

// ---------- zgoda na szkic i wysyłka ----------
// Jedyne miejsce, które zapisuje zgodę: kliknięcie Piotra „Zatwierdź” (akcja approveStep). Treść poprawiona w tym samym kliknięciu (body) zapisuje się
// razem ze zgodą; stary szkic bez bloku (sama treść w output) dostaje blok. Szkic już wysyłany (bieg wysyłki go wziął) albo wysłany się nie zmienia.
// seen: podpis szkicu z karty, którą Piotr miał przed oczami (shownSig); inny podpis w bazie = szkic zmienił się po wyświetleniu, zgody nie ma
// option: numer opcji wśród szkiców kroku (0 = pierwsza); przy jednym szkicu zbędny, przy kilku bez poprawnego numeru zgody nie ma
export async function approveDraft(ownerId: string, stepId: string, opts: { body?: string | null; seen?: string | null; option?: number } = {}): Promise<boolean> {
  return sql().begin(async (tx) => {
    const [r] = await tx`select s.* from steps s join tasks t on t.id = s.task_id where s.id = ${stepId} and t.owner_id = ${ownerId} for update of s`;
    if (!r || r.status === "done" || r.sendStartedAt) return false;
    const step = rowToStep(r, []);
    let blocks: Block[] = [...(step.blocks ?? [])];
    const idx = blocks.map((b, k) => (b.type === "draft" ? k : -1)).filter((k) => k >= 0);
    let i = idx.length > 1 ? idx[opts.option ?? -1] ?? -1 : idx[0] ?? -1;
    if (idx.length > 1 && i < 0) return false;
    if (i >= 0 && opts.seen && shownSig(step, blocks[i] as Draft, opts.body != null) !== opts.seen) return false;
    if (i < 0) {
      const body = opts.body ?? step.output;
      if (!body?.trim()) return false;
      blocks = [...blocks.slice(0, 11), { type: "draft", target: { app: step.tool, action: "send" }, body, status: "proposed" }];
      i = blocks.length - 1;
    }
    const cur = blocks[i] as Draft;
    if (cur.status === "sent") return false;
    // inna opcja tej kartki już poszła: krok już opublikował, a ta zgoda nigdy nie byłaby ważna (draftOf woli wysłaną)
    if (blocks.some((b, k) => k !== i && b.type === "draft" && b.status === "sent")) return false;
    blocks[i] = { ...cur, ...(opts.body != null ? { body: opts.body } : {}), status: "approved" };
    // ostatnie kliknięcie wygrywa: opcja zatwierdzona chwilę wcześniej (drugi przycisk, zanim karta się odświeżyła, albo druga karta) wraca do
    // propozycji, żeby approved_sig zawsze był podpisem szkicu kroku (draftOf) i bieg wysyłki dostał dokładnie jeden szkic.
    // „Nieaktualny” znika z każdej opcji: Piotr widział kartkę i wybrał, a odrzuconej nikt nie szykuje od nowa
    blocks = sanitizeBlocks(blocks.map((b, k): Block => {
      if (b.type !== "draft") return b;
      const d: Draft = { ...b }; delete d.stale;
      return k !== i && d.status === "approved" ? { ...d, status: "proposed" } : d;
    }));
    // dwie opcje o tej samej treści: wybór byłby niejednoznaczny (zgoda trzyma się podpisu, nie pozycji), więc bez zgody
    const sig = approvalSig({ id: step.id, blocks }, blocks[i] as Draft);
    if (blocks.some((b, k) => k !== i && b.type === "draft" && approvalSig({ id: step.id, blocks }, b) === sig)) return false;
    // zapis zgody (paczka 22): kto, kiedy, podpis i początek zatwierdzonej treści; zostaje na karcie wysłanego kroku
    const now = new Date(), picked = blocks[i] as Draft;
    const excerpt = (picked.subject ? picked.subject + ": " : "") + (picked.body || (picked.rows ?? []).map((r) => r.join(" | ")).join("; "));
    const p: Row = {
      blocks: tx.json(blocks as never), blocks_at: now, status: "handoff", prev_status: "draft", handoff_at: now,
      approved_at: now, approved_sig: sig, send_started_at: null,
      approval: tx.json({ at: now.toISOString(), by: "owner", sig, excerpt: excerpt.replace(/\s+/g, " ").trim().slice(0, 160), source: "click" } as never),
    };
    if (r.blocks && JSON.stringify(r.blocks) !== JSON.stringify(blocks)) p.blocks_prev = tx.json(r.blocks as never);
    await tx`update steps set ${tx(p)} where id = ${stepId}`;
    return true;
  });
}
// zgoda wycofana (Zatrzymaj w biegu wysyłki, brak konektora, bieg wysyłki bez potwierdzenia): szkic wraca do propozycji, krok do zatwierdzenia.
// Zwraca true, gdy było co cofnąć; tylko wtedy dopisuje notatkę do rozmowy zadania (nic dwa razy).
export async function clearApproval(ownerId: string, stepId: string, opts: { note?: string } = {}): Promise<boolean> {
  const [r] = await sql()`select s.* from steps s join tasks t on t.id = s.task_id where s.id = ${stepId} and t.owner_id = ${ownerId}`;
  if (!r || r.status === "done") return false;
  const blocks = parseBlocks(r.blocks);
  if (!r.approvedAt && !r.approvedSig && !r.sendStartedAt && !blocks?.some(isApproved)) return false;
  const p: Row = { approved_at: null, approved_sig: null, send_started_at: null, approval: null };
  if (blocks?.some(isApproved)) { p.blocks = sql().json(demote(blocks) as never); p.blocks_at = new Date(); }
  if (r.status === "handoff") { p.status = "draft"; p.prev_status = null; p.handoff_at = null; }
  await sql()`update steps set ${sql()(p)} where id = ${stepId}`;
  if (opts.note) await addChat(ownerId, r.taskId as string, "agent", opts.note, { stepId });
  return true;
}
// notatka po biegu wysyłki, który nie potwierdził wysyłki (bez ponawiania: Piotr sprawdza i zatwierdza ponownie)
// paczka 20: z nazwą kroku, bo bez niej notatka po nieudanej wysyłce jednego kroku wyglądała jak alarm po udanej wysyłce innego
export const unconfirmedSendNote = (app: string, title?: string | null) => `Wysyłka${title ? ` „${shortTitle(title, 60)}”` : ""} nie została potwierdzona. Sprawdź w ${toolLabel(app)}, czy poszło, i zatwierdź ponownie, jeśli trzeba.`;
// bieg wysyłki bierze szkic: atomowo i najwyżej raz (tylko gdy nikt go jeszcze nie wziął, zgoda jest ważna, a kroki przed nim są zrobione)
export async function markSendStarted(ownerId: string, stepId: string): Promise<boolean> {
  return sql().begin(async (tx) => {
    const [r] = await tx`select s.* from steps s join tasks t on t.id = s.task_id where s.id = ${stepId} and t.owner_id = ${ownerId} and t.deleted_at is null for update of s`;
    if (!r || !isSendable(rowToStep(r, []))) return false;
    const [open] = await tx`select 1 from step_dependencies d join steps x on x.id = d.depends_on_id where d.step_id = ${stepId} and x.status <> 'done' limit 1`;
    if (open) return false;
    await tx`update steps set send_started_at = now() where id = ${stepId}`;
    return true;
  });
}
// wysyłka potwierdzona przez bieg wysyłki (np. commit zrobiony przez aplikację na Macu): krok zrobiony, szkic „wysłany”, krótka linia w rozmowie.
// by: agent (bieg wysyłki: czas Claude'a od wzięcia szkicu) albo owner (zgoda Piotra kończy szkic, który nigdzie nie idzie)
export async function completeSend(ownerId: string, stepId: string, sent: { summary?: string | null; link?: string | null } = {}, by: "owner" | "agent" = "agent"): Promise<boolean> {
  const [row] = await sql()`select s.task_id from steps s join tasks t on t.id = s.task_id where s.id = ${stepId} and t.owner_id = ${ownerId}`;
  const task = row ? await getTask(ownerId, row.taskId as string) : null;
  const step = task?.steps.find((s) => s.id === stepId);
  if (!task || !step || !approvalValid(step) || !step.sendStartedAt) return false;
  const link = isHttpUrl(sent.link) ? sent.link.trim() : undefined;
  await completeStep(ownerId, task, step, { report: sent.summary?.trim().slice(0, 4000) || undefined, link, by, addAgentSec: by === "agent" ? elapsedSec(step.sendStartedAt) : 0 });
  const closed = !!(await getTask(ownerId, task.id))?.doneAt;
  await addChat(ownerId, task.id, "agent", doneChat(step, closed), { stepId, link });
  return true;
}

// ---------- fakty ----------
const rowToFact = (r: Row): Fact => ({
  id: r.id as string, label: r.label as string, value: r.value as string, pinned: !!r.pinned, hidden: !!r.hidden,
  source: r.sourceApp ? { app: r.sourceApp as string, ref: (r.sourceRef as string) ?? undefined, url: (r.sourceUrl as string) ?? undefined, fetchedAt: iso(r.fetchedAt) ?? undefined } : undefined,
});
export async function listFacts(where: { stepId?: string; taskId?: string }): Promise<Fact[]> {
  const rows = where.stepId
    ? await sql()`select * from facts where step_id = ${where.stepId} order by position, created_at`
    : await sql()`select * from facts where task_id = ${where.taskId!} and step_id is null order by position, created_at`;
  return rows.map(rowToFact);
}
// agent podaje nowy zestaw faktów; przypięcia i ukrycia Piotra zostają (po etykiecie)
export async function replaceFacts(where: { stepId?: string; taskId?: string }, facts: Fact[]): Promise<void> {
  const old = await listFacts(where);
  const pref = new Map(old.map((f) => [f.label.toLowerCase(), { pinned: !!f.pinned, hidden: !!f.hidden }]));
  await sql().begin(async (tx) => {
    if (where.stepId) await tx`delete from facts where step_id = ${where.stepId}`; else await tx`delete from facts where task_id = ${where.taskId!} and step_id is null`;
    const rows = facts.slice(0, 40).map((f, i) => ({
      task_id: where.taskId ?? null, step_id: where.stepId ?? null, label: f.label.slice(0, 80), value: f.value.slice(0, 2000),
      source_app: f.source?.app ?? null, source_ref: f.source?.ref ?? null, source_url: isHttpUrl(f.source?.url) ? f.source.url.trim() : null, fetched_at: f.source?.fetchedAt ?? null,
      pinned: pref.get(f.label.toLowerCase())?.pinned ?? !!f.pinned, hidden: pref.get(f.label.toLowerCase())?.hidden ?? !!f.hidden, position: i,
    }));
    if (rows.length) await tx`insert into facts ${tx(rows)}`;
  });
}
export async function setFactPreference(id: string, pref: { pinned?: boolean; hidden?: boolean }): Promise<void> {
  const p: Row = {};
  if (pref.pinned !== undefined) p.pinned = pref.pinned;
  if (pref.hidden !== undefined) p.hidden = pref.hidden;
  if (Object.keys(p).length) await sql()`update facts set ${sql()(p)} where id = ${id}`;
}
// preferencje per aplikacja: czego Piotr nie chce widzieć, co zawsze chce (tekst dla agenta)
export async function factPreferencesText(ownerId: string): Promise<string> {
  const rows = await sql()`
    select f.source_app, f.label, bool_or(f.pinned) as pinned, bool_or(f.hidden) as hidden
    from facts f left join steps s on s.id = f.step_id left join tasks t on t.id = coalesce(f.task_id, s.task_id)
    where t.owner_id = ${ownerId} and (f.pinned or f.hidden) group by 1, 2`;
  if (!rows.length) return "";
  const by = new Map<string, { pin: string[]; hide: string[] }>();
  rows.forEach((r) => { const k = (r.sourceApp as string) ?? "ogólnie"; const e = by.get(k) ?? { pin: [], hide: [] }; if (r.pinned) e.pin.push(r.label as string); if (r.hidden) e.hide.push(r.label as string); by.set(k, e); });
  return "PREFERENCJE PÓL: " + [...by.entries()].map(([app, e]) => `${app}: ${e.pin.length ? "zawsze pokazuj " + e.pin.join(", ") : ""}${e.pin.length && e.hide.length ? "; " : ""}${e.hide.length ? "nie pokazuj " + e.hide.join(", ") : ""}`).join(" | ");
}

// ---------- migawki ----------
export async function addSnapshot(where: { stepId?: string; taskId?: string }, app: string, raw: unknown, meta: { sourceId?: string; url?: string } = {}): Promise<string> {
  const [r] = await sql()`insert into snapshots (task_id, step_id, source_app, source_id, url, raw) values (${where.taskId ?? null}, ${where.stepId ?? null}, ${app}, ${meta.sourceId ?? null}, ${meta.url ?? null}, ${sql().json(raw as never)}) returning id`;
  return r.id as string;
}
export async function latestSnapshots(where: { stepId?: string; taskId?: string }): Promise<{ app: string; url: string | null; fetchedAt: string; raw: unknown }[]> {
  const rows = where.stepId
    ? await sql()`select distinct on (source_app) source_app, url, fetched_at, raw from snapshots where step_id = ${where.stepId} order by source_app, fetched_at desc`
    : await sql()`select distinct on (source_app) source_app, url, fetched_at, raw from snapshots where task_id = ${where.taskId!} order by source_app, fetched_at desc`;
  return rows.map((r) => ({ app: r.sourceApp as string, url: (r.url as string) ?? null, fetchedAt: iso(r.fetchedAt) as string, raw: r.raw }));
}

// ---------- załączniki ----------
export type Attachment = { id: string; kind: "image" | "file" | "link"; name: string | null; url: string | null; caption: string | null; analysis: string | null; keep: boolean; expiresAt: string | null; mime: string | null };
const rowToAttachment = (r: Row): Attachment => ({ id: r.id as string, kind: r.kind as Attachment["kind"], name: (r.name as string) ?? null, url: (r.url as string) ?? null, caption: (r.caption as string) ?? null, analysis: (r.analysis as string) ?? null, keep: !!r.keep, expiresAt: iso(r.expiresAt), mime: (r.mime as string) ?? null });
const ATT_COLS = ["id", "task_id", "step_id", "kind", "name", "url", "storage_path", "mime", "bytes", "caption", "analysis", "keep", "added_at", "expires_at"];   // bez `data`: listy nie ciągną plików
export async function listAttachments(where: { stepId?: string; taskId?: string }): Promise<Attachment[]> {
  const rows = where.stepId
    ? await sql()`select ${sql()(ATT_COLS)} from attachments where step_id = ${where.stepId} order by added_at`
    : await sql()`select ${sql()(ATT_COLS)} from attachments where task_id = ${where.taskId!} order by added_at`;
  return rows.map(rowToAttachment);
}
// plik wklejony w doku ląduje w bazie (data); adres /api/files/<id> działa po zalogowaniu, agent czyta go przez MCP get_attachment
export async function addAttachment(where: { stepId?: string; taskId?: string }, a: { id?: string; kind: Attachment["kind"]; name?: string; url?: string; storagePath?: string; mime?: string; bytes?: number; caption?: string; analysis?: string; keep?: boolean; expiresAt?: string | null; data?: Buffer }): Promise<Attachment> {
  const id = a.id ?? randomUUID();
  const url = a.url ?? (a.data ? `/api/files/${id}` : null);
  const [r] = await sql()`insert into attachments (id, task_id, step_id, kind, name, url, storage_path, mime, bytes, caption, analysis, keep, expires_at, data)
    values (${id}, ${where.taskId ?? null}, ${where.stepId ?? null}, ${a.kind}, ${a.name ?? null}, ${url}, ${a.storagePath ?? null}, ${a.mime ?? null}, ${a.bytes ?? (a.data ? a.data.length : null)}, ${a.caption ?? null}, ${a.analysis ?? null}, ${!!a.keep}, ${a.expiresAt ?? null}, ${a.data ?? null}) returning ${sql()(ATT_COLS)}`;
  return rowToAttachment(r);
}
export async function updateAttachment(ownerId: string, id: string, patch: { caption?: string; analysis?: string }): Promise<boolean> {
  const rows = await sql()`update attachments a set caption = coalesce(${patch.caption ?? null}, a.caption), analysis = coalesce(${patch.analysis ?? null}, a.analysis)
    where a.id = ${id} and ${ownerId} = coalesce((select owner_id from tasks where id = a.task_id), (select t.owner_id from steps s join tasks t on t.id = s.task_id where s.id = a.step_id)) returning a.id`;
  return rows.length > 0;
}
export type AttachmentFile = { id: string; name: string | null; mime: string | null; bytes: number | null; data: Buffer };
export async function getAttachmentFile(ownerId: string, id: string): Promise<AttachmentFile | null> {
  const [r] = await sql()`select a.id, a.name, a.mime, a.bytes, a.data from attachments a
    where a.id = ${id} and a.data is not null and ${ownerId} = coalesce((select owner_id from tasks where id = a.task_id), (select t.owner_id from steps s join tasks t on t.id = s.task_id where s.id = a.step_id))`;
  return r ? { id: r.id as string, name: (r.name as string) ?? null, mime: (r.mime as string) ?? null, bytes: r.bytes == null ? null : Number(r.bytes), data: Buffer.from(r.data as Uint8Array) } : null;
}
export async function countAttachments(taskIds: string[]): Promise<Record<string, number>> {
  if (!taskIds.length) return {};
  const rows = await sql()`select task_id, count(*)::int as n from attachments where task_id = any(${taskIds}) group by task_id`;
  return Object.fromEntries(rows.map((r) => [r.taskId as string, Number(r.n)]));
}

// ---------- zasady ----------
const rowToRule = (r: Row): Rule => ({ id: r.id as string, kind: ((r.kind as Rule["kind"]) ?? "rule"), scope: r.scope as Rule["scope"], companyId: (r.companyId as string) ?? null, projectId: (r.projectId as string) ?? null, tool: (r.tool as string) ?? null, originCompanyId: (r.originCompanyId as string) ?? null, title: r.title as string, body: r.body as string, trigger: (r.trigger as string) ?? null, summary: (r.summary as string) ?? null, visibility: r.visibility as Rule["visibility"] });
export async function listRules(ownerId: string): Promise<Rule[]> {
  const rows = await sql()`select * from rules where owner_id = ${ownerId} order by scope, position, created_at`;
  return rows.map(rowToRule);
}
// zasady pasujące do zadania: ogólne + firmy projektu + projektu + narzędzi użytych w krokach; projekt prywatny nie widzi niczego firmowego
export function rulesFor(rules: Rule[], projectId: string | null, tools: string[], companyId: string | null = null): Rule[] {
  return rules.filter((r) => r.scope === "global" || (r.scope === "company" && !!companyId && r.companyId === companyId) || (r.scope === "project" && r.projectId === projectId) || (r.scope === "tool" && r.tool && tools.includes(r.tool)));
}
// ta sama nazwa w tym samym zakresie (i dla tego samego projektu albo narzędzia) = ta sama zasada; dzięki temu ponowne wgranie nie robi duplikatów
export async function findRule(ownerId: string, w: { scope: Rule["scope"]; companyId?: string | null; projectId?: string | null; tool?: string | null; title: string }): Promise<Rule | null> {
  const rows = await sql()`select * from rules where owner_id = ${ownerId} and scope = ${w.scope} and company_id is not distinct from ${w.companyId ?? null} and project_id is not distinct from ${w.projectId ?? null} and tool is not distinct from ${w.tool ?? null} and lower(title) = lower(${w.title.trim()}) limit 1`;
  return rows.length ? rowToRule(rows[0]) : null;
}
export type RuleInput = Partial<Rule> & { title: string; body: string; scope: Rule["scope"] };
// każdy zapis zostawia migawkę w rule_versions (historia brzmienia zasady)
export async function upsertRule(ownerId: string, rule: RuleInput): Promise<Rule> {
  const kind = rule.kind ?? "rule", trigger = rule.trigger?.trim() || null, summary = rule.summary?.trim() || null, title = rule.title.trim(), body = rule.body.trim();
  const companyId = rule.scope === "company" ? rule.companyId ?? null : null, projectId = rule.scope === "project" ? rule.projectId ?? null : null, tool = rule.scope === "tool" ? rule.tool ?? null : null, origin = rule.originCompanyId ?? null;
  if (rule.id) {   // zapis bez zmian (np. ponowne wgranie tych samych zasad) nie zostawia pustej wersji w historii
    const [cur] = await sql()`select * from rules where id = ${rule.id} and owner_id = ${ownerId}`;
    if (cur && cur.kind === kind && cur.title === title && cur.body === body && cur.scope === rule.scope && (cur.companyId ?? null) === companyId && (cur.projectId ?? null) === projectId && (cur.tool ?? null) === tool && (cur.originCompanyId ?? null) === origin && (cur.trigger ?? null) === trigger && (cur.summary ?? null) === summary && cur.visibility === (rule.visibility ?? "private")) return rowToRule(cur);
  }
  const rows = rule.id
    ? await sql()`update rules set kind = ${kind}, title = ${title}, body = ${body}, scope = ${rule.scope}, company_id = ${companyId}, project_id = ${projectId}, tool = ${tool}, origin_company_id = ${origin}, trigger = ${trigger}, summary = ${summary}, visibility = ${rule.visibility ?? "private"}, updated_at = now() where id = ${rule.id} and owner_id = ${ownerId} returning *`
    : await sql()`insert into rules (owner_id, kind, scope, company_id, project_id, tool, origin_company_id, title, body, trigger, summary, visibility) values (${ownerId}, ${kind}, ${rule.scope}, ${companyId}, ${projectId}, ${tool}, ${origin}, ${title}, ${body}, ${trigger}, ${summary}, ${rule.visibility ?? "private"}) returning *`;
  const r = rows[0];
  if (!r) throw new Error("Nie ma takiej zasady.");
  await snapshotRule(ownerId, r, rule.id ? "updated" : "created");
  return rowToRule(r);
}
export async function deleteRule(ownerId: string, id: string): Promise<void> {
  const [r] = await sql()`delete from rules where id = ${id} and owner_id = ${ownerId} returning *`;
  if (r) await snapshotRule(ownerId, r, "deleted");
}
export type RuleChange = "created" | "updated" | "deleted";
export type RuleVersion = { id: string; ruleId: string; change: RuleChange; kind: Rule["kind"]; scope: Rule["scope"]; title: string; body: string; trigger: string | null; summary: string | null; changedAt: string };
async function snapshotRule(ownerId: string, r: Row, change: RuleChange): Promise<void> {
  await sql()`insert into rule_versions (rule_id, owner_id, change, kind, scope, company_id, project_id, tool, origin_company_id, title, body, trigger, summary)
    values (${r.id as string}, ${ownerId}, ${change}, ${(r.kind as string) ?? "rule"}, ${r.scope as string}, ${(r.companyId as string) ?? null}, ${(r.projectId as string) ?? null}, ${(r.tool as string) ?? null}, ${(r.originCompanyId as string) ?? null}, ${r.title as string}, ${r.body as string}, ${(r.trigger as string) ?? null}, ${(r.summary as string) ?? null})`;
}
// historia: najnowsza migawka pierwsza; bez ruleId = wszystkie zasady właściciela (strona zasad pokazuje je przy kartach)
export async function listRuleVersions(ownerId: string, ruleId?: string, limit = 500): Promise<RuleVersion[]> {
  const rows = ruleId
    ? await sql()`select * from rule_versions where owner_id = ${ownerId} and rule_id = ${ruleId} order by changed_at desc limit ${limit}`
    : await sql()`select * from rule_versions where owner_id = ${ownerId} order by changed_at desc limit ${limit}`;
  return rows.map((r) => ({ id: r.id as string, ruleId: r.ruleId as string, change: r.change as RuleChange, kind: r.kind as Rule["kind"], scope: r.scope as Rule["scope"], title: r.title as string, body: r.body as string, trigger: (r.trigger as string) ?? null, summary: (r.summary as string) ?? null, changedAt: iso(r.changedAt) as string }));
}

// ---------- czasy ----------
export async function listSamples(ownerId: string): Promise<TimeSample[]> {
  const rows = await sql()`select tool, project_id, est_min, spent_min, who from time_samples where owner_id = ${ownerId} order by at desc limit 300`;
  return rows.map((r) => ({ tool: r.tool as string, projectId: (r.projectId as string) ?? null, estMin: Number(r.estMin), spentMin: Number(r.spentMin), who: r.who === "agent" ? "agent" as const : "owner" as const }));
}
// czas Claude'a: start_step stawia znacznik; zamknięcie albo oddanie kroku dolicza sekundy i go kasuje
export async function markAgentStart(stepId: string): Promise<void> { await sql()`update steps set agent_started_at = now(), left_at = null where id = ${stepId}`; }
// agent oddał krok, bo nie dał rady (leave_step bez czekania): kafelek „Potrzebna pomoc”
export async function markLeft(stepId: string, need: Step["need"] = null): Promise<void> { await sql()`update steps set left_at = now(), need = ${need ? sql().json(need as never) : null} where id = ${stepId}`; }
// ostatni sygnał Piotra w każdym zadaniu (jego wiadomość albo odpowiedź na pytanie): krok oddany z braku dostępu wraca po nim do pracy (paczka 22)
export async function lastOwnerSignals(ownerId: string): Promise<Record<string, string>> {
  const rows = await sql()`select task_id, max(at) as at from (
      select task_id, created_at as at from chat_messages where owner_id = ${ownerId} and role = 'user' and task_id is not null
      union all
      select task_id, answered_at as at from questions where owner_id = ${ownerId} and answered_at is not null and task_id is not null
    ) x group by task_id`;
  const out: Record<string, string> = {};
  for (const r of rows) { const at = iso(r.at); if (at) out[r.taskId as string] = at; }
  return out;
}
// odcisk folderów i narzędzi z Ustawień aplikacji na Macu (paczka 22), osobno dla każdego komputera; zapis tylko przy zmianie,
// at = chwila zmiany. Po niej kroki oddane z braku dostępu wracają do pracy (bridgeAccessAt)
export async function recordBridgeAccess(ownerId: string, host: string, key: string): Promise<boolean> {
  const rows = await sql()`update users set settings = jsonb_set(settings, '{bridgeAccess}', coalesce(settings->'bridgeAccess', '{}'::jsonb)
      || jsonb_build_object(${host}::text, jsonb_build_object('key', ${key}::text, 'at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))))
    where id = ${ownerId} and coalesce(settings->'bridgeAccess'->${host}->>'key', '') <> ${key} returning id`;
  return rows.length > 0;
}
export async function addAgentTime(stepId: string, sec: number): Promise<void> { await sql()`update steps set agent_sec = agent_sec + ${Math.max(0, Math.round(sec))}, agent_started_at = null where id = ${stepId}`; }
// czas Piotra z zegara karty: dolicza się tylko, póki nie wpisał czasu ręcznie (ręczna poprawka wygrywa)
export async function addOwnSec(stepId: string, sec: number): Promise<void> { await sql()`update steps set spent_sec = spent_sec + ${Math.max(0, Math.round(sec))}, spent_at = now() where id = ${stepId} and spent_manual = false`; }

// ---------- „Uruchom w chmurze” (paczka 13, punkt 3) ----------
// Piotr klika na kroku „Zleć w projekcie: …” / „Wdróż na produkcję” (tylko jego sesja w aplikacji, nigdy agent); mostek na Macu odpala zaplanowane zadanie
// w chmurze (cloudToRing → markCloudRung), a sesja w chmurze bierze krok atomowo (takeCloudStep). Oddanie, zatrzymanie albo zamknięcie kroku kasuje zlecenie (writeStep).
export type CloudItem = { step: Step; taskId: string; taskTitle: string; steps: Step[] };
export async function queueCloud(ownerId: string, stepId: string): Promise<boolean> {
  const r = await sql()`update steps s set cloud = jsonb_build_object('state', 'queued', 'at', now()), left_at = null from tasks t
    where t.id = s.task_id and t.owner_id = ${ownerId} and t.deleted_at is null and s.id = ${stepId} and s.status = 'todo' and s.cloud is null returning s.id`;
  return r.length > 0;
}
export async function cancelCloud(ownerId: string, stepId: string): Promise<boolean> {
  // wzięty przez chmurę krok zatrzymuje się jak każdy w toku („Zatrzymaj”); tu tylko zlecenie, którego chmura jeszcze nie wzięła
  const r = await sql()`update steps s set cloud = null from tasks t where t.id = s.task_id and t.owner_id = ${ownerId} and s.id = ${stepId} and s.cloud->>'state' in ('auto', 'queued', 'rung') returning s.id`;
  return r.length > 0;
}
// paczka 19, punkt 2: krok „Zleć w projekcie: …” dodany przez agenta na wyraźne polecenie Piotra w rozmowie zadania (msg = id tej wiadomości) rusza w chmurze
// bez drugiego kliknięcia: polecenie w rozmowie jest zgodą. Najpierw „auto” (czeka na swoje kroki), promoteCloud zamienia je w zwykłe zlecenie, gdy wszystkie są zrobione
// from (paczka 22): krok decyzji Piotra, z którego przeszła zgoda (odpowiedź na kartce decyzji zleca kroki, które tylko wykonują wybraną opcję)
export async function armCloud(ownerId: string, stepId: string, msgId: string, from?: string | null): Promise<boolean> {
  const r = await sql()`update steps s set cloud = jsonb_strip_nulls(jsonb_build_object('state', 'auto', 'at', now(), 'msg', ${msgId}::text, 'from', ${from ?? null}::text)), left_at = null from tasks t
    where t.id = s.task_id and t.owner_id = ${ownerId} and t.deleted_at is null and s.id = ${stepId} and s.status = 'todo' and s.cloud is null returning s.id`;
  return r.length > 0;
}
// „auto” bez niezrobionych zależności → zlecenie do chmury (mostek odpali ją jak po kliknięciu); zwraca kroki, które właśnie ruszyły
export async function promoteCloud(taskId: string): Promise<{ id: string; title: string; from: string | null }[]> {
  return (await sql()`update steps s set cloud = s.cloud || jsonb_build_object('state', 'queued', 'at', now())
    where s.task_id = ${taskId} and s.status = 'todo' and s.cloud->>'state' = 'auto'
      and not exists (select 1 from step_dependencies d join steps x on x.id = d.depends_on_id where d.step_id = s.id and x.status <> 'done')
    returning s.id, s.title, s.cloud->>'from' as "from"`).map((r) => ({ id: r.id as string, title: r.title as string, from: (r.from as string | null) ?? null }));
}
// promoteCloud z linią w rozmowie zadania: Piotr widzi, że krok ruszył bez jego kliknięcia
export async function startAutoCloud(taskId: string): Promise<string[]> {
  const went = await promoteCloud(taskId);
  if (went.length) {
    const [t] = await sql()`select owner_id from tasks where id = ${taskId}`;
    const order = went.some((x) => x.from) ? (await sql()`select id, title from steps where task_id = ${taskId} order by position, created_at`).map((r) => ({ id: r.id as string, title: r.title as string })) : [];
    for (const x of went) {
      const k = x.from ? order.findIndex((o) => o.id === x.from) : -1;
      const why = k >= 0 ? `po Twojej decyzji w kroku ${String(k + 1).padStart(2, "0")} „${shortTitle(order[k].title, 50)}”` : "tak jak prosiłeś w rozmowie";
      if (t) await addChat(t.ownerId as string, taskId, "agent", `Zlecone do chmury: „${shortTitle(x.title, 70)}”, ${why}. Claude w chmurze weźmie ten krok i zamknie go z wynikiem.`, { stepId: x.id });
    }
  }
  return went.map((x) => x.id);
}
// paczka 22: odpowiedź Piotra na kartce decyzji (wiadomość „Decyzja w kroku …” albo „Zmieniam decyzję w kroku …” przy kroku decyzji) z ostatniej doby,
// najnowsza spośród kroków steps; jej id to zgoda dla kroków „Zleć w projekcie”, które tylko wykonują wybraną opcję
export async function decisionMsgIn(ownerId: string, taskId: string, stepIds: string[]): Promise<{ id: string; stepId: string } | null> {
  if (!stepIds.length) return null;
  const [r] = await sql()`select id, actions->>'stepId' as step_id from chat_messages where owner_id = ${ownerId} and task_id = ${taskId} and role = 'user'
    and actions->>'stepId' in ${sql()(stepIds)} and (text like 'Decyzja w kroku %' or text like 'Zmieniam decyzję w kroku %') and created_at > now() - interval '24 hours'
    order by created_at desc limit 1`;
  return r ? { id: r.id as string, stepId: r.stepId as string } : null;
}
// wiadomość Piotra w tym zadaniu z ostatniej doby: tylko taka może zlecić krok do chmury (agent nie zleca sam z siebie)
export async function ownerChatIn(ownerId: string, taskId: string, msgId: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(msgId)) return false;
  const r = await sql()`select 1 from chat_messages where owner_id = ${ownerId} and task_id = ${taskId} and id = ${msgId} and role = 'user' and created_at > now() - interval '24 hours'`;
  return r.length > 0;
}
// kroki zlecone do chmury, jeszcze niewzięte (rung = Mac już odpalił chmurę, ale sesja jeszcze nie ruszyła)
export async function listCloud(ownerId: string): Promise<CloudItem[]> {
  const rows = await sql()`select s.task_id from steps s join tasks t on t.id = s.task_id
    where t.owner_id = ${ownerId} and t.deleted_at is null and s.status = 'todo' and s.cloud->>'state' in ('queued', 'rung') order by s.cloud->>'at'`;
  const ids = [...new Set(rows.map((r) => r.taskId as string))];
  const out: CloudItem[] = [];
  for (const id of ids) {
    const t = await getTask(ownerId, id);
    for (const st of t?.steps ?? []) if (t && st.status === "todo" && (st.cloud?.state === "queued" || st.cloud?.state === "rung")) out.push({ step: st, taskId: t.id, taskTitle: t.title, steps: t.steps });
  }
  return out.sort((a, b) => (a.step.cloud!.at < b.step.cloud!.at ? -1 : 1));
}
// ile zleceń czeka na odpalenie chmury: nowe kliknięcia i odpalone dawno, a niewzięte (np. sesja w chmurze nie ruszyła), z odstępem RING_AGAIN_MIN
export async function cloudToRing(ownerId: string, againMin: number): Promise<number> {
  const [r] = await sql()`select count(*)::int as n from steps s join tasks t on t.id = s.task_id
    where t.owner_id = ${ownerId} and t.deleted_at is null and s.status = 'todo'
      and (s.cloud->>'state' = 'queued' or (s.cloud->>'state' = 'rung' and (s.cloud->>'rungAt')::timestamptz < now() - make_interval(mins => ${againMin}))) `;
  return Number(r?.n ?? 0);
}
export async function markCloudRung(ownerId: string, againMin: number): Promise<number> {
  const r = await sql()`update steps s set cloud = s.cloud || jsonb_build_object('state', 'rung', 'rungAt', now()) from tasks t
    where t.id = s.task_id and t.owner_id = ${ownerId} and s.status = 'todo'
      and (s.cloud->>'state' = 'queued' or (s.cloud->>'state' = 'rung' and (s.cloud->>'rungAt')::timestamptz < now() - make_interval(mins => ${againMin}))) returning s.id`;
  return r.length;
}
export async function noteCloudFail(ownerId: string, stepId: string): Promise<void> {
  await sql()`update steps s set cloud = s.cloud || jsonb_build_object('failAt', now()) from tasks t where t.id = s.task_id and t.owner_id = ${ownerId} and s.id = ${stepId} and s.cloud is not null`;
}
// sesja w chmurze bierze krok: najwyżej raz (zlecenie musi czekać), krok przechodzi w toku i liczy się czas Claude'a
export async function takeCloudStep(ownerId: string, stepId: string): Promise<boolean> {
  const r = await sql()`update steps s set cloud = s.cloud || jsonb_build_object('state', 'working', 'takenAt', now()),
      status = 'handoff', prev_status = 'todo', handoff_at = now(), agent_started_at = now(), left_at = null from tasks t
    where t.id = s.task_id and t.owner_id = ${ownerId} and s.id = ${stepId} and s.status = 'todo' and s.cloud->>'state' in ('queued', 'rung') returning s.id`;
  return r.length > 0;
}

// ---------- czat ----------
// seenAt: agent wziął wiadomość do opracowania w bieżącym biegu; answeredAt: załatwiona (reply_chat albo odpowiedź agenta w aplikacji); obie null = czeka w kolejce
export type ChatMessage = { id: string; role: "user" | "agent"; text: string; actions: unknown; createdAt: string; seenAt: string | null; answeredAt: string | null };
const rowToChat = (r: Row): ChatMessage => ({ id: r.id as string, role: r.role as "user" | "agent", text: r.text as string, actions: r.actions, createdAt: iso(r.createdAt) as string, seenAt: iso(r.seenAt), answeredAt: iso(r.answeredAt) });
// before: kursor (created_at) do wczytywania starszych wpisów w historii rozmowy
export async function listChat(ownerId: string, taskId: string | null, limit = 20, before: string | null = null): Promise<ChatMessage[]> {
  const cut = before ?? "9999-12-31T00:00:00Z";
  const rows = taskId
    ? await sql()`select * from chat_messages where owner_id = ${ownerId} and task_id = ${taskId} and created_at < ${cut} order by created_at desc limit ${limit}`
    : await sql()`select * from chat_messages where owner_id = ${ownerId} and task_id is null and created_at < ${cut} order by created_at desc limit ${limit}`;
  return rows.reverse().map(rowToChat);
}
// seen: wiadomość Piotra już załatwiona (agent w aplikacji odpowiedział od razu); bez tego czeka na mostek albo automat jako praca
export async function addChat(ownerId: string, taskId: string | null, role: "user" | "agent", text: string, actions?: unknown, opts: { seen?: boolean } = {}): Promise<string> {
  const seen = role === "agent" || opts.seen ? new Date() : null;
  const [r] = await sql()`insert into chat_messages (owner_id, task_id, role, text, actions, seen_at, answered_at) values (${ownerId}, ${taskId}, ${role}, ${text}, ${actions ? sql().json(actions as never) : null}, ${seen}, ${seen}) returning id`;
  return r.id as string;
}
// wiadomość wzięta do opracowania dawniej niż tyle minut temu i wciąż bez odpowiedzi liczy się jako nowa (bieg mostka padł bez sygnału, automat co godzinę ją weźmie)
export const CHAT_STALE_MIN = 90;
// wiadomości Piotra w zadaniach czekające na agenta (praca dla mostka: odpowiedzieć, dopisać kroki, poprawić szkic); zadanie z taką wiadomością nigdy nie wypada z listy pracy
export async function listUnseenChat(ownerId: string, limit = 30, staleMin = CHAT_STALE_MIN): Promise<(ChatMessage & { taskId: string; taskTitle: string })[]> {
  const rows = await sql()`select c.*, t.title as task_title from chat_messages c join tasks t on t.id = c.task_id
    where c.owner_id = ${ownerId} and c.role = 'user' and c.answered_at is null and c.task_id is not null and t.deleted_at is null
      and (c.seen_at is null or c.seen_at < now() - make_interval(mins => ${staleMin}))
    order by c.created_at limit ${limit}`;
  return rows.map((r) => ({ ...rowToChat(r), taskId: r.taskId as string, taskTitle: r.taskTitle as string }));
}
// wiadomości Piotra bez odpowiedzi w jednym zadaniu (linia stanu pod dymkiem, karta nad dokiem, pasek nad kanwą, blokada samozamknięcia)
export async function listPendingChat(ownerId: string, taskId: string): Promise<ChatMessage[]> {
  const rows = await sql()`select * from chat_messages where owner_id = ${ownerId} and task_id = ${taskId} and role = 'user' and answered_at is null order by created_at`;
  return rows.map(rowToChat);
}
// ile wiadomości bez odpowiedzi ma każde zadanie (chip „2 wiadomości” na kafelku); taskId zawęża do jednego zadania
export async function countPendingChat(ownerId: string, taskId: string | null = null): Promise<Map<string, number>> {
  const rows = await sql()`select task_id, count(*)::int as n from chat_messages where owner_id = ${ownerId} and role = 'user' and answered_at is null and task_id is not null
    ${taskId ? sql()`and task_id = ${taskId}` : sql()``} group by task_id`;
  return new Map(rows.map((r) => [r.taskId as string, Number(r.n)]));
}
// agent wziął wiadomości do opracowania (list_work): od teraz „w pracy”, aż reply_chat je załatwi albo bieg skończy się bez odpowiedzi
export async function markChatSeen(ownerId: string, where: { ids?: string[]; taskId?: string }): Promise<void> {
  if (where.ids) { if (where.ids.length) await sql()`update chat_messages set seen_at = now() where owner_id = ${ownerId} and id in ${sql()(where.ids)} and answered_at is null`; }
  else if (where.taskId) await sql()`update chat_messages set seen_at = now() where owner_id = ${ownerId} and task_id = ${where.taskId} and role = 'user' and answered_at is null`;
}
// reply_chat: załatwione wiadomości (wskazane albo wszystkie dotychczasowe w zadaniu); zwraca ich id, żeby odpowiedź w historii wiązała się z prośbami
export async function markChatAnswered(ownerId: string, taskId: string, ids?: string[]): Promise<string[]> {
  if (ids && !ids.length) return [];
  const rows = await sql()`update chat_messages set answered_at = now(), seen_at = coalesce(seen_at, now())
    where owner_id = ${ownerId} and task_id = ${taskId} and role = 'user' and answered_at is null ${ids ? sql()`and id in ${sql()(ids)}` : sql()``} returning id`;
  return rows.map((r) => r.id as string);
}
// „Wycofaj” w dymku kolejki (paczka 18): Piotr zabiera swoje wiadomości bez odpowiedzi z kolejki agenta; zostają w historii rozmowy z oznaczeniem withdrawn
export async function withdrawChat(ownerId: string, taskId: string): Promise<number> {
  const rows = await sql()`update chat_messages set answered_at = now(), seen_at = coalesce(seen_at, now()), actions = coalesce(actions, '{}'::jsonb) || '{"withdrawn": true}'::jsonb
    where owner_id = ${ownerId} and task_id = ${taskId} and role = 'user' and answered_at is null returning id`;
  return rows.length;
}
// wiadomości wzięte w biegu, który właśnie się skończył, a bez odpowiedzi: wracają do kolejki (następny bieg widzi je jako NOWE); nic nie ginie po cichu
async function requeueChat(ownerId: string, since: Date | string | null): Promise<void> {
  if (!since) return;
  await sql()`update chat_messages set seen_at = null where owner_id = ${ownerId} and role = 'user' and answered_at is null and seen_at is not null and seen_at >= ${new Date(since)}`;
}
// zadanie z wszystkimi krokami gotowymi i bez wiadomości czekających na odpowiedź: kończy się samo; zwraca true, gdy właśnie się zakończyło
export async function closeIfDone(ownerId: string, taskId: string): Promise<boolean> {
  const t = await getTask(ownerId, taskId);
  if (!t || t.doneAt || !t.steps.length || !t.steps.every((s) => s.status === "done")) return false;
  const [pending] = await sql()`select 1 from chat_messages where owner_id = ${ownerId} and task_id = ${taskId} and role = 'user' and answered_at is null limit 1`;
  if (pending) return false;
  const rows = await sql()`update tasks set done_at = now() where id = ${taskId} and owner_id = ${ownerId} and done_at is null returning id`;
  return rows.length > 0;
}
// stempel zmian dla pulsu przeglądarki: ostatnia zmiana zadania, kroków, rozmowy i pytań (jednego zadania albo wszystkich)
// odcisk wszystkiego, z czego liczy się lista pracy (zadania, kroki, zależności, wiadomości, pytania, próbki czasu, ważność projektów, ustawienia):
// jeden mały wiersz zamiast całej bazy zadań; mostek pyta co kilkanaście sekund, a pełną listę liczymy tylko, gdy odcisk się zmieni
export async function workStamp(ownerId: string): Promise<string> {
  const [r] = await sql()`select concat_ws('|',
      (select max(updated_at)::text || '#' || count(*) from tasks where owner_id = ${ownerId}),
      (select max(s.updated_at)::text || '#' || count(*) from steps s join tasks t on t.id = s.task_id where t.owner_id = ${ownerId}),
      (select count(*) from task_dependencies d join tasks t on t.id = d.task_id where t.owner_id = ${ownerId}),
      (select count(*) from step_dependencies d join steps s on s.id = d.step_id join tasks t on t.id = s.task_id where t.owner_id = ${ownerId}),
      (select max(greatest(created_at, seen_at, answered_at))::text || '#' || count(*) from chat_messages where owner_id = ${ownerId}),
      (select max(greatest(asked_at, answered_at, seen_at))::text || '#' || count(*) from questions where owner_id = ${ownerId}),
      (select max(at)::text || '#' || count(*) from time_samples where owner_id = ${ownerId}),
      (select md5(coalesce(string_agg(id::text || ':' || weight, ',' order by id), '')) from projects where owner_id = ${ownerId}),
      (select md5(settings::text) from users where id = ${ownerId})
    ) as k`;
  return (r?.k as string) ?? "";
}
export async function changeStamp(ownerId: string, taskId: string | null): Promise<string> {
  const [r] = taskId
    ? await sql()`select greatest(
        (select max(updated_at) from tasks where id = ${taskId} and owner_id = ${ownerId}),
        (select max(updated_at) from steps where task_id = ${taskId}),
        (select max(greatest(created_at, coalesce(seen_at, created_at), coalesce(answered_at, created_at))) from chat_messages where owner_id = ${ownerId} and task_id = ${taskId}),
        (select max(greatest(asked_at, coalesce(answered_at, asked_at))) from questions where task_id = ${taskId}),
        (select max(coalesce(fetched_at, '1970-01-01')) from facts where task_id = ${taskId} or step_id in (select id from steps where task_id = ${taskId}))
      ) as at`
    : await sql()`select greatest(
        (select max(updated_at) from tasks where owner_id = ${ownerId}),
        (select max(s.updated_at) from steps s join tasks t on t.id = s.task_id where t.owner_id = ${ownerId}),
        (select max(greatest(created_at, coalesce(seen_at, created_at), coalesce(answered_at, created_at))) from chat_messages where owner_id = ${ownerId}),
        (select max(greatest(asked_at, coalesce(answered_at, asked_at))) from questions where owner_id = ${ownerId})
      ) as at`;
  return iso(r?.at) ?? "0";
}

// ---------- pamięć układu ----------
export async function getLayoutMemory(ownerId: string, app: string): Promise<Block[] | null> {
  const [r] = await sql()`select blocks from layout_memory where owner_id = ${ownerId} and source_app = ${app} and kind = 'step'`;
  if (!r) return null;
  const p = Blocks.safeParse(r.blocks); return p.success ? p.data : null;
}
export async function setLayoutMemory(ownerId: string, app: string, blocks: Block[]): Promise<void> {
  await sql()`insert into layout_memory (owner_id, source_app, kind, blocks) values (${ownerId}, ${app}, 'step', ${sql().json(sanitizeBlocks(blocks) as never)})
    on conflict (owner_id, source_app, kind) do update set blocks = excluded.blocks, updated_at = now()`;
}

// ---------- grupy na kanwie ----------
export type Group = { id: string; taskId: string | null; name: string; color: number; x: number; y: number; w: number; h: number; members: string[]; auto: boolean };
export async function listGroups(ownerId: string, taskId: string | null): Promise<Group[]> {
  const rows = taskId
    ? await sql()`select * from canvas_groups where owner_id = ${ownerId} and task_id = ${taskId} order by created_at`
    : await sql()`select * from canvas_groups where owner_id = ${ownerId} and task_id is null order by created_at`;
  return rows.map((r) => ({ id: r.id as string, taskId: (r.taskId as string) ?? null, name: r.name as string, color: Number(r.color), x: Number(r.x), y: Number(r.y), w: Number(r.w), h: Number(r.h), members: (r.members as string[]) ?? [], auto: !!r.auto }));
}
export async function createGroup(ownerId: string, taskId: string | null, name: string, members: string[], rect?: { x: number; y: number; w: number; h: number }): Promise<Group> {
  const [{ n }] = await sql()`select count(*)::int as n from canvas_groups where owner_id = ${ownerId}`;
  // kolumny prostokąta są całkowite, a kanwa liczy w ułamkach (powiększenie, środek widoku): ułamek wywracał zapis grupy
  const r0 = rect ? roundRect(rect) : { x: 0, y: 0, w: 0, h: 0 };
  const [r] = await sql()`insert into canvas_groups (owner_id, task_id, name, color, x, y, w, h, members, auto) values (${ownerId}, ${taskId}, ${name.slice(0, 60)}, ${Number(n) % 8}, ${r0.x}, ${r0.y}, ${r0.w}, ${r0.h}, ${members}, ${!rect}) returning id`;
  await releaseMembers(ownerId, taskId, r.id as string, members);
  return (await listGroups(ownerId, taskId)).find((g) => g.id === r.id)!;
}
function roundRect(r: { x: number; y: number; w: number; h: number }) {
  const i = (v: number) => Math.round(Number(v) || 0);
  return { x: i(r.x), y: i(r.y), w: i(r.w), h: i(r.h) };
}
// kafelek należy do jednej grupy na kanwie: wchodząc do nowej, wypada z poprzedniej (inaczej znikał z nowej, bo rysujemy go tylko w pierwszej)
async function releaseMembers(ownerId: string, taskId: string | null, keepId: string, members: string[]): Promise<void> {
  if (!members.length) return;
  await sql()`update canvas_groups set members = array(select m from unnest(members) as m where m <> all(${members}::uuid[]))
    where owner_id = ${ownerId} and task_id is not distinct from ${taskId} and id <> ${keepId} and members && ${members}::uuid[]`;
}
export async function updateGroup(ownerId: string, id: string, patch: Partial<Omit<Group, "id" | "taskId">>): Promise<void> {
  const p: Row = {};
  if (patch.name !== undefined) p.name = patch.name.slice(0, 60);
  for (const k of ["x", "y", "w", "h", "color"] as const) if (patch[k] !== undefined) p[k] = Math.round(Number(patch[k]) || 0);
  if (patch.members !== undefined) p.members = patch.members;
  if (patch.auto !== undefined) p.auto = patch.auto;
  if (!Object.keys(p).length) return;
  const [g] = await sql()`update canvas_groups set ${sql()(p)} where id = ${id} and owner_id = ${ownerId} returning task_id`;
  if (g && patch.members?.length) await releaseMembers(ownerId, (g.taskId as string) ?? null, id, patch.members);
}
export async function deleteGroup(ownerId: string, id: string): Promise<void> { await sql()`delete from canvas_groups where id = ${id} and owner_id = ${ownerId}`; }

// ---------- wyszukiwanie pełnotekstowe (bez AI) ----------
export async function searchTasks(ownerId: string, q: string, limit = 20): Promise<Task[]> {
  const rows = await sql()`select ${taskCols()} from tasks where owner_id = ${ownerId} and deleted_at is null and (search @@ plainto_tsquery('simple', ${q}) or title ilike ${"%" + q + "%"}) order by created_at desc limit ${limit}`;
  return hydrate(rows);
}

// ---------- kosz / archiwum ----------
export const TRASH_DAYS = 30;
export const CHAT_DAYS = 180;   // rozmowa ogólna (bez zadania) znika po pół roku; rozmowa w zadaniu żyje tak długo jak zadanie
export async function purgeExpired(ownerId: string): Promise<number> {
  const rows = await sql()`delete from tasks where owner_id = ${ownerId} and deleted_at is not null and deleted_at < now() - interval '30 days' returning id`;
  await sql()`delete from chat_messages where owner_id = ${ownerId} and task_id is null and created_at < now() - interval '180 days'`;
  await sql()`update attachments set url = null, storage_path = null, data = null where expires_at is not null and expires_at < now() and keep = false and (url is not null or storage_path is not null or data is not null)`;
  return rows.length;
}

// ---------- tokeny i ustawienia (widok ustawień) ----------
export type ApiTokenInfo = { id: string; name: string; kind: TokenKind; createdAt: string; lastUsedAt: string | null; seenAt: string | null; meta: Record<string, unknown> };
export async function listApiTokens(ownerId: string): Promise<ApiTokenInfo[]> {
  // tokeny biegów żyją kilkadziesiąt minut i nie są do zarządzania: lista ich nie pokazuje
  const rows = await sql()`select id, name, kind, created_at, last_used_at, seen_at, meta from api_tokens where owner_id = ${ownerId} and kind <> 'run' order by created_at desc`;
  return rows.map((r) => ({ id: r.id as string, name: r.name as string, kind: (r.kind as TokenKind) ?? "client", createdAt: iso(r.createdAt) as string, lastUsedAt: iso(r.lastUsedAt), seenAt: iso(r.seenAt), meta: (r.meta as Record<string, unknown>) ?? {} }));
}
export async function deleteApiToken(ownerId: string, id: string): Promise<void> {
  await sql()`delete from api_tokens where id = ${id} and owner_id = ${ownerId}`;
}
export async function setUserSettings(ownerId: string, patch: Record<string, unknown>): Promise<void> {
  await sql()`update users set settings = settings || ${sql().json(patch as never)} where id = ${ownerId}`;
}
export async function userSettings(ownerId: string): Promise<Record<string, unknown>> {
  const [r] = await sql()`select settings from users where id = ${ownerId}`;
  return (r?.settings as Record<string, unknown>) ?? {};
}
// limit modelu do podanej chwili (z komunikatu Claude Code); jednym zapisem, żeby dwa biegi nie nadpisały sobie limitów
export async function recordModelLimit(ownerId: string, model: string, until: string): Promise<void> {
  await sql()`update users set settings = jsonb_set(settings, '{modelLimits}', coalesce(settings->'modelLimits', '{}'::jsonb) || jsonb_build_object(${model}::text, ${until}::text)) where id = ${ownerId}`;
}
// krok oddany przez bieg: następna próba idzie poziom wyżej (najwyżej MAX_ESCALATION)
export async function bumpEscalation(stepId: string): Promise<void> {
  await sql()`update steps set escalation = least(escalation + 1, ${MAX_ESCALATION}) where id = ${stepId}`;
}

// krok oddany, bo czeka na inny krok (paczka 14, punkt 1): każde oddanie zapisuje cel od nowa (null = nie czeka)
export async function setWaitFor(stepId: string, target: string | null): Promise<void> {
  await sql()`update steps set wait_for = ${target} where id = ${stepId}`;
}

// ---------- mostek na komputerze ----------
// Puls: token rodzaju "bridge" ma seen_at i meta (komputer, silnik, stan). Bieg: jeden otwarty na właściciela (unikalny indeks częściowy),
// więc dwa komputery nie wykonają tej samej pracy; bieg bez sygnału wygasa. Rodzaj biegu: work = praca bez wysyłek, send = jeden zatwierdzony szkic.
export type RunKind = "work" | "send";
// markAt: ostatnie wywołanie MCP, które kończy jakiś etap pracy (get_task, complete_step…): od niego liczy się czas Claude'a na krok bez start_step.
// steps: kroki, których bieg dotknął (serwer MCP zapisuje przy każdym udanym wywołaniu): first = pierwsze dotknięcie, at = ostatnie, what = co zrobił;
// stepId = krok „teraz”. stopAt: Piotr zatrzymał bieg w Task Hub; stoppable: bieg pracy v2 (ma token biegu, więc da się go zatrzymać stąd)
export type RunStep = { first: string; at: string; what: string };
// model, effort: co bieg dostał; focus: grupa pracy „model|wysiłek” (list_work biegu pokazuje tylko ją); modelUsed: pełna nazwa z Claude Code
export type RunModel = { model: string; effort: string; focus: string; fallback: string };
export type BridgeRun = { id: string; bridge: string; startedAt: string; touchedAt: string; endedAt: string | null; outcome: string | null; note: string | null; taskId: string | null; stepId: string | null; kind?: RunKind; markAt?: string | null; steps?: Record<string, RunStep>; stopAt?: string | null; stoppable?: boolean; model?: string | null; effort?: string | null; focus?: string | null; fallback?: string | null; modelUsed?: string | null };
const rowToRun = (r: Row): BridgeRun => ({ id: r.id as string, bridge: r.bridge as string, startedAt: iso(r.startedAt) as string, touchedAt: iso(r.touchedAt) as string, endedAt: iso(r.endedAt), outcome: (r.outcome as string) ?? null, note: (r.note as string) ?? null, taskId: (r.taskId as string) ?? null, stepId: (r.stepId as string) ?? null, kind: r.kind === "send" ? "send" : "work", markAt: iso(r.markAt), steps: (r.steps as Record<string, RunStep>) ?? {}, stopAt: iso(r.stopAt), stoppable: r.stoppable === true,
  model: (r.model as string) ?? null, effort: (r.effort as string) ?? null, focus: (r.focus as string) ?? null, fallback: (r.fallback as string) ?? null, modelUsed: (r.modelUsed as string) ?? null });
// pause: Piotr zatrzymał bieg w Task Hub („Zatrzymaj” w dymku pracy): mostek nie bierze nowej pracy do tej chwili, chyba że Piotr napisze wcześniej
export type BridgeStatus = { alive: boolean; seenAt: string | null; name: string | null; meta: Record<string, unknown>; run: BridgeRun | null; pause: string | null };

export async function bridgeSeen(tokenId: string, meta: Record<string, unknown>): Promise<void> {
  await sql()`update api_tokens set seen_at = now(), last_used_at = now(), meta = meta || ${sql().json(meta as never)} where id = ${tokenId} and kind = 'bridge'`;
}
export async function bridgeStatus(ownerId: string, aliveMs: number): Promise<BridgeStatus> {
  const [t] = await sql()`select name, seen_at, meta from api_tokens where owner_id = ${ownerId} and kind = 'bridge' and seen_at is not null order by seen_at desc limit 1`;
  const [r] = await sql()`select b.*, exists(select 1 from api_tokens k where k.kind = 'run' and k.scope->>'runId' = b.id::text and k.scope->>'kind' = 'work') as stoppable from bridge_runs b where b.owner_id = ${ownerId} and b.ended_at is null limit 1`;
  const seenAt = t ? (iso(t.seenAt) as string) : null;
  return { alive: !!seenAt && Date.now() - new Date(seenAt).getTime() < aliveMs, seenAt, name: t ? (t.name as string) : null, meta: t ? ((t.meta as Record<string, unknown>) ?? {}) : {}, run: r ? rowToRun(r) : null, pause: await stopPause(ownerId) };
}
export async function expireBridgeRuns(ownerId: string, staleMin: number): Promise<number> {
  const rows = await sql()`update bridge_runs set ended_at = now(), outcome = 'stale' where owner_id = ${ownerId} and ended_at is null and touched_at < now() - make_interval(mins => ${staleMin}) returning id, started_at, kind, step_id, outcome, note`;
  for (const r of rows) await requeueChat(ownerId, r.startedAt as Date);
  await afterRuns(ownerId, rows);
  return rows.length;
}
// stepId: krok biegu wysyłki (ustala też zadanie); bieg pracy wiąże się z krokiem sam, z notatek mostka
export async function startBridgeRun(ownerId: string, tokenId: string | null, bridge: string, kind: RunKind = "work", stepId: string | null = null, m: RunModel | null = null): Promise<BridgeRun | null> {
  const [s] = stepId ? await sql()`select s.id, s.task_id from steps s join tasks t on t.id = s.task_id where s.id = ${stepId} and t.owner_id = ${ownerId}` : [];
  const [r] = await sql()`insert into bridge_runs (owner_id, token_id, bridge, kind, step_id, task_id, model, effort, focus, fallback)
    values (${ownerId}, ${tokenId}, ${bridge.slice(0, 80)}, ${kind}, ${s?.id ?? null}, ${s?.taskId ?? null}, ${m?.model || null}, ${m?.effort || null}, ${m?.focus ?? null}, ${m?.fallback || null})
    on conflict (owner_id) where ended_at is null do nothing returning *`;
  return r ? rowToRun(r) : null;
}
// po biegu: jego tokeny przestają działać; bieg wysyłki, po którym krok nie jest zrobiony, cofa zgodę, którą wziął, i zostawia notatkę w rozmowie (bez ponawiania).
// Wysyłkę potwierdzoną przez mostek (completeSend) trzeba zapisać przed zakończeniem biegu.
async function afterRuns(ownerId: string, runs: Row[]): Promise<void> {
  for (const r of runs) {
    await revokeRunTokens(ownerId, r.id as string);
    if (r.kind !== "send" || !r.stepId) continue;
    const stepId = r.stepId as string;
    const [s] = await sql()`select task_id, title, status, blocks, send_started_at from steps where id = ${stepId}`;
    if (!s || s.status === "done") continue;
    // znacznik wysyłki jest tego biegu (jeden otwarty bieg na właściciela): jego zgoda wraca do Piotra. Bez znacznika Piotr już ją cofnął
    // („Zatrzymaj”) albo zatwierdził szkic od nowa w trakcie biegu: nowej zgody nie ruszamy
    if (s.sendStartedAt) await clearApproval(ownerId, stepId);
    // notatka zawsze, bo treść mogła wyjść; nie, gdy bieg sam powiedział w rozmowie, co się stało (leave_step, wysyłka po wycofaniu zgody)
    const [said] = await sql()`select 1 from chat_messages where owner_id = ${ownerId} and task_id = ${s.taskId as string} and role = 'agent' and created_at >= ${r.startedAt as Date} and actions->>'stepId' = ${stepId} limit 1`;
    if (said) continue;
    const blocks = parseBlocks(s.blocks), d = draftOf({ blocks });
    // commit z aplikacji na Macu: aplikacja wie, co się nie udało (np. commit jest, push nie), więc piszemy powód
    const why = d && isGitDraft(d, blocks) && r.outcome === "error" && typeof r.note === "string" && r.note.trim() ? r.note.trim().slice(0, 500).replace(/([^.!?])$/, "$1.") : "";
    await addChat(ownerId, s.taskId as string, "agent", why ? `Commit nie wyszedł: ${why} Szkic wrócił do zatwierdzenia; zatwierdź go ponownie, gdy to poprawisz.` : unconfirmedSendNote(d?.target.app ?? "aplikacji docelowej", s.title as string), { stepId });
  }
}
// bieg, który aplikacja na Macu ma przerwać przy najbliższym sygnale: zatrzymany w Task Hub (stop_at) albo bieg wysyłki, którego zgodę Piotr wycofał
// („Zatrzymaj” na karcie kasuje znacznik wysyłki) lub który sam oddał krok (stara aplikacja bez tego doczeka do końca, a krok i tak się nie zamknie)
export async function runCancelled(ownerId: string, runId: string): Promise<boolean> {
  const [r] = await sql()`select b.stop_at, b.kind, s.status, s.send_started_at from bridge_runs b left join steps s on s.id = b.step_id where b.id = ${runId} and b.owner_id = ${ownerId} and b.ended_at is null`;
  if (!r) return false;
  return !!r.stopAt || (r.kind === "send" && !!r.status && r.status !== "done" && !r.sendStartedAt);
}
// „Zatrzymaj” w dymku pracy: bieg pracy v2 dostaje stop_at, jego token gaśnie (konektor Task Hub przestaje odpowiadać, Claude Code kończy), aplikacja
// na Macu przerywa go przy najbliższym sygnale, a mostek bierze nową pracę po przerwie (STOP_PAUSE_MIN) albo od razu, gdy Piotr napisze.
// Zwraca koniec przerwy; null dla biegu v1 (bez tokenu biegu), wysyłki, skończonego albo już zatrzymanego
export const STOP_PAUSE_MIN = 10;
const pauseEnd = (stopAt: Date | string) => new Date(new Date(stopAt).getTime() + STOP_PAUSE_MIN * 60_000).toISOString();
export async function stopRun(ownerId: string, runId: string): Promise<string | null> {
  const [r] = await sql()`update bridge_runs b set stop_at = now(), touched_at = now() where b.id = ${runId} and b.owner_id = ${ownerId} and b.ended_at is null and b.stop_at is null and b.kind = 'work'
    and exists(select 1 from api_tokens k where k.owner_id = ${ownerId} and k.kind = 'run' and k.scope->>'runId' = b.id::text and k.scope->>'kind' = 'work') returning b.stop_at`;
  if (!r) return null;
  await revokeRunTokens(ownerId, runId);
  return pauseEnd(r.stopAt as Date);
}
// przerwa po „Zatrzymaj”: do STOP_PAUSE_MIN od zatrzymania, chyba że Piotr od tego czasu napisał (wtedy mostek rusza od razu); koniec przerwy albo null
export async function stopPause(ownerId: string): Promise<string | null> {
  const [r] = await sql()`select b.stop_at from bridge_runs b where b.owner_id = ${ownerId} and b.stop_at > now() - make_interval(mins => ${STOP_PAUSE_MIN})
    and not exists(select 1 from chat_messages m where m.owner_id = ${ownerId} and m.role = 'user' and m.created_at > b.stop_at) order by b.stop_at desc limit 1`;
  return r ? pauseEnd(r.stopAt as Date) : null;
}
// note: co mostek robi teraz („start_step: id”, „Bash: npm test”); z którym zadaniem i krokiem bieg jest związany, zapisuje serwer MCP (runTouch)
export async function touchBridgeRun(ownerId: string, id: string, note?: string, modelUsed?: string): Promise<boolean> {
  const p: Row = { touched_at: new Date() };
  if (note !== undefined) p.note = note.slice(0, 200);
  if (modelUsed !== undefined && isModelName(modelUsed)) p.model_used = modelUsed.trim();
  const rows = await sql()`update bridge_runs set ${sql()(p)} where id = ${id} and owner_id = ${ownerId} and ended_at is null returning id`;
  return rows.length > 0;
}
// otwarty, niezatrzymany bieg pracy (stary mostek v1 woła MCP tokenem mostka, nie biegu: jego wywołania liczą się do tego biegu)
export async function openRunId(ownerId: string): Promise<string | null> {
  const [r] = await sql()`select id from bridge_runs where owner_id = ${ownerId} and ended_at is null and stop_at is null and kind = 'work' limit 1`;
  return r ? (r.id as string) : null;
}
// ślad wywołania MCP w biegu, jednym zapisem: krok „teraz” (stepId + taskId; end = ten krok się skończył; samo taskId = zadanie, krok zostaje, gdy jego),
// i kroki, których bieg dotknął (touched: co zrobił), z pierwszym i ostatnim dotknięciem. Kroki spoza zadań właściciela odpadają. Zatrzymany bieg nie zapisuje
export async function runTouch(ownerId: string, runId: string, o: { stepId?: string | null; taskId?: string | null; end?: string | null; touched?: { id: string; what: string }[] }): Promise<boolean> {
  const s = sql();
  const at = new Date().toISOString();
  const wanted = (o.touched ?? []).map((x) => x.id);
  const owned = wanted.length ? new Set((await s`select s.id from steps s join tasks t on t.id = s.task_id where s.id = any(${wanted}) and t.owner_id = ${ownerId}`).map((r) => r.id as string)) : new Set<string>();
  const touched = (o.touched ?? []).filter((x) => owned.has(x.id));
  const ids = touched.map((x) => x.id), whats = touched.map((x) => x.what.slice(0, 60));
  const now = o.stepId ? s`, step_id = ${o.stepId}, task_id = ${o.taskId ?? null}`
    : o.end ? s`, step_id = case when b.step_id = ${o.end} then null else b.step_id end`
    : o.taskId ? s`, task_id = ${o.taskId}, step_id = case when b.step_id is not null and exists(select 1 from steps x where x.id = b.step_id and x.task_id = ${o.taskId}) then b.step_id else null end`
    : s``;
  const rows = await s`update bridge_runs b set touched_at = now(),
    steps = b.steps || coalesce((select jsonb_object_agg(x.k, jsonb_build_object('first', coalesce(b.steps->x.k->>'first', ${at}::text), 'at', ${at}::text, 'what', x.w)) from unnest(${ids}::text[], ${whats}::text[]) as x(k, w)), '{}'::jsonb)${now}
    where b.id = ${runId} and b.owner_id = ${ownerId} and b.ended_at is null and b.stop_at is null returning b.id`;
  return rows.length > 0;
}
export async function runSteps(ownerId: string, runId: string): Promise<Record<string, RunStep>> {
  const [r] = await sql()`select steps from bridge_runs where id = ${runId} and owner_id = ${ownerId}`;
  return (r?.steps as Record<string, RunStep>) ?? {};
}
// agent zmienił krok (kartka, szkic, zamknięcie, fakty): kropka na kafelku, póki Piotr go nie otworzy
export async function markAgentSteps(ids: string[]): Promise<void> { if (ids.length) await sql()`update steps set agent_at = now() where id = any(${ids})`; }
export async function stepOpened(ownerId: string, taskId: string, stepId: string): Promise<void> {
  await sql()`update steps s set opened_at = now() from tasks t where t.id = s.task_id and s.id = ${stepId} and t.id = ${taskId} and t.owner_id = ${ownerId} and s.agent_at > coalesce(s.opened_at, '-infinity'::timestamptz)`;
}
export async function endBridgeRun(ownerId: string, id: string, outcome: string, note?: string): Promise<boolean> {
  const rows = await sql()`update bridge_runs set ended_at = now(), touched_at = now(), outcome = ${outcome.slice(0, 20)}, note = coalesce(${note?.slice(0, 600) ?? null}, note) where id = ${id} and owner_id = ${ownerId} and ended_at is null returning id, started_at, kind, step_id, outcome, note`;
  // „ostatnio: model · wysiłek” na krokach, których bieg dotknął (bieg z modelem od Task Hub)
  if (rows.length) await sql()`update steps s set last_run = jsonb_build_object('model', coalesce(b.model_used, b.model), 'effort', b.effort, 'at', now())
    from bridge_runs b where b.id = ${id} and b.model is not null and (s.id::text in (select jsonb_object_keys(b.steps)) or s.id = b.step_id)`;
  if (rows.length) await requeueChat(ownerId, rows[0].startedAt as Date);   // wiadomości wzięte w tym biegu bez odpowiedzi wracają do kolejki
  await afterRuns(ownerId, rows);
  return rows.length > 0;
}
export async function listBridgeRuns(ownerId: string, limit = 8): Promise<BridgeRun[]> {
  const rows = await sql()`select * from bridge_runs where owner_id = ${ownerId} order by started_at desc limit ${limit}`;
  return rows.map(rowToRun);
}
// --- mostek v2 (punkty wejścia /api/bridge): bieg po id i bieg wysyłki, który nic nie zaczął ---
export async function markBridgeRun(ownerId: string, id: string): Promise<void> { await sql()`update bridge_runs set mark_at = now() where id = ${id} and owner_id = ${ownerId} and ended_at is null`; }
export async function getBridgeRun(ownerId: string, id: string): Promise<BridgeRun | null> {
  const [r] = await sql()`select * from bridge_runs where id = ${id} and owner_id = ${ownerId}`;
  return r ? rowToRun(r) : null;
}
// szkic zmienił stan między wyborem a startem biegu wysyłki (send_started_at się nie ustawił): bieg znika bez śladu, zgoda Piotra zostaje
export async function discardBridgeRun(ownerId: string, id: string): Promise<boolean> {
  const rows = await sql()`delete from bridge_runs where id = ${id} and owner_id = ${ownerId} and ended_at is null and kind = 'send' returning id`;
  if (rows.length) await revokeRunTokens(ownerId, id);
  return rows.length > 0;
}

// ---------- położenia na kanwie ----------
export async function setTaskPositions(ownerId: string, items: { id: string; x: number; y: number }[]): Promise<void> {
  for (const it of items) await sql()`update tasks set pos = ${sql().json({ x: Math.round(it.x), y: Math.round(it.y) })} where id = ${it.id} and owner_id = ${ownerId}`;
}
export async function clearTaskPositions(ownerId: string): Promise<void> { await sql()`update tasks set pos = null where owner_id = ${ownerId}`; }
export async function setStepPositions(ownerId: string, taskId: string, items: { id: string; x: number; y: number }[]): Promise<void> {
  for (const it of items) await sql()`update steps set pos = ${sql().json({ x: Math.round(it.x), y: Math.round(it.y) })} where id = ${it.id} and task_id = ${taskId} and task_id in (select id from tasks where owner_id = ${ownerId})`;
}
export async function clearStepPositions(ownerId: string, taskId: string): Promise<void> {
  await sql()`update steps set pos = null where task_id = ${taskId} and task_id in (select id from tasks where owner_id = ${ownerId})`;
}

// ---------- pytania agenta zadawane w aplikacji ----------
const rowToQuestion = (r: Row): Question => ({
  id: r.id as string, taskId: r.taskId as string, stepId: (r.stepId as string) ?? null, text: r.text as string,
  options: (r.options as Question["options"]) ?? [], recommended: r.recommended == null ? null : Number(r.recommended), answer: (r.answer as string) ?? null,
  askedAt: iso(r.askedAt) as string, answeredAt: iso(r.answeredAt), seenAt: iso(r.seenAt),
});
export async function listQuestions(ownerId: string, where: { taskId?: string; open?: boolean; answeredUnseen?: boolean } = {}): Promise<Question[]> {
  const rows = await sql()`select * from questions where owner_id = ${ownerId}
    ${where.taskId ? sql()`and task_id = ${where.taskId}` : sql()``}
    ${where.open ? sql()`and answered_at is null` : sql()``}
    ${where.answeredUnseen ? sql()`and answered_at is not null and seen_at is null` : sql()``}
    order by asked_at`;
  return rows.map(rowToQuestion);
}
export async function askQuestion(ownerId: string, q: { taskId: string; stepId?: string | null; text: string; options?: Question["options"]; recommended?: number | null }): Promise<Question> {
  const [r] = await sql()`insert into questions (owner_id, task_id, step_id, text, options, recommended)
    values (${ownerId}, ${q.taskId}, ${q.stepId ?? null}, ${q.text.slice(0, 2000)}, ${sql().json((q.options ?? []).slice(0, 6) as never)}, ${q.recommended ?? null}) returning *`;
  return rowToQuestion(r);
}
export async function answerQuestion(ownerId: string, id: string, answer: string): Promise<void> {
  await sql()`update questions set answer = ${answer.slice(0, 4000)}, answered_at = now(), seen_at = null where id = ${id} and owner_id = ${ownerId}`;
}
export async function markQuestionsSeen(ownerId: string, ids: string[]): Promise<void> {
  if (ids.length) await sql()`update questions set seen_at = now() where owner_id = ${ownerId} and id = any(${ids})`;
}
export async function deleteQuestion(ownerId: string, id: string): Promise<void> { await sql()`delete from questions where id = ${id} and owner_id = ${ownerId}`; }

// odpowiedź na blok "question" w panelu kroku (agent wbudowany albo konektor ułożył pytanie w blokach)
// odpowiedź na pytanie z kartki; zwraca treść pytania (null = nie ma takiego pytania), żeby odpowiedź poszła też do agenta.
// text: treść pytania z formularza; gdy pod indeksem jest co innego (kartka zmieniła się po wyświetleniu), odpowiedź trafia do pytania o tej treści
export async function answerBlockQuestion(stepId: string, index: number, answer: string, text?: string): Promise<string | null> {
  const [r] = await sql()`select blocks from steps where id = ${stepId}`;
  const p = r?.blocks ? Blocks.safeParse(r.blocks) : null; if (!p || !p.success) return null;
  const isQ = (x: Block | undefined): x is Extract<Block, { type: "question" }> => !!x && x.type === "question";
  let b: Block | undefined = p.data[index];
  if (!isQ(b) || (text && b.text !== text)) b = text ? p.data.find((x) => isQ(x) && x.text === text) : undefined;
  if (!isQ(b)) return null;
  b.answer = answer.slice(0, 2000); delete b.prev;
  await sql()`update steps set blocks = ${sql().json(sanitizeBlocks(p.data) as never)} where id = ${stepId}`;   // treść szkicu bez zmian: zgoda zostaje
  return b.text;
}
// poprzednie wersje kartek (paczka 19): zlecenie na karcie zrobionego kroku, gdy wynik zastąpił klocki sprzed zamknięcia; tylko dla podanych kroków
export async function prevBlocksOf(stepIds: string[]): Promise<Map<string, Block[]>> {
  const out = new Map<string, Block[]>();
  if (!stepIds.length) return out;
  const rows = await sql()`select id, blocks_prev from steps where id in ${sql()(stepIds)} and blocks_prev is not null`;
  for (const r of rows) { const b = parseBlocks(r.blocksPrev); if (b) out.set(r.id as string, b); }
  return out;
}
// cofnięcie ostatniej zmiany kartki: poprzednia i obecna wersja zamieniają się miejscami (drugie cofnięcie przywraca zmianę).
// Cofnięcie nie wskrzesza zgody ani wysyłki: przywrócony szkic przechodzi przez tę samą kontrolę co każdy zapis.
export async function restorePrevBlocks(stepId: string): Promise<boolean> {
  const [r] = await sql()`select blocks, blocks_prev, approved_sig, status from steps where id = ${stepId} and blocks_prev is not null`;
  const prev = r ? parseBlocks(r.blocksPrev) : null;
  if (!r || !prev) return false;
  const approvedSig = (r.approvedSig as string) ?? null;
  const g = guardBlocks(stepId, { blocks: parseBlocks(r.blocks), approvedSig }, prev, false);
  const p: Row = { blocks: sql().json((approvedSig && !g.approved ? demote(g.blocks) : g.blocks) as never), blocks_prev: r.blocks == null ? null : sql().json(r.blocks as never), blocks_at: new Date() };
  if (approvedSig && !g.approved) {
    p.approved_at = null; p.approved_sig = null; p.send_started_at = null; p.approval = null;
    if (r.status === "handoff") { p.status = "draft"; p.prev_status = null; p.handoff_at = null; }
  }
  await sql()`update steps set ${sql()(p)} where id = ${stepId}`;
  return true;
}
