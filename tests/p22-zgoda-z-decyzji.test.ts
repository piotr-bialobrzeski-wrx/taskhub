// Paczka 22: odpowiedź Piotra na kartce kroku decyzji jest zgodą na kroki „Zleć w projekcie: …”, które tylko wykonują wybraną opcję (zależą od tej decyzji):
// ruszają w chmurze same, bez cloudFrom i bez „Uruchom w chmurze”. Krok spoza opcji (needsClick) i „Wdróż na produkcję” czekają na kliknięcie;
// „Zmień odpowiedź” wstrzymuje zlecenie, którego chmura jeszcze nie wzięła. Pomijane bez TEST_DATABASE_URL.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Block } from "@/lib/schema";

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/session", async (orig) => ({ ...(await orig<typeof import("@/lib/session")>()), requireOwner: async () => (await import("@/lib/repo")).ensureOwner() }));

describe.skipIf(!process.env.TEST_DATABASE_URL)("zgoda z decyzji przechodzi dalej", async () => {
  const repo = await import("@/lib/repo");
  const { sql } = await import("@/lib/db");
  const mcp = await import("@/app/api/mcp/route");
  const actions = await import("@/app/actions");
  let owner = "", client = "";
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = await mcp.POST(new Request("http://x/api/mcp", { method: "POST", headers: { authorization: `Bearer ${client}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) }));
    const msgs = (await r.text()).split("\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6)));
    const m = msgs.find((x) => x.id === 1);
    return ((m?.result?.content ?? []) as { text?: string }[]).map((c) => c.text ?? "").join("\n") + (m?.error ? m.error.message : "");
  };
  const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
  const q: Block = { type: "question", text: "Co dodać do paczki?", options: [{ label: "Pełna poprawka" }, { label: "Tylko kafelek" }], recommended: 0 };
  const steps = async (taskId: string) => (await repo.getTask(owner, taskId))!.steps;
  const decided = async () => {
    const t = await repo.createTask(owner, { title: "Paczka", projectId: null, steps: [{ title: "Zdecyduj, jak chronić zgodę", tool: "manual" }, { title: "Napraw pole czatu", tool: "claude" }] });
    const [dec, other] = t.steps;
    await repo.updateStep(dec.id, { blocks: [{ type: "text", body: "Propozycja" }, q] });
    await actions.answerBlockForm(fd({ taskId: t.id, stepId: dec.id, index: "1", q: q.type === "question" ? q.text : "", option: "Pełna poprawka" }));
    return { t, dec, other };
  };

  beforeAll(async () => {
    owner = (await repo.ensureOwner()).id;
    await sql()`delete from tasks where owner_id = ${owner}`;
    await sql()`delete from api_tokens where owner_id = ${owner}`;
    await sql()`delete from chat_messages where owner_id = ${owner}`;
    client = await repo.createApiToken(owner, "Claude", "client");
  });
  afterAll(async () => { await sql().end({ timeout: 2 }); });

  it("krok po decyzji rusza sam; krok spoza opcji, krok bez decyzji i wdrożenie czekają", async () => {
    const { t, dec, other } = await decided();
    const out = await call("add_steps", { taskId: t.id, steps: [
      { title: "Zleć w projekcie: ochrona zgody", tool: "manual", dependsOn: [dec.id] },
      { title: "Zleć w projekcie: przeniesienie starych zgód", tool: "manual", dependsOn: [dec.id], needsClick: true },
      { title: "Zleć w projekcie: pole czatu", tool: "manual", dependsOn: [other.id] },
      { title: "Wdróż na produkcję", tool: "manual", dependsOn: [dec.id] },
    ] });
    expect(out).toContain('"cloud": true');
    const all = await steps(t.id);
    const by = (end: string) => all.find((s) => s.title.endsWith(end))!;
    expect(by("ochrona zgody").cloud).toMatchObject({ state: "queued", from: dec.id });
    expect(by("starych zgód").cloud ?? null).toBeNull();
    expect(by("pole czatu").cloud ?? null).toBeNull();
    expect(by("na produkcję").cloud ?? null).toBeNull();
    expect((await repo.listChat(owner, t.id, 50)).some((m) => m.text.includes("po Twojej decyzji w kroku 01"))).toBe(true);
  });

  it("czeka na inny krok jako „auto” z decyzją; po nim rusza; „Zmień odpowiedź” wstrzymuje niewzięte zlecenie", async () => {
    const { t, dec, other } = await decided();
    await call("add_steps", { taskId: t.id, steps: [{ title: "Zleć w projekcie: ochrona zgody", tool: "manual", dependsOn: [dec.id, other.id] }] });
    const id = (await steps(t.id)).find((s) => s.title.endsWith("ochrona zgody"))!.id;
    expect((await steps(t.id)).find((s) => s.id === id)!.cloud).toMatchObject({ state: "auto", from: dec.id });
    await actions.markDone(t.id, other.id);
    expect((await steps(t.id)).find((s) => s.id === id)!.cloud).toMatchObject({ state: "queued", from: dec.id });
    await actions.reopen(t.id, dec.id);
    expect((await steps(t.id)).find((s) => s.id === id)!.cloud).toMatchObject({ state: "auto", from: dec.id });
    await actions.answerBlockForm(fd({ taskId: t.id, stepId: dec.id, index: "1", q: q.type === "question" ? q.text : "", option: "Tylko kafelek" }));
    expect((await steps(t.id)).find((s) => s.id === id)!.cloud).toMatchObject({ state: "queued" });
  });

  it("decyzja sprzed doby nie daje zgody", async () => {
    const { t, dec } = await decided();
    await sql()`update chat_messages set created_at = now() - interval '25 hours' where task_id = ${t.id}`;
    await call("add_steps", { taskId: t.id, steps: [{ title: "Zleć w projekcie: ochrona zgody", tool: "manual", dependsOn: [dec.id] }] });
    expect((await steps(t.id)).find((s) => s.title.endsWith("ochrona zgody"))!.cloud ?? null).toBeNull();
  });
});
