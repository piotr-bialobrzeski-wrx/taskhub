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
    await sql()`delete from api_tokens where owner_id = ${owner}`;
  });
  afterAll(async () => { await sql().end({ timeout: 2 }); });

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
