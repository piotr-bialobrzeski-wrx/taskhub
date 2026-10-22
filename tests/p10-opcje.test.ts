// Paczka 10, punkt 3a: tożsamość szkicu po podpisie. Drugi blok draft w kroku to opcja; zgoda, wysyłka i poprawki trzymają się treści
// (approvalSig), nie pozycji w tablicy. Kartki z opcjami zapisuje tu wprost repo.updateStep (to samo, co robi set_blocks po coerceAgentDrafts).
// Punkt 3c: bieg wysyłki dostaje w get_task tylko wybraną opcję i zamyka krok mimo odrzuconej propozycji obok; poprawka z czatu trafia
// do wskazanej opcji; set_blocks sprawdza każdą opcję osobno pod kątem miejsca, do którego inny krok już wysłał.
// Poprawki po przeglądzie: odmowa zgody z powodem w rozmowie (opcja spoza karty, opcja obok już wysłanej, dwie opcje o tej samej treści),
// poprawka z czatu z nieznaną opcją nic nie zmienia, stary szkic bez bloku dalej zapisuje treść z pola, set_blocks liczy podpis po sanitizeBlocks.
// Przegląd 2: ostatnie kliknięcie wygrywa (jedna zatwierdzona opcja, „nieaktualny” znika po wyborze), krok bez zgody z tymi samymi odmowami,
// set_blocks nie dokłada propozycji obok wysłanego szkicu, dedupeOptions liczy podpis po sanitizeBlocks, composeStep z modelem wyrzuca powtórzoną opcję.
import { describe, it, expect, beforeAll, vi } from "vitest";
import type { Block, Step } from "@/lib/schema";
import { approvalSig, approveRefusal, coerceAgentDrafts, dedupeOptions, draftOf, draftsOf, optionIndex, optionLabel, optionsOf, shownSig, type Draft } from "@/lib/agent/approval";
import { draftsText } from "@/lib/agent/context";
import { targetLink } from "@/lib/stepcard";
import { Ai } from "@/lib/ai";
import { FakeProvider } from "./helpers";

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

describe("odmowa zgody z powodem i opcje z modelu w aplikacji (poprawki po przeglądzie)", () => {
  it("approveRefusal: brak takiej opcji, opcja obok już wysłanej, ta sama treść (także po poprawce z formularza); inaczej null", () => {
    const s = st([A, B]);
    expect(approveRefusal(s, { option: 1 })).toBeNull();
    expect(approveRefusal(s, {})).toContain("nie ma takiej opcji");
    expect(approveRefusal(s, { option: 5 })).toContain("nie ma takiej opcji");
    expect(approveRefusal(st([{ ...A, status: "sent" }, B]), { option: 1 })).toContain("już poszła");
    expect(approveRefusal(st([A, { ...A, title: "Kopia" }]), { option: 0 })).toContain("tę samą treść");
    expect(approveRefusal(s, { option: 0, body: B.body })).toContain("tę samą treść");
    expect(approveRefusal(s, { option: 0, body: "zupełnie inna" })).toBeNull();
    // jeden szkic: numer zbędny; stary szkic bez bloku: nic do sprawdzenia
    expect(approveRefusal(st([A]), {})).toBeNull();
    expect(approveRefusal(st([A]), { option: 0, body: "inna" })).toBeNull();
    expect(approveRefusal(st(null), { option: 0 })).toBeNull();
  });
  it("dedupeOptions: powtórzona treść i inna aplikacja niż pierwsza wypadają, klocki kontekstu zostają", () => {
    const text: Block = { type: "text", body: "Kontekst" };
    const Bc = D(B.body, { target: { app: "clickup", action: "update" } });
    expect(dedupeOptions("s1", [text, A, { ...A, title: "Kopia" }, Bc])).toEqual([text, A]);
    expect(dedupeOptions("s1", [text, A, B])).toEqual([text, A, B]);
    // adres spoza http(s) wypada przy zapisie, więc nie odróżnia dwóch opcji (podpis po sanitizeBlocks, jak w set_blocks)
    const bad = dedupeOptions("s1", [{ ...A, target: { ...A.target, url: "taskhub:abc" } }, A]);
    expect(bad).toHaveLength(1); expect(draftsOf({ blocks: bad }).map((d) => d.body)).toEqual([A.body]);
    expect(dedupeOptions("s1", [text])).toEqual([text]);
    expect(dedupeOptions("s1", [])).toEqual([]);
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
  const { composeStep } = await import("@/lib/agent/compose");
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
  it("(2) agent przepisuje kartkę z opcjami w odwróconej kolejności (set_blocks): zgoda zostaje na B", async () => {
    const { taskId, s } = await twoOptions();
    await approveB(taskId, s);
    expect(await call(client, "set_blocks", { stepId: s.id, blocks: [{ type: "text", body: "Kontekst" }, { ...B }, { ...A }] })).toContain("Panel zapisany");
    const after = await get(taskId, s.id);
    expect(after.status).toBe("handoff"); expect(after.approvedAt).not.toBeNull();
    expect(draftsOf(after).map((d) => [d.body, d.status])).toEqual([[B.body, "approved"], [A.body, "proposed"]]);
    expect(draftOf(after)?.body).toBe(B.body);
    expect(after.approvedSig).toBe(approvalSig(after, draftOf(after)!));
    expect(repo.isSendable(after)).toBe(true);
  });
  it("(3) set_blocks w handoff: poprawka odrzuconej A przechodzi, B dalej zatwierdzona; poprawka wybranej B = odmowa, zgoda zostaje", async () => {
    const { taskId, s } = await twoOptions();
    await approveB(taskId, s);
    expect(await call(client, "set_blocks", { stepId: s.id, blocks: [{ ...A, body: A.body + " (poprawka)" }, { ...B }] })).toContain("Panel zapisany");
    const a1 = await get(taskId, s.id);
    expect(a1.status).toBe("handoff"); expect(a1.approvedAt).not.toBeNull();
    expect(repo.isSendable(a1)).toBe(true);
    expect(draftsOf(a1).map((d) => [d.body, d.status])).toEqual([[A.body + " (poprawka)", "proposed"], [B.body, "approved"]]);
    // zmieniona B: po zapisie szkic kroku nie miałby stanu wybranej, więc odmowa i nic się nie zapisuje
    const r2 = await call(client, "set_blocks", { stepId: s.id, blocks: [{ ...A, body: A.body + " (poprawka)" }, { ...B, body: B.body + "!" }] });
    expect(r2).toContain("Nie zapisałem"); expect(r2).toContain("przy opcjach");
    const a2 = await get(taskId, s.id);
    expect(repo.isSendable(a2)).toBe(true);
    expect(draftsOf(a2).map((d) => d.status)).toEqual(["proposed", "approved"]);
    expect(draftsOf(a2)[1].body).toBe(B.body);
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
  // ---------- poprawki po przeglądzie ----------
  const chat = async (taskId: string) => (await repo.listChat(owner, taskId, 20)).map((m) => m.text);
  it("(10) stary szkic bez bloku: saveDraftBody z option 0 (tak binduje karta) zapisuje output", async () => {
    const t = await repo.createTask(owner, { title: "Opcje stary szkic", steps: [{ title: "Mail do Ani", tool: "gmail", needsApproval: true }] });
    const sid = t.steps[0].id;
    await repo.updateStep(sid, { status: "draft", output: "Treść maila" });
    await actions.saveDraftBody(t.id, sid, 0, "Treść po poprawce");
    expect((await get(t.id, sid)).output).toBe("Treść po poprawce");
    expect(draftsOf(await get(t.id, sid))).toHaveLength(0);
  });
  it("(11) krok bez zgody, opcja spoza karty: krok się nie zamyka, obie propozycje, jedna notatka „zanim go zatwierdziłeś”", async () => {
    const { taskId, s } = await twoOptions(false);
    const fd = new FormData(); fd.set("option", "5");
    await actions.approveStep(taskId, s.id, fd);
    const after = await get(taskId, s.id);
    expect(after.status).toBe("draft");
    expect(draftsOf(after).map((d) => d.status)).toEqual(["proposed", "proposed"]);
    expect(optionsOf(after).chosen).toBeNull();
    const notes = (await chat(taskId)).filter((x) => x.includes("zanim go zatwierdziłeś"));
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain("Nie zatwierdziłem „Odpisz na #dev”");
  });
  it("(12) opcja obok już wysłanej (krok z opcjami wysłał B, potem przywrócony do zrobienia): zgody na A nie ma, krok nie czeka na wysyłkę, notatka „już poszła”", async () => {
    const { taskId, sid, s } = await twoOptions();
    expect(repo.isSendable(await approveB(taskId, s))).toBe(true);
    expect(await repo.markSendStarted(owner, sid)).toBe(true);
    expect(await repo.completeSend(owner, sid, { summary: "Poszło na #dev." })).toBe(true);
    expect(draftsOf(await get(taskId, sid)).map((d) => d.status)).toEqual(["proposed", "sent"]);
    await actions.reopen(taskId, sid);
    const was = await get(taskId, sid);
    expect(was.status).toBe("todo"); expect(was.approvedAt).toBeNull();
    expect(draftsOf(was).map((d) => d.status)).toEqual(["proposed", "sent"]);
    expect(await repo.approveDraft(owner, sid, { option: 0 })).toBe(false);
    // formularz A z podpisami z karty (dociera tylko ze starej karty: odświeżona nie ma przycisku)
    const a = draftsOf(was)[0];
    const fd = new FormData(); fd.set("option", "0"); fd.set("seen", shownSig(was, a, true)); fd.set("seenFull", shownSig(was, a, false));
    await actions.approveStep(taskId, sid, fd);
    const after = await get(taskId, sid);
    expect(after.status).toBe("todo"); expect(after.approvedAt).toBeNull(); expect(after.approvedSig).toBeNull();
    expect(draftsOf(after).map((d) => d.status)).toEqual(["proposed", "sent"]);
    expect(repo.isSendable(after)).toBe(false);
    const notes = (await chat(taskId)).filter((x) => x.includes("Nie zatwierdziłem"));
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain("już poszła");
  });
  it("(13) dwie opcje o tej samej treści pod różnymi nazwami: „Zatwierdź” nie przechodzi po cichu, jedna notatka „tę samą treść”", async () => {
    const { taskId, s } = await twoOptions(true, [A, { ...A, title: "Kopia" }]);
    const a = draftsOf(s)[0];
    const fd = new FormData(); fd.set("option", "0"); fd.set("seen", shownSig(s, a, true)); fd.set("seenFull", shownSig(s, a, false));
    await actions.approveStep(taskId, s.id, fd);
    const after = await get(taskId, s.id);
    expect(after.status).toBe("draft"); expect(after.approvedAt).toBeNull();
    expect(draftsOf(after).map((d) => d.status)).toEqual(["proposed", "proposed"]);
    const notes = (await chat(taskId)).filter((x) => x.includes("Nie zatwierdziłem"));
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain("tę samą treść");
    expect(notes[0]).not.toContain("zmienił się");
    // bez podpisu z karty (sam numer opcji) ten sam powód; bez numeru przy opcjach: „nie ma takiej opcji”
    const fd2 = new FormData(); fd2.set("option", "0");
    await actions.approveStep(taskId, s.id, fd2);
    expect((await chat(taskId)).filter((x) => x.includes("tę samą treść"))).toHaveLength(2);
    await actions.approveStep(taskId, s.id);
    expect((await chat(taskId)).filter((x) => x.includes("nie ma takiej opcji"))).toHaveLength(1);
    expect((await get(taskId, s.id)).approvedAt).toBeNull();
  });
  it("(14) set_blocks: adres spoza http(s) nie odróżnia dwóch opcji o tej samej treści (podpis po sanitizeBlocks, jak przy zapisie i zgodzie)", async () => {
    const { taskId, s } = await twoOptions(true, []);
    const r = await call(client, "set_blocks", { stepId: s.id, blocks: [{ ...A, target: { ...A.target, url: "taskhub:abc" } }, { ...A }] });
    expect(r).toContain("Nie zapisałem"); expect(r).toContain("tej samej treści");
    expect(draftsOf(await get(taskId, s.id))).toHaveLength(0);
    // adres http(s) odróżnia opcje jak dotąd
    expect(await call(client, "set_blocks", { stepId: s.id, blocks: [{ ...A, target: { ...A.target, url: "https://x.slack.com/archives/C1/p1700000000000900" } }, { ...A, title: "Bez adresu" }] })).toContain("Panel zapisany");
    expect(draftsOf(await get(taskId, s.id))).toHaveLength(2);
  });
  it("(15) poprawka z czatu z nieznaną opcją: nic się nie zmienia, zgoda na B zostaje, notatka „Nie ma opcji” z listą opcji", async () => {
    const { taskId, s } = await twoOptions();
    expect(repo.isSendable(await approveB(taskId, s))).toBe(true);
    const done = await applyActions({ reply: "", actions: [{ type: "update_step", id: s.id, output: "Poprawka do wariantu C", option: "Opcja C" }] }, await chatDeps(taskId));
    expect(done.map((d) => d.label)).toEqual(["Nie zmieniono: Odpisz na #dev"]);
    expect(done[0].note).toContain("Nie ma opcji „Opcja C” w kroku „Odpisz na #dev”");
    expect(done[0].note).toContain("opcje: Krótko, Opcja B");
    const after = await get(taskId, s.id);
    expect(after.status).toBe("handoff"); expect(after.approvedAt).not.toBeNull();
    expect(draftsOf(after).map((d) => [d.body, d.status])).toEqual([[A.body, "proposed"], [B.body, "approved"]]);
    expect(repo.isSendable(after)).toBe(true);
    // numer spoza zakresu też jest odmową; bez option poprawka idzie jak dotąd
    expect((await applyActions({ reply: "", actions: [{ type: "update_step", id: s.id, output: "x", option: 7 }] }, await chatDeps(taskId)))[0].note).toContain("Nie ma opcji „7”");
    expect(draftsOf(await get(taskId, s.id)).map((d) => d.body)).toEqual([A.body, B.body]);
  });
  // ---------- przegląd 2 ----------
  it("(16) dwa kliknięcia zanim karta się odświeżyła (B, potem A): ostatnie wygrywa, jedna zatwierdzona opcja, podpis szkicu kroku, bieg wysyłki widzi jedną sekcję", async () => {
    const { taskId, s } = await twoOptions();
    const mid = await approveB(taskId, s);
    expect(mid.status).toBe("handoff");
    expect(draftsOf(mid).map((d) => d.status)).toEqual(["proposed", "approved"]);
    // formularz A z podpisami, które karta wyliczyła przed pierwszym kliknięciem (ta sama kartka, drugi przycisk)
    const a = draftsOf(s)[0];
    const fd = new FormData(); fd.set("option", "0"); fd.set("seen", shownSig(s, a, true)); fd.set("seenFull", shownSig(s, a, false));
    await actions.approveStep(taskId, s.id, fd);
    const after = await get(taskId, s.id);
    expect(after.status).toBe("handoff"); expect(after.approvedAt).not.toBeNull();
    expect(draftsOf(after).map((d) => d.status)).toEqual(["approved", "proposed"]);
    expect(after.approvedSig).toBe(approvalSig(after, draftsOf(after)[0]));
    expect(draftOf(after)?.body).toBe(A.body);
    expect(optionsOf(after).chosen?.body).toBe(A.body);
    expect(repo.isSendable(after)).toBe(true);
    const forSender = draftsText([after], { send: () => true });
    expect(forSender.match(/SZKIC KROKU/g)).toHaveLength(1);
    expect(forSender).toContain("ZATWIERDZONY: wyślij dokładnie tę treść"); expect(forSender).toContain(A.body); expect(forSender).not.toContain(B.body);
    expect((await chat(taskId)).filter((x) => x.includes("Nie zatwierdziłem"))).toHaveLength(0);
  });
  it("(17) po wyborze „nieaktualny” znika z każdej opcji: odrzuconej nikt nie szykuje od nowa, karta nie pokazuje noty o zmianie zakresu", async () => {
    const { taskId, s } = await twoOptions(true, [{ ...A, stale: true }, B]);
    expect(draftsOf(s).map((d) => !!d.stale)).toEqual([true, false]);
    const after = await approveB(taskId, s);
    expect(after.status).toBe("handoff");
    expect(draftsOf(after).map((d) => d.status)).toEqual(["proposed", "approved"]);
    expect(draftsOf(after).some((d) => d.stale)).toBe(false);
    expect(repo.isSendable(after)).toBe(true);
  });
  it("(18) krok bez zgody po przywróceniu: opcja obok już wysłanej nie zamyka kroku, B zostaje propozycją, jedna notatka „już poszła”; ta sama treść też odmowa", async () => {
    const { taskId, s } = await twoOptions(false);
    const fd = new FormData(); fd.set("option", "0");
    await actions.approveStep(taskId, s.id, fd);
    expect((await get(taskId, s.id)).status).toBe("done");
    await actions.reopen(taskId, s.id);
    const was = await get(taskId, s.id);
    expect(was.status).toBe("draft");
    expect(draftsOf(was).map((d) => d.status)).toEqual(["sent", "proposed"]);
    const fd2 = new FormData(); fd2.set("option", "1");
    await actions.approveStep(taskId, s.id, fd2);
    const after = await get(taskId, s.id);
    expect(after.status).toBe("draft"); expect(after.doneAt).toBeNull();
    expect(draftsOf(after).map((d) => d.status)).toEqual(["sent", "proposed"]);
    const notes = (await chat(taskId)).filter((x) => x.includes("Nie zatwierdziłem"));
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain("Nie zatwierdziłem „Odpisz na #dev”"); expect(notes[0]).toContain("już poszła");
    // dwie opcje o tej samej treści bez zgody: krok też się nie zamyka
    const same = await twoOptions(false, [A, { ...A, title: "Kopia" }]);
    const fd3 = new FormData(); fd3.set("option", "0");
    await actions.approveStep(same.taskId, same.sid, fd3);
    expect((await get(same.taskId, same.sid)).status).toBe("draft");
    expect(draftsOf(await get(same.taskId, same.sid)).map((d) => d.status)).toEqual(["proposed", "proposed"]);
    expect((await chat(same.taskId)).filter((x) => x.includes("tę samą treść"))).toHaveLength(1);
  });
  it("(19) set_blocks obok wysłanego szkicu (krok przywrócony do zrobienia): druga propozycja to odmowa „już poszedł”, sam kontekst się zapisuje", async () => {
    const { taskId, sid, s } = await twoOptions(true, [A]);
    const fd = new FormData(); fd.set("seen", shownSig(s, A, true)); fd.set("seenFull", shownSig(s, A, false));
    await actions.approveStep(taskId, sid, fd);
    expect(await repo.markSendStarted(owner, sid)).toBe(true);
    expect(await repo.completeSend(owner, sid, { summary: "Poszło na #dev." })).toBe(true);
    await actions.reopen(taskId, sid);
    expect((await get(taskId, sid)).status).toBe("todo");
    const r = await call(client, "set_blocks", { stepId: sid, blocks: [A, B] });
    expect(r).toContain("Nie zapisałem"); expect(r).toContain("już poszedł"); expect(r).toContain("add_steps");
    expect(draftsOf(await get(taskId, sid)).map((d) => d.status)).toEqual(["sent"]);
    // inny szkic zamiast wysłanego też nie: wysłanego nie da się cofnąć
    expect(await call(client, "set_blocks", { stepId: sid, blocks: [B] })).toContain("już poszedł");
    expect(draftsOf(await get(taskId, sid)).map((d) => [d.body, d.status])).toEqual([[A.body, "sent"]]);
    // sam kontekst przy tym samym wysłanym szkicu: zapis, szkic dalej wysłany, krok dalej do zrobienia
    expect(await call(client, "set_blocks", { stepId: sid, blocks: [{ type: "text", body: "Kontekst" }, A] })).toContain("Panel zapisany");
    const after = await get(taskId, sid);
    expect(after.status).toBe("todo");
    expect(statuses(after.blocks!)).toEqual(["text", "sent"]);
  });
  it("(20) composeStep z modelem w aplikacji: powtórzona opcja i opcja do innej aplikacji wypadają przed zapisem, klocek kontekstu zostaje", async () => {
    const text: Block = { type: "text", body: "Kontekst" };
    const Bc = D(B.body, { target: { app: "clickup", action: "update" } });
    const t = await repo.createTask(owner, { title: "Opcje compose", steps: [{ title: "Odpisz na #dev", tool: "claude", needsApproval: true }] });
    const step = t.steps[0];
    const fake = new FakeProvider("anthropic", [{ blocks: [text, A, { ...A, title: "Kopia" }, Bc], facts: [] }]);
    const r = await composeStep(owner, t, step, { ai: new Ai("anthropic", { anthropic: fake }), rules: [], factPrefs: "" });
    expect(r.usedAi).toBe(true); expect(fake.calls).toHaveLength(1);
    expect(r.blocks).toEqual([text, A]);
    const after = await get(t.id, step.id);
    expect(draftsOf(after)).toEqual([A]);
    expect(after.blocks).toHaveLength(2);
  });
});
