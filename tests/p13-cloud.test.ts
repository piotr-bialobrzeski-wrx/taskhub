// „Uruchom w chmurze” (paczka 13, punkt 3): kliknięcie Piotra → mostek dostaje zlecenie do odpalenia chmury → sesja w chmurze bierze krok
// (cloud_work / take_cloud_step) → complete_step. Bieg mostka i automat takiego kroku nie widzą. Część z bazą pomijana bez TEST_DATABASE_URL.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { isDeployStep, isProjectStep, projectPrompt } from "@/lib/stepcard";
import type { Step } from "@/lib/schema";

const step = (o: Partial<Step>): Step => ({ id: "s", taskId: "t", position: 0, title: "", detail: "", tool: "manual", status: "todo", prevStatus: null, needsApproval: false, estMin: 10, spentSec: 0, spentManual: false, link: null, handoffAt: null, doneAt: null, report: null, output: "", review: null, blocks: null, blocksAt: null, logged: false, pos: null, dependsOn: [], connectionId: null, ...o });

describe("krok „Wdróż na produkcję” (paczka 13)", () => {
  it("krok Piotra „Wdróż na produkcję” idzie do chmury jak „Zleć w projekcie”", () => {
    expect(isProjectStep({ tool: "manual", title: "Wdróż na produkcję" })).toBe(true);
    expect(isDeployStep({ tool: "manual", title: "Wdróż na produkcje paczkę 13" })).toBe(true);
    expect(isDeployStep({ tool: "code", title: "Wdróż na produkcję" })).toBe(false);
    expect(isDeployStep({ tool: "manual", title: "Zleć w projekcie: x" })).toBe(false);
  });
  it("polecenie wdrożenia: zgoda Piotra na paczkę i co zgłosić na końcu", () => {
    const s = step({ id: "d", title: "Wdróż na produkcję" });
    const p = projectPrompt({ id: "t1", title: "Paczka", steps: [s] }, s, "https://th.example");
    expect(p).toContain("Wdróż na produkcję bieżącą paczkę zmian Task Hub");
    expect(p).toContain("krok 01");
    expect(p).toContain("complete_step");
  });
});

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/session", async (orig) => ({ ...(await orig<typeof import("@/lib/session")>()), requireOwner: async () => (await import("@/lib/repo")).ensureOwner() }));

describe.skipIf(!process.env.TEST_DATABASE_URL)("Uruchom w chmurze: kliknięcie, odpalenie z Maca, wzięcie przez chmurę", async () => {
  const repo = await import("@/lib/repo");
  const { sql } = await import("@/lib/db");
  const work = await import("@/app/api/bridge/work/route");
  const cloud = await import("@/app/api/bridge/cloud/route");
  const run = await import("@/app/api/bridge/run/route");
  const mcp = await import("@/app/api/mcp/route");
  const actions = await import("@/app/actions");
  const { CLOUD_TRIGGER } = await import("@/lib/bridge");
  let owner = "", bridge = "", client = "";
  const H = (t: string) => ({ Authorization: `Bearer ${t}` });
  const call = async (t: string, name: string, args: Record<string, unknown>) => {
    const r = await mcp.POST(new Request("http://x/api/mcp", { method: "POST", headers: { authorization: `Bearer ${t}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) }));
    const msgs = (await r.text()).split("\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6)));
    const m = msgs.find((x) => x.id === 1);
    return ((m?.result?.content ?? []) as { text?: string }[]).map((c) => c.text ?? "").join("\n") + (m?.error ? m.error.message : "");
  };
  const poll = async () => (await work.GET(new Request("http://x/api/bridge/work?v=2&host=mini", { headers: H(bridge) }))).json();
  const rung = async (body: Record<string, unknown>) => (await cloud.POST(new Request("http://x/api/bridge/cloud", { method: "POST", headers: H(bridge), body: JSON.stringify(body) }))).json();
  const stepNow = async (taskId: string, id: string) => (await repo.getTask(owner, taskId))!.steps.find((x) => x.id === id)!;

  beforeAll(async () => {
    owner = (await repo.ensureOwner()).id;
    await sql()`delete from tasks where owner_id = ${owner}`;
    await sql()`delete from bridge_runs where owner_id = ${owner}`;
    await sql()`delete from api_tokens where owner_id = ${owner}`;
    await sql()`delete from chat_messages where owner_id = ${owner}`;
    bridge = await repo.createApiToken(owner, "mini", "bridge");
    client = await repo.createApiToken(owner, "Claude", "client");
  });
  afterAll(async () => { await sql().end({ timeout: 2 }); });

  it("pełna droga: klik → mostek odpala chmurę → chmura bierze krok → complete_step; bieg mostka kroku nie widzi", async () => {
    const t = await repo.createTask(owner, { title: "Eskalacja", steps: [{ title: "Zleć w projekcie: eskalacja bez oddań", tool: "manual", detail: "Popraw leave_step." }, { title: "Popraw opis", tool: "manual" }] });
    const [s, other] = t.steps;
    expect((await poll()).cloud).toBeUndefined();
    // zwykły krok Piotra nie idzie do chmury; krok „Zleć w projekcie” tak, raz
    await actions.runInCloud(t.id, other.id);
    expect((await stepNow(t.id, other.id)).cloud).toBeNull();
    await actions.runInCloud(t.id, s.id);
    await actions.runInCloud(t.id, s.id);
    expect((await stepNow(t.id, s.id)).cloud?.state).toBe("queued");
    expect((await poll()).cloud).toEqual({ count: 1, trigger: CLOUD_TRIGGER });
    // Mac odpalił chmurę: następne pytanie już nie każe odpalać
    expect(await rung({ ok: true })).toEqual({ ok: true, rung: 1 });
    expect((await poll()).cloud).toBeUndefined();
    expect((await stepNow(t.id, s.id)).cloud?.state).toBe("rung");
    // bieg pracy mostka: cloud_work i take_cloud_step odmawiają
    const b = await (await run.POST(new Request("http://x/api/bridge/run", { method: "POST", headers: H(bridge), body: JSON.stringify({ bridge: "mini", v: 2, kind: "work" }) }))).json();
    if (b.token) {
      expect(await call(b.token, "cloud_work", {})).toContain("nie bieg mostka");
      expect(await call(b.token, "take_cloud_step", { stepId: s.id })).toContain("nie bieg mostka");
      await repo.endBridgeRun(owner, b.run.id, "done");
    }
    // konektor w chmurze: lista z poleceniem, wzięcie najwyżej raz
    const list = await call(client, "cloud_work", {});
    expect(list).toContain(s.id);
    expect(list).toContain("Zrób krok z Task Hub: eskalacja bez oddań.");
    expect(list).not.toContain(other.id);
    expect(await call(client, "take_cloud_step", { stepId: s.id })).toContain("Krok w toku");
    expect(await call(client, "take_cloud_step", { stepId: s.id })).toContain("Nie wziąłem");
    const w1 = await stepNow(t.id, s.id);
    expect(w1.status).toBe("handoff");
    expect(w1.cloud?.state).toBe("working");
    expect(await call(client, "cloud_work", {})).toBe("Nic nie czeka na chmurę.");
    // w toku w chmurze: list_work (automat, bieg) go nie pokazuje
    expect(await call(client, "list_work", { force: true })).not.toContain(s.id);
    expect(await call(client, "complete_step", { stepId: s.id, summary: "Poprawione na gałęzi paczki 13." })).toContain("Krok zapisany");
    const done = await stepNow(t.id, s.id);
    expect(done.status).toBe("done");
    expect(done.doneBy).toBe("owner");
    expect(done.cloud).toBeNull();
  });

  it("wycofanie, oddanie i błąd odpalenia: zlecenie gaśnie albo czeka z jedną notatką", async () => {
    const t = await repo.createTask(owner, { title: "Wdrożenie", steps: [{ title: "Wdróż na produkcję", tool: "manual" }] });
    const s = t.steps[0];
    await actions.runInCloud(t.id, s.id);
    await actions.cancelCloudRun(t.id, s.id);
    expect((await stepNow(t.id, s.id)).cloud).toBeNull();
    // błąd odpalenia: jedna notatka w rozmowie, zlecenie czeka dalej
    await actions.runInCloud(t.id, s.id);
    await rung({ ok: false, note: "brak narzędzia RemoteTrigger" });
    await rung({ ok: false, note: "brak narzędzia RemoteTrigger" });
    const notes = (await repo.listChat(owner, t.id, 50)).filter((m) => m.text.includes("Mac nie odpalił chmury"));
    expect(notes).toHaveLength(1);
    expect((await poll()).cloud?.count).toBe(1);
    // chmura bierze i oddaje: krok wraca do zrobienia bez zlecenia (nie wraca sam do chmury)
    expect(await call(client, "take_cloud_step", { stepId: s.id })).toContain("Krok w toku");
    expect(await call(client, "leave_step", { stepId: s.id, reason: "brak dostępu do repozytorium" })).toContain("Krok oddany");
    const back = await stepNow(t.id, s.id);
    expect(back.status).toBe("todo");
    expect(back.cloud).toBeNull();
    expect((await poll()).cloud).toBeUndefined();
  });
});
