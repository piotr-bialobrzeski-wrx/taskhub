// Paczka 19: karta zrobionego kroku w wariancie A „Wynik na górze, zlecenie pod nim”: klocki sprzed zamknięcia zostają jako zlecenie,
// także gdy wynik (blok zmian z chmury) je zastąpił albo krok nie miał zapisanej kartki. Część z bazą pomijana bez TEST_DATABASE_URL.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { doneOrder, hasOrder } from "@/lib/stepcard";
import type { Block } from "@/lib/schema";

const order: Block = { type: "text", title: "Co ma powstać", body: "Wdrożyć wariant B." };
const changes: Block = { type: "changes", repo: "o/r", branch: "b", summary: "Zrobione.", files: [{ path: "a.ts" }] };
const link: Block = { type: "link", links: [{ title: "Prototyp", url: "https://x.example/p" }] };

describe("zlecenie na karcie zrobionego kroku", () => {
  it("główna treść kartki to zlecenie", () => {
    expect(doneOrder({ detail: "opis" }, [order], null)).toEqual([order]);
  });
  it("wynik zastąpił kartkę: zlecenie z poprzedniej wersji, bez zmian i materiału ze źródłem", () => {
    expect(doneOrder({ detail: "opis" }, [], [order, link, changes])).toEqual([order]);
  });
  it("bez kartki w historii: opis kroku", () => {
    expect(doneOrder({ detail: " Popraw grupy. " }, [], null)).toEqual([{ type: "text", body: "Popraw grupy." }]);
    expect(doneOrder({ detail: "" }, [], [changes])).toEqual([]);
  });
  it("hasOrder: same zmiany i linki to nie zlecenie", () => {
    expect(hasOrder([changes, link])).toBe(false);
    expect(hasOrder([order, changes])).toBe(true);
    expect(hasOrder(null)).toBe(false);
  });
});

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

describe.skipIf(!process.env.TEST_DATABASE_URL)("complete_step z chmury zostawia zlecenie", async () => {
  const repo = await import("@/lib/repo");
  const { sql } = await import("@/lib/db");
  const mcp = await import("@/app/api/mcp/route");
  let owner = "", client = "";
  const call = async (t: string, name: string, args: Record<string, unknown>) => {
    const r = await mcp.POST(new Request("http://x/api/mcp", { method: "POST", headers: { authorization: `Bearer ${t}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) }));
    const msgs = (await r.text()).split("\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6)));
    const m = msgs.find((x) => x.id === 1);
    return ((m?.result?.content ?? []) as { text?: string }[]).map((c) => c.text ?? "").join("\n") + (m?.error ? m.error.message : "");
  };
  beforeAll(async () => {
    owner = (await repo.ensureOwner()).id;
    await sql()`delete from tasks where owner_id = ${owner}`;
    await sql()`delete from api_tokens where owner_id = ${owner}`;
    client = await repo.createApiToken(owner, "Claude", "client");
  });
  afterAll(async () => { await sql().end({ timeout: 2 }); });

  const done = { stepId: "", summary: "Poprawione na gałęzi paczki.", repo: "o/r", branch: "b", changes: [{ path: "src/a.ts", status: "modified" }] };
  it("krok z kartką: klocki zostają, blok zmian dochodzi na końcu", async () => {
    const t = await repo.createTask(owner, { title: "Karta", steps: [{ title: "Zleć w projekcie: ramki", tool: "manual", detail: "Ramki." }] });
    const s = t.steps[0];
    await repo.updateStep(s.id, { blocks: [order, link] });
    expect(await call(client, "complete_step", { ...done, stepId: s.id })).toContain("Krok zapisany");
    const st = (await repo.getTask(owner, t.id))!.steps[0];
    expect(st.blocks?.map((b) => b.type)).toEqual(["text", "link", "changes"]);
  });
  it("krok bez zapisanej kartki: opis kroku zostaje na kartce obok wyniku", async () => {
    const t = await repo.createTask(owner, { title: "Karta 2", steps: [{ title: "Zleć w projekcie: grupy", tool: "manual", detail: "Popraw tworzenie grupy." }] });
    const s = t.steps[0];
    expect(await call(client, "complete_step", { ...done, stepId: s.id })).toContain("Krok zapisany");
    const st = (await repo.getTask(owner, t.id))!.steps[0];
    expect(st.blocks?.[0]).toEqual({ type: "text", body: "Popraw tworzenie grupy." });
    expect(st.blocks?.at(-1)?.type).toBe("changes");
    // starsza wersja kartki w historii: poprzednia wersja zostaje do odczytu zlecenia
    expect((await repo.prevBlocksOf([s.id])).size).toBe(0);
  });
});
