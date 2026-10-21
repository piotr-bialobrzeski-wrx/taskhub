// Paczka 10, punkt 3a: tożsamość szkicu po podpisie. Drugi blok draft w kroku to opcja; zgoda, wysyłka i poprawki trzymają się treści
// (approvalSig), nie pozycji w tablicy. Kartki z opcjami zapisuje tu wprost repo.updateStep (to samo, co robi set_blocks po coerceAgentDrafts).
// Punkt 3c: bieg wysyłki dostaje w get_task tylko wybraną opcję i zamyka krok mimo odrzuconej propozycji obok; poprawka z czatu trafia
// do wskazanej opcji; set_blocks sprawdza każdą opcję osobno pod kątem miejsca, do którego inny krok już wysłał.
import { describe, it, expect, beforeAll, vi } from "vitest";
import type { Block, Step } from "@/lib/schema";
import { approvalSig, coerceAgentDrafts, draftOf, draftsOf, optionIndex, optionLabel, optionsOf, shownSig, type Draft } from "@/lib/agent/approval";
import { targetLink } from "@/lib/stepcard";

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/session", async (orig) => ({ ...(await orig<typeof import("@/lib/session")>()), requireOwner: async () => (await import("@/lib/repo")).ensureOwner() }));

const D = (body: string, extra: Partial<Draft> = {}): Draft => ({ type: "draft", target: { app: "slack", where: "#dev", action: "send" }, body, status: "proposed", ...extra });
const A = D("Wersja krótka: robimy to w przyszłym sprincie.", { title: "Krótko" });
const B = D("Wersja długa: robimy to w przyszłym sprincie, bo teraz blokuje nas migracja.");
const st = (blocks: Block[] | null, id = "s1") => ({ id, blocks });
const statuses = (blocks: Block[]) => blocks.map((b) => (b.type === "draft" ? b.status : b.type));

describe("opcje: szkic kroku po stanie, nie po pozycji", () => {
  it("draftOf woli wysłany, potem zatwierdzony, potem pierwszy; draftsOf daje wszystkie w kolejności kartki", () => {
    expect(draftOf(st([A, B]))?.body).toBe(A.body);
    expect(draftOf(st([A, { ...B, status: "approved" }]))?.body).toBe(B.body);
    expect(draftOf(st([{ ...A, status: "approved" }, { ...B, status: "sent" }]))?.body).toBe(B.body);
    expect(draftOf(st(null))).toBeNull();
    expect(draftOf(st([{ type: "text", body: "x" }]))).toBeNull();
    expect(draftsOf(st([{ type: "text", body: "x" }, A, B])).map((d) => d.body)).toEqual([A.body, B.body]);
    expect(draftsOf(st(null))).toEqual([]);
  });
  it("optionsOf: wybrana i odrzucone wynikają ze stanu", () => {
    expect(optionsOf(st([A, B]))).toMatchObject({ chosen: null, rejected: [], multi: true });
    expect(optionsOf(st([A]))).toMatchObject({ chosen: null, rejected: [], multi: false });
    const o = optionsOf(st([A, { ...B, status: "approved" }]));
    expect(o.chosen?.body).toBe(B.body); expect(o.rejected.map((d) => d.body)).toEqual([A.body]); expect(o.drafts).toHaveLength(2);
    const s = optionsOf(st([{ ...A, status: "sent" }, B]));
    expect(s.chosen?.body).toBe(A.body); expect(s.rejected.map((d) => d.body)).toEqual([B.body]);
  });
  it("optionLabel: title albo litera z pozycji; optionIndex po numerze i po nazwie", () => {
    expect(optionLabel(A, 0)).toBe("Krótko");
    expect(optionLabel(B, 1)).toBe("Opcja B");
    expect(optionLabel({ ...B, title: "  " }, 2)).toBe("Opcja C");
    const s = st([A, B]);
    expect(optionIndex(s, 1)).toBe(1);
    expect(optionIndex(s, "1")).toBe(1);
    expect(optionIndex(s, 2)).toBeNull();
    expect(optionIndex(s, "krótko")).toBe(0);
    expect(optionIndex(s, "opcja b")).toBe(1);
    expect(optionIndex(s, "B")).toBe(1);
    expect(optionIndex(s, "Opcja A")).toBe(0);
    expect(optionIndex(s, "Opcja C")).toBeNull();
    expect(optionIndex(s, undefined)).toBeNull();
    expect(optionIndex(s, "")).toBeNull();
  });
  it("coerceAgentDrafts: stan trzyma się treści; po przestawieniu kolejności zgoda zostaje na tej samej opcji", () => {
    const step = st([A, { ...B, status: "approved" }]);
    const out = coerceAgentDrafts(step, [{ type: "text", body: "Kontekst" }, { ...B, stale: true }, A]);
    expect(statuses(out)).toEqual(["text", "approved", "proposed"]);
    expect(out.some((b) => b.type === "draft" && b.stale)).toBe(false);
    // zmieniona treść wybranej: żadna nie dziedziczy stanu
    expect(statuses(coerceAgentDrafts(step, [A, { ...B, body: B.body + "!" }]))).toEqual(["proposed", "proposed"]);
    // title i pozycja nie wchodzą w podpis: zmiana nazwy opcji nie kasuje zgody
    expect(statuses(coerceAgentDrafts(step, [A, { ...B, title: "Długo" }]))).toEqual(["proposed", "approved"]);
    // jeden szkic: jak dotąd
    expect(statuses(coerceAgentDrafts(st([{ ...A, status: "approved" }]), [A]))).toEqual(["approved"]);
  });
  it("dwa identyczne szkice: stan dziedziczy tylko pierwszy z podpisem, reszta to propozycje", () => {
    const step = st([{ ...A, status: "approved" }]);
    expect(statuses(coerceAgentDrafts(step, [A, A, B]))).toEqual(["approved", "proposed", "proposed"]);
    expect(statuses(coerceAgentDrafts(step, [B, A, A]))).toEqual(["proposed", "approved", "proposed"]);
  });
});

describe("targetLink z opcją (paczka 10)", () => {
  const src = (url: string): Block => ({ type: "free", title: "Ticket", markdown: "treść", source: { app: "clickup", url } });
  const cu = (body: string, url?: string) => D(body, { target: { app: "clickup", action: "update", url } });
  it("bierze adres wskazanej opcji, a bez wskazania adres szkicu kroku (wybranego albo pierwszego)", () => {
    const a = cu("A", "https://app.clickup.com/t/869aaaaa1"), b = cu("B", "https://app.clickup.com/t/869bbbbb2");
    expect(targetLink({ tool: "clickup", title: "Zaktualizuj" }, [a, b], b)).toEqual({ label: "Otwórz w ClickUpie", url: "https://app.clickup.com/t/869bbbbb2" });
    expect(targetLink({ tool: "clickup", title: "Zaktualizuj" }, [a, b])?.url).toBe("https://app.clickup.com/t/869aaaaa1");
    expect(targetLink({ tool: "clickup", title: "Zaktualizuj" }, [a, { ...b, status: "approved" }])?.url).toBe("https://app.clickup.com/t/869bbbbb2");
  });
  it("dwa źródła tej samej aplikacji o różnych adresach: bez zgadywania; jedno albo powtórzone: przycisk", () => {
    const d = cu("x");
    expect(targetLink({ tool: "clickup", title: "Porównaj" }, [src("https://app.clickup.com/t/1"), src("https://app.clickup.com/t/2"), d])).toBeNull();
    expect(targetLink({ tool: "clickup", title: "Porównaj" }, [src("https://app.clickup.com/t/1"), src("https://app.clickup.com/t/1"), d])?.url).toBe("https://app.clickup.com/t/1");
    expect(targetLink({ tool: "clickup", title: "Porównaj" }, [src("https://app.clickup.com/t/1"), d])?.url).toBe("https://app.clickup.com/t/1");
    // adres w szkicu wygrywa nawet przy dwóch źródłach
    expect(targetLink({ tool: "clickup", title: "Porównaj" }, [src("https://app.clickup.com/t/1"), src("https://app.clickup.com/t/2"), cu("x", "https://app.clickup.com/t/2")])?.url).toBe("https://app.clickup.com/t/2");
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)("opcje w bazie: zgoda, wysyłka i poprawki po podpisie", async () => {
  const repo = await import("@/lib/repo");
  const { sql } = await import("@/lib/db");
  const actions = await import("@/app/actions");
  const mcp = await import("@/app/api/mcp/route");
  const run = await import("@/app/api/bridge/run/route");
  const { applyActions } = await import("@/lib/agent/chat");
  const { cardModeOf } = await import("@/components/PublishCard");
  let owner = "", client = "", bridge = "";
  // wywołanie narzędzia MCP (JSON-RPC tools/call, odpowiedź w strumieniu SSE): tylko tekst odpowiedzi
  const call = async (tok: string, name: string, args: Record<string, unknown>): Promise<string> => {
    const r = await mcp.POST(new Request("http://x/api/mcp", { method: "POST", headers: { authorization: `Bearer ${tok}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) }));
    const msgs = (await r.text()).split("\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6)));
    const m = msgs.find((x) => x.id === 1);
    return ((m?.result?.content ?? []) as { text?: string }[]).map((c) => c.text ?? "").join("\n") + (m?.error ? m.error.message : "");
  };
  const chatDeps = async (taskId: string) => ({ ai: null as never, ownerId: owner, taskId, tasks: [(await repo.getTask(owner, taskId))!] });
  const get = async (taskId: string, stepId: string) => (await repo.getTask(owner, taskId))!.steps.find((x) => x.id === stepId)!;
  const twoOptions = async (needsApproval = true, blocks: Block[] = [A, B]) => {
    const t = await repo.createTask(owner, { title: "Opcje " + Math.random().toString(36).slice(2, 8), steps: [{ title: "Odpisz na #dev", tool: "slack", needsApproval }] });
    const sid = t.steps[0].id;
    await repo.updateStep(sid, { status: "draft", blocks });
    return { taskId: t.id, sid, s: await get(t.id, sid) };
  };
  // Piotr klika „Zatwierdź: Opcja B”: formularz niesie numer opcji i podpis tej opcji, którą widział
  const approveB = async (taskId: string, s: Step) => {
    const b = draftsOf(s)[1];
    const fd = new FormData(); fd.set("option", "1"); fd.set("seen", shownSig(s, b, true)); fd.set("seenFull", shownSig(s, b, false));
    await actions.approveStep(taskId, s.id, fd);
    return get(taskId, s.id);
  };
  beforeAll(async () => {
    owner = (await repo.ensureOwner()).id;
    await sql()`delete from tasks where owner_id = ${owner} and title like 'Opcje %'`;
    // zgoda na szkic do Slacka wymaga konektora Slack na Macu
    await sql()`delete from connections where owner_id = ${owner}`;
    await repo.upsertBridgeConnections(owner, "Mac", [{ name: "claude.ai Slack", ok: true }]);
    client = await repo.createApiToken(owner, "Claude", "client");
    bridge = await repo.createApiToken(owner, "Mac", "bridge");
  });

  it("(1) zgoda na opcję B: podpis B w approved_sig, A zostaje propozycją, krok do wysłania", async () => {
    const { taskId, s } = await twoOptions();
    expect(s.status).toBe("draft");
    expect(draftsOf(s).map((d) => d.status)).toEqual(["proposed", "proposed"]);
    const after = await approveB(taskId, s);
    expect(after.status).toBe("handoff");
    const [a, b] = draftsOf(after);
    expect(a.status).toBe("proposed"); expect(b.status).toBe("approved");
    expect(after.approvedSig).toBe(approvalSig(after, b));
    expect(after.approvedSig).not.toBe(approvalSig(after, a));
    expect(draftOf(after)?.body).toBe(B.body);
    expect(repo.isSendable(after)).toBe(true);
    expect(optionsOf(after).chosen?.body).toBe(B.body);
    expect(optionsOf(after).rejected.map((d) => d.body)).toEqual([A.body]);
  });
  it("(2) agent przepisuje kartkę z opcjami w odwróconej kolejności: zgoda zostaje na B", async () => {
    const { taskId, s } = await twoOptions();
    const was = await approveB(taskId, s);
    const blocks = coerceAgentDrafts(was, [{ type: "text", body: "Kontekst" }, { ...B }, { ...A }]);
    await repo.updateStep(s.id, { blocks });
    const after = await get(taskId, s.id);
    expect(after.status).toBe("handoff"); expect(after.approvedAt).not.toBeNull();
    expect(draftsOf(after).map((d) => [d.body, d.status])).toEqual([[B.body, "approved"], [A.body, "proposed"]]);
    expect(draftOf(after)?.body).toBe(B.body);
    expect(after.approvedSig).toBe(approvalSig(after, draftOf(after)!));
    expect(repo.isSendable(after)).toBe(true);
  });
  it("(3) zmieniona B: set_blocks odmówi (szkic kroku nie ma już stanu wybranej), a zapis wprost kasuje zgodę jak każda zmiana treści", async () => {
    const { taskId, s } = await twoOptions();
    const was = await approveB(taskId, s);
    const changed = coerceAgentDrafts(was, [A, { ...B, body: B.body + " Dopisek." }]);
    // warunek odmowy z set_blocks (route.ts): po zapisie szkic kroku nie miałby stanu zatwierdzonego
    expect(statuses(changed)).toEqual(["proposed", "proposed"]);
    expect(draftOf({ blocks: changed })?.status).not.toBe(draftOf(was)?.status);
    expect(repo.isSendable(await get(taskId, s.id))).toBe(true);   // nic nie zapisano: zgoda stoi
    // zapis z pominięciem bramki: zgoda trzyma się podpisu, więc znika, a krok wraca do zatwierdzenia
    await repo.updateStep(s.id, { blocks: [A, { ...B, body: B.body + " Dopisek.", status: "approved" }] });
    const after = await get(taskId, s.id);
    expect(after).toMatchObject({ status: "draft", approvedAt: null, approvedSig: null });
    expect(draftsOf(after).map((d) => d.status)).toEqual(["proposed", "proposed"]);
  });
  it("(5) „Zatrzymaj”: obie opcje wracają do propozycji, zgody nie ma", async () => {
    const { taskId, s } = await twoOptions();
    expect((await approveB(taskId, s)).status).toBe("handoff");
    await actions.backToTodo(taskId, s.id);
    const after = await get(taskId, s.id);
    expect(after.status).toBe("todo"); expect(after.approvedAt).toBeNull(); expect(after.approvedSig).toBeNull();
    expect(draftsOf(after).map((d) => d.status)).toEqual(["proposed", "proposed"]);
    expect(optionsOf(after).chosen).toBeNull();
  });
  it("(6) krok bez zgody: „Zatwierdź” opcji A zamyka krok i zapisuje A jako wysłaną, B zostaje propozycją", async () => {
    const { taskId, s } = await twoOptions(false);
    const fd = new FormData(); fd.set("option", "0");
    await actions.approveStep(taskId, s.id, fd);
    const after = await get(taskId, s.id);
    expect(after.status).toBe("done");
    expect(draftsOf(after).map((d) => d.status)).toEqual(["sent", "proposed"]);
    expect(draftOf(after)?.body).toBe(A.body);
    expect(optionsOf(after).rejected.map((d) => d.body)).toEqual([B.body]);
  });
  it("(6b) poprawka z pola trafia do wskazanej opcji; zamknięcie bez wyboru nic nie wysyła", async () => {
    const { taskId, s } = await twoOptions(false);
    await actions.saveDraftBody(taskId, s.id, 1, "B po poprawce");
    let after = await get(taskId, s.id);
    expect(draftsOf(after).map((d) => d.body)).toEqual([A.body, "B po poprawce"]);
    await actions.saveDraftBody(taskId, s.id, 5, "nie ma takiej opcji");
    expect(draftsOf(await get(taskId, s.id)).map((d) => d.body)).toEqual([A.body, "B po poprawce"]);
    await actions.markDone(taskId, s.id);
    after = await get(taskId, s.id);
    expect(after.status).toBe("done");
    expect(draftsOf(after).map((d) => d.status)).toEqual(["proposed", "proposed"]);
    expect(optionsOf(after).chosen).toBeNull();
  });
  it("(7) approveDraft przy dwóch opcjach wymaga numeru; dwie opcje o tym samym podpisie nie dostają zgody", async () => {
    const { taskId, s } = await twoOptions();
    expect(await repo.approveDraft(owner, s.id)).toBe(false);
    expect(await repo.approveDraft(owner, s.id, { option: 2 })).toBe(false);
    expect(await repo.approveDraft(owner, s.id, { option: -1 })).toBe(false);
    expect((await get(taskId, s.id))).toMatchObject({ status: "draft", approvedAt: null });
    expect(await repo.approveDraft(owner, s.id, { option: 1 })).toBe(true);
    expect(draftsOf(await get(taskId, s.id)).map((d) => d.status)).toEqual(["proposed", "approved"]);
    // ta sama treść pod dwiema nazwami: wybór byłby niejednoznaczny
    const same = await twoOptions(true, [A, { ...A, title: "Kopia" }]);
    expect(await repo.approveDraft(owner, same.sid, { option: 0 })).toBe(false);
    expect(await repo.approveDraft(owner, same.sid, { option: 1 })).toBe(false);
    expect((await get(same.taskId, same.sid)).approvedAt).toBeNull();
    // poprawka z formularza, która zrównuje treść z drugą opcją, też nie
    const { sid } = await twoOptions();
    expect(await repo.approveDraft(owner, sid, { option: 0, body: B.body })).toBe(false);
    // jeden szkic: numer zbędny, jak dotąd
    const one = await twoOptions(true, [A]);
    expect(await repo.approveDraft(owner, one.sid)).toBe(true);
    expect(draftOf(await get(one.taskId, one.sid))?.status).toBe("approved");
  });
  it("(4) bieg wysyłki: get_task ma jedną sekcję SZKIC KROKU (wybraną B), complete_step zamyka krok mimo A proposed; karta „Wysłano”", async () => {
    // bieg bierze najdawniej zatwierdzony szkic właściciela: zostaje tylko ten z tego przypadku; jeden otwarty bieg na właściciela
    await sql()`delete from tasks where owner_id = ${owner}`;
    const open = (await repo.bridgeStatus(owner, 0)).run; if (open) await repo.endBridgeRun(owner, open.id, "done");
    const { taskId, s } = await twoOptions();
    await approveB(taskId, s);
    const r = await run.POST(new Request("http://x/api/bridge/run", { method: "POST", headers: { Authorization: `Bearer ${bridge}` }, body: JSON.stringify({ bridge: "Mac", v: 2, kind: "send" }) }));
    expect(r.status).toBe(200);
    const sr = await r.json() as { token: string; run: { id: string }; step: { id: string } };
    expect(sr.step.id).toBe(s.id);
    const gt = await call(sr.token, "get_task", { taskId });
    expect(gt.match(/SZKIC KROKU/g)).toHaveLength(1);
    expect(gt).toContain(`SZKIC KROKU ${s.id} „Odpisz na #dev” · Opcja B (ZATWIERDZONY: wyślij dokładnie tę treść)`);
    expect(gt).toContain(B.body); expect(gt).not.toContain(A.body);
    expect(await call(sr.token, "complete_step", { stepId: s.id, summary: "Wysłane na #dev.", link: "https://x.slack.com/archives/C1/p1700000000000100" })).toContain("Krok zapisany");
    const after = await get(taskId, s.id);
    expect(after.status).toBe("done");
    expect(draftsOf(after).map((d) => [d.body, d.status])).toEqual([[A.body, "proposed"], [B.body, "sent"]]);
    expect(cardModeOf(after)).toBe("sent");
    expect(optionsOf(after).chosen?.body).toBe(B.body);
    expect(optionsOf(after).rejected.map((d) => d.body)).toEqual([A.body]);
    // konektor i bieg pracy widzą po wysyłce obie opcje z oznaczeniem
    const gt2 = await call(client, "get_task", { taskId });
    expect(gt2).toContain(`SZKIC KROKU ${s.id} „Odpisz na #dev” · Krótko (opcja niewybrana (Piotr wybrał „Opcja B”): nie wysyłaj)`);   // A ma title
    expect(gt2).toContain(`SZKIC KROKU ${s.id} „Odpisz na #dev” · Opcja B (wysłany)`);
    await repo.endBridgeRun(owner, sr.run.id, "done");
  });
  it("(8) poprawka z czatu: update_step z option „Opcja B” zmienia tylko B; bez option idzie do wybranej, inaczej do pierwszej", async () => {
    const { taskId, s } = await twoOptions();
    await applyActions({ reply: "", actions: [{ type: "update_step", id: s.id, output: "B po poprawce z czatu", option: "Opcja B" }] }, await chatDeps(taskId));
    let after = await get(taskId, s.id);
    expect(draftsOf(after).map((d) => [d.body, d.status])).toEqual([[A.body, "proposed"], ["B po poprawce z czatu", "proposed"]]);
    // bez option i bez wyboru: pierwsza; numer opcji też działa
    await applyActions({ reply: "", actions: [{ type: "update_step", id: s.id, output: "A po poprawce" }] }, await chatDeps(taskId));
    expect(draftsOf(await get(taskId, s.id)).map((d) => d.body)).toEqual(["A po poprawce", "B po poprawce z czatu"]);
    await applyActions({ reply: "", actions: [{ type: "update_step", id: s.id, output: "B numerem", option: 1 }] }, await chatDeps(taskId));
    expect(draftsOf(await get(taskId, s.id)).map((d) => d.body)).toEqual(["A po poprawce", "B numerem"]);
    // po zgodzie na B: bez option poprawka idzie do wybranej i kasuje zgodę (inny podpis)
    const t2 = await twoOptions();
    expect(repo.isSendable(await approveB(t2.taskId, t2.s))).toBe(true);
    await applyActions({ reply: "", actions: [{ type: "update_step", id: t2.s.id, output: "B jeszcze raz" }] }, await chatDeps(t2.taskId));
    after = await get(t2.taskId, t2.s.id);
    expect(draftsOf(after).map((d) => [d.body, d.status])).toEqual([[A.body, "proposed"], ["B jeszcze raz", "proposed"]]);
    expect(after.approvedAt).toBeNull(); expect(after.status).toBe("draft");
  });
  it("(9) set_blocks sprawdza każdą opcję: druga opcja do miejsca, do którego inny krok już wysłał, to odmowa", async () => {
    const U = "https://x.slack.com/archives/C1/p1700000000000100", V = "https://x.slack.com/archives/C1/p1700000000000200";
    const to = (body: string, url: string, title: string) => D(body, { title, target: { app: "slack", where: "#dev", action: "send", url } });
    const t = await repo.createTask(owner, { title: "Opcje sameTarget", steps: [{ title: "Odpisz w wątku", tool: "slack", needsApproval: false }, { title: "Odpisz jeszcze raz", tool: "slack", needsApproval: true }] });
    const [s1, s2] = t.steps.map((x) => x.id);
    // krok 1 (bez zgody) wysłał do U: „Zatwierdź” zapisuje jego szkic jako wysłany
    await repo.updateStep(s1, { status: "draft", blocks: [to("Pierwsza odpowiedź", U, "Jedyna")] });
    const fd = new FormData(); fd.set("option", "0");
    await actions.approveStep(t.id, s1, fd);
    expect(draftsOf(await get(t.id, s1)).map((d) => d.status)).toEqual(["sent"]);
    const r = await call(client, "set_blocks", { stepId: s2, blocks: [to("Wariant A", V, "Opcja A"), to("Wariant B", U, "Opcja B")] });
    expect(r).toContain("Nie zapisałem"); expect(r).toContain("już wysłane"); expect(r).toContain(`[${s1}]`);
    expect(draftsOf(await get(t.id, s2))).toHaveLength(0);
    // obie do innych miejsc: zapis, krok czeka na wybór
    expect(await call(client, "set_blocks", { stepId: s2, blocks: [to("Wariant A", V, "Opcja A"), to("Wariant B", V.replace(/200$/, "300"), "Opcja B")] })).toContain("czeka na zatwierdzenie");
    expect(draftsOf(await get(t.id, s2)).map((d) => d.title)).toEqual(["Opcja A", "Opcja B"]);
  });
});
