// Warstwa danych: proste funkcje na SQL. Bez ORM, żeby schemat był czytelny i łatwy do backupu.
import { randomUUID } from "node:crypto";
import { createHash, randomBytes } from "node:crypto";
import { sql } from "./db";
import { type Company, type Connection, Blocks, type Block, type Fact, type Project, type Question, type Rule, type Step, type Task, type TimeSample, appOfLabel, normalizeTool } from "./schema";
import { spentMin } from "./time";

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
export type TokenKind = "client" | "bridge";
export async function createApiToken(ownerId: string, name: string, kind: TokenKind = "client"): Promise<string> {
  const token = "th_" + randomBytes(24).toString("base64url");
  await sql()`insert into api_tokens (owner_id, name, token_hash, kind) values (${ownerId}, ${name}, ${hashToken(token)}, ${kind})`;
  return token;
}
export type TokenAuth = { id: string; ownerId: string; kind: TokenKind; name: string };
// użycie tokenu mostka (także przez Claude Code, który mostek uruchomił) jest zarazem jego pulsem
export async function tokenForSecret(token: string): Promise<TokenAuth | null> {
  const [r] = await sql()`update api_tokens set last_used_at = now(), seen_at = case when kind = 'bridge' then now() else seen_at end where token_hash = ${hashToken(token)} returning id, owner_id, kind, name`;
  return r ? { id: r.id as string, ownerId: r.ownerId as string, kind: (r.kind as TokenKind) ?? "client", name: r.name as string } : null;
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
  await sql()`update projects set ${sql()(p)} where id = ${id} and owner_id = ${ownerId}`;
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
export type BridgeServer = { name: string; url?: string | null; command?: string | null; transport?: string | null; ok: boolean; status?: string | null };
export async function upsertBridgeConnections(ownerId: string, host: string, servers: BridgeServer[]): Promise<{ added: number; updated: number; off: number }> {
  const h = host.trim().slice(0, 80) || "komputer";
  const keep = servers.filter((s) => s.name && !/^task[-_ ]?hub$/i.test(s.name.trim()));
  const existing = (await sql()`select * from connections where owner_id = ${ownerId} and source = 'bridge' and host = ${h}`).map(rowToConnection);
  const all = (await sql()`select * from connections where owner_id = ${ownerId}`).map(rowToConnection);
  let added = 0, updated = 0;
  for (const srv of keep) {
    const label = srv.name.trim().slice(0, 80);
    const state: Connection["state"] = srv.ok ? "active" : "expired";
    const url = (srv.url ?? srv.command ?? null)?.trim().slice(0, 500) || null;
    const meta = { server: label, transport: srv.transport ?? null, status: srv.status ?? null };
    // dopasowanie po nazwie serwera zapamiętanej w meta (etykietę Piotr może zmienić), awaryjnie po etykiecie
    const mine = existing.find((c) => String(c.meta.server ?? c.label).toLowerCase() === label.toLowerCase());
    if (mine) {
      await sql()`update connections set state = ${state}, url = ${url}, meta = meta || ${sql().json(meta as never)}, seen_at = now(), updated_at = now() where id = ${mine.id}`;
      updated++;
    } else {
      // ten sam konektor znany skądinąd (ręczny wpis o tej nazwie albo inny komputer) podpowiada konto, firmę i sferę; sama aplikacja to za mało (Gmail firmowy i prywatny)
      const twin = all.find((c) => c.label.toLowerCase() === label.toLowerCase() || String(c.meta.server ?? "").toLowerCase() === label.toLowerCase());
      await sql()`insert into connections (owner_id, app, label, account, company_id, sphere, provider, kind, state, source, host, url, meta, seen_at)
        values (${ownerId}, ${appOfLabel(label)}, ${label}, ${twin?.account ?? null}, ${twin?.companyId ?? null}, ${twin?.sphere ?? "work"}, 'claude-code', 'mcp', ${state}, 'bridge', ${h}, ${url}, ${sql().json(meta as never)}, now())
        on conflict (owner_id, host, lower(label)) where source = 'bridge' do update set state = excluded.state, url = excluded.url, meta = connections.meta || excluded.meta, seen_at = now(), updated_at = now()`;
      added++;
    }
  }
  const names = new Set(keep.map((s) => s.name.trim().toLowerCase()));
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
    review: (r.review as Record<string, unknown>) ?? null, blocks: blocks && blocks.success ? blocks.data : null, blocksAt: iso(r.blocksAt), logged: !!r.logged,
    pos: (r.pos as { x: number; y: number }) ?? null, dependsOn: deps, connectionId: (r.connectionId as string) ?? null,
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
async function hydrate(rows: Row[]): Promise<Task[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id as string);
  const [stepRows, sdeps, tdeps] = await Promise.all([
    sql()`select * from steps where task_id in ${sql()(ids)} order by task_id, position, created_at`,
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
    ? await sql()`select * from tasks where owner_id = ${ownerId} order by created_at`
    : opts.trash
      ? await sql()`select * from tasks where owner_id = ${ownerId} and deleted_at is not null order by deleted_at desc`
      : await sql()`select * from tasks where owner_id = ${ownerId} and deleted_at is null order by created_at`;
  return hydrate(rows);
}
export async function getTask(ownerId: string, id: string): Promise<Task | null> {
  const rows = await sql()`select * from tasks where owner_id = ${ownerId} and id = ${id}`;
  return (await hydrate(rows))[0] ?? null;
}
export type NewStep = { title: string; detail?: string; tool?: string; needsApproval?: boolean; estMin?: number; link?: string; dependsOn?: string[] /* indeksy lub id */; connectionId?: string | null };
export type NewTask = { title: string; summary?: string; source?: string; level?: number; due?: string | null; projectId?: string | null; steps?: NewStep[]; dependsOn?: string[] };

export async function createTask(ownerId: string, input: NewTask): Promise<Task> {
  const [t] = await sql()`insert into tasks (owner_id, project_id, title, summary, source, level, due)
    values (${ownerId}, ${input.projectId ?? null}, ${input.title.slice(0, 200)}, ${input.summary ?? ""}, ${input.source ?? ""}, ${input.level ?? 3}, ${input.due ?? null}) returning id`;
  const id = t.id as string;
  if (input.dependsOn?.length) await sql()`insert into task_dependencies ${sql()(input.dependsOn.map((d) => ({ task_id: id, depends_on_id: d })))} on conflict do nothing`;
  if (input.steps?.length) await addSteps(id, input.steps);
  return (await getTask(ownerId, id))!;
}
// before: id kroku, przed którym nowe kroki mają wejść (np. przed publikacją): dostają jego miejsce w kolejności, dziedziczą jego zależności
// (gdy nie podały własnych), a on zaczyna czekać na nie; kroki za nim przesuwają się dalej
export async function addSteps(taskId: string, steps: NewStep[], opts: { before?: string | null } = {}): Promise<Step[]> {
  const [bef] = opts.before ? await sql()`select id, position from steps where id = ${opts.before} and task_id = ${taskId}` : [];
  if (bef) await sql()`update steps set position = position + ${steps.length} where task_id = ${taskId} and position >= ${Number(bef.position)}`;
  const [{ n }] = await sql()`select coalesce(max(position), -1) + 1 as n from steps where task_id = ${taskId}`;
  let pos = bef ? Number(bef.position) : Number(n);
  const created: { id: string }[] = [];
  for (const s of steps) {
    const [r] = await sql()`insert into steps (task_id, position, title, detail, tool, needs_approval, est_min, link, connection_id)
      values (${taskId}, ${pos++}, ${s.title.slice(0, 200)}, ${s.detail ?? ""}, ${normalizeTool(s.tool)}, ${!!s.needsApproval}, ${Math.max(15, Math.round((s.estMin ?? 15) / 15) * 15)}, ${s.link ?? null}, ${s.connectionId ?? null}) returning id`;
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
  if (bef) {
    // dziedziczenie: nowy krok bez własnych zależności czeka na to, na co czekał krok „before”; „before” czeka na ostatnie z nowych (te, na które żaden nowy nie czeka)
    const inherited = (await sql()`select depends_on_id from step_dependencies where step_id = ${bef.id as string}`).map((r) => r.dependsOnId as string);
    const own = new Set(links.map((l) => l.step_id));
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
  await sql()`update tasks set ${sql()(p)} where id = ${id} and owner_id = ${ownerId}`;
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

export type StepPatch = Partial<{ title: string; detail: string; tool: string; status: Step["status"]; prevStatus: string | null; needsApproval: boolean; estMin: number; spentSec: number; spentManual: boolean; link: string | null; doneAt: string | null; handoffAt: string | null; report: string | null; output: string; review: Record<string, unknown> | null; blocks: Block[] | null; position: number; logged: boolean; pos: { x: number; y: number } | null; connectionId: string | null }>;
export async function updateStep(id: string, patch: StepPatch): Promise<void> {
  const p: Row = {};
  if (patch.title !== undefined) p.title = patch.title.slice(0, 200);
  if (patch.detail !== undefined) p.detail = patch.detail;
  if (patch.tool !== undefined) p.tool = normalizeTool(patch.tool);
  if (patch.status !== undefined) p.status = patch.status;
  if (patch.prevStatus !== undefined) p.prev_status = patch.prevStatus;
  if (patch.needsApproval !== undefined) p.needs_approval = patch.needsApproval;
  if (patch.estMin !== undefined) p.est_min = Math.max(15, Math.round(patch.estMin / 15) * 15);
  if (patch.spentSec !== undefined) { p.spent_sec = Math.max(0, Math.round(patch.spentSec)); p.spent_at = new Date(); }
  if (patch.spentManual !== undefined) p.spent_manual = patch.spentManual;
  if (patch.link !== undefined) p.link = patch.link;
  if (patch.handoffAt !== undefined) p.handoff_at = patch.handoffAt;
  if (patch.doneAt !== undefined) p.done_at = patch.doneAt;
  if (patch.report !== undefined) p.report = patch.report;
  if (patch.output !== undefined) p.output = patch.output;
  if (patch.review !== undefined) p.review = patch.review === null ? null : sql().json(patch.review as never);
  if (patch.blocks !== undefined) { p.blocks = patch.blocks === null ? null : sql().json(patch.blocks); p.blocks_at = patch.blocks === null ? null : new Date(); }
  if (patch.pos !== undefined) p.pos = patch.pos === null ? null : sql().json(patch.pos);
  if (patch.position !== undefined) p.position = patch.position;
  if (patch.logged !== undefined) p.logged = patch.logged;
  if (patch.connectionId !== undefined) p.connection_id = patch.connectionId;
  if (!Object.keys(p).length) return;
  await sql()`update steps set ${sql()(p)} where id = ${id}`;
}
export async function setStepDependencies(id: string, dependsOn: string[]): Promise<void> {
  await sql().begin(async (tx) => {
    await tx`delete from step_dependencies where step_id = ${id}`;
    if (dependsOn.length) await tx`insert into step_dependencies ${tx(dependsOn.filter((d) => d !== id).map((d) => ({ step_id: id, depends_on_id: d })))} on conflict do nothing`;
  });
}
export async function deleteStep(id: string): Promise<void> { await sql()`delete from steps where id = ${id}`; }

// krok gotowy: zapis czasu do historii (uczenie), status, raport i link
export async function completeStep(ownerId: string, task: Task, step: Step, opts: { report?: string; link?: string; output?: string; addSpentSec?: number } = {}): Promise<void> {
  const spentSec = step.spentSec + (opts.addSpentSec ?? 0);
  const patch: StepPatch = { status: "done", prevStatus: step.status === "done" ? step.prevStatus : step.status, spentSec, handoffAt: null, doneAt: new Date().toISOString() };
  if (opts.report !== undefined) { patch.report = opts.report; patch.output = opts.report; }
  if (opts.output !== undefined) patch.output = opts.output;
  if (opts.link) patch.link = opts.link;
  // zatwierdzony szkic, który krok właśnie wysłał, zostaje w zadaniu jako zapis wysyłki
  if (step.blocks?.some((b) => b.type === "draft" && b.status === "approved")) patch.blocks = step.blocks.map((b) => (b.type === "draft" && b.status === "approved" ? { ...b, status: "sent" as const } : b));
  const sm = spentMin({ spentSec });
  if (sm > 0 && !step.logged) {
    await sql()`insert into time_samples (owner_id, step_id, tool, project_id, est_min, spent_min) values (${ownerId}, ${step.id}, ${step.tool}, ${task.projectId}, ${step.estMin}, ${sm})`;
    patch.logged = true;
  }
  await updateStep(step.id, patch);
  // ostatni krok gotowy: zadanie kończy się samo, chyba że jakaś wiadomość Piotra czeka jeszcze na odpowiedź agenta (zamknie je reply_chat)
  await closeIfDone(ownerId, task.id);
}
export async function reopenStep(ownerId: string, taskId: string, step: Step): Promise<void> {
  const status = step.prevStatus === "handoff" ? "todo" : step.prevStatus && step.prevStatus !== "done" ? (step.prevStatus as Step["status"]) : step.output ? "draft" : "todo";
  await sql().begin(async (tx) => {
    await tx`update steps set status = ${status}, prev_status = null, logged = false, done_at = null where id = ${step.id}`;
    await tx`delete from time_samples where step_id = ${step.id}`;
    await tx`update tasks set done_at = null where id = ${taskId} and owner_id = ${ownerId}`;
  });
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
      source_app: f.source?.app ?? null, source_ref: f.source?.ref ?? null, source_url: f.source?.url ?? null, fetched_at: f.source?.fetchedAt ?? null,
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
export async function addAttachment(where: { stepId?: string; taskId?: string }, a: { kind: Attachment["kind"]; name?: string; url?: string; storagePath?: string; mime?: string; bytes?: number; caption?: string; analysis?: string; keep?: boolean; expiresAt?: string | null; data?: Buffer }): Promise<Attachment> {
  const id = randomUUID();
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
  const rows = await sql()`select tool, project_id, est_min, spent_min from time_samples where owner_id = ${ownerId} order by at desc limit 300`;
  return rows.map((r) => ({ tool: r.tool as string, projectId: (r.projectId as string) ?? null, estMin: Number(r.estMin), spentMin: Number(r.spentMin) }));
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
  await sql()`insert into layout_memory (owner_id, source_app, kind, blocks) values (${ownerId}, ${app}, 'step', ${sql().json(blocks as never)})
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
  const r0 = rect ?? { x: 0, y: 0, w: 0, h: 0 };
  const [r] = await sql()`insert into canvas_groups (owner_id, task_id, name, color, x, y, w, h, members, auto) values (${ownerId}, ${taskId}, ${name.slice(0, 60)}, ${Number(n) % 8}, ${r0.x}, ${r0.y}, ${r0.w}, ${r0.h}, ${members}, ${!rect}) returning id`;
  await releaseMembers(ownerId, taskId, r.id as string, members);
  return (await listGroups(ownerId, taskId)).find((g) => g.id === r.id)!;
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
  for (const k of ["x", "y", "w", "h", "color"] as const) if (patch[k] !== undefined) p[k] = patch[k];
  if (patch.members !== undefined) p.members = patch.members;
  if (patch.auto !== undefined) p.auto = patch.auto;
  if (!Object.keys(p).length) return;
  const [g] = await sql()`update canvas_groups set ${sql()(p)} where id = ${id} and owner_id = ${ownerId} returning task_id`;
  if (g && patch.members?.length) await releaseMembers(ownerId, (g.taskId as string) ?? null, id, patch.members);
}
export async function deleteGroup(ownerId: string, id: string): Promise<void> { await sql()`delete from canvas_groups where id = ${id} and owner_id = ${ownerId}`; }

// ---------- wyszukiwanie pełnotekstowe (bez AI) ----------
export async function searchTasks(ownerId: string, q: string, limit = 20): Promise<Task[]> {
  const rows = await sql()`select * from tasks where owner_id = ${ownerId} and deleted_at is null and (search @@ plainto_tsquery('simple', ${q}) or title ilike ${"%" + q + "%"}) order by created_at desc limit ${limit}`;
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
  const rows = await sql()`select id, name, kind, created_at, last_used_at, seen_at, meta from api_tokens where owner_id = ${ownerId} order by created_at desc`;
  return rows.map((r) => ({ id: r.id as string, name: r.name as string, kind: (r.kind as TokenKind) ?? "client", createdAt: iso(r.createdAt) as string, lastUsedAt: iso(r.lastUsedAt), seenAt: iso(r.seenAt), meta: (r.meta as Record<string, unknown>) ?? {} }));
}
export async function deleteApiToken(ownerId: string, id: string): Promise<void> {
  await sql()`delete from api_tokens where id = ${id} and owner_id = ${ownerId}`;
}
export async function setUserSettings(ownerId: string, patch: Record<string, unknown>): Promise<void> {
  await sql()`update users set settings = settings || ${sql().json(patch as never)} where id = ${ownerId}`;
}

// ---------- mostek na komputerze ----------
// Puls: token rodzaju "bridge" ma seen_at i meta (komputer, silnik, stan). Bieg: jeden otwarty na właściciela (unikalny indeks częściowy),
// więc dwa komputery nie wykonają tej samej pracy; bieg bez sygnału wygasa.
export type BridgeRun = { id: string; bridge: string; startedAt: string; touchedAt: string; endedAt: string | null; outcome: string | null; note: string | null; taskId: string | null; stepId: string | null };
const rowToRun = (r: Row): BridgeRun => ({ id: r.id as string, bridge: r.bridge as string, startedAt: iso(r.startedAt) as string, touchedAt: iso(r.touchedAt) as string, endedAt: iso(r.endedAt), outcome: (r.outcome as string) ?? null, note: (r.note as string) ?? null, taskId: (r.taskId as string) ?? null, stepId: (r.stepId as string) ?? null });
export type BridgeStatus = { alive: boolean; seenAt: string | null; name: string | null; meta: Record<string, unknown>; run: BridgeRun | null };

export async function bridgeSeen(tokenId: string, meta: Record<string, unknown>): Promise<void> {
  await sql()`update api_tokens set seen_at = now(), last_used_at = now(), meta = meta || ${sql().json(meta as never)} where id = ${tokenId} and kind = 'bridge'`;
}
export async function bridgeStatus(ownerId: string, aliveMs: number): Promise<BridgeStatus> {
  const [t] = await sql()`select name, seen_at, meta from api_tokens where owner_id = ${ownerId} and kind = 'bridge' and seen_at is not null order by seen_at desc limit 1`;
  const [r] = await sql()`select * from bridge_runs where owner_id = ${ownerId} and ended_at is null limit 1`;
  const seenAt = t ? (iso(t.seenAt) as string) : null;
  return { alive: !!seenAt && Date.now() - new Date(seenAt).getTime() < aliveMs, seenAt, name: t ? (t.name as string) : null, meta: t ? ((t.meta as Record<string, unknown>) ?? {}) : {}, run: r ? rowToRun(r) : null };
}
export async function expireBridgeRuns(ownerId: string, staleMin: number): Promise<number> {
  const rows = await sql()`update bridge_runs set ended_at = now(), outcome = 'stale' where owner_id = ${ownerId} and ended_at is null and touched_at < now() - make_interval(mins => ${staleMin}) returning id, started_at`;
  for (const r of rows) await requeueChat(ownerId, r.startedAt as Date);
  return rows.length;
}
export async function startBridgeRun(ownerId: string, tokenId: string | null, bridge: string): Promise<BridgeRun | null> {
  const [r] = await sql()`insert into bridge_runs (owner_id, token_id, bridge) values (${ownerId}, ${tokenId}, ${bridge.slice(0, 80)}) on conflict (owner_id) where ended_at is null do nothing returning *`;
  return r ? rowToRun(r) : null;
}
// note: co mostek robi teraz („start_step: id”, „Bash: npm test”); link: z którym zadaniem albo krokiem bieg jest związany (krok ustala też zadanie)
export async function touchBridgeRun(ownerId: string, id: string, note?: string, link: { taskId?: string; stepId?: string } = {}): Promise<boolean> {
  const p: Row = { touched_at: new Date() };
  if (note !== undefined) p.note = note.slice(0, 200);
  if (link.stepId) {
    const [s] = await sql()`select s.id, s.task_id from steps s join tasks t on t.id = s.task_id where s.id = ${link.stepId} and t.owner_id = ${ownerId}`;
    if (s) { p.step_id = s.id; p.task_id = s.taskId; }
  } else if (link.taskId) {
    const [t] = await sql()`select id from tasks where id = ${link.taskId} and owner_id = ${ownerId}`;
    if (t) { p.task_id = t.id; p.step_id = null; }
  }
  const rows = await sql()`update bridge_runs set ${sql()(p)} where id = ${id} and owner_id = ${ownerId} and ended_at is null returning id`;
  return rows.length > 0;
}
export async function endBridgeRun(ownerId: string, id: string, outcome: string, note?: string): Promise<boolean> {
  const rows = await sql()`update bridge_runs set ended_at = now(), touched_at = now(), outcome = ${outcome.slice(0, 20)}, note = coalesce(${note?.slice(0, 600) ?? null}, note) where id = ${id} and owner_id = ${ownerId} and ended_at is null returning id, started_at`;
  if (rows.length) await requeueChat(ownerId, rows[0].startedAt as Date);   // wiadomości wzięte w tym biegu bez odpowiedzi wracają do kolejki
  return rows.length > 0;
}
export async function listBridgeRuns(ownerId: string, limit = 8): Promise<BridgeRun[]> {
  const rows = await sql()`select * from bridge_runs where owner_id = ${ownerId} order by started_at desc limit ${limit}`;
  return rows.map(rowToRun);
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
export async function answerBlockQuestion(stepId: string, index: number, answer: string): Promise<void> {
  const [r] = await sql()`select blocks from steps where id = ${stepId}`;
  const p = r?.blocks ? Blocks.safeParse(r.blocks) : null; if (!p || !p.success) return;
  const b = p.data[index]; if (!b || b.type !== "question") return;
  b.answer = answer.slice(0, 2000);
  await sql()`update steps set blocks = ${sql().json(p.data as never)} where id = ${stepId}`;
}
