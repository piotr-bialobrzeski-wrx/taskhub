// Paczka 14, punkt 1: oddanie z czekania nie podnosi poziomu, krok czekający na inny krok nie wraca do list_work przed nim,
// krok z kodem w projekcie Task Hub nie trafia do biegów mostka (Piotr zleca go chmurze). Część z bazą pomijana bez TEST_DATABASE_URL.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { WAIT_RE, waitTarget } from "@/lib/agent/work";
import { isAppCodeStep } from "@/lib/schema";
import { isProjectStep, projectPrompt } from "@/lib/stepcard";

describe("powód czekania i krok, na który czeka", () => {
  it("„czeka na …” i „do zrobienia w projekcie w chmurze” to czekanie; brak narzędzia nie", () => {
    expect(WAIT_RE.test("Czeka na bieg kroku researchu")).toBe(true);
    expect(WAIT_RE.test("czekam na inny bieg")).toBe(true);
    expect(WAIT_RE.test("„Czeka na krok 02”")).toBe(true);
    expect(WAIT_RE.test("Do zrobienia w projekcie w chmurze")).toBe(true);
    expect(WAIT_RE.test("brak narzędzia do ClickUpa")).toBe(false);
    expect(WAIT_RE.test("nie rozumiem opisu; czeka na Piotra")).toBe(false);
    expect(WAIT_RE.test("czekanie nic nie da")).toBe(false);
  });
  it("cel: id w powodzie, potem tytuł w cudzysłowie (najpierw w tym samym zadaniu); siebie i bez czekania nie liczy", () => {
    const self = { id: "11111111-1111-4111-8111-111111111111", taskId: "a", title: "Przetestuj dobór" };
    const steps = [self,
      { id: "22222222-2222-4222-8222-222222222222", taskId: "b", title: "Zbierz flagi kosztu biegu Claude Code" },
      { id: "33333333-3333-4333-8333-333333333333", taskId: "a", title: "Popraw opis" },
      { id: "44444444-4444-4444-8444-444444444444", taskId: "c", title: "Popraw opis" },
      { id: "55555555-5555-4555-8555-555555555555", taskId: "c", title: "Wspólny" },
      { id: "66666666-6666-4666-8666-666666666666", taskId: "d", title: "Wspólny" }];
    expect(waitTarget("Czeka na bieg kroku researchu „Zbierz flagi kosztu biegu Claude Code” w zadaniu testowym", self, steps)).toBe(steps[1].id);
    expect(waitTarget(`czeka na krok ${steps[1].id.toUpperCase()}`, self, steps)).toBe(steps[1].id);
    expect(waitTarget("czeka na „Popraw opis”", self, steps)).toBe(steps[2].id);
    expect(waitTarget("czeka na „Wspólny”", self, steps)).toBeNull();
    expect(waitTarget(`czeka na ${self.id}`, self, steps)).toBeNull();
    expect(waitTarget("brak danych z „Zbierz flagi kosztu biegu Claude Code”", self, steps)).toBeNull();
  });
  it("krok z kodem w projekcie Task Hub idzie do chmury; w innym projekcie i bez projektu nie", () => {
    expect(isAppCodeStep({ tool: "code" }, "Task Hub")).toBe(true);
    expect(isAppCodeStep({ tool: "code" }, "taskhub")).toBe(true);
    expect(isAppCodeStep({ tool: "code" }, "Shiftwow")).toBe(false);
    expect(isAppCodeStep({ tool: "code" }, null)).toBe(false);
    expect(isAppCodeStep({ tool: "claude" }, "Task Hub")).toBe(false);
    expect(isProjectStep({ tool: "code", title: "Dodaj grupy projektów" }, "Task Hub")).toBe(true);
    expect(isProjectStep({ tool: "code", title: "Dodaj grupy projektów" })).toBe(false);
    const s = { id: "s", title: "Dodaj grupy projektów na głównej kanwie", detail: "Grupy jak na kanwie zadania." };
    expect(projectPrompt({ id: "t", title: "Grupy", steps: [s as never] }, s, "https://th.example")).toContain("Zrób krok z Task Hub: Dodaj grupy projektów na głównej kanwie.");
  });
});

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/session", async (orig) => ({ ...(await orig<typeof import("@/lib/session")>()), requireOwner: async () => (await import("@/lib/repo")).ensureOwner() }));

describe.skipIf(!process.env.TEST_DATABASE_URL)("oddanie z czekania, czekanie na krok, kod Task Hub poza mostkiem", async () => {
  const repo = await import("@/lib/repo");
  const { sql } = await import("@/lib/db");
  const run = await import("@/app/api/bridge/run/route");
  const mcp = await import("@/app/api/mcp/route");
  const actions = await import("@/app/actions");
  let owner = "", bridge = "", client = "";
  const H = (t: string) => ({ Authorization: `Bearer ${t}` });
  const call = async (t: string, name: string, args: Record<string, unknown>) => {
    const r = await mcp.POST(new Request("http://x/api/mcp", { method: "POST", headers: { authorization: `Bearer ${t}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) }));
    const msgs = (await r.text()).split("\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6)));
    const m = msgs.find((x) => x.id === 1);
    return ((m?.result?.content ?? []) as { text?: string }[]).map((c) => c.text ?? "").join("\n") + (m?.error ? m.error.message : "");
  };
  const workRun = async () => (await (await run.POST(new Request("http://x/api/bridge/run", { method: "POST", headers: H(bridge), body: JSON.stringify({ bridge: "mini", v: 2, kind: "work" }) }))).json()) as { token: string; run: { id: string } };
  const stepNow = async (taskId: string, id: string) => (await repo.getTask(owner, taskId))!.steps.find((x) => x.id === id)!;

  beforeAll(async () => {
    owner = (await repo.ensureOwner()).id;
    await sql()`delete from tasks where owner_id = ${owner}`;
    await sql()`delete from projects where owner_id = ${owner}`;
    await sql()`delete from bridge_runs where owner_id = ${owner}`;
    await sql()`delete from api_tokens where owner_id = ${owner}`;
    await sql()`delete from chat_messages where owner_id = ${owner}`;
    bridge = await repo.createApiToken(owner, "mini", "bridge");
    client = await repo.createApiToken(owner, "Claude", "client");
  });
  afterAll(async () => { await sql().end({ timeout: 2 }); });

  it("oddanie „czeka na …” w biegu: poziom zostaje, krok wraca na listę dopiero po zrobieniu kroku, na który czeka", async () => {
    const other = await repo.createTask(owner, { title: "Zadanie testowe", steps: [{ title: "Zbierz flagi kosztu biegu Claude Code", tool: "claude" }] });
    const t = await repo.createTask(owner, { title: "Dobór", steps: [{ title: "Przetestuj dobór", tool: "claude" }] });
    const s = t.steps[0], target = other.steps[0];
    let b = await workRun();
    expect(await call(b.token, "start_step", { stepId: s.id })).toBe("Krok w toku.");
    expect(await call(b.token, "leave_step", { stepId: s.id, reason: "Czeka na bieg kroku researchu „Zbierz flagi kosztu biegu Claude Code” w zadaniu testowym." })).toBe("Krok oddany.");
    let now = await stepNow(t.id, s.id);
    expect(now.escalation).toBe(0);
    expect(now.waitFor).toBe(target.id);
    expect(now.leftAt).toBeNull();   // czekanie to „Zaplanowane”, nie „Potrzebna pomoc” (paczka 18)
    expect(await call(b.token, "list_work", { force: true })).not.toContain(s.id);
    await repo.endBridgeRun(owner, b.run.id, "done");
    // tamten zrobiony: krok wraca
    expect(await call(client, "complete_step", { stepId: target.id, summary: "Zebrane." })).toContain("Krok zapisany");
    b = await workRun();
    expect(await call(b.token, "list_work", { force: true })).toContain(s.id);
    // oddanie z braku zrozumienia: poziom rośnie, czekanie się czyści
    expect(await call(b.token, "leave_step", { stepId: s.id, reason: "nie rozumiem opisu" })).toBe("Krok oddany.");
    now = await stepNow(t.id, s.id);
    expect(now.escalation).toBe(1);
    expect(now.waitFor).toBeNull();
    expect(now.leftAt).toBeTruthy();   // prawdziwe oddanie: kafelek „Potrzebna pomoc”
    expect(await call(b.token, "start_step", { stepId: s.id })).toBe("Krok w toku.");
    expect((await stepNow(t.id, s.id)).leftAt).toBeNull();   // nowa próba gasi „Potrzebna pomoc”
    expect(await call(b.token, "leave_step", { stepId: s.id, reason: "nadal nie rozumiem" })).toBe("Krok oddany.");
    // waitFor wprost, bez cudzysłowu; obcy identyfikator nie przechodzi
    const t2 = await repo.createTask(owner, { title: "Dwa kroki", steps: [{ title: "Pierwszy", tool: "claude" }, { title: "Drugi", tool: "claude" }] });
    expect(await call(b.token, "leave_step", { stepId: t2.steps[1].id, reason: "czekam, aż pierwszy skończy inny bieg", waitFor: t2.steps[0].id })).toBe("Krok oddany.");
    expect((await stepNow(t2.id, t2.steps[1].id)).waitFor).toBe(t2.steps[0].id);
    expect(await call(b.token, "leave_step", { stepId: t2.steps[0].id, reason: "do zrobienia w projekcie w chmurze", waitFor: "00000000-0000-4000-8000-000000000000" })).toBe("Krok oddany.");
    const first = await stepNow(t2.id, t2.steps[0].id);
    expect(first.waitFor).toBeNull();
    expect(first.escalation).toBe(0);
    const lw = await call(b.token, "list_work", { force: true });
    expect(lw).toContain(t2.steps[0].id);
    expect(lw).not.toContain(t2.steps[1].id);
    await repo.endBridgeRun(owner, b.run.id, "done");
    await sql()`delete from tasks where id in (${t.id}, ${other.id}, ${t2.id})`;
  });

  it("krok z kodem w projekcie Task Hub: list_work go nie pokazuje, „Uruchom” zleca go chmurze", async () => {
    const app = await repo.createProject(owner, "Task Hub");
    const t = await repo.createTask(owner, { title: "Grupy projektów", projectId: app.id, steps: [{ title: "Dodaj grupy projektów na głównej kanwie", tool: "code" }] });
    const elsewhere = await repo.createTask(owner, { title: "Poprawka gdzie indziej", steps: [{ title: "Popraw błąd", tool: "code" }] });
    const s = t.steps[0];
    const lw = await call(client, "list_work", { force: true });
    expect(lw).not.toContain(s.id);
    expect(lw).toContain(elsewhere.steps[0].id);
    await actions.handoff(t.id, s.id);
    const q = await stepNow(t.id, s.id);
    expect(q.status).toBe("todo");
    expect(q.cloud?.state).toBe("queued");
    expect(await call(client, "cloud_work", {})).toContain("Zrób krok z Task Hub: Dodaj grupy projektów na głównej kanwie.");
    // krok z kodem gdzie indziej: „Uruchom” jak dotąd (mostek), runInCloud nic nie robi
    await actions.runInCloud(elsewhere.id, elsewhere.steps[0].id);
    expect((await stepNow(elsewhere.id, elsewhere.steps[0].id)).cloud).toBeNull();
    await actions.handoff(elsewhere.id, elsewhere.steps[0].id);
    expect((await stepNow(elsewhere.id, elsewhere.steps[0].id)).status).toBe("handoff");
  });
});
