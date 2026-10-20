// Etap 0, mostek v2: bieg pracy bez wysyłek z tokenem biegu, osobny bieg wysyłki jednego szkicu (konektor albo commit z aplikacji),
// koniec biegu (stopped, sent, cofnięcie zgody, tokeny gasną), stary mostek v1 bez zmian, wydania aplikacji przez serwer (GitHub bez tokenu w odpowiedziach).
// Część z bazą pomijana bez TEST_DATABASE_URL.
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import type { Block, Connection } from "@/lib/schema";
import type { Draft } from "@/lib/agent/approval";
import { bridgePrompt, bridgeWorkPrompt, sendPrompt, gitSend, isGitDraft, sendServers, repoOf, safeBranch, safeRepoPath, sha256Of, protocolOf } from "@/lib/bridge";

// sesja Piotra w przeglądarce (ciasteczko) bez Next: przełącznik w teście
const auth = vi.hoisted(() => ({ signed: false }));
vi.mock("@/lib/auth", async (orig) => ({ ...(await orig<typeof import("@/lib/auth")>()), isSignedIn: async () => auth.signed }));

const DB = !!process.env.TEST_DATABASE_URL;
const HEX = "a".repeat(40) + "0123456789abcdef01234567";
const draft = (target: Draft["target"], body = "Treść", extra: Partial<Draft> = {}): Draft => ({ type: "draft", target, body, status: "proposed", ...extra });
const DIFF_A = "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-a\n+b", DIFF_R = "@@ -1 +1,2 @@\n # App\n+Opis";
const changes = (o: Partial<Extract<Block, { type: "changes" }>> = {}): Block => ({ type: "changes", repo: "wlrx/app", branch: "feat/x", files: [{ path: "src/a.ts", diff: DIFF_A }, { path: "./README.md", diff: DIFF_R }], ...o });

describe("prompty mostka", () => {
  it("v1 jak dotąd (wysyła zatwierdzone szkice), ale krok z kodem może zmieniać pliki w repozytorium projektu", () => {
    const p = bridgePrompt();
    expect(p).toContain("ZATWIERDZONE SZKICE DO WYSŁANIA");
    expect(p).toContain("z wyjątkiem kroku z kodem: on zmienia pliki (i instaluje zależności projektu) w repozytorium projektu");
    expect(p).not.toContain("nie instaluj niczego i nie zmieniaj plików poza katalogiem roboczym.");
  });
  it("v2 bieg pracy: bez sekcji wysyłki, zewnętrzne aplikacje tylko do czytania, bez commita i pusha, foldery z kodem z listy", () => {
    const p = bridgeWorkPrompt();
    expect(p).toContain("list_work");
    expect(p).not.toContain("ZATWIERDZONE SZKICE");
    expect(p).toContain("są tylko do czytania");
    expect(p).toContain("Nigdy nie rób commita ani pusha");
    expect(p).toContain("Dodaj folder repozytorium w Ustawieniach aplikacji Task Hub na Macu (Foldery z kodem)");
    expect(p).toContain("także gdy krok nie ma needsApproval");
    expect(p).toContain("WIADOMOŚCI PIOTRA W ZADANIACH");   // reszta pracy jak w v1
    // paczka 7: plik na Macu zapisuje tylko bieg pracy v2; stary mostek nic o nim nie wie
    expect(p).toContain("sekcja PLIKI NA MACU"); expect(p).toContain("plik w Dysku Google"); expect(p).toContain("Foldery na pliki");
    expect(bridgePrompt()).not.toContain("PLIKI NA MACU"); expect(bridgePrompt()).not.toContain("plik w Dysku Google");
  });
  it("v2 bieg wysyłki: jeden szkic z get_task, tylko podany konektor, raz, przy wątpliwości leave_step", () => {
    const p = sendPrompt({ stepId: "S1", taskId: "T1", app: "slack", action: "reply", servers: ["claude.ai Slack"] });
    expect(p).toContain(`get_task z taskId "T1"`);
    expect(p).toContain("SZKIC KROKU S1");
    expect(p).toContain("wyłącznie konektorem „claude.ai Slack”");
    expect(p).toContain(`complete_step ze stepId "S1"`);
    expect(p).toContain(`leave_step ze stepId "S1"`);
    expect(p).not.toContain("list_work");
  });
  it("wersja protokołu: brak albo 1 = v1, 2 i wyżej = v2", () => {
    expect([protocolOf(undefined), protocolOf("1"), protocolOf(2), protocolOf("2"), protocolOf("3"), protocolOf("x")]).toEqual([1, 1, 2, 2, 2, 1]);
  });
});

describe("bieg wysyłki: commit z aplikacji i dobór konektora", () => {
  it("git: repozytorium, gałąź i pliki z bloku zmian, treść commita ze szkicu, push tylko dla action push", () => {
    const d = draft({ app: "github", action: "push", where: "wlrx/app, gałąź feat/x" }, "Popraw A", { subject: "fix: A" });
    expect(isGitDraft(d, [changes()])).toBe(true);
    expect(gitSend([changes({ repo: "https://github.com/wlrx/app.git" })], d)).toEqual({ repo: "wlrx/app", branch: "feat/x", message: "fix: A\n\nPopraw A", files: ["src/a.ts", "README.md"], push: true, diffs: { "src/a.ts": DIFF_A, "README.md": DIFF_R } });
    expect(gitSend([changes()], { ...d, target: { ...d.target, action: "commit" } })).toMatchObject({ push: false });
    // repozytorium i gałąź awaryjnie z „dokąd”
    expect(gitSend([changes({ repo: undefined, branch: undefined })], d)).toMatchObject({ repo: "wlrx/app", branch: "feat/x" });
    // sama nazwa repozytorium w bloku zmian (bez właściciela): właściciel/nazwa z „dokąd”, a bez niego jasna odmowa na serwerze
    expect(gitSend([changes({ repo: "app" })], d)).toMatchObject({ repo: "wlrx/app" });
    expect(gitSend([changes({ repo: "app" })], { ...d, target: { app: "github", action: "push", where: "repozytorium app" } })).toMatch(/właściciel\/nazwa/);
  });
  it("git: każdy plik z diffem (aplikacja porówna go z dyskiem przed commitem); bez diffu albo z dwoma różnymi diffami odmowa", () => {
    const d = draft({ app: "github", action: "commit", where: "wlrx/app" }, "x");
    expect(gitSend([changes({ files: [{ path: "src/a.ts", diff: DIFF_A }, { path: "src/b.ts" }] })], d)).toMatch(/src\/b\.ts.*nie ma diffu/);
    expect(gitSend([changes({ files: [{ path: "src/a.ts", diff: "  \n" }] })], d)).toMatch(/nie ma diffu/);
    expect(gitSend([changes({ files: [{ path: "src/a.ts", diff: DIFF_A }, { path: "./src/a.ts", diff: DIFF_R }] })], d)).toMatch(/dwa razy/);
    expect(gitSend([changes({ files: [{ path: "src/a.ts", diff: DIFF_A }, { path: "./src/a.ts", diff: DIFF_A }] })], d)).toMatchObject({ files: ["src/a.ts"], diffs: { "src/a.ts": DIFF_A } });
  });
  it("git: odmowa bez bloku zmian, z gałęzią albo ścieżką, która mogłaby być opcją albo wyjść poza repozytorium", () => {
    const d = draft({ app: "github", action: "commit" }, "x");
    expect(gitSend([], d)).toMatch(/bloku zmian/);
    expect(gitSend([changes({ branch: "--force" })], d)).toMatch(/gałęzi/);
    expect(gitSend([changes({ branch: "a..b" })], d)).toMatch(/gałęzi/);
    expect(gitSend([changes({ files: [{ path: "../etc/passwd" }] })], d)).toMatch(/ścieżka/);
    expect(gitSend([changes({ files: [{ path: "/abs/x" }] })], d)).toMatch(/ścieżka/);
    expect(gitSend([changes({ files: [{ path: "-rf" }] })], d)).toMatch(/ścieżka/);
    expect(gitSend([changes({ files: [] })], d)).toMatch(/pliku/);
    expect(gitSend([changes({ repo: "nie ma; rm -rf" })], { ...d, target: { app: "github", action: "commit" } })).toMatch(/repozytorium/);
    expect(gitSend([changes()], draft({ app: "github", action: "commit" }, "  "))).toMatch(/treści/);
    expect([safeBranch("feat/x-1.2"), safeBranch("-x"), safeBranch("x.lock"), safeBranch("a//b"), safeRepoPath("a/./b")]).toEqual([true, false, false, false, false]);
    expect([repoOf("git@github.com:wlrx/app.git"), repoOf("https://github.com/wlrx/app/tree/main"), repoOf("app"), repoOf("../x")]).toEqual(["wlrx/app", "wlrx/app", null, null]);
  });
  it("komentarz albo issue w GitHubie to zwykła wysyłka konektorem, nie commit", () => {
    expect(isGitDraft(draft({ app: "github", action: "comment" }), [changes()])).toBe(false);
    expect(isGitDraft(draft({ app: "github", action: "send" }), [])).toBe(false);
    expect(isGitDraft(draft({ app: "clickup", action: "commit" }), [])).toBe(true);
  });
  it("konektor: połączenie kroku z mostka, inaczej ta aplikacja z tego komputera i z firmy zadania, nigdy z innej firmy", () => {
    const c = (o: Partial<Connection>): Connection => ({ id: "x", app: "slack", label: "Slack", account: null, companyId: null, sphere: "work", provider: "claude", kind: "mcp", state: "active", source: "bridge", host: "mini", url: null, meta: {}, seenAt: null, ...o });
    const conns = [
      c({ id: "s1", label: "Slack", meta: { server: "claude.ai Slack" }, companyId: "A" }),
      c({ id: "s2", label: "slack-bee", meta: { server: "slack-bee" }, companyId: "B" }),
      c({ id: "s3", label: "slack-old", meta: { server: "slack-old" }, state: "off" }),
      c({ id: "g1", app: "gmail", label: "Gmail", meta: { server: "claude.ai Gmail" }, host: "inny-mac" }),
      c({ id: "m1", app: "gmail", label: "Gmail", source: "manual", host: null }),
      c({ id: "d1", app: "drive", label: "Google Drive", meta: { server: "claude.ai Google Drive" } }),
      c({ id: "c1", app: "clickup", label: "clickup-prywatny", meta: { server: "clickup-prywatny" }, sphere: "private" }),
    ];
    const t = { connectionId: null, host: "mini", companyId: "A" };
    expect(sendServers(conns, { ...t, app: "Slack" })).toEqual(["claude.ai Slack"]);
    expect(sendServers(conns, { ...t, app: "slack", companyId: "B" })).toEqual(["slack-bee"]);
    expect(sendServers(conns, { ...t, app: "slack", companyId: null })).toEqual([]);              // prywatne zadanie: nie z konta firmy
    expect(sendServers(conns, { ...t, app: "slack", connectionId: "s2" })).toEqual(["slack-bee"]);  // połączenie kroku wygrywa
    expect(sendServers(conns, { ...t, app: "slack", connectionId: "s3" })).toEqual([]);            // wyłączone: nie zgadujemy innego
    expect(sendServers(conns, { ...t, app: "E-mail", companyId: null })).toEqual([]);              // Gmail jest tylko na innym Macu
    expect(sendServers(conns, { ...t, app: "gmail", companyId: null, host: "inny-mac" })).toEqual(["claude.ai Gmail"]);
    expect(sendServers(conns, { ...t, app: "gmail", companyId: null, host: "inny-mac", connectionId: "m1" })).toEqual(["claude.ai Gmail"]);   // ręczny wpis → ten sam konektor po nazwie
    expect(sendServers(conns, { ...t, app: "sheets", companyId: null })).toEqual(["claude.ai Google Drive"]);
    expect(sendServers(conns, { ...t, app: "clickup" })).toEqual([]);                             // zadanie firmowe: nie z prywatnego konta
    expect(sendServers(conns, { ...t, app: "clickup", companyId: null })).toEqual(["clickup-prywatny"]);
  });
  it("suma SHA-256 z pliku shasum: pierwsze słowo, 64 znaki hex", () => {
    expect(sha256Of(`${HEX.toUpperCase()}  Task-Hub.zip\n`)).toBe(HEX);
    expect(sha256Of("abc  x")).toBeNull();
    expect(sha256Of(null)).toBeNull();
  });
});

// GitHub udawany: najnowsze wydanie, przekierowania plików na podpisane adresy, plik sumy
type Call = { url: string; auth: string | null; redirect: string | undefined };
function fakeGitHub(o: { latest?: number; tag?: string } = {}) {
  const calls: Call[] = [];
  const API = "https://api.github.com/repos/piotr-bialobrzeski-wrx/taskhub";
  const assets = [
    { id: 11, name: "Task-Hub-0.1.7.zip", size: 700 }, { id: 12, name: "Task-Hub-0.1.7.zip.sha256", size: 80 },
    { id: 13, name: "Task-Hub-0.1.7.pkg", size: 690 }, { id: 14, name: "Task-Hub-0.1.7.dmg", size: 760 },
  ];
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const h = new Headers(init?.headers);
    calls.push({ url, auth: h.get("authorization"), redirect: init?.redirect });
    if (url === `${API}/releases/latest`) return o.latest && o.latest !== 200 ? new Response("{}", { status: o.latest }) : Response.json({ tag_name: o.tag ?? "app-v0.1.7", body: "Nowości", assets });
    if (url.startsWith(`${API}/releases?`)) return o.latest === 404 ? new Response("{}", { status: 404 }) : Response.json([{ tag_name: "app-latest", prerelease: true, assets: [] }, { tag_name: "app-v0.1.7", assets }]);
    const m = /\/releases\/assets\/(\d+)$/.exec(url);
    if (m) return assets.some((a) => String(a.id) === m[1]) ? new Response(null, { status: 302, headers: { location: `https://objects.example/${m[1]}?sig=abc` } }) : new Response("{}", { status: 404 });
    if (url === "https://objects.example/12?sig=abc") return new Response(`${HEX}  Task-Hub-0.1.7.zip\n`);
    return new Response("nie", { status: 500 });
  });
  return { calls, spy };
}

describe("pobranie aplikacji z sesją Piotra (pierwsza instalacja z Ustawień)", () => {
  const prev = process.env.GITHUB_RELEASES_TOKEN;
  afterEach(() => { vi.restoreAllMocks(); auth.signed = false; if (prev === undefined) delete process.env.GITHUB_RELEASES_TOKEN; else process.env.GITHUB_RELEASES_TOKEN = prev; });

  it("/api/app/download: bez sesji do logowania; z sesją przekierowanie na instalator .pkg, token GitHuba tylko w zapytaniu do API", async () => {
    const route = await import("@/app/api/app/download/route");
    process.env.GITHUB_RELEASES_TOKEN = "ghs_tajny";
    const gh = fakeGitHub();
    const out = await route.GET();
    expect(out.status).toBe(302); expect(out.headers.get("location")).toBe("/login");
    auth.signed = true;
    const r = await route.GET();
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe("https://objects.example/13?sig=abc");
    expect(gh.calls.filter((c) => c.url.startsWith("https://api.github.com")).every((c) => c.auth === "Bearer ghs_tajny")).toBe(true);
    expect(gh.calls.find((c) => c.url.endsWith("/releases/assets/13"))?.redirect).toBe("manual");
    expect(JSON.stringify([...r.headers])).not.toContain("ghs_tajny");
  });
  it("/api/bridge/app/download: sesja wystarcza; zły numer pliku 404; bez sesji i tokenu 401; bez GITHUB_RELEASES_TOKEN pyta bez nagłówka", async () => {
    const route = await import("@/app/api/bridge/app/download/route");
    delete process.env.GITHUB_RELEASES_TOKEN;
    const gh = fakeGitHub();
    expect((await route.GET(new Request("http://x/api/bridge/app/download?asset=11"))).status).toBe(401);
    auth.signed = true;
    const r = await route.GET(new Request("http://x/api/bridge/app/download?asset=11"));
    expect(r.status).toBe(302); expect(r.headers.get("location")).toBe("https://objects.example/11?sig=abc");
    expect(gh.calls.every((c) => c.auth === null)).toBe(true);
    expect((await route.GET(new Request("http://x/api/bridge/app/download?asset=../1"))).status).toBe(404);
    expect((await route.GET(new Request("http://x/api/bridge/app/download?asset=99"))).status).toBe(404);
  });
});

describe.skipIf(!DB)("mostek v2 na serwerze", async () => {
  const repo = await import("@/lib/repo");
  const { sql } = await import("@/lib/db");
  const { authBridge } = await import("@/lib/bridge");
  const work = await import("@/app/api/bridge/work/route");
  const run = await import("@/app/api/bridge/run/route");
  const runId = await import("@/app/api/bridge/run/[id]/route");
  const app = await import("@/app/api/bridge/app/route");
  const download = await import("@/app/api/bridge/app/download/route");
  const mcp = await import("@/app/api/mcp/route");
  let owner = "", tok = "", client = "";
  const H = (t: string) => ({ Authorization: `Bearer ${t}` });
  const getWork = async (q = "") => work.GET(new Request(`http://x/api/bridge/work${q}`, { headers: H(tok) }));
  const postRun = async (body: Record<string, unknown>, t = tok) => run.POST(new Request("http://x/api/bridge/run", { method: "POST", headers: H(t), body: JSON.stringify(body) }));
  const patch = async (id: string, body: Record<string, unknown>) => runId.PATCH(new Request("http://x/api/bridge/run/x", { method: "PATCH", headers: H(tok), body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });
  const step = async (taskId: string, stepId: string) => (await repo.getTask(owner, taskId))!.steps.find((s) => s.id === stepId)!;
  // krok ze szkicem zatwierdzonym kliknięciem Piotra
  const approved = async (title: string, tool: string, blocks: Block[]) => {
    const t = await repo.createTask(owner, { title, steps: [{ title, tool, needsApproval: true }] });
    await repo.updateStep(t.steps[0].id, { status: "draft", blocks });
    expect(await repo.approveDraft(owner, t.steps[0].id)).toBe(true);
    return { taskId: t.id, stepId: t.steps[0].id };
  };
  const chat = async (taskId: string) => (await sql()`select text from chat_messages where task_id = ${taskId} and role = 'agent' order by created_at`).map((r) => r.text as string);
  const callTool = async (t: string, name: string, args: Record<string, unknown>) => {
    const r = await mcp.POST(new Request("http://x/api/mcp", { method: "POST", headers: { authorization: `Bearer ${t}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) }));
    const msgs = (await r.text()).split("\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6)));
    const m = msgs.find((x) => x.id === 1);
    return { text: ((m?.result?.content ?? []) as { text?: string }[]).map((c) => c.text ?? "").join("\n"), isError: !!m?.result?.isError || !!m?.error };
  };

  beforeAll(async () => {
    owner = (await repo.ensureOwner()).id;
    await sql()`delete from tasks where owner_id = ${owner}`;
    await sql()`delete from bridge_runs where owner_id = ${owner}`;
    await sql()`delete from api_tokens where owner_id = ${owner}`;
    await sql()`delete from connections where owner_id = ${owner}`;
    tok = await repo.createApiToken(owner, "mini", "bridge");
    client = await repo.createApiToken(owner, "Claude", "client");
    await repo.upsertBridgeConnections(owner, "mini", [{ name: "claude.ai Slack", ok: true }, { name: "clickup", ok: true }]);
  });
  afterAll(async () => { vi.restoreAllMocks(); await sql().end({ timeout: 2 }); });

  it("v1 bez zmian: /work bez sends i work, bieg ze starym promptem i bez tokenu biegu, zatwierdzony szkic liczy się do pracy", async () => {
    const a = await approved("Mostek v1: opis w ClickUp", "clickup", [draft({ app: "clickup", action: "update", where: "lista Backlog" }, "Opis")]);
    const w = await (await getWork("?host=mini&state=idle&v=1")).json();
    expect(Object.keys(w).sort()).toEqual(["counts", "ok", "pending", "pollMs", "run", "time", "version"]);
    expect(w.version).toBe(1); expect(w.counts.approved).toBe(1); expect(w.pending).toBeGreaterThanOrEqual(1);
    const r = await postRun({ bridge: "mini" });
    expect(r.status).toBe(200);
    const b = await r.json();
    expect(Object.keys(b).sort()).toEqual(["maxMinutes", "mcp", "prompt", "run", "staleMinutes"]);
    expect(b.prompt).toBe(bridgePrompt()); expect(b.run.kind).toBe("work");
    expect((await patch(b.run.id, { outcome: "done", note: "ok" })).status).toBe(200);
    expect(repo.isSendable(await step(a.taskId, a.stepId))).toBe(true);   // bieg v1 nie rusza zgody
    await sql()`delete from tasks where id = ${a.taskId}`;
  });

  it("v2 bieg pracy: token biegu (zakres work), prompt bez wysyłek; token biegu nie działa na /api/bridge; stopped kończy bieg i gasi token", async () => {
    const a = await approved("Mostek v2: odpowiedź na Slacku", "slack", [draft({ app: "slack", action: "reply", where: "#dev" }, "Cześć")]);
    await repo.createTask(owner, { title: "Mostek v2: zadanie bez kroków" });
    const w = await (await getWork("?host=mini&v=2")).json();
    expect(w.version).toBe(2); expect(w.sends).toBe(1); expect(w.work).toBeGreaterThanOrEqual(1);
    expect(w.pending).toBe(w.work + w.sends); expect(w.counts.approved).toBe(1);
    const r = await postRun({ bridge: "mini", v: 2, kind: "work" });
    expect(r.status).toBe(200);
    const b = await r.json();
    expect(b.kind).toBe("work"); expect(b.prompt).toBe(bridgeWorkPrompt()); expect(b.prompt).not.toContain("ZATWIERDZONE SZKICE");
    expect(b.token).toMatch(/^th_/); expect(b.token).not.toBe(tok); expect(b.mcp).toMatch(/\/api\/mcp$/);
    const t = await repo.tokenForSecret(b.token);
    expect(t?.kind).toBe("run"); expect(t?.scope).toMatchObject({ kind: "work", runId: b.run.id });
    // Claude Code w biegu pracy nie dostaje szkicu do wysłania
    const lw = await callTool(b.token, "list_work", {});
    expect(lw.text).not.toContain("ZATWIERDZONE SZKICE"); expect(lw.text).not.toContain(a.stepId);
    // token biegu i token klienta nie otwierają punktów wejścia mostka
    expect((await work.GET(new Request("http://x/api/bridge/work?v=2", { headers: H(b.token) }))).status).toBe(401);
    expect((await postRun({ v: 2, kind: "work" }, b.token)).status).toBe(401);
    expect((await postRun({ v: 2, kind: "work" }, client)).status).toBe(401);
    expect(await authBridge(new Request("http://x", { headers: H(b.token) }))).toBeInstanceOf(Response);
    expect((await postRun({ bridge: "mini", v: 2, kind: "send" })).status).toBe(409);   // jeden otwarty bieg na właściciela
    expect((await postRun({ bridge: "mini", v: 2, kind: "zły" })).status).toBe(400);
    expect((await patch(b.run.id, { outcome: "stopped", note: "Piotr zatrzymał" })).status).toBe(200);
    expect((await repo.listBridgeRuns(owner, 1))[0]).toMatchObject({ id: b.run.id, outcome: "stopped", kind: "work" });
    expect(await repo.tokenForSecret(b.token)).toBeNull();
    expect(repo.isSendable(await step(a.taskId, a.stepId))).toBe(true);   // koniec biegu pracy nie rusza zgody
    await sql()`delete from tasks where owner_id = ${owner}`;
  });

  it("v2 wysyłka: najdawniej zatwierdzony szkic, znacznik wysyłki, konektor tej aplikacji; bieg bez potwierdzenia cofa zgodę i nie wraca do tego szkicu", async () => {
    expect((await postRun({ bridge: "mini", v: 2, kind: "send" })).status).toBe(204);   // nic do wysłania
    const a = await approved("Mostek v2: opis w ClickUp", "clickup", [draft({ app: "clickup", action: "update", where: "lista Backlog" }, "Opis")]);
    const b = await approved("Mostek v2: wiadomość na Slacku", "slack", [draft({ app: "slack", action: "send", where: "#dev" }, "Cześć")]);
    await sql()`update steps set approved_at = now() - interval '1 hour' where id = ${a.stepId}`;
    const r1 = await postRun({ bridge: "mini", v: 2, kind: "send" });
    expect(r1.status).toBe(200);
    const s1 = await r1.json();
    expect(s1).toMatchObject({ kind: "send", step: { id: a.stepId, taskId: a.taskId }, target: { app: "clickup", action: "update", where: "lista Backlog" }, maxMinutes: 10, servers: ["clickup"] });
    expect(s1.prompt).toContain(`SZKIC KROKU ${a.stepId}`); expect(s1.git).toBeUndefined();
    expect((await repo.tokenForSecret(s1.token))?.scope).toMatchObject({ kind: "send", runId: s1.run.id, stepId: a.stepId, taskId: a.taskId });
    expect((await step(a.taskId, a.stepId)).sendStartedAt).not.toBeNull();
    const w = await (await getWork("?v=2")).json();
    expect(w.sends).toBe(1);   // zostaje tylko drugi szkic
    // bieg padł bez sygnału: wygasa, zgoda wraca do Piotra z notatką, następny bieg bierze drugi szkic, nie ten sam
    await sql()`update bridge_runs set touched_at = now() - interval '20 minutes' where id = ${s1.run.id}`;
    const r2 = await postRun({ bridge: "mini", v: 2, kind: "send" });
    expect(r2.status).toBe(200);
    const s2 = await r2.json();
    expect(s2.step.id).toBe(b.stepId); expect(s2.servers).toEqual(["claude.ai Slack"]);
    const sa = await step(a.taskId, a.stepId);
    expect(sa).toMatchObject({ status: "draft", approvedAt: null, sendStartedAt: null });
    expect(repo.draftOf(sa)?.status).toBe("proposed");
    expect(await chat(a.taskId)).toContain(repo.unconfirmedSendNote("clickup"));
    expect(await repo.tokenForSecret(s1.token)).toBeNull();
    // Piotr zatrzymał wysyłkę: stopped przyjęte, zgoda cofnięta z notatką, token biegu zgasł
    expect((await patch(s2.run.id, { outcome: "stopped" })).status).toBe(200);
    expect((await step(b.taskId, b.stepId)).approvedAt).toBeNull();
    expect(await chat(b.taskId)).toContain("Wysyłka nie została potwierdzona. Sprawdź w Slack, czy poszło, i zatwierdź ponownie, jeśli trzeba.");
    expect(await repo.tokenForSecret(s2.token)).toBeNull();
    expect((await postRun({ bridge: "mini", v: 2, kind: "send" })).status).toBe(204);   // bez automatycznego ponawiania
    await sql()`delete from tasks where owner_id = ${owner}`;
  });

  it("v2 wysyłka konektorem: Claude Code zamyka krok tokenem wysyłki, koniec biegu nic nie cofa", async () => {
    const a = await approved("Mostek v2: wiadomość do zespołu", "slack", [draft({ app: "slack", action: "send", where: "#dev" }, "Cześć")]);
    const s = await (await postRun({ bridge: "mini", v: 2, kind: "send" })).json();
    expect(s.step.id).toBe(a.stepId);
    expect((await callTool(s.token, "list_tasks", {})).isError).toBe(true);   // tylko narzędzia wysyłki
    const done = await callTool(s.token, "complete_step", { stepId: a.stepId, summary: "Wysłane na #dev.", link: "https://slack.com/archives/C1/p1" });
    expect(done.isError).toBe(false);
    expect((await patch(s.run.id, { outcome: "done", note: "wysłane" })).status).toBe(200);
    const st = await step(a.taskId, a.stepId);
    expect(st.status).toBe("done"); expect(repo.draftOf(st)?.status).toBe("sent");
    expect(await chat(a.taskId)).not.toContain(repo.unconfirmedSendNote("slack"));
    await sql()`delete from tasks where owner_id = ${owner}`;
  });

  it("v2 commit z aplikacji: payload git bez modelu i tokenu, sent zamyka krok z linkiem, tokeny biegu gasną", async () => {
    const a = await approved("Mostek v2: poprawka w kodzie", "code", [
      changes({ repo: "https://github.com/wlrx/app.git" }),
      draft({ app: "github", action: "push", where: "wlrx/app, gałąź feat/x" }, "Popraw A"),
    ]);
    const r = await postRun({ bridge: "mini", v: 2, kind: "send" });
    expect(r.status).toBe(200);
    const s = await r.json();
    expect(s.git).toEqual({ repo: "wlrx/app", branch: "feat/x", message: "Popraw A", files: ["src/a.ts", "README.md"], push: true, diffs: { "src/a.ts": DIFF_A, "README.md": DIFF_R } });
    expect(s.token).toBeUndefined(); expect(s.prompt).toBeUndefined(); expect(s.servers).toBeUndefined();
    const res = await patch(s.run.id, { outcome: "done", sent: { summary: "commit abc1234 na feat/x", link: "https://github.com/wlrx/app/commit/abc1234" } });
    expect(await res.json()).toEqual({ ok: true, sent: true });
    const st = await step(a.taskId, a.stepId);
    expect(st.status).toBe("done"); expect(st.link).toBe("https://github.com/wlrx/app/commit/abc1234"); expect(st.report).toBe("commit abc1234 na feat/x");
    expect(repo.draftOf(st)?.status).toBe("sent");
    expect((await sql()`select count(*)::int as n from api_tokens where kind = 'run' and scope->>'runId' = ${s.run.id}`)[0].n).toBe(0);
    await sql()`delete from tasks where owner_id = ${owner}`;
  });

  it("v2 commit zgłoszony po wycofaniu zgody: krok nie zamyka się, Piotr dostaje notatkę, że coś poszło", async () => {
    const a = await approved("Mostek v2: commit po zatrzymaniu", "code", [changes(), draft({ app: "github", action: "commit", where: "wlrx/app" }, "Popraw B")]);
    const s = await (await postRun({ bridge: "mini", v: 2, kind: "send" })).json();
    expect(s.git).toMatchObject({ repo: "wlrx/app", push: false });
    await repo.clearApproval(owner, a.stepId);   // Piotr cofnął zgodę w trakcie
    expect(await (await patch(s.run.id, { outcome: "done", sent: { summary: "commit abc1234 na feat/x", link: "javascript:alert(1)" } })).json()).toEqual({ ok: true, sent: false });
    expect((await step(a.taskId, a.stepId)).status).not.toBe("done");
    expect((await chat(a.taskId)).some((t) => t.startsWith("Mostek zgłosił wysyłkę (commit abc1234 na feat/x), ale zgoda na ten szkic była już wycofana. Sprawdź w GitHub"))).toBe(true);
    const [m] = await sql()`select actions from chat_messages where task_id = ${a.taskId} and text like 'Mostek zgłosił%'`;
    expect((m.actions as { link?: string }).link).toBeUndefined();
    await sql()`delete from tasks where owner_id = ${owner}`;
  });

  it("v2 wysyłka niemożliwa z tego Maca: 422, bieg nie rusza, zgoda wraca do Piotra z notatką, którego konektora brakuje", async () => {
    const a = await approved("Mostek v2: mail do klienta", "gmail", [draft({ app: "gmail", action: "reply", where: "anna@firma.pl" }, "Dzień dobry")]);
    const r = await postRun({ bridge: "mini", v: 2, kind: "send" });
    expect(r.status).toBe(422);
    const e = await r.json();
    expect(e.error).toContain("nie ma działającego konektora E-mail");
    expect((await repo.bridgeStatus(owner, 0)).run).toBeNull();
    const st = await step(a.taskId, a.stepId);
    expect(st).toMatchObject({ status: "draft", approvedAt: null, sendStartedAt: null });
    expect(await chat(a.taskId)).toContain(e.error);
    // commit bez bloku zmian: też 422
    const g = await approved("Mostek v2: push bez zmian", "code", [draft({ app: "github", action: "push", where: "wlrx/app" }, "x")]);
    const rg = await postRun({ bridge: "mini", v: 2, kind: "send" });
    expect(rg.status).toBe(422); expect((await rg.json()).error).toMatch(/bloku zmian/);
    expect((await step(g.taskId, g.stepId)).approvedAt).toBeNull();
    await sql()`delete from tasks where owner_id = ${owner}`;
  });

  it("v2 wysyłka szkicu, który nie wychodzi poza Task Hub (dokument): zgoda kończy krok bez biegu, bierze następny szkic", async () => {
    const doc = await approved("Mostek v2: notatka w dokumencie", "claude", [draft({ app: "claude", action: "other" }, "Notatka")]);
    await sql()`update steps set approved_at = now() - interval '1 hour' where id = ${doc.stepId}`;
    const sl = await approved("Mostek v2: wiadomość po notatce", "slack", [draft({ app: "slack", action: "send", where: "#dev" }, "Cześć")]);
    const r = await postRun({ bridge: "mini", v: 2, kind: "send" });
    expect(r.status).toBe(200);
    expect((await r.json()).step.id).toBe(sl.stepId);
    const st = await step(doc.taskId, doc.stepId);
    expect(st.status).toBe("done"); expect(repo.draftOf(st)?.status).toBe("sent");
    await sql()`delete from bridge_runs where owner_id = ${owner}`;
    await sql()`delete from tasks where owner_id = ${owner}`;
  });

  it("aktualizacja aplikacji: wersja, adresy pobrania w Task Hub, suma z pliku .sha256; token GitHuba nigdy w odpowiedzi; nigdy 404", async () => {
    const prev = process.env.GITHUB_RELEASES_TOKEN;
    process.env.GITHUB_RELEASES_TOKEN = "ghs_tajny";
    try {
      const gh = fakeGitHub();
      const r = await app.GET(new Request("http://x/api/bridge/app", { headers: H(tok) }));
      expect(r.status).toBe(200);
      const raw = await r.text();
      expect(raw).not.toContain("ghs_tajny");
      expect(JSON.parse(raw)).toMatchObject({ version: "0.1.7", tag: "app-v0.1.7", notes: "Nowości", zip: { url: "/api/bridge/app/download?asset=11", sha256: HEX }, pkg: { url: "/api/bridge/app/download?asset=13" } });
      expect(JSON.parse(raw).pkg.sha256).toBeUndefined();
      expect(gh.calls.find((c) => c.url.startsWith("https://objects.example/"))?.auth).toBeNull();   // podpisany adres bez tokenu
      expect((await app.GET(new Request("http://x/api/bridge/app", { headers: H(client) }))).status).toBe(401);
      const d = await download.GET(new Request("http://x/api/bridge/app/download?asset=11", { headers: H(tok) }));
      expect(d.status).toBe(302); expect(d.headers.get("location")).toBe("https://objects.example/11?sig=abc");
      expect((await download.GET(new Request("http://x/api/bridge/app/download?asset=11", { headers: H(client) }))).status).toBe(401);
      vi.restoreAllMocks();
      fakeGitHub({ latest: 200, tag: "v9" });   // „latest” to nie wydanie aplikacji: szuka app-v… na liście
      expect((await (await app.GET(new Request("http://x/api/bridge/app", { headers: H(tok) }))).json()).version).toBe("0.1.7");
      vi.restoreAllMocks();
      fakeGitHub({ latest: 404 });   // prywatne repozytorium bez tokenu: 502, nie 404 (404 to dla aplikacji starszy serwer)
      expect((await app.GET(new Request("http://x/api/bridge/app", { headers: H(tok) }))).status).toBe(502);
    } finally {
      vi.restoreAllMocks();
      if (prev === undefined) delete process.env.GITHUB_RELEASES_TOKEN; else process.env.GITHUB_RELEASES_TOKEN = prev;
    }
  });
});
