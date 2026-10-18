// Testy warstwy danych na prawdziwym Postgresie (TEST_DATABASE_URL). Pomijane, gdy bazy nie ma.
import { describe, it, expect, beforeAll, afterAll } from "vitest";

const DB = !!process.env.TEST_DATABASE_URL;

describe.skipIf(!DB)("repo", async () => {
  const repo = await import("@/lib/repo");
  const { sql } = await import("@/lib/db");
  let owner = "";
  beforeAll(async () => {
    owner = (await repo.ensureOwner()).id;
    await sql()`delete from tasks where owner_id = ${owner}`;
    await sql()`delete from projects where owner_id = ${owner}`;
    await sql()`delete from rules where owner_id = ${owner}`;
    await sql()`delete from rule_versions where owner_id = ${owner}`;
    await sql()`delete from companies where owner_id = ${owner}`;
    await sql()`delete from connections where owner_id = ${owner}`;
    await sql()`delete from api_tokens where owner_id = ${owner}`;
  });

  it("rejestr połączeń: mostek dopisuje swoje konektory, przejmuje firmę z ręcznego wpisu, gasi te, których już nie widzi; krok wskazuje połączenie", async () => {
    const c = await repo.createCompany(owner, "Firma X");
    const manual = await repo.createConnection(owner, { label: "Slack", account: "firma-x.slack.com", companyId: c.id, provider: "claude" });
    expect(manual).toMatchObject({ app: "slack", sphere: "work", source: "manual", state: "active", kind: "mcp" });
    const r1 = await repo.upsertBridgeConnections(owner, "MacBook", [{ name: "slack", url: "https://mcp.slack.com/mcp", transport: "HTTP", ok: true }, { name: "gmail", ok: false, status: "Needs authentication" }, { name: "task-hub", url: "https://taskhub.example/api/mcp", ok: true }]);
    expect(r1).toEqual({ added: 2, updated: 0, off: 0 });
    let list = await repo.listConnections(owner);
    const bslack = list.find((x) => x.source === "bridge" && x.app === "slack")!, bgmail = list.find((x) => x.source === "bridge" && x.app === "gmail")!;
    expect(bslack).toMatchObject({ companyId: c.id, sphere: "work", provider: "claude-code", host: "MacBook", state: "active", url: "https://mcp.slack.com/mcp" });   // firma z ręcznego wpisu o tej samej nazwie
    expect(bgmail).toMatchObject({ state: "expired", companyId: null });
    expect(list.some((x) => x.app === "taskhub")).toBe(false);   // własny konektor nie jest „połączeniem”
    await repo.updateConnection(owner, bgmail.id, { label: "Gmail firmowy", account: "piotr@firma-x.pl" });   // etykieta zmieniona ręcznie zostaje, mostek dopasowuje po nazwie serwera
    const r2 = await repo.upsertBridgeConnections(owner, "MacBook", [{ name: "gmail", ok: true }]);
    expect(r2).toEqual({ added: 0, updated: 1, off: 1 });
    expect((await repo.listConnections(owner)).find((x) => x.id === bgmail.id)).toMatchObject({ label: "Gmail firmowy", account: "piotr@firma-x.pl", state: "active" });
    list = await repo.listConnections(owner);
    expect(list.find((x) => x.id === bslack.id)?.state).toBe("off");
    expect(list.find((x) => x.id === bgmail.id)?.state).toBe("active");
    expect((await repo.findConnection(owner, "SLACK"))?.id).toBe(manual.id);   // nazwa bez wielkości liter; działające przed wygaszonymi
    expect((await repo.findConnection(owner, bslack.id))?.id).toBe(bslack.id);
    const t = await repo.createTask(owner, { title: "Z połączeniem", steps: [{ title: "Napisz na Slacku", tool: "slack", connectionId: manual.id }] });
    expect(t.steps[0].connectionId).toBe(manual.id);
    await repo.updateStep(t.steps[0].id, { connectionId: null });
    expect((await repo.getTask(owner, t.id))!.steps[0].connectionId).toBeNull();
    await repo.updateStep(t.steps[0].id, { connectionId: bgmail.id });
    await repo.deleteConnection(owner, bgmail.id);   // krok zostaje, traci wskazanie
    expect((await repo.getTask(owner, t.id))!.steps[0].connectionId).toBeNull();
    await repo.purgeTask(owner, t.id);
    await repo.deleteCompany(owner, c.id);
  });

  it("firmy nad projektami: zasada firmy i pochodzenie; usunięcie firmy zostawia projekty jako prywatne, zabiera jej zasady", async () => {
    const c = await repo.createCompany(owner, "Pirxey & Widelab", "work", "jedna firma, dwa brandy");
    expect(await repo.findCompanyByName(owner, "pirxey & widelab")).toMatchObject({ id: c.id, sphere: "work", note: "jedna firma, dwa brandy" });
    const p = await repo.createProject(owner, "Shiftwow", 4, c.id);
    expect((await repo.listProjects(owner)).find((x) => x.id === p.id)?.companyId).toBe(c.id);
    const r = await repo.upsertRule(owner, { kind: "profile", scope: "company", companyId: c.id, title: "Firma", body: "Dwa brandy", originCompanyId: c.id });
    expect(await repo.findRule(owner, { scope: "company", companyId: c.id, title: "firma" })).toMatchObject({ id: r.id, companyId: c.id, originCompanyId: c.id });
    expect(repo.rulesFor(await repo.listRules(owner), p.id, [], c.id).map((x) => x.id)).toContain(r.id);
    expect(repo.rulesFor(await repo.listRules(owner), p.id, [], null).map((x) => x.id)).not.toContain(r.id);
    await repo.updateCompany(owner, c.id, { sphere: "private", endedAt: new Date().toISOString() });
    expect((await repo.listCompanies(owner)).find((x) => x.id === c.id)).toMatchObject({ sphere: "private" });
    expect((await repo.listCompanies(owner)).find((x) => x.id === c.id)?.endedAt).not.toBeNull();
    await repo.deleteCompany(owner, c.id);
    expect((await repo.listProjects(owner)).find((x) => x.id === p.id)?.companyId).toBeNull();
    expect((await repo.listRules(owner)).find((x) => x.id === r.id)).toBeUndefined();
    await repo.deleteProject(owner, p.id);
  });
  afterAll(async () => { await sql().end({ timeout: 2 }); });

  it("kafelek należy do jednej grupy: nowa grupa i zmiana składu zabierają go z poprzedniej", async () => {
    const a = await repo.createTask(owner, { title: "Grupowe A" }), b = await repo.createTask(owner, { title: "Grupowe B" }), c = await repo.createTask(owner, { title: "Grupowe C" });
    const g1 = await repo.createGroup(owner, null, "Pierwsza", [a.id, b.id]);       // automatyczna (bez prostokąta)
    expect(g1.auto).toBe(true);
    const g2 = await repo.createGroup(owner, null, "Druga", [b.id, c.id], { x: 10, y: 20, w: 300, h: 200 });
    const after = await repo.listGroups(owner, null);
    expect(after.find((g) => g.id === g1.id)!.members).toEqual([a.id]);
    expect(after.find((g) => g.id === g2.id)!.members).toEqual([b.id, c.id]);
    await repo.updateGroup(owner, g1.id, { members: [a.id, c.id], auto: false, x: 0, y: 0, w: 100, h: 100 });
    const again = await repo.listGroups(owner, null);
    expect(again.find((g) => g.id === g2.id)!.members).toEqual([b.id]);
    expect(again.find((g) => g.id === g1.id)!.auto).toBe(false);
    for (const g of again) await repo.deleteGroup(owner, g.id);
  });

  it("zadanie z krokami i zależnościami po indeksie; kolejność kroków", async () => {
    const t = await repo.createTask(owner, { title: "Wysłać ofertę", summary: "cel", level: 4, steps: [
      { title: "Zebrać dane", tool: "clickup", estMin: 20 },
      { title: "Napisać mail", tool: "gmail", needsApproval: true, dependsOn: ["n1"] },
      { title: "Wysłać", tool: "manual", dependsOn: ["n2"] },
    ] });
    expect(t.steps.map((s) => s.title)).toEqual(["Zebrać dane", "Napisać mail", "Wysłać"]);
    expect(t.steps[0].estMin).toBe(15);              // zaokrąglenie do kwantu
    expect(t.steps[1].dependsOn).toEqual([t.steps[0].id]);
    expect(t.steps[1].needsApproval).toBe(true);
    const more = await repo.addSteps(t.id, [{ title: "Follow-up", dependsOn: [t.steps[2].id] }]);
    expect(more[0].dependsOn).toEqual([t.steps[2].id]);
    expect(more[0].position).toBe(3);
  });

  it("add_steps z before: nowe kroki wchodzą przed wskazany, dziedziczą jego zależności, a on zaczyna zależeć od nich; pierwotny tytuł zostaje", async () => {
    const t = await repo.createTask(owner, { title: "Poprawić ekran", steps: [
      { title: "Analiza" }, { title: "Zmiany w kodzie", dependsOn: ["n1"] }, { title: "Zatwierdź publikację", needsApproval: true, dependsOn: ["n2"] },
    ] });
    const pub = t.steps[2];
    const added = await repo.addSteps(t.id, [{ title: "Adres jednym polem" }, { title: "Ship date", dependsOn: ["n1"] }], { before: pub.id });
    const fresh = (await repo.getTask(owner, t.id))!;
    expect(fresh.steps.map((s) => s.title)).toEqual(["Analiza", "Zmiany w kodzie", "Adres jednym polem", "Ship date", "Zatwierdź publikację"]);
    expect(fresh.steps.map((s) => s.position)).toEqual([0, 1, 2, 3, 4]);
    expect(added[0].dependsOn).toEqual([t.steps[1].id]);              // bez własnych zależności: dziedziczy zależności kroku publikacji
    expect(added[1].dependsOn).toEqual([added[0].id]);                // własne zależności (n1 w paczce) zostają
    expect(fresh.steps[4].dependsOn).toContain(added[1].id);          // publikacja czeka na ostatni z nowych („ogon”)
    expect(fresh.steps[4].dependsOn).not.toContain(added[0].id);      // nie na ten, na który i tak czeka ogon
    await repo.updateTask(owner, t.id, { title: "Poprawić ekran Intake w prototypie", titleOriginal: t.title });
    const r = (await repo.getTask(owner, t.id))!;
    expect(r.title).toBe("Poprawić ekran Intake w prototypie"); expect(r.titleOriginal).toBe("Poprawić ekran");
  });

  it("załącznik z danymi: adres /api/files/<id>, lista bez danych, plik tylko dla właściciela", async () => {
    const t = await repo.createTask(owner, { title: "Z załącznikiem" });
    const png = Buffer.from("89504e470d0a1a0a", "hex");
    const a = await repo.addAttachment({ taskId: t.id }, { kind: "image", name: "zrzut.png", mime: "image/png", keep: true, data: png });
    expect(a.url).toBe(`/api/files/${a.id}`);
    expect((await repo.listAttachments({ taskId: t.id })).map((x) => x.id)).toEqual([a.id]);
    const f = await repo.getAttachmentFile(owner, a.id);
    expect(f?.mime).toBe("image/png"); expect(f?.data.equals(png)).toBe(true); expect(f?.bytes).toBe(png.length);
    expect(await repo.getAttachmentFile("00000000-0000-0000-0000-000000000000", a.id)).toBeNull();
    expect(await repo.updateAttachment(owner, a.id, { caption: "Zrzut", analysis: "Ekran logowania" })).toBe(true);
    expect((await repo.listAttachments({ taskId: t.id }))[0].analysis).toBe("Ekran logowania");
    expect(await repo.countAttachments([t.id])).toEqual({ [t.id]: 1 });
  });

  it("ukończenie kroku loguje czas do nauki, ponowne otwarcie go cofa, ostatni krok zamyka zadanie", async () => {
    const t = await repo.createTask(owner, { title: "Jeden krok", steps: [{ title: "Zrób", tool: "code", estMin: 30 }] });
    const s = t.steps[0];
    await repo.updateStep(s.id, { spentSec: 50 * 60 });
    await repo.completeStep(owner, t, { ...s, spentSec: 50 * 60 }, { report: "Zrobione: https://example.com/x" });
    let fresh = (await repo.getTask(owner, t.id))!;
    expect(fresh.steps[0].status).toBe("done");
    expect(fresh.steps[0].logged).toBe(true);
    expect(fresh.steps[0].output).toContain("Zrobione");
    expect(fresh.doneAt).not.toBeNull();
    let samples = await repo.listSamples(owner);
    expect(samples.find((x) => x.tool === "code")).toMatchObject({ estMin: 30, spentMin: 45 });
    await repo.reopenStep(owner, t.id, fresh.steps[0]);
    fresh = (await repo.getTask(owner, t.id))!;
    expect(fresh.steps[0].status).toBe("todo");
    expect(fresh.doneAt).toBeNull();
    samples = await repo.listSamples(owner);
    expect(samples.find((x) => x.tool === "code")).toBeUndefined();
  });

  it("fakty: podmiana zachowuje przypięte i ukryte po etykiecie", async () => {
    const t = await repo.createTask(owner, { title: "Fakty", steps: [{ title: "k" }] });
    const sid = t.steps[0].id;
    await repo.replaceFacts({ stepId: sid }, [{ label: "Termin", value: "piątek", pinned: false, hidden: false, source: { app: "clickup" } }, { label: "Watchers", value: "7", pinned: false, hidden: false }]);
    const f = await repo.listFacts({ stepId: sid });
    await repo.setFactPreference(f.find((x) => x.label === "Termin")!.id!, { pinned: true });
    await repo.setFactPreference(f.find((x) => x.label === "Watchers")!.id!, { hidden: true });
    await repo.replaceFacts({ stepId: sid }, [{ label: "Termin", value: "sobota", pinned: false, hidden: false }, { label: "Watchers", value: "9", pinned: false, hidden: false }]);
    const g = await repo.listFacts({ stepId: sid });
    expect(g.find((x) => x.label === "Termin")).toMatchObject({ value: "sobota", pinned: true });
    expect(g.find((x) => x.label === "Watchers")).toMatchObject({ hidden: true });
    expect(await repo.factPreferencesText(owner)).toContain("Watchers");
  });

  it("projekty, zasady i wyszukiwanie pełnotekstowe", async () => {
    const p = await repo.createProject(owner, "Klient A", 5);
    expect(await repo.findProjectByName(owner, "klient a")).toMatchObject({ id: p.id, weight: 5 });
    await repo.upsertRule(owner, { scope: "project", projectId: p.id, title: "Język", body: "Po angielsku", visibility: "private" });
    await repo.upsertRule(owner, { scope: "tool", tool: "slack", title: "Slack", body: "Krótko", visibility: "private" });
    await repo.upsertRule(owner, { scope: "global", title: "Styl", body: "Bez emoji", visibility: "private" });
    const rules = await repo.listRules(owner);
    expect(repo.rulesFor(rules, p.id, ["gmail"]).map((r) => r.title).sort()).toEqual(["Język", "Styl"]);
    expect(repo.rulesFor(rules, null, ["slack"]).map((r) => r.title).sort()).toEqual(["Slack", "Styl"]);
    expect(rules.map((r) => r.kind)).toEqual(["rule", "rule", "rule"]);                       // domyślny rodzaj
    // procedura: rodzaj, skrót i wyzwalacz; ta sama nazwa w zakresie = ta sama zasada; każda zmiana zostawia wersję
    const proc = await repo.upsertRule(owner, { kind: "procedure", scope: "global", title: "User story", summary: "Jak pisać story.", trigger: "story, clickup", body: "Wersja 1" });
    expect(await repo.findRule(owner, { scope: "global", title: "user story" })).toMatchObject({ id: proc.id, kind: "procedure", trigger: "story, clickup" });
    expect(await repo.findRule(owner, { scope: "project", projectId: p.id, title: "User story" })).toBeNull();
    await repo.upsertRule(owner, { ...proc, body: "Wersja 2" });
    await repo.upsertRule(owner, { ...proc, body: "Wersja 2" });   // bez zmian: bez nowej wersji
    await repo.deleteRule(owner, proc.id);
    const hist = await repo.listRuleVersions(owner, proc.id);
    expect(hist.map((v) => [v.change, v.body])).toEqual([["deleted", "Wersja 2"], ["updated", "Wersja 2"], ["created", "Wersja 1"]]);
    await repo.createTask(owner, { title: "Zamówić catering na warsztat", source: "Ania prosi o catering na czwartek", projectId: p.id });
    const found = await repo.searchTasks(owner, "catering");
    expect(found.map((t) => t.title)).toContain("Zamówić catering na warsztat");
  });

  it("tokeny MCP: w bazie tylko skrót, token działa raz utworzony", async () => {
    const token = await repo.createApiToken(owner, "test");
    expect(token.startsWith("th_")).toBe(true);
    expect(await repo.ownerForToken(token)).toBe(owner);
    expect(await repo.ownerForToken("th_zly")).toBeNull();
    const [row] = await sql()`select token_hash from api_tokens where owner_id = ${owner} and name = 'test'`;
    expect(row.tokenHash).not.toContain(token);
    const list = await repo.listApiTokens(owner);
    expect(list.find((x) => x.name === "test")?.lastUsedAt).not.toBeNull();
    await repo.deleteApiToken(owner, list[0].id);
  });

  it("kosz: przywracanie i czyszczenie po terminie", async () => {
    const t = await repo.createTask(owner, { title: "Do kosza" });
    await repo.updateTask(owner, t.id, { deletedAt: new Date(Date.now() - 40 * 864e5).toISOString() });
    expect((await repo.listTasks(owner)).some((x) => x.id === t.id)).toBe(false);
    expect((await repo.listTasks(owner, { trash: true })).some((x) => x.id === t.id)).toBe(true);
    expect(await repo.purgeExpired(owner)).toBeGreaterThanOrEqual(1);
    expect(await repo.getTask(owner, t.id)).toBeNull();
  });
  it("pytania agenta: otwarte, odpowiedź, odczyt przez agenta; położenia kafelków", async () => {
    const t = await repo.createTask(owner, { title: "Z pytaniem", steps: [{ title: "Krok" }, { title: "Drugi" }] });
    const q = await repo.askQuestion(owner, { taskId: t.id, stepId: t.steps[0].id, text: "Którą wersję?", options: [{ label: "A" }, { label: "B", note: "szybsza" }], recommended: 1 });
    expect((await repo.listQuestions(owner, { taskId: t.id, open: true })).map((x) => x.id)).toEqual([q.id]);
    await repo.answerQuestion(owner, q.id, "B");
    expect(await repo.listQuestions(owner, { taskId: t.id, open: true })).toEqual([]);
    const unseen = await repo.listQuestions(owner, { answeredUnseen: true });
    expect(unseen.find((x) => x.id === q.id)?.answer).toBe("B");
    await repo.markQuestionsSeen(owner, [q.id]);
    expect((await repo.listQuestions(owner, { answeredUnseen: true })).some((x) => x.id === q.id)).toBe(false);

    await repo.setStepPositions(owner, t.id, [{ id: t.steps[1].id, x: 400, y: 200 }]);
    await repo.setTaskPositions(owner, [{ id: t.id, x: 40, y: 132 }]);
    let fresh = (await repo.getTask(owner, t.id))!;
    expect(fresh.steps[1].pos).toEqual({ x: 400, y: 200 });
    expect(fresh.pos).toEqual({ x: 40, y: 132 });
    await repo.clearStepPositions(owner, t.id);
    fresh = (await repo.getTask(owner, t.id))!;
    expect(fresh.steps[1].pos).toBeNull();
  });

});
