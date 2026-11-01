// Paczka 32: krok, przy którym Piotr napisał prośbę, czeka na agenta (nie na Piotra); wiadomość wzięta bez biegu mostka nie udaje „zaraz zacznie”.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { stepAsked, stepLook, stepTile, taskLook } from "@/lib/canvas/vm";
import { workBubble } from "@/lib/feed";
import type { ChatMessage } from "@/lib/repo";
import { step, task } from "./helpers";

describe("krok z prośbą Piotra bez odpowiedzi", () => {
  it("stepAsked: krok → najstarsza wiadomość bez odpowiedzi; wiadomości bez kroku pomija", () => {
    const m = stepAsked([
      { actions: { stepId: "s1" }, createdAt: "2026-11-01T09:40:00Z" },
      { actions: { stepId: "s1" }, createdAt: "2026-11-01T09:30:00Z" },
      { actions: null, createdAt: "2026-11-01T09:00:00Z" },
    ]);
    expect([...m]).toEqual([["s1", "2026-11-01T09:30:00Z"]]);
  });
  it("szkic czekający na zgodę, przy którym Piotr zlecił poprawkę: „Zlecone agentowi · 10:30” w kolorze agenta", () => {
    const s = step({ tool: "clickup", status: "draft" }), t = task({ steps: [s] });
    expect(stepTile(t, s, [t], null, "2026-11-01T09:30:00Z").look).toEqual({ key: "plan-ag", label: "Zlecone agentowi · 10:30" });
    expect(stepTile(t, s, [t]).look.key).toBe("mine");
  });
  it("bieg pracuje nad tym krokiem: Agent pracuje wygrywa; zrobiony krok zostaje zrobiony", () => {
    const s = step({ tool: "clickup", status: "draft" });
    expect(stepLook(s, "draft", true, "2026-11-01T09:30:00Z").key).toBe("live");
    expect(stepLook(step({ status: "done" }), "done", false, "2026-11-01T09:30:00Z").key).toBe("done");
  });
  it("kafelek zadania: zostałe szkice dalej czekają na Piotra", () => {
    const a = step({ tool: "clickup", status: "draft" }), b = step({ tool: "clickup", status: "draft" }), t = task({ steps: [a, b] });
    const looks = [stepLook(a, "draft", false, "2026-11-01T09:30:00Z"), stepLook(b, "draft", false)];
    expect(taskLook(t, "draft", looks, false, 0).key).toBe("mine");
    expect(taskLook(task({ steps: [a] }), "draft", [looks[0]], false, 0).key).toBe("plan-ag");
  });
});

describe("dymek wysłanej wiadomości", () => {
  const msg = (p: Partial<ChatMessage> = {}): ChatMessage => ({ id: "m1", role: "user", text: "Sprawdź komentarze", actions: { stepId: "s1" }, createdAt: "2026-11-01T09:30:00Z", seenAt: null, answeredAt: null, ...p });
  const t = task({ id: "t1", steps: [step({ id: "s1" })] });
  it("wzięta bez biegu mostka przy żywym mostku: kto i kiedy wziął, i kiedy wróci do kolejki", () => {
    const b = workBubble({ task: t, w: { alive: true, name: "Mac", run: null }, pending: [msg({ seenAt: "2026-11-01T09:31:00Z" })], busy: null });
    expect(b).toMatchObject({ title: "Claude w chmurze wziął to o 10:31", line: "Bez odpowiedzi wróci do kolejki o 12:01" });
    expect(workBubble({ task: t, w: { alive: true, name: "Mac", run: null }, pending: [msg()], busy: null })).toMatchObject({ title: "Wysłane, Claude zaraz zacznie" });
  });
});

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

describe.skipIf(!process.env.TEST_DATABASE_URL)("list_work z force przy żywym mostku nie zabiera wiadomości Piotra (paczka 32)", async () => {
  const repo = await import("@/lib/repo");
  const { sql } = await import("@/lib/db");
  const work = await import("@/app/api/bridge/work/route");
  const mcp = await import("@/app/api/mcp/route");
  let owner = "", bridge = "", client = "";
  const call = async (t: string, name: string, args: Record<string, unknown>) => {
    const r = await mcp.POST(new Request("http://x/api/mcp", { method: "POST", headers: { authorization: `Bearer ${t}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) }));
    const msgs = (await r.text()).split("\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6)));
    const m = msgs.find((x) => x.id === 1);
    return ((m?.result?.content ?? []) as { text?: string }[]).map((c) => c.text ?? "").join("\n") + (m?.error ? m.error.message : "");
  };
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

  it("mostek żywy: force pokazuje wiadomość, ale jej nie oznacza; mostek śpi: konektor ją bierze", async () => {
    const t = await repo.createTask(owner, { title: "Story w ClickUpie", steps: [{ title: "Przepisz story Schedule Draft", tool: "clickup" }] } as never);
    const sid = t.steps[0].id;
    const id = await repo.addChat(owner, t.id, "user", "Sprawdź komentarze Macieja", { stepId: sid });
    await work.GET(new Request("http://x/api/bridge/work?v=2&host=mini", { headers: { Authorization: `Bearer ${bridge}` } }));   // puls mostka
    expect(await call(client, "list_work", {})).toContain("MOSTEK AKTYWNY");
    expect(await call(client, "list_work", { force: true })).toContain("Sprawdź komentarze Macieja");
    const [a] = await sql()`select seen_at from chat_messages where id = ${id}`;
    expect(a.seenAt).toBeNull();
    await sql()`update api_tokens set seen_at = now() - interval '1 hour' where id is not null and owner_id = ${owner} and kind = 'bridge'`;
    expect(await call(client, "list_work", {})).toContain("Sprawdź komentarze Macieja");
    const [b] = await sql()`select seen_at from chat_messages where id = ${id}`;
    expect(b.seenAt).not.toBeNull();
    expect(stepAsked(await repo.listPendingStepChat(owner)).has(sid)).toBe(true);   // wzięta, ale bez odpowiedzi: krok dalej czeka na agenta
  });
});
