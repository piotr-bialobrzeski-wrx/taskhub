// Paczka 7, punkt 1: czas Claude'a liczy się sam (start_step albo znacznik biegu → zamknięcie), czas Piotra tylko z jego kroków; kto zamknął krok.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Block } from "@/lib/schema";

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/session", async (orig) => ({ ...(await orig<typeof import("@/lib/session")>()), requireOwner: async () => (await import("@/lib/repo")).ensureOwner() }));

describe.skipIf(!process.env.TEST_DATABASE_URL)("czas Claude'a i czas Piotra", async () => {
  const repo = await import("@/lib/repo");
  const { sql } = await import("@/lib/db");
  const run = await import("@/app/api/bridge/run/route");
  const runId = await import("@/app/api/bridge/run/[id]/route");
  const mcp = await import("@/app/api/mcp/route");
  const actions = await import("@/app/actions");
  let owner = "", tok = "", client = "";
  const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
  const q = (text: string): Block => ({ type: "question", text, options: [{ label: "A" }, { label: "B" }], recommended: 0 });
  const lastChat = async (taskId: string) => (await repo.listChat(owner, taskId)).at(-1)?.text;
  const H = (t: string) => ({ Authorization: `Bearer ${t}` });
  const call = async (t: string, name: string, args: Record<string, unknown>) => {
    const r = await mcp.POST(new Request("http://x/api/mcp", { method: "POST", headers: { authorization: `Bearer ${t}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) }));
    const msgs = (await r.text()).split("\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6)));
    const m = msgs.find((x) => x.id === 1);
    return ((m?.result?.content ?? []) as { text?: string }[]).map((c) => c.text ?? "").join("\n") + (m?.error ? m.error.message : "");
  };
  // bieg pracy mostka v2: token biegu, którym Claude Code woła MCP
  const workRun = async () => {
    const open = (await repo.bridgeStatus(owner, 0)).run; if (open) await repo.endBridgeRun(owner, open.id, "done");   // poprzedni test mógł zostawić bieg
    const b = await (await run.POST(new Request("http://x/api/bridge/run", { method: "POST", headers: H(tok), body: JSON.stringify({ bridge: "mini", v: 2, kind: "work" }) }))).json(); expect(b.token).toMatch(/^th_/); return b as { token: string; run: { id: string } };
  };
  const endRun = async (id: string) => runId.PATCH(new Request("http://x/api/bridge/run/x", { method: "PATCH", headers: H(tok), body: JSON.stringify({ outcome: "done" }) }), { params: Promise.resolve({ id }) });
  const step = async (taskId: string, stepId: string) => (await repo.getTask(owner, taskId))!.steps.find((s) => s.id === stepId)!;
  const ago = (col: string, table: string, id: string, min: number) => sql().unsafe(`update ${table} set ${col} = now() - interval '${min} minutes' where id = '${id}'`);

  beforeAll(async () => {
    owner = (await repo.ensureOwner()).id;
    await sql()`delete from tasks where owner_id = ${owner}`;
    await sql()`delete from bridge_runs where owner_id = ${owner}`;
    await sql()`delete from api_tokens where owner_id = ${owner}`;
    await sql()`delete from connections where owner_id = ${owner}`;
    tok = await repo.createApiToken(owner, "mini", "bridge");
    client = await repo.createApiToken(owner, "Claude", "client");
    await repo.upsertBridgeConnections(owner, "mini", [{ name: "claude.ai Slack", ok: true }]);
  });
  afterAll(async () => { await sql().end({ timeout: 2 }); });

  it("start_step → complete_step: czas od startu, zamknął agent, bieg ma znacznik; krok Piotra: jego minuty, zamknął Piotr", async () => {
    const t = await repo.createTask(owner, { title: "Czas biegu", steps: [{ title: "Sprawdź logi", tool: "code" }, { title: "Zadzwoń do Ani", tool: "manual", estMin: 15 }] });
    const [code, manual] = t.steps.map((s) => s.id);
    const b = await workRun();
    expect(await call(b.token, "start_step", { stepId: code })).toBe("Krok w toku.");
    expect((await step(t.id, code)).agentStartedAt).not.toBeNull();
    await ago("agent_started_at", "steps", code, 4);
    await ago("started_at", "bridge_runs", b.run.id, 5);   // bieg trwa od 5 min, krok zaczęty 4 min temu
    expect(await call(b.token, "complete_step", { stepId: code, summary: "ok" })).toContain("Krok zapisany");
    const c = await step(t.id, code);
    expect(c).toMatchObject({ status: "done", doneBy: "agent", agentStartedAt: null, spentSec: 0 });
    expect(c.agentSec).toBeGreaterThanOrEqual(235); expect(c.agentSec).toBeLessThanOrEqual(245);
    expect((await repo.getBridgeRun(owner, b.run.id))?.markAt).not.toBeNull();
    expect(await call(b.token, "complete_step", { stepId: manual, summary: "zadzwoniłem", spentMin: 20 })).toContain("Krok zapisany");
    expect(await step(t.id, manual)).toMatchObject({ status: "done", doneBy: "owner", spentSec: 1200, agentSec: 0 });
    expect((await repo.listSamples(owner)).find((x) => x.tool === "manual")).toMatchObject({ spentMin: 20, who: "owner" });
    await endRun(b.run.id);
  });
  it("bez start_step: od znacznika biegu; start sprzed biegu liczy się od startu biegu; oddanie liczy tylko od start_step", async () => {
    const t = await repo.createTask(owner, { title: "Znacznik biegu", steps: [{ title: "A", tool: "code" }, { title: "B", tool: "code" }, { title: "C", tool: "code" }, { title: "D", tool: "code" }] });
    const [a, bb, c, d] = t.steps.map((s) => s.id);
    const b = await workRun();
    await ago("mark_at", "bridge_runs", b.run.id, 6);
    expect(await call(b.token, "complete_step", { stepId: a, summary: "ok" })).toContain("Krok zapisany");
    const sa = await step(t.id, a);
    expect(sa.agentSec).toBeGreaterThanOrEqual(355); expect(sa.agentSec).toBeLessThanOrEqual(365);
    // start_step sprzed tego biegu (zostawiony krok z poprzedniego biegu): liczy się od startu biegu, nie od tamtego startu
    await ago("agent_started_at", "steps", bb, 120);
    await ago("started_at", "bridge_runs", b.run.id, 3);
    expect(await call(b.token, "complete_step", { stepId: bb, summary: "ok" })).toContain("Krok zapisany");
    const sb = await step(t.id, bb);
    expect(sb.agentSec).toBeGreaterThanOrEqual(175); expect(sb.agentSec).toBeLessThanOrEqual(185);
    // leave_step: od start_step tak, od znacznika biegu nie
    expect(await call(b.token, "start_step", { stepId: c })).toBe("Krok w toku.");
    await ago("agent_started_at", "steps", c, 2);
    await ago("mark_at", "bridge_runs", b.run.id, 9);
    expect(await call(b.token, "leave_step", { stepId: c, reason: "brak dostępu" })).toBe("Krok oddany.");
    const sc = await step(t.id, c);
    expect(sc.status).toBe("todo"); expect(sc.agentStartedAt).toBeNull();
    expect(sc.agentSec).toBeGreaterThanOrEqual(115); expect(sc.agentSec).toBeLessThanOrEqual(125);
    await ago("mark_at", "bridge_runs", b.run.id, 9);
    expect(await call(b.token, "leave_step", { stepId: d, reason: "brak narzędzia" })).toBe("Krok oddany.");
    expect((await step(t.id, d)).agentSec).toBe(0);
    await endRun(b.run.id);
  });
  it("szkic z set_blocks: czas od znacznika biegu dolicza się, a zgody nie ma; wysyłka przez bieg wysyłki zamyka jako agent, zgoda Piotra jako owner", async () => {
    const t = await repo.createTask(owner, { title: "Szkic i wysyłka", steps: [{ title: "Napisz na #dev", tool: "slack", needsApproval: true }] });
    const sid = t.steps[0].id;
    const b = await workRun();
    await ago("mark_at", "bridge_runs", b.run.id, 3);
    const draft: Block = { type: "draft", target: { app: "slack", where: "#dev", action: "send" }, body: "Hej", status: "proposed" };
    expect(await call(b.token, "set_blocks", { stepId: sid, blocks: [draft] })).toContain("czeka na zatwierdzenie");
    let s = await step(t.id, sid);
    expect(s.status).toBe("draft"); expect(s.approvedAt).toBeNull();
    expect(s.agentSec).toBeGreaterThanOrEqual(175); expect(s.agentSec).toBeLessThanOrEqual(185);
    await endRun(b.run.id);
    expect(await repo.approveDraft(owner, sid)).toBe(true);
    expect(await repo.markSendStarted(owner, sid)).toBe(true);
    await ago("send_started_at", "steps", sid, 1);
    expect(await repo.completeSend(owner, sid, { summary: "poszło" })).toBe(true);
    s = await step(t.id, sid);
    expect(s.doneBy).toBe("agent"); expect(s.agentSec).toBeGreaterThanOrEqual(230);
    // szkic, który nigdzie nie idzie: zgoda Piotra go kończy i to Piotr jest wykonawcą
    const t2 = await repo.createTask(owner, { title: "Notatka", steps: [{ title: "Zapisz notatkę", tool: "claude", needsApproval: true }] });
    const nid = t2.steps[0].id;
    await repo.updateStep(nid, { status: "draft", blocks: [{ type: "draft", target: { app: "claude", action: "send" }, body: "Notatka", status: "proposed" }] });
    expect(await repo.approveDraft(owner, nid)).toBe(true);
    expect(await repo.markSendStarted(owner, nid)).toBe(true);
    expect(await repo.completeSend(owner, nid, { summary: "ok" }, "owner")).toBe(true);
    expect(await step(t2.id, nid)).toMatchObject({ status: "done", doneBy: "owner", agentSec: 0 });
    // klient bez biegu i bez start_step: czas tylko z spentMin agenta
    const t3 = await repo.createTask(owner, { title: "Klient", steps: [{ title: "Policz", tool: "code" }] });
    expect(await call(client, "complete_step", { stepId: t3.steps[0].id, summary: "ok", spentMin: 7 })).toContain("Krok zapisany");
    expect(await step(t3.id, t3.steps[0].id)).toMatchObject({ doneBy: "agent", agentSec: 420, spentSec: 0 });
  });

  // ---------- punkt 1: kroki Piotra ----------
  it("odpowiedź na kartce zamyka krok-decyzję Piotra (wynik „Decyzja: A”, zamknął Piotr), rozmowa dostaje „Decyzja w kroku”, zadanie zostaje otwarte; krok Claude'a z pytaniem zostaje otwarty", async () => {
    const t = await repo.createTask(owner, { title: "Decyzja", steps: [{ title: "Zdecyduj, co scalić", tool: "manual" }] });
    const dec = t.steps[0].id;
    await repo.updateStep(dec, { blocks: [{ type: "text", body: "fakty" }, q("Co scalić?")] });
    await actions.answerBlockForm(fd({ taskId: t.id, stepId: dec, index: "1", q: "Co scalić?", option: "A" }));   // indeks z wyrenderowanej kartki
    expect(await step(t.id, dec)).toMatchObject({ status: "done", doneBy: "owner", output: "Decyzja: A" });
    expect(await lastChat(t.id)).toBe("Decyzja w kroku „Zdecyduj, co scalić”: A. Pytanie z kartki: „Co scalić?”.");
    expect((await repo.getTask(owner, t.id))!.doneAt).toBeNull();   // wiadomość czeka na agenta: on zastosuje decyzję, dopiero wtedy zadanie się zamknie
    const t2 = await repo.createTask(owner, { title: "Pytanie Claude'a", steps: [{ title: "Zrób X", tool: "code" }] });
    await repo.updateStep(t2.steps[0].id, { blocks: [q("Którą wersję?")] });
    await actions.answerBlockForm(fd({ taskId: t2.id, stepId: t2.steps[0].id, index: "0", q: "Którą wersję?", answer: "B" }));
    expect((await step(t2.id, t2.steps[0].id)).status).toBe("todo");
    expect(await lastChat(t2.id)).toBe("Odpowiedź na pytanie z kartki „Którą wersję?”: B");
  });
  it("decyzja zamyka też krok „Przeczytaj …”, na który czekała; dwa pytania zamyka druga odpowiedź; „Zmień odpowiedź” → nowa odpowiedź z „wcześniej”", async () => {
    const t = await repo.createTask(owner, { title: "Dwa pytania", steps: [{ title: "Przeczytaj raport", tool: "manual" }, { title: "Zdecyduj o wersji", tool: "manual", dependsOn: ["n1"] }] });
    const [read, dec] = t.steps.map((s) => s.id);
    await repo.updateStep(dec, { blocks: [q("P1?"), q("P2?")] });
    await actions.answerBlockForm(fd({ taskId: t.id, stepId: dec, index: "0", q: "P1?", option: "A" }));
    expect((await step(t.id, dec)).status).toBe("todo");
    expect(await lastChat(t.id)).toBe("Odpowiedź na pytanie z kartki „P1?”: A");
    await actions.answerBlockForm(fd({ taskId: t.id, stepId: dec, index: "1", q: "P2?", option: "B" }));
    expect(await step(t.id, dec)).toMatchObject({ status: "done", output: "Decyzje: „P1?”: A; „P2?”: B" });
    expect(await step(t.id, read)).toMatchObject({ status: "done", doneBy: "owner" });
    await actions.reopen(t.id, dec);
    let s = await step(t.id, dec);
    expect(s.status).toBe("todo"); expect(s.hasPrevBlocks).toBe(false);
    expect(s.blocks?.map((b) => (b as { prev?: string }).prev)).toEqual(["A", "B"]); expect(s.blocks?.[0]).not.toHaveProperty("answer");
    // indeks nie trafia (kartka przebudowana): odpowiedź idzie po treści; ta sama odpowiedź co wcześniej nie jest zmianą
    await actions.answerBlockForm(fd({ taskId: t.id, stepId: dec, index: "0", q: "P2?", option: "B" }));
    s = await step(t.id, dec);
    expect(s.status).toBe("todo"); expect(s.blocks?.[1]).toMatchObject({ answer: "B" });
    await actions.answerBlockForm(fd({ taskId: t.id, stepId: dec, index: "0", q: "P1?", option: "B" }));
    expect(await step(t.id, dec)).toMatchObject({ status: "done", output: "Decyzje: „P1?”: B; „P2?”: B" });
    expect(await lastChat(t.id)).toBe("Zmieniam decyzję w kroku „Zdecyduj o wersji”: B (wcześniej: A). Pytanie z kartki: „P1?”.");
  });
  it("zegar karty: porcja sekund dolicza się do kroku Piotra; za duża porcja, krok Claude'a i czas wpisany ręcznie ją pomijają", async () => {
    const t = await repo.createTask(owner, { title: "Zegar karty", steps: [{ title: "Przejrzyj umowę", tool: "manual", estMin: 15 }, { title: "Policz", tool: "code" }] });
    const [own, code] = t.steps.map((s) => s.id);
    await actions.addOwnTime(t.id, own, 90);
    expect((await step(t.id, own)).spentSec).toBe(90);
    await actions.addOwnTime(t.id, own, 5000);
    await actions.addOwnTime(t.id, code, 90);
    expect((await step(t.id, own)).spentSec).toBe(90); expect((await step(t.id, code)).spentSec).toBe(0);
    await actions.patchStep(t.id, own, { spentMin: 10 });   // ręczna poprawka wygrywa: zegar już nie dolicza
    await actions.addOwnTime(t.id, own, 60);
    expect(await step(t.id, own)).toMatchObject({ spentSec: 600, spentManual: true });
  });
  it("„Zrobione” z pytaniem o czas: 30 min zapisuje czas Piotra, „Pomiń” zamyka bez czasu", async () => {
    const t = await repo.createTask(owner, { title: "Poza aplikacją", steps: [{ title: "Zadzwoń do Kingi", tool: "manual", estMin: 15 }, { title: "Wyślij umowę pocztą", tool: "manual", estMin: 15 }] });
    await actions.doneWithTime(t.id, t.steps[0].id, 30);
    expect(await step(t.id, t.steps[0].id)).toMatchObject({ status: "done", doneBy: "owner", spentSec: 1800, spentManual: true });
    await actions.doneWithTime(t.id, t.steps[1].id, null);
    expect(await step(t.id, t.steps[1].id)).toMatchObject({ status: "done", doneBy: "owner", spentSec: 0 });
    expect((await repo.getTask(owner, t.id))!.doneAt).not.toBeNull();
  });
  it("add_steps z done: krok od razu zrobiony przez Claude z czasem biegu; done z manual, file albo needsApproval odmawia; uwaga przy „Przeczytaj …” dla Piotra", async () => {
    const t = await repo.createTask(owner, { title: "Rozpisanie z done" });
    const b = await workRun();
    await ago("mark_at", "bridge_runs", b.run.id, 5);
    expect(await call(b.token, "add_steps", { taskId: t.id, steps: [{ title: "Przeczytaj wątek #dev", tool: "slack", done: "W wątku są 3 wymagania." }, { title: "Zdecyduj o zakresie", tool: "manual" }] })).toContain("\"done\": true");
    const ts = (await repo.getTask(owner, t.id))!;
    expect(ts.steps[0]).toMatchObject({ status: "done", doneBy: "agent", report: "W wątku są 3 wymagania." });
    expect(ts.steps[0].agentSec).toBeGreaterThanOrEqual(295); expect(ts.steps[0].agentSec).toBeLessThanOrEqual(305);
    expect(ts.steps[1].status).toBe("todo"); expect(ts.doneAt).toBeNull();
    expect(await lastChat(t.id)).toBe("Rozpisałem 2 kroki: „Przeczytaj wątek #dev”, „Zdecyduj o zakresie”. Od razu zrobiłem: „Przeczytaj wątek #dev”.");
    expect(await call(b.token, "add_steps", { taskId: t.id, steps: [{ title: "Zadzwoń", tool: "manual", done: "zadzwoniłem" }] })).toContain("ma done, a tool manual");
    expect(await call(b.token, "add_steps", { taskId: t.id, steps: [{ title: "Zapisz plik", tool: "file", done: "zapisane" }] })).toContain("ma done, a tool file");
    expect(await call(b.token, "add_steps", { taskId: t.id, steps: [{ title: "Napisz na #dev", tool: "slack", needsApproval: true, done: "wysłane" }] })).toContain("ma done i needsApproval");
    expect((await repo.getTask(owner, t.id))!.steps).toHaveLength(2);
    expect(await call(b.token, "add_steps", { taskId: t.id, steps: [{ title: "Przeczytaj raport", tool: "manual" }] })).toContain("nie twórz Piotrowi kroków „Przeczytaj …”");
    expect((await repo.getTask(owner, t.id))!.steps).toHaveLength(3);
    await endRun(b.run.id);
  });
  it("set_blocks nie podrabia odpowiedzi Piotra: answer od agenta znika, zapisana odpowiedź na to samo pytanie zostaje", async () => {
    const t = await repo.createTask(owner, { title: "Podrobiona odpowiedź", steps: [{ title: "Zdecyduj", tool: "manual" }] });
    const sid = t.steps[0].id;
    expect(await call(client, "set_blocks", { stepId: sid, blocks: [{ ...q("Co?"), answer: "A" }] })).not.toContain("Nie zapisałem");
    expect((await step(t.id, sid)).blocks?.[0]).not.toHaveProperty("answer");
    await repo.answerBlockQuestion(sid, 0, "B");
    expect(await call(client, "set_blocks", { stepId: sid, blocks: [{ type: "text", body: "fakty" }, q("Co?")] })).not.toContain("Nie zapisałem");
    expect((await step(t.id, sid)).blocks?.[1]).toMatchObject({ type: "question", answer: "B" });
  });
});
