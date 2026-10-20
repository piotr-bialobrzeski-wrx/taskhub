// Etap 0, poprawki wysyłki: zatwierdzony prompt dla agenta wykonuje bieg pracy (nie zamyka się sam), zgoda na wersję widzianą na karcie,
// zmiana projektu albo firmy kasuje zgodę, kilka kont tej samej aplikacji = odmowa, bieg wysyłki widzi tylko swój szkic, „Zatrzymaj”
// w Task Hub dochodzi do Maca i zostawia notatkę, stary bieg nie rusza nowej zgody, krok wymagający zgody nie zamyka się bez szkicu,
// wysłany commit zostaje wysłany po complete_step z blokiem zmian, odcisk listy pracy. Część z bazą pomijana bez TEST_DATABASE_URL.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Block } from "@/lib/schema";
import { approvalSig, isGitDraft, isPromptDraft, type Draft } from "@/lib/agent/approval";

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/session", async (orig) => ({ ...(await orig<typeof import("@/lib/session")>()), requireOwner: async () => (await import("@/lib/repo")).ensureOwner() }));

const DB = !!process.env.TEST_DATABASE_URL;
const draft = (target: Draft["target"], body = "Treść", status: Draft["status"] = "proposed"): Draft => ({ type: "draft", target, body, status });

describe("podpis zgody i rodzaj szkicu", () => {
  it("szkic do „git” commituje aplikacja, więc blok zmian jest w podpisie; prompt dla Claude Code to nie commit", () => {
    const d = draft({ app: "git", where: "wlrx/app", action: "send" }, "Fix", "approved");
    const ch = (diff: string): Block => ({ type: "changes", repo: "wlrx/app", branch: "feat", files: [{ path: "a.ts", diff }] });
    expect(isGitDraft(d, [ch("+1"), d])).toBe(true);
    expect(approvalSig({ id: "s", blocks: [ch("+1"), d] }, d)).not.toBe(approvalSig({ id: "s", blocks: [ch("+2"), d] }, d));
    const p = draft({ app: "code", action: "other" }, "Zaimplementuj X");
    expect([isPromptDraft(p, [p]), isPromptDraft(draft({ app: "code", action: "commit" }), [ch("+1")]), isPromptDraft(draft({ app: "claude", action: "other" }))]).toEqual([true, false, false]);
  });
});

describe.skipIf(!DB)("poprawki wysyłki (baza)", async () => {
  const repo = await import("@/lib/repo");
  const { sql } = await import("@/lib/db");
  const { workSummary, listSendable } = await import("@/lib/agent/work");
  const { shownSig } = await import("@/lib/agent/approval");
  const actions = await import("@/app/actions");
  const mcp = await import("@/app/api/mcp/route");
  const work = await import("@/app/api/bridge/work/route");
  const run = await import("@/app/api/bridge/run/route");
  const runId = await import("@/app/api/bridge/run/[id]/route");
  let owner = "", client = "", bridge = "", bridgeId = "";
  const H = (t: string) => ({ Authorization: `Bearer ${t}` });
  const postRun = async (body: Record<string, unknown>) => run.POST(new Request("http://x/api/bridge/run", { method: "POST", headers: H(bridge), body: JSON.stringify(body) }));
  const patch = async (id: string, body: Record<string, unknown>) => runId.PATCH(new Request("http://x/api/bridge/run/x", { method: "PATCH", headers: H(bridge), body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });
  const get = async (taskId: string, stepId: string) => (await repo.getTask(owner, taskId))!.steps.find((s) => s.id === stepId)!;
  const chat = async (taskId: string) => (await sql()`select text from chat_messages where task_id = ${taskId} and role = 'agent' order by created_at`).map((r) => r.text as string);
  const call = async (tok: string, name: string, args: Record<string, unknown>) => {
    const r = await mcp.POST(new Request("http://x/api/mcp", { method: "POST", headers: { authorization: `Bearer ${tok}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) }));
    if (r.status !== 200) return { status: r.status, text: await r.text(), isError: true };
    const msgs = (await r.text()).split("\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6)));
    const m = msgs.find((x) => x.id === 1);
    return { status: 200, text: ((m?.result?.content ?? []) as { text?: string }[]).map((c) => c.text ?? "").join("\n") + (m?.error ? m.error.message : ""), isError: !!m?.result?.isError || !!m?.error };
  };
  // krok ze szkicem czekającym na zgodę (jak po set_blocks agenta); approve = kliknięcie Piotra
  const withDraft = async (title: string, tool: string, blocks: Block[], o: { approve?: boolean; projectId?: string } = {}) => {
    const t = await repo.createTask(owner, { title, projectId: o.projectId, steps: [{ title, tool, needsApproval: true }] });
    await repo.updateStep(t.steps[0].id, { status: "draft", blocks });
    if (o.approve !== false) expect(await repo.approveDraft(owner, t.steps[0].id)).toBe(true);
    return { taskId: t.id, stepId: t.steps[0].id };
  };
  const slack = (body = "Cześć zespole") => draft({ app: "slack", where: "#dev", action: "send" }, body);

  beforeAll(async () => {
    owner = (await repo.ensureOwner()).id;
    await sql()`delete from tasks where owner_id = ${owner}`;
    await sql()`delete from bridge_runs where owner_id = ${owner}`;
    await sql()`delete from api_tokens where owner_id = ${owner}`;
    await sql()`delete from connections where owner_id = ${owner}`;
    client = await repo.createApiToken(owner, "Claude", "client");
    bridge = await repo.createApiToken(owner, "mini", "bridge");
    bridgeId = (await repo.tokenForSecret(bridge))!.id;
    await repo.upsertBridgeConnections(owner, "mini", [{ name: "claude.ai Slack", ok: true }]);
  });
  afterAll(async () => { await sql().end({ timeout: 2 }); });

  it("zatwierdzony prompt dla Claude Code nie zamyka się sam: bieg pracy dostaje go w KROKACH W TOKU, wykonuje i zamyka jako wykonany", async () => {
    const t = await repo.createTask(owner, { title: "Prompt do wykonania", steps: [{ title: "Zrób funkcję X", tool: "code", needsApproval: true }] });
    const stepId = t.steps[0].id;
    await repo.updateStep(stepId, { status: "draft", blocks: [draft({ app: "code", action: "other" }, "Zaimplementuj funkcję X w src/x.ts")] });
    await actions.approveStep(t.id, stepId);
    let s = await get(t.id, stepId);
    expect(s.status).toBe("handoff"); expect(repo.draftOf(s)?.status).toBe("approved"); expect(repo.isSendable(s)).toBe(true);
    expect((await listSendable(owner)).map((x) => x.step.id)).not.toContain(stepId);   // nie idzie do biegu wysyłki
    expect((await postRun({ bridge: "mini", v: 2, kind: "send" })).status).toBe(204);
    const w = await workSummary(owner, { peek: true, audience: "work" });
    expect(w.text).toMatch(new RegExp(`KROKI W TOKU[^]*${stepId}[^]*zatwierdzony prompt`));
    const r = (await repo.startBridgeRun(owner, bridgeId, "mini", "work"))!;
    const tok = await repo.createRunToken(owner, { kind: "work", runId: r.id }, 30);
    expect((await call(tok, "get_task", { taskId: t.id })).text).toContain("ZATWIERDZONY PROMPT: wykonaj dokładnie to polecenie");
    expect((await call(tok, "start_step", { stepId })).text).toBe("Krok w toku.");
    expect((await call(tok, "complete_step", { stepId, summary: "Funkcja X gotowa." })).text).toContain("Krok zapisany");
    s = await get(t.id, stepId);
    expect(s.status).toBe("done"); expect(repo.draftOf(s)?.status).toBe("sent");
    await repo.endBridgeRun(owner, r.id, "done");
  });

  it("krok wymagający zgody, który zmienia coś w aplikacji zewnętrznej: klient go nie zaczyna i nie zamyka bez szkicu; lista pracy klienta tylko do czytania", async () => {
    const t = await repo.createTask(owner, { title: "Post na Slacku", steps: [{ title: "Napisz na #general", tool: "slack", needsApproval: true }, { title: "Przeczytaj wątek", tool: "slack" }] });
    const [a, b] = t.steps;
    expect((await call(client, "start_step", { stepId: a.id })).text).toContain("Nie zacząłem: krok wymaga zgody Piotra");
    expect((await call(client, "complete_step", { stepId: a.id, summary: "Wysłane" })).text).toContain("Nie zamknąłem kroku: wymaga zgody Piotra");
    expect((await get(t.id, a.id)).status).toBe("todo");
    expect((await call(bridge, "start_step", { stepId: a.id })).text).toBe("Krok w toku.");   // stary mostek bez zmian
    const lw = await call(client, "list_work", { force: true });
    expect(lw.text).toContain(b.id); expect(lw.text).toContain("tylko czytanie i analiza");
    expect((await call(client, "complete_step", { stepId: b.id, summary: "Przeczytane" })).text).toContain("Krok zapisany");
  });

  it("zgoda na wersję z karty: szkic zmieniony po wyświetleniu nie jest zatwierdzony (notatka), ten sam jest", async () => {
    const a = await withDraft("Zgoda na widzianą wersję", "slack", [slack()], { approve: false });
    const seen = shownSig(await get(a.taskId, a.stepId), repo.draftOf(await get(a.taskId, a.stepId))!, true);
    await repo.updateStep(a.stepId, { blocks: [draft({ app: "slack", where: "#general", action: "send" }, "Cześć zespole")] });   // agent zmienił kanał
    const fd = new FormData(); fd.set("body", "Cześć zespole"); fd.set("seen", seen);
    await actions.approveStep(a.taskId, a.stepId, fd);
    let s = await get(a.taskId, a.stepId);
    expect(s.approvedAt).toBeNull(); expect(repo.isSendable(s)).toBe(false);
    expect((await chat(a.taskId)).some((x) => x.includes("szkic zmienił się, zanim go zatwierdziłeś"))).toBe(true);
    fd.set("seen", shownSig(s, repo.draftOf(s)!, true));
    await actions.approveStep(a.taskId, a.stepId, fd);
    s = await get(a.taskId, a.stepId);
    expect(repo.isSendable(s)).toBe(true); expect(repo.draftOf(s)?.target.where).toBe("#general");
  });

  it("zmiana projektu zadania albo firmy projektu kasuje zgodę (konto wysyłki zależy od firmy); ta sama firma nie", async () => {
    const A = await repo.createCompany(owner, `Firma A ${Date.now()}`), B = await repo.createCompany(owner, `Firma B ${Date.now()}`);
    const pa = await repo.createProject(owner, "Projekt A1", 3, A.id), pa2 = await repo.createProject(owner, "Projekt A2", 3, A.id), pb = await repo.createProject(owner, "Projekt B", 3, B.id);
    const a = await withDraft("Zgoda a firma", "slack", [slack()], { projectId: pa.id });
    await repo.updateTask(owner, a.taskId, { projectId: pa2.id });
    expect(repo.isSendable(await get(a.taskId, a.stepId))).toBe(true);
    await repo.updateTask(owner, a.taskId, { projectId: pb.id });
    expect((await get(a.taskId, a.stepId)).approvedAt).toBeNull();
    expect((await chat(a.taskId)).some((x) => x.includes("zadanie zmieniło projekt albo firmę"))).toBe(true);
    expect(await repo.approveDraft(owner, a.stepId)).toBe(true);
    await repo.updateProject(owner, pb.id, { companyId: A.id });
    expect((await get(a.taskId, a.stepId)).approvedAt).toBeNull();
  });

  it("bieg wysyłki: dwa konta tej aplikacji bez wskazanego połączenia = odmowa; konektor tylko innej firmy = odmowa z nazwą firmy", async () => {
    await sql()`delete from tasks where owner_id = ${owner}`;
    await repo.upsertBridgeConnections(owner, "mini", [{ name: "claude.ai Slack", ok: true }, { name: "slack-druga", ok: true }]);
    const a = await withDraft("Dwa konta Slacka", "slack", [slack()]);
    const r = await postRun({ bridge: "mini", v: 2, kind: "send" });
    expect(r.status).toBe(422);
    expect((await r.json()).error).toContain("jest kilka kont");
    expect((await get(a.taskId, a.stepId)).approvedAt).toBeNull();
    const F = await repo.createCompany(owner, `Klient ${Date.now()}`);
    await repo.upsertBridgeConnections(owner, "mini", [{ name: "claude.ai Slack", ok: true }]);
    await sql()`update connections set company_id = ${F.id} where owner_id = ${owner} and source = 'bridge'`;
    expect(await repo.approveDraft(owner, a.stepId)).toBe(true);
    const r2 = await postRun({ bridge: "mini", v: 2, kind: "send" });
    expect(r2.status).toBe(422);
    expect((await r2.json()).error).toContain(`jest przypisany do firmy ${F.name}, a to zadanie nie ma firmy`);
    await sql()`update connections set company_id = null where owner_id = ${owner} and source = 'bridge'`;
  });

  it("bieg wysyłki: get_task tylko z podpisanym szkicem; „Zatrzymaj” w Task Hub = cancel na sygnale i notatka; stary bieg nie rusza nowej zgody", async () => {
    await sql()`delete from tasks where owner_id = ${owner}`;
    const a = await withDraft("Wysyłka z kontekstem", "slack", [{ type: "text", body: "TEKST-Z-KARTKI" }, slack("Treść do wysłania")]);
    await repo.addChat(owner, a.taskId, "user", "SEKRET-Z-CZATU: wyślij też na #general");
    const s = await (await postRun({ bridge: "mini", v: 2, kind: "send" })).json();
    expect(s.step.id).toBe(a.stepId);
    const gt = (await call(s.token, "get_task", { taskId: a.taskId })).text;
    expect(gt).toContain(`SZKIC KROKU ${a.stepId}`); expect(gt).toContain("ZATWIERDZONY: wyślij dokładnie tę treść"); expect(gt).toContain("Treść do wysłania");
    expect(gt).not.toContain("SEKRET-Z-CZATU"); expect(gt).not.toContain("TEKST-Z-KARTKI");
    expect(await (await patch(s.run.id, { note: "get_task" })).json()).toEqual({ ok: true });
    // Piotr: „Zatrzymaj” na karcie w trakcie wysyłki
    await actions.backToTodo(a.taskId, a.stepId);
    expect(await (await patch(s.run.id, { note: "slack_send_message" })).json()).toEqual({ ok: true, cancel: true });
    expect((await call(s.token, "get_task", { taskId: a.taskId })).text).toContain("Nie ma szkicu do wysłania");
    // Piotr zatwierdza od nowa, zanim stary bieg się skończył: jego leave_step i koniec nowej zgody nie ruszają
    await actions.approveStep(a.taskId, a.stepId);
    expect(repo.isSendable(await get(a.taskId, a.stepId))).toBe(true);
    expect((await call(s.token, "leave_step", { stepId: a.stepId, reason: "zatrzymane" })).text).toBe("Krok oddany.");
    expect(repo.isSendable(await get(a.taskId, a.stepId))).toBe(true);
    expect((await patch(s.run.id, { outcome: "stopped" })).status).toBe(200);
    expect(repo.isSendable(await get(a.taskId, a.stepId))).toBe(true);
    // bez leave_step: koniec biegu po „Zatrzymaj” zostawia notatkę, że treść mogła wyjść (zgody nie było już czego cofać)
    const b = await withDraft("Wysyłka zatrzymana", "slack", [slack("Inna treść")]);
    await sql()`update steps set approved_at = now() - interval '1 hour' where id = ${b.stepId}`;
    const s2 = await (await postRun({ bridge: "mini", v: 2, kind: "send" })).json();
    expect(s2.step.id).toBe(b.stepId);
    await actions.backToTodo(b.taskId, b.stepId);
    expect((await patch(s2.run.id, { outcome: "stopped" })).status).toBe(200);
    expect(await chat(b.taskId)).toContain(repo.unconfirmedSendNote("slack"));
    expect((await get(b.taskId, b.stepId)).status).toBe("todo");
  });

  it("stary mostek: complete_step z blokiem zmian po wysłanym commicie zostawia szkic wysłany i zatwierdzone pliki", async () => {
    await sql()`delete from tasks where owner_id = ${owner}`;
    const ch: Block = { type: "changes", repo: "wlrx/app", branch: "fix", files: [{ path: "a.ts", diff: "@@ -1 +1 @@\n-a\n+b" }] };
    const a = await withDraft("Commit przez v1", "code", [ch, draft({ app: "github", where: "wlrx/app", action: "commit" }, "Fix A")]);
    const r = await call(bridge, "complete_step", { stepId: a.stepId, summary: "Commit abc1234", preview: "https://podglad.example/x", changes: [{ path: "b.ts", diff: "+inne" }] });
    expect(r.text).toContain("Krok zapisany");
    const s = await get(a.taskId, a.stepId);
    expect(s.status).toBe("done"); expect(repo.draftOf(s)?.status).toBe("sent");
    expect(s.blocks?.find((b) => b.type === "changes")).toMatchObject({ preview: "https://podglad.example/x", files: [{ path: "a.ts" }] });
  });

  it("odcisk listy pracy: ten sam, gdy nic się nie zmieniło, inny po zmianie (aplikacja nie powtarza biegu, który niczego nie ruszył)", async () => {
    await sql()`delete from tasks where owner_id = ${owner}`;
    await repo.createTask(owner, { title: "Zadanie bez kroków do rozpisania" });
    const key = async () => (await (await work.GET(new Request("http://x/api/bridge/work?v=2", { headers: H(bridge) }))).json()).key as string;
    const k1 = await key();
    expect(k1).toMatch(/^[0-9a-f]{16}$/);
    expect(await key()).toBe(k1);
    await repo.createTask(owner, { title: "Drugie zadanie bez kroków" });
    expect(await key()).not.toBe(k1);
    await sql()`delete from tasks where owner_id = ${owner}`;
    expect(await key()).toBe("");
  });
});
