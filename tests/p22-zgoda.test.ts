// Paczka 22: ochrona zgody na szkice. Agent zapisuje szkic tylko jako propozycję (inny stan to błąd), zgoda tylko z kliknięcia Piotra
// z trwałym zapisem (kto, kiedy, podpis, początek treści), wysyłka sprawdza zapis i treść, karta i get_task pokazują, kto i kiedy zatwierdził,
// zapis odtworzony z biegów wysyłki dla starszych kroków. Część z bazą pomijana bez TEST_DATABASE_URL.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { Block } from "@/lib/schema";
import { approvalSig, approvalValid, forgedDraftStatus, type Draft } from "@/lib/agent/approval";
import { approvalNote } from "@/components/PublishCard";

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/session", async (orig) => ({ ...(await orig<typeof import("@/lib/session")>()), requireOwner: async () => (await import("@/lib/repo")).ensureOwner() }));

const DB = !!process.env.TEST_DATABASE_URL;
const draft = (body: string, status: Draft["status"] = "proposed"): Draft => ({ type: "draft", target: { app: "slack", where: "#dev", action: "send" }, body, status });

describe("stan szkicu od agenta i zapis zgody (bez bazy)", () => {
  it("agent nie nadaje stanu: nowy „zatwierdzony” albo „wysłany” to próba podrobienia; ten sam zapisany szkic przechodzi", () => {
    const empty = { id: "s1", blocks: null };
    expect(forgedDraftStatus(empty, [draft("A")])).toBeNull();
    expect(forgedDraftStatus(empty, [draft("A", "approved")])).toBe("approved");
    expect(forgedDraftStatus(empty, [draft("A", "sent")])).toBe("sent");
    const approved = { id: "s1", blocks: [draft("A", "approved")] as Block[] };
    expect(forgedDraftStatus(approved, [{ type: "text", body: "Kontekst" }, draft("A", "approved")])).toBeNull();
    expect(forgedDraftStatus(approved, [draft("B", "approved")])).toBe("approved");
    expect(forgedDraftStatus(approved, [draft("A", "sent")])).toBe("sent");
  });
  it("zgoda bez zapisu kliknięcia albo z innym podpisem w zapisie jest nieważna", () => {
    const s = { id: "s1", status: "handoff" as const, blocks: [draft("A", "approved")] as Block[], approvedAt: "2026-10-27T10:00:00Z" };
    const sig = approvalSig(s, s.blocks[0] as Draft);
    expect(approvalValid({ ...s, approvedSig: sig })).toBe(true);   // bez wczytanego zapisu (stare wywołania): sam podpis
    expect(approvalValid({ ...s, approvedSig: sig, approval: { at: s.approvedAt, by: "owner", sig, source: "click" } })).toBe(true);
    expect(approvalValid({ ...s, approvedSig: sig, approval: null })).toBe(false);
    expect(approvalValid({ ...s, approvedSig: sig, approval: { at: s.approvedAt, by: "owner", sig: "inny", source: "click" } })).toBe(false);
    expect(approvalValid({ ...s, approvedSig: sig, approval: { at: null, before: s.approvedAt, by: "owner", source: "send-run" } })).toBe(false);
  });
  it("karta mówi, kto i kiedy zatwierdził; wysłany szkic bez zapisu zgody to ostrzeżenie", () => {
    expect(approvalNote({ approval: { at: "2026-10-27T10:42:00Z", by: "owner", source: "click" }, approvedAt: null }, true)?.text).toBe("Zatwierdziłeś 27 paź 2026, 11:42");
    expect(approvalNote({ approval: { at: null, before: "2026-10-22T09:44:00Z", by: "owner", source: "send-run" }, approvedAt: null }, true)?.text).toBe("Zatwierdziłeś przed 22 paź 2026, 11:44");
    expect(approvalNote({ approval: null, approvedAt: null }, true)).toEqual({ text: "Brak zapisu Twojej zgody na ten szkic", warn: true });
    expect(approvalNote({ approval: null, approvedAt: null }, false)).toBeNull();
  });
});

describe.skipIf(!DB)("zgoda na szkic w bazie", async () => {
  const repo = await import("@/lib/repo");
  const { sql } = await import("@/lib/db");
  const actions = await import("@/app/actions");
  const mcp = await import("@/app/api/mcp/route");
  let owner = "", client = "";
  const get = async (taskId: string, stepId: string) => (await repo.getTask(owner, taskId))!.steps.find((s) => s.id === stepId)!;
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = await mcp.POST(new Request("http://x/api/mcp", { method: "POST", headers: { authorization: `Bearer ${client}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) }));
    const m = (await r.text()).split("\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6))).find((x) => x.id === 1);
    return { text: ((m?.result?.content ?? []) as { text?: string }[]).map((c) => c.text ?? "").join("\n"), isError: !!m?.result?.isError };
  };
  const slackStep = async (title: string, needsApproval = true) => {
    const t = await repo.createTask(owner, { title, steps: [{ title, tool: "slack", needsApproval }] });
    return { taskId: t.id, stepId: t.steps[0].id };
  };

  beforeAll(async () => {
    owner = (await repo.ensureOwner()).id;
    await sql()`delete from tasks where owner_id = ${owner}`;
    await sql()`delete from bridge_runs where owner_id = ${owner}`;
    await sql()`delete from connections where owner_id = ${owner}`;
    client = await repo.createApiToken(owner, "Claude", "client");
    await repo.upsertBridgeConnections(owner, "mini", [{ name: "claude.ai Slack", ok: true }]);
  });
  afterAll(async () => { await sql().end({ timeout: 2 }); });

  it("szkic agenta czeka na zgodę; kliknięcie zapisuje kto, kiedy, podpis i początek treści; zapis zostaje po wysyłce", async () => {
    const { taskId, stepId } = await slackStep("Napisz na #dev");
    const no = await call("set_blocks", { stepId, blocks: [draft("Cześć zespole, wdrożenie o 15:00", "approved")] });
    expect(no.isError).toBe(true);
    expect((await call("set_blocks", { stepId, blocks: [draft("Cześć zespole, wdrożenie o 15:00")] })).text).toContain("czeka na zatwierdzenie");
    expect((await get(taskId, stepId)).approval).toBeNull();
    await actions.approveStep(taskId, stepId);
    let s = await get(taskId, stepId);
    expect(s.approval).toMatchObject({ by: "owner", source: "click", sig: s.approvedSig, excerpt: "Cześć zespole, wdrożenie o 15:00" });
    expect(s.approval?.at).toBe(s.approvedAt);
    expect(await repo.markSendStarted(owner, stepId)).toBe(true);
    expect(await repo.completeSend(owner, stepId, { summary: "Wysłane na #dev" })).toBe(true);
    s = await get(taskId, stepId);
    expect(s.status).toBe("done"); expect(s.approvedAt).toBeNull();
    expect(s.approval?.source).toBe("click");
    expect((await call("get_task", { taskId })).text).toMatch(/zrobił: Claude \| zgoda Piotra: \d+ paź 2026, \d\d:\d\d/);
    // przywrócenie do zrobienia kasuje zapis: nowa wysyłka to nowa zgoda
    await sql()`update steps set blocks = ${sql().json([draft("Inna treść")] as never)} where id = ${stepId}`;
    await actions.reopen(taskId, stepId);
    expect((await get(taskId, stepId)).approval).toBeNull();
  });

  it("zmiana szkicu po zgodzie cofa zgodę i jej zapis; wysyłka nic nie bierze, krok wraca do zatwierdzenia", async () => {
    const { taskId, stepId } = await slackStep("Odpisz Kindze");
    await repo.updateStep(stepId, { status: "draft", blocks: [draft("Wersja 1")] });
    await actions.approveStep(taskId, stepId);
    expect(repo.isSendable(await get(taskId, stepId))).toBe(true);
    await repo.updateStep(stepId, { blocks: [draft("Wersja 2", "approved")] });
    const s = await get(taskId, stepId);
    expect(s).toMatchObject({ status: "draft", approvedAt: null, approval: null });
    expect(await repo.markSendStarted(owner, stepId)).toBe(false);
  });

  it("zapis zgody inny niż podpis (zgoda nie z kliknięcia) blokuje wysyłkę", async () => {
    const { taskId, stepId } = await slackStep("Wiadomość do zespołu");
    await repo.updateStep(stepId, { status: "draft", blocks: [draft("Treść")] });
    await actions.approveStep(taskId, stepId);
    await sql()`update steps set approval = null where id = ${stepId}`;
    expect(repo.isSendable(await get(taskId, stepId))).toBe(false);
    expect(await repo.markSendStarted(owner, stepId)).toBe(false);
  });

  it("szkic do Slacka w kroku bez „wymaga zgody”: „Zatwierdź” nie zamyka kroku jako wysłanego, tylko daje zgodę do wysyłki", async () => {
    const { taskId, stepId } = await slackStep("Odpisz w wątku", false);
    await repo.updateStep(stepId, { status: "draft", blocks: [draft("Dzięki, biorę to")] });
    await actions.approveStep(taskId, stepId);
    const s = await get(taskId, stepId);
    expect(s).toMatchObject({ status: "handoff", needsApproval: true });
    expect(repo.draftOf(s)?.status).toBe("approved");
    expect(s.approval?.source).toBe("click");
  });

  it("migracja odtwarza zapis zgody z biegu wysyłki dla wysłanych kroków bez zapisu", async () => {
    const { taskId, stepId } = await slackStep("Stara wysyłka");
    await repo.updateStep(stepId, { status: "draft", blocks: [draft("Stara treść")] });
    await actions.approveStep(taskId, stepId);
    const run = await repo.startBridgeRun(owner, null, "mini", "send", stepId);
    expect(run).not.toBeNull();
    await sql()`update bridge_runs set started_at = '2026-10-22T09:44:00Z', ended_at = now() where id = ${run!.id}`;
    await sql()`update steps set status = 'done', approved_at = null, approved_sig = null, approval = null where id = ${stepId}`;
    await sql().unsafe(readFileSync("supabase/migrations/0026_approval_record.sql", "utf8"));
    const s = await get(taskId, stepId);
    expect(s.approval).toMatchObject({ at: null, source: "send-run", by: "owner" });
    expect(new Date(s.approval!.before!).toISOString()).toBe("2026-10-22T09:44:00.000Z");
  });
});
