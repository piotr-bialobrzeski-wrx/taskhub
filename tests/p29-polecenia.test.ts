// Paczka 29: wiadomość z głównej kanwy (albo paska) nie staje się od razu zadaniem. Czeka na Claude jako polecenie:
// Claude robi je od razu (grupy, znajdź, otwórz krok) i odpowiada w dymku na kanwie, a zadanie zakłada tylko dla nowej pracy.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { agentFeed, workBubble, CANVAS_KEY } from "@/lib/feed";
import type { ChatMessage } from "@/lib/repo";

const msg = (p: Partial<ChatMessage>): ChatMessage => ({ id: "m1", role: "agent", text: "Gotowe.", actions: null, createdAt: new Date().toISOString(), seenAt: null, answeredAt: null, ...p });

describe("polecenia z kanwy: dymki", () => {
  it("odpowiedź z kanwy prowadząca do kroku ma przycisk „Otwórz krok 02”, do zadania „Otwórz zadanie”", () => {
    const [a, b, c] = agentFeed([
      msg({ id: "a", actions: { taskId: "t1", stepId: "s2", label: "02" } }),
      msg({ id: "b", actions: { taskId: "t1" } }),
      msg({ id: "c", actions: { stepId: "s9" } }),
    ]);
    expect(a.open).toEqual({ href: "/tasks/t1?step=s2", label: "Otwórz krok 02" });
    expect(a.stepId).toBeNull();
    expect(b.open).toEqual({ href: "/tasks/t1", label: "Otwórz zadanie" });
    expect(c.open).toBeNull();
    expect(c.stepId).toBe("s9");
  });
  it("wiadomość z kanwy czeka: dymek „wysłane”; wzięta w biegu: „Claude czyta Twoją wiadomość”", () => {
    const pending = [msg({ id: "u1", role: "user", text: "Pogrupuj kafelki według projektów" })];
    const idle = workBubble({ task: { id: "", steps: [] }, w: { alive: true, name: "mini", run: null }, pending, busy: null });
    expect(idle).toMatchObject({ kind: "sent", title: "Wysłane, Claude zaraz zacznie", quote: "Pogrupuj kafelki według projektów" });
    const since = new Date(Date.now() - 60_000).toISOString();
    const run = { runId: "r1", taskId: null, stepId: null, since, text: "pracuje", bridge: "mini", detail: null, kind: "work", stoppable: true } as never;
    const taken = [{ ...pending[0], seenAt: new Date().toISOString() }];
    const busy = workBubble({ task: { id: "", steps: [] }, w: { alive: true, name: "mini", run }, pending: taken, busy: null });
    expect(busy).toMatchObject({ kind: "working", head: "Claude czyta Twoją wiadomość", now: "robi to, o co prosisz" });
  });
});

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

describe.skipIf(!process.env.TEST_DATABASE_URL)("polecenia z kanwy: kolejka, lista pracy i konektor", async () => {
  const repo = await import("@/lib/repo");
  const { sql } = await import("@/lib/db");
  const { intake } = await import("@/lib/intake");
  const { workSummary, agentQueue } = await import("@/lib/agent/work");
  const run = await import("@/app/api/bridge/run/route");
  const work = await import("@/app/api/bridge/work/route");
  const mcp = await import("@/app/api/mcp/route");
  let owner = "", tok = "", runTok = "";
  const H = (t: string) => ({ Authorization: `Bearer ${t}` });
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = await mcp.POST(new Request("http://x/api/mcp", { method: "POST", headers: { authorization: `Bearer ${runTok}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) }));
    const msgs = (await r.text()).split("\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6)));
    const m = msgs.find((x) => x.id === 1);
    return ((m?.result?.content ?? []) as { text?: string }[]).map((c) => c.text ?? "").join("\n") + (m?.error ? m.error.message : "");
  };

  beforeAll(async () => {
    owner = (await repo.ensureOwner()).id;
    await sql()`delete from tasks where owner_id = ${owner}`;
    await sql()`delete from chat_messages where owner_id = ${owner}`;
    await sql()`delete from canvas_groups where owner_id = ${owner}`;
    await sql()`delete from bridge_runs where owner_id = ${owner}`;
    await sql()`delete from api_tokens where owner_id = ${owner}`;
    tok = await repo.createApiToken(owner, "mini", "bridge");
    await work.GET(new Request("http://x/api/bridge/work?host=mini&runner=claude&state=idle&v=2", { headers: H(tok) }));
    runTok = (await (await run.POST(new Request("http://x/api/bridge/run", { method: "POST", headers: H(tok), body: JSON.stringify({ bridge: "mini", v: 2, kind: "work" }) }))).json()).token;
  });
  afterAll(async () => { await sql().end({ timeout: 2 }); });

  it("tekst z kanwy bez plików: bez nowego zadania, czeka w kolejce i na liście pracy jako wiadomość z kanwy", async () => {
    const r = await intake(owner, { typed: "Pogrupuj kafelki według projektów", files: [], taskId: null, stepId: null });
    expect(r.goTo).toBeNull();
    expect(r.note).toBeTruthy();
    expect(await repo.listTasks(owner)).toHaveLength(0);
    const peek = await workSummary(owner, { peek: true, audience: "work" });
    expect(peek.counts.chat).toBe(1);
    expect(peek.text).toContain("WIADOMOŚCI Z GŁÓWNEJ KANWY");
    expect(peek.text).toContain("Pogrupuj kafelki według projektów");
    expect((await agentQueue(owner, null)).items.map((x) => x.key)).toContain(CANVAS_KEY);
    // stary mostek (v1) jej nie widzi: nie ma reply_canvas w swoim poleceniu
    expect((await workSummary(owner, { peek: true, audience: "bridge-v1" })).counts.chat).toBe(0);
  });

  it("create_group i reply_canvas: grupa na kanwie, wiadomość załatwiona, odpowiedź z przyciskiem do zadania", async () => {
    const [a, b] = await Promise.all([repo.createTask(owner, { title: "Oferta Widelab" }), repo.createTask(owner, { title: "Raport Pirxey" })]);
    const g = await call("create_group", { name: "Widelab", taskIds: [a.id, "00000000-0000-0000-0000-000000000000"] });
    expect(g).toContain("1 kafelków");
    expect(g).toContain("Pominięte");
    // ta sama nazwa: zmienia skład, nie tworzy drugiej grupy
    await call("create_group", { name: "widelab", taskIds: [a.id, b.id] });
    const groups = await repo.listGroups(owner, null);
    expect(groups).toHaveLength(1);
    expect([...groups[0].members].sort()).toEqual([a.id, b.id].sort());

    const [m] = await repo.listPendingChat(owner, null);
    expect(await call("reply_canvas", { text: "Gotowe.", taskId: "00000000-0000-0000-0000-000000000000" })).toContain("Nie ma takiego zadania");
    expect(await call("reply_canvas", { text: "Pogrupowałem kafelki w 1 grupę.", messageIds: [m.id], taskId: a.id })).toContain("załatwione wiadomości: 1");
    expect(await repo.listPendingChat(owner, null)).toHaveLength(0);
    const last = (await repo.listChat(owner, null)).at(-1)!;
    expect(last.role).toBe("agent");
    expect(last.actions).toMatchObject({ taskId: a.id, answers: [m.id] });
    expect((await workSummary(owner, { peek: true, audience: "work" })).text).not.toContain("WIADOMOŚCI Z GŁÓWNEJ KANWY");
  });

  it("z plikiem: zadanie od razu, jak dotąd (pliki potrzebują zadania)", async () => {
    const f = new File([new Uint8Array([1, 2, 3])], "umowa.pdf", { type: "application/pdf" });
    const r = await intake(owner, { typed: "Sprawdź umowę", files: [f], taskId: null, stepId: null });
    expect(r.goTo).toBeTruthy();
  });
});
