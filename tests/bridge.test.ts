// Mostek na komputerze: skrypt (czyste funkcje) i serwer (token mostka, puls, biegi, punkty wejścia /api/bridge). Część z bazą pomijana bez TEST_DATABASE_URL.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { parseLimit, parseAuth, claudeArgs, loadConfig, plistFor, runnerCommand, parseArgs, runProcess, writeMcpConfig, permissionMode, ALLOWED_TOOLS } from "../public/bridge/taskhub-bridge.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DB = !!process.env.TEST_DATABASE_URL;

describe("mostek: skrypt", () => {
  it("rozpoznaje limit subskrypcji i czas odblokowania", () => {
    expect(parseLimit("You've hit your usage limit · resets at 3pm").limit).toBe(true);
    expect(parseLimit("Claude AI usage limit reached|1760630400").reset_at).toBe(1760630400000);
    expect(parseLimit("zwykły błąd").limit).toBe(false);
  });
  it("rozpoznaje wylogowany Claude Code", () => {
    expect(parseAuth("Not logged in · Please run /login")).toBe(true);
    expect(parseAuth("OAuth token has expired")).toBe(true);
    expect(parseAuth("ok")).toBe(false);
  });
  it("argumenty claude: prompt, stream-json, dontAsk z listą narzędzi, konektor Task Hub z pliku 0600 (token nigdy w argumentach)", () => {
    const cfg = loadConfig({ url: "https://x.app/", token: "th_1" }, {}, {});
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "th-run-"));
    const file = writeMcpConfig(path.join(dir, "run"), "bieg-1", "https://x.app/api/mcp", "th_run");
    const a = claudeArgs("PROMPT", cfg, file);
    expect(a.slice(0, 2)).toEqual(["-p", "PROMPT"]);
    expect(a).toContain("stream-json");
    expect(a[a.indexOf("--permission-mode") + 1]).toBe("dontAsk");
    expect(a[a.indexOf("--mcp-config") + 1]).toBe(file);
    expect(a).toContain("--strict-mcp-config");
    expect(a[a.indexOf("--allowedTools") + 1].split(",")).toEqual(ALLOWED_TOOLS);
    expect(a[a.indexOf("--disallowedTools") + 1].split(",")).toEqual(expect.arrayContaining(["Bash", "Edit", "Write"]));
    expect(a.join(" ")).not.toMatch(/th_1|th_run|bypassPermissions/);
    expect(JSON.parse(fs.readFileSync(file, "utf8")).mcpServers["task-hub"]).toEqual({ type: "http", url: "https://x.app/api/mcp", headers: { Authorization: "Bearer th_run" } });
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(fs.statSync(path.dirname(file)).mode & 0o777).toBe(0o700);
    fs.rmSync(dir, { recursive: true, force: true });
    expect(cfg.url).toBe("https://x.app");
    expect(cfg.runner).toBe("claude");
  });
  it("tryb uprawnień: bypassPermissions ze starego config.json albo argumentu zamienia się na dontAsk", () => {
    expect(loadConfig({}, {}, { url: "https://x.app", token: "t", permission: "bypassPermissions" }).permission).toBe("dontAsk");
    expect(loadConfig({ permission: "bypassPermissions" }, {}, {}).permission).toBe("dontAsk");
    expect(permissionMode("acceptEdits")).toBe("dontAsk");
    expect(permissionMode("plan")).toBe("plan");
    expect(loadConfig({}, {}, {}).permission).toBe("dontAsk");
  });
  it("własny silnik (np. Codex) dostaje prompt, adres i plik konfiguracji przez podstawienie, token tylko w zmiennej środowiska", () => {
    const cfg = loadConfig({}, {}, { url: "https://x.app", token: "th_2", runner: "command", command: ["codex", "exec", "--full-auto", "{prompt}"] });
    expect(runnerCommand(cfg, "P", "https://x.app/api/mcp")).toEqual({ bin: "codex", args: ["exec", "--full-auto", "P"], json: false });
    expect(runnerCommand({ ...cfg, command: ["eng", "--mcp", "{mcpConfig}", "{prompt}"] }, "P", "m", "/r/1-mcp.json").args).toEqual(["--mcp", "/r/1-mcp.json", "P"]);
    expect(() => runnerCommand({ ...cfg, command: ["eng", "--token", "{token}"] }, "P", "m")).toThrow(/TASKHUB_MCP_TOKEN/);   // token nie idzie w argumentach
    expect(() => runnerCommand({ ...cfg, command: null }, "P", "m")).toThrow(/silnik/);
  });
  it("usługa launchd woła node bezpośrednio, startuje po zalogowaniu, bez klucza API", () => {
    const p = plistFor({ node: "/opt/homebrew/bin/node", script: "/Users/x/taskhub-bridge.mjs", log: "/Users/x/Library/Logs/t.log", dir: "/Users/x/.taskhub-bridge" });
    expect(p).toContain("<string>/opt/homebrew/bin/node</string>");
    expect(p).toContain("<key>KeepAlive</key><true/>");
    expect(p).not.toContain("ANTHROPIC_API_KEY");
  });
  it("bieg claude: czyta stream-json, przekazuje użycia narzędzi, bierze wynik z ostatniego zdarzenia", async () => {
    const steps: string[] = [];
    const fake = path.join(__dirname, "fixtures", "fake-claude.sh");
    const r = await runProcess("sh", [fake], { cwd: __dirname, onStep: (s) => steps.push(s), maxMs: 20_000, json: true });
    expect(r).toEqual({ ok: true, reply: "Rozpisałem zadanie na 3 kroki i zrobiłem research." });
    expect(steps).toEqual(["list_work", "add_steps: abc"]);
    const bad = await runProcess("sh", [fake, "limit"], { cwd: __dirname, onStep: () => {}, maxMs: 20_000, json: true });
    expect(bad.ok).toBe(false); expect(parseLimit(bad.error).limit).toBe(true);
    const missing = await runProcess("/nie/ma/takiego/claude", [], { cwd: __dirname, onStep: () => {}, maxMs: 5_000, json: true });
    expect(missing.ok).toBe(false); expect(missing.error).toMatch(/nie znaleziono/);
  });
  it("argumenty wiersza poleceń", () => {
    expect(parseArgs(["--install", "--url", "https://a", "--once"])).toMatchObject({ install: true, url: "https://a", once: true });
  });
});

describe.skipIf(!DB)("mostek: serwer", async () => {
  const repo = await import("@/lib/repo");
  const { sql } = await import("@/lib/db");
  const { workSummary } = await import("@/lib/agent/work");
  const work = await import("@/app/api/bridge/work/route");
  const run = await import("@/app/api/bridge/run/route");
  const runId = await import("@/app/api/bridge/run/[id]/route");
  let owner = "";
  beforeAll(async () => {
    owner = (await repo.ensureOwner()).id;
    await sql()`delete from bridge_runs where owner_id = ${owner}`;
    await sql()`delete from api_tokens where owner_id = ${owner}`;
  });
  afterAll(async () => { await sql().end({ timeout: 2 }); });

  it("token mostka: rodzaj, puls przy każdym użyciu, status żywy albo nie", async () => {
    const t = await repo.createApiToken(owner, "MacBook", "bridge");
    const c = await repo.createApiToken(owner, "Claude", "client");
    expect((await repo.tokenForSecret(c))?.kind).toBe("client");
    expect((await repo.bridgeStatus(owner, 120_000)).alive).toBe(false);   // jeszcze nieużyty
    const a = await repo.tokenForSecret(t);
    expect(a?.kind).toBe("bridge");
    const st = await repo.bridgeStatus(owner, 120_000);
    expect(st.alive).toBe(true); expect(st.name).toBe("MacBook");
    expect((await repo.bridgeStatus(owner, 0)).alive).toBe(false);
    await repo.bridgeSeen(a!.id, { state: "limit", host: "mbp" });
    expect((await repo.bridgeStatus(owner, 120_000)).meta).toMatchObject({ state: "limit", host: "mbp" });
    expect((await repo.listApiTokens(owner)).find((x) => x.name === "MacBook")?.kind).toBe("bridge");
  });
  it("jeden otwarty bieg: drugi komputer dostaje odmowę, zakończony zwalnia, zawieszony wygasa", async () => {
    const r1 = await repo.startBridgeRun(owner, null, "A");
    expect(r1).not.toBeNull();
    expect(await repo.startBridgeRun(owner, null, "B")).toBeNull();
    expect(await repo.touchBridgeRun(owner, r1!.id, "add_steps")).toBe(true);
    expect((await repo.bridgeStatus(owner, 0)).run?.note).toBe("add_steps");
    expect(await repo.endBridgeRun(owner, r1!.id, "done", "zrobione")).toBe(true);
    expect(await repo.endBridgeRun(owner, r1!.id, "done")).toBe(false);
    const r2 = await repo.startBridgeRun(owner, null, "B");
    expect(r2).not.toBeNull();
    await sql()`update bridge_runs set touched_at = now() - interval '20 minutes' where id = ${r2!.id}`;
    expect(await repo.expireBridgeRuns(owner, 15)).toBe(1);
    expect((await repo.listBridgeRuns(owner)).map((r) => r.outcome)).toEqual(["stale", "done"]);
  });
  it("lista pracy: zadanie bez kroków to praca; podgląd mostka nie oznacza odpowiedzi jako odczytanych", async () => {
    const t = await repo.createTask(owner, { title: "Mostek test: zadanie bez kroków" });
    const q = await repo.askQuestion(owner, { taskId: t.id, stepId: null, text: "Które?", options: undefined, recommended: null });
    await repo.answerQuestion(owner, q.id, "pierwsze");
    const w = await workSummary(owner, { peek: true });
    expect(w.total).toBeGreaterThanOrEqual(1);
    expect(w.counts.answered).toBe(1);
    expect((await workSummary(owner, { peek: true })).counts.answered).toBe(1);   // nadal nieodczytana
    const full = await workSummary(owner);
    expect(full.text).toContain("ODPOWIEDZI PIOTRA");
    expect((await workSummary(owner, { peek: true })).counts.answered).toBe(0);  // list_work oznaczył
    await sql()`delete from tasks where id = ${t.id}`;
  });
  it("wiadomość Piotra w zadaniu to praca na początku listy; odpowiedź agenta w aplikacji nie czeka; stempel zmian rośnie", async () => {
    const t = await repo.createTask(owner, { title: "Mostek test: wiadomość", steps: [{ title: "Krok" }] });
    const s0 = await repo.changeStamp(owner, t.id);
    await repo.addChat(owner, t.id, "user", "Dodaj jeszcze ship date z godziną");
    await repo.addChat(owner, t.id, "agent", "Przekazałem mostkowi.");
    const w = await workSummary(owner, { peek: true });
    expect(w.counts.chat).toBe(1);
    expect(w.text.startsWith("WIADOMOŚCI PIOTRA")).toBe(true);                // przed krokami i zadaniami bez kroków
    expect(w.text).toContain("ship date");
    expect((await repo.listUnseenChat(owner)).map((m) => m.taskTitle)).toContain("Mostek test: wiadomość");
    await workSummary(owner);                                                  // list_work bez peek oznacza jako przeczytane
    expect((await workSummary(owner, { peek: true })).counts.chat).toBe(0);
    await repo.addChat(owner, t.id, "user", "Dzięki", undefined, { seen: true });  // agent w aplikacji odpowiedział od razu
    expect((await workSummary(owner, { peek: true })).counts.chat).toBe(0);
    expect(await repo.changeStamp(owner, t.id)).not.toBe(s0);
    await sql()`delete from tasks where id = ${t.id}`;
  });
  it("stany wiadomości: czeka → wzięta w biegu → odpowiedziano; bieg bez odpowiedzi oddaje ją do kolejki; wzięta dawno temu liczy się jako nowa", async () => {
    await sql()`delete from bridge_runs where owner_id = ${owner}`;
    const t = await repo.createTask(owner, { title: "Mostek test: stany", steps: [{ title: "Krok" }] });
    const m1 = await repo.addChat(owner, t.id, "user", "Dodaj ship date");
    const m2 = await repo.addChat(owner, t.id, "user", "I numer partii");
    expect((await repo.listPendingChat(owner, t.id)).map((m) => m.id)).toEqual([m1, m2]);
    expect((await repo.countPendingChat(owner)).get(t.id)).toBe(2);
    const r = await repo.startBridgeRun(owner, null, "Mac");
    const w = await workSummary(owner);                                         // list_work: obie wzięte do opracowania w tym biegu
    expect(w.text).toContain(`wiadomość [${m1}]`);
    expect((await repo.listUnseenChat(owner)).length).toBe(0);                 // dla następnego list_work już nie są nowe…
    expect((await repo.listPendingChat(owner, t.id)).length).toBe(2);          // …ale wciąż czekają na odpowiedź
    expect(await repo.markChatAnswered(owner, t.id, [m1])).toEqual([m1]);      // reply_chat z messageIds załatwia jedną
    expect((await repo.listPendingChat(owner, t.id)).map((m) => m.id)).toEqual([m2]);
    await repo.endBridgeRun(owner, r!.id, "done");                            // bieg skończył się bez odpowiedzi na drugą: wraca do kolejki
    expect((await repo.listUnseenChat(owner)).map((m) => m.id)).toEqual([m2]);
    await sql()`update chat_messages set seen_at = now() - interval '100 minutes' where id = ${m2}`;   // wzięta dawno, bez odpowiedzi (bieg padł bez sygnału)
    expect((await repo.listUnseenChat(owner)).map((m) => m.id)).toEqual([m2]);
    await sql()`update chat_messages set seen_at = now() - interval '10 minutes' where id = ${m2}`;
    expect((await repo.listUnseenChat(owner)).length).toBe(0);
    expect(await repo.markChatAnswered(owner, t.id)).toEqual([m2]);          // reply_chat bez messageIds: wszystkie dotychczasowe
    expect(await repo.markChatAnswered(owner, t.id)).toEqual([]);
    expect((await repo.countPendingChat(owner)).has(t.id)).toBe(false);
    await sql()`delete from tasks where id = ${t.id}`;
  });
  it("zadanie nie zamyka się samo, dopóki wiadomość Piotra czeka na odpowiedź; po reply_chat zamyka się", async () => {
    const t = await repo.createTask(owner, { title: "Mostek test: zamknięcie", steps: [{ title: "Jedyny krok" }] });
    await repo.addChat(owner, t.id, "user", "Jeszcze jedno");
    const full = (await repo.getTask(owner, t.id))!;
    await repo.completeStep(owner, full, full.steps[0], { report: "zrobione" });
    expect((await repo.getTask(owner, t.id))!.doneAt).toBeNull();            // ostatni krok gotowy, ale prośba bez odpowiedzi
    expect((await workSummary(owner, { peek: true })).text).toContain("Jeszcze jedno");   // zadanie z wiadomością nie wypada z listy pracy
    expect(await repo.closeIfDone(owner, t.id)).toBe(false);
    await repo.markChatAnswered(owner, t.id);
    expect(await repo.closeIfDone(owner, t.id)).toBe(true);
    expect((await repo.getTask(owner, t.id))!.doneAt).not.toBeNull();
    expect(await repo.closeIfDone(owner, t.id)).toBe(false);                  // już zamknięte
    // agent dopisuje kroki do zamkniętego zadania: wraca do pracy, a zatwierdzony (kliknięciem Piotra) szkic trafia do listy pracy starego mostka
    const [pub] = await repo.addSteps(t.id, [{ title: "Opublikuj opis", tool: "clickup", needsApproval: true }]);
    expect((await repo.getTask(owner, t.id))!.doneAt).toBeNull();
    await repo.updateStep(pub.id, { status: "draft", blocks: [{ type: "draft", target: { app: "clickup", action: "update" }, body: "x", status: "proposed" }] });
    expect(await repo.approveDraft(owner, pub.id)).toBe(true);
    expect((await workSummary(owner, { peek: true })).text).toContain("ZATWIERDZONE SZKICE DO WYSŁANIA");
    // zatwierdzony szkic, przed którym jest niezrobiony krok, czeka z wysyłką
    const [pre] = await repo.addSteps(t.id, [{ title: "Najpierw to", tool: "clickup" }]);
    await sql()`insert into step_dependencies (step_id, depends_on_id) values (${pub.id}, ${pre.id})`;
    const w = (await workSummary(owner, { peek: true })).text;
    expect(w).toContain("ZATWIERDZONE, ALE CZEKAJĄ NA KROKI PRZED NIMI");
    expect(w).not.toContain("ZATWIERDZONE SZKICE DO WYSŁANIA");
    await sql()`delete from tasks where id = ${t.id}`;
  });
  it("punkty wejścia mostka: 401 bez tokenu mostka, puls + liczba pracy, bieg na wyłączność, zakończenie", async () => {
    await sql()`delete from bridge_runs where owner_id = ${owner}`;
    const t = await repo.createApiToken(owner, "Mac mini", "bridge");
    const c = await repo.createApiToken(owner, "klient", "client");
    const H = (tok: string) => ({ Authorization: `Bearer ${tok}` });
    expect((await work.GET(new Request("http://x/api/bridge/work"))).status).toBe(401);
    expect((await work.GET(new Request("http://x/api/bridge/work", { headers: H(c) }))).status).toBe(401);
    const task = await repo.createTask(owner, { title: "Mostek test: praca dla biegu" });
    const w = await (await work.GET(new Request("http://x/api/bridge/work?host=mini&state=idle", { headers: H(t) }))).json();
    expect(w.ok).toBe(true); expect(w.pending).toBeGreaterThanOrEqual(1); expect(w.run).toBeNull(); expect(w.pollMs).toBeGreaterThan(0);
    expect((await repo.bridgeStatus(owner, 120_000)).meta).toMatchObject({ host: "mini", state: "idle" });
    const r = await run.POST(new Request("http://x/api/bridge/run", { method: "POST", headers: H(t), body: JSON.stringify({ bridge: "mini" }) }));
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.prompt).toContain("list_work"); expect(body.mcp).toMatch(/\/api\/mcp$/); expect(body.run.bridge).toBe("mini");
    const again = await run.POST(new Request("http://x/api/bridge/run", { method: "POST", headers: H(t), body: "{}" }));
    expect(again.status).toBe(409);
    const ctx = { params: Promise.resolve({ id: body.run.id as string }) };
    expect((await runId.PATCH(new Request("http://x/api/bridge/run/x", { method: "PATCH", headers: H(t), body: JSON.stringify({ note: "get_task" }) }), ctx)).status).toBe(200);
    expect((await runId.PATCH(new Request("http://x/api/bridge/run/x", { method: "PATCH", headers: H(t), body: JSON.stringify({ outcome: "done", note: "gotowe" }) }), ctx)).status).toBe(200);
    expect((await runId.PATCH(new Request("http://x/api/bridge/run/x", { method: "PATCH", headers: H(t), body: JSON.stringify({ outcome: "done" }) }), ctx)).status).toBe(404);
    const w2 = await (await work.GET(new Request("http://x/api/bridge/work", { headers: H(t) }))).json();
    expect(w2.run).toBeNull();
    await sql()`delete from tasks where id = ${task.id}`;
  });
});
