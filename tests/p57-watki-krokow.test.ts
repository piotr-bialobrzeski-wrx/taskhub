// Paczka 57: każdy krok ma własny wątek rozmowy. Wiadomość należy do kroku (actions.stepId) albo do samego zadania.
// W karcie kroku historia pokazuje tylko wątek kroku (z kolejką „Czeka na mostek” tego wątku), w widoku zadania wątek zadania i skróty do wątków kroków.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/session", async (orig) => ({ ...(await orig<typeof import("@/lib/session")>()), requireOwner: async () => (await import("@/lib/repo")).ensureOwner() }));

describe.skipIf(!process.env.TEST_DATABASE_URL)("osobne wątki rozmowy kroków", async () => {
  const repo = await import("@/lib/repo");
  const { sql } = await import("@/lib/db");
  const actions = await import("@/app/actions");
  const mcp = await import("@/app/api/mcp/route");
  let owner = "", client = "";
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = await mcp.POST(new Request("http://x/api/mcp", { method: "POST", headers: { authorization: `Bearer ${client}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) }));
    const msgs = (await r.text()).split("\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6)));
    const m = msgs.find((x) => x.id === 1);
    return ((m?.result?.content ?? []) as { text?: string }[]).map((c) => c.text ?? "").join("\n") + (m?.error ? m.error.message : "");
  };
  beforeAll(async () => {
    owner = (await repo.ensureOwner()).id;
    await sql()`delete from tasks where owner_id = ${owner}`;
    await sql()`delete from chat_messages where owner_id = ${owner}`;
    await sql()`delete from api_tokens where owner_id = ${owner}`;
    client = await repo.createApiToken(owner, "Claude", "client");
  });
  afterAll(async () => { await sql().end({ timeout: 2 }); });

  it("wątek kroku, wątek zadania i skróty; stare wiadomości z krokiem trafiają do jego wątku", async () => {
    const t = await repo.createTask(owner, { title: "Wątki", steps: [{ title: "Pierwszy", tool: "manual" }, { title: "Drugi", tool: "manual" }] });
    const [a, b] = t.steps;
    await repo.addChat(owner, t.id, "user", "ogólnie o zadaniu");
    const qa = await repo.addChat(owner, t.id, "user", "popraw pierwszy", { stepId: a.id });
    await repo.addChat(owner, t.id, "agent", "Zlecone do chmury", { stepId: b.id });

    const all = await actions.loadChat(t.id, null);
    expect(all.msgs.map((m) => m.text)).toEqual(["ogólnie o zadaniu", "popraw pierwszy", "Zlecone do chmury"]);
    expect(all.threads).toBeUndefined();

    const inA = await actions.loadChat(t.id, null, a.id);
    expect(inA.msgs.map((m) => m.text)).toEqual(["popraw pierwszy"]);
    expect(inA.queue?.n).toBe(1);   // „Czeka na mostek” liczy tylko wiadomości tego kroku
    expect(inA.threads).toBeUndefined();
    const inB = await actions.loadChat(t.id, null, b.id);
    expect(inB.msgs.map((m) => m.text)).toEqual(["Zlecone do chmury"]);
    expect(inB.queue).toBeNull();

    const task = await actions.loadChat(t.id, null, null);
    expect(task.msgs.map((m) => m.text)).toEqual(["ogólnie o zadaniu"]);
    expect(task.queue?.n).toBe(1);
    expect(task.threads?.map((x) => [x.stepId, x.n, x.pending])).toEqual([[b.id, 1, 0], [a.id, 1, 1]]);

    // odpowiedź agenta bez stepId na wiadomość z kroku trafia do wątku tego kroku
    expect(await call("reply_chat", { taskId: t.id, text: "Poprawione.", messageIds: [qa] })).toContain("Odpowiedź zapisana");
    const after = await actions.loadChat(t.id, null, a.id);
    expect(after.msgs.map((m) => m.text)).toEqual(["popraw pierwszy", "Poprawione."]);
    expect(after.msgs[1].answers).toEqual([qa]);
    expect(after.queue).toBeNull();
    expect((await actions.loadChat(t.id, null, null)).msgs.map((m) => m.text)).toEqual(["ogólnie o zadaniu"]);
  });

  it("odpowiedź na wiadomości z różnych miejsc idzie do wątku zadania, chyba że agent wskaże krok", async () => {
    const t = await repo.createTask(owner, { title: "Mieszane", steps: [{ title: "Jeden", tool: "manual" }, { title: "Dwa", tool: "manual" }] });
    const [a, b] = t.steps;
    const m1 = await repo.addChat(owner, t.id, "user", "o kroku jeden", { stepId: a.id });
    const m2 = await repo.addChat(owner, t.id, "user", "o zadaniu");
    await call("reply_chat", { taskId: t.id, text: "Obie załatwione.", messageIds: [m1, m2] });
    expect((await actions.loadChat(t.id, null, null)).msgs.map((m) => m.text)).toEqual(["o zadaniu", "Obie załatwione."]);
    const m3 = await repo.addChat(owner, t.id, "user", "jeszcze o zadaniu");
    await call("reply_chat", { taskId: t.id, text: "Dopisałem krok 02.", messageIds: [m3], stepId: b.id });
    expect((await actions.loadChat(t.id, null, b.id)).msgs.map((m) => m.text)).toEqual(["Dopisałem krok 02."]);
  });

  it("paczka 62: odpowiedź zapisana w innym kroku zostawia kopię z przyciskiem w wątku wiadomości", async () => {
    const t = await repo.createTask(owner, { title: "Echo", steps: [{ title: "Story daty", tool: "manual" }, { title: "Story paska", tool: "manual" }] });
    const [a, b] = t.steps;
    const m = await repo.addChat(owner, t.id, "user", "zmień belkę", { stepId: a.id });
    await call("reply_chat", { taskId: t.id, text: "Dopisałem szkic paska.", messageIds: [m], stepId: b.id });
    const inA = await actions.loadChat(t.id, null, a.id);
    expect(inA.msgs.map((x) => x.text)).toEqual(["zmień belkę", "Odpowiedziałem w kroku 02 „Story paska”: Dopisałem szkic paska."]);
    expect(inA.msgs[1].answers).toEqual([m]);
    expect(inA.msgs[1].goStep).toBe(b.id);
    expect((await actions.loadChat(t.id, null, b.id)).msgs.map((x) => x.text)).toEqual(["Dopisałem szkic paska."]);
    // cała rozmowa (kontekst agenta, dymki) ma tylko oryginał
    expect((await repo.listChat(owner, t.id, 20)).filter((x) => x.role === "agent").map((x) => x.text)).toEqual(["Dopisałem szkic paska."]);
  });
});
