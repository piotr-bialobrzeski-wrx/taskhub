// Termin zadania i kroku (paczka 40): rodzaj („zrób do” / „w dniu”) i powtarzanie (co tydzień, co miesiąc, własny odstęp).
// Zadania „Dwa rodzaje terminu zadań” i „Cykliczne terminy zadań i kroków”. Część z bazą pomijana bez TEST_DATABASE_URL.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { cleanDue, dueText, nextDue, parseRepeat, presetOf, repeatLabel } from "@/lib/due";
import { dueOf, tileMeta } from "@/lib/canvas/vm";
import { step, task } from "./helpers";

describe("reguła powtarzania", () => {
  it("opis jak w kalendarzu", () => {
    expect(repeatLabel({ every: 1, unit: "week" })).toBe("co tydzień");
    expect(repeatLabel({ every: 1, unit: "month" })).toBe("co miesiąc");
    expect(repeatLabel({ every: 1, unit: "day" })).toBe("codziennie");
    expect(repeatLabel({ every: 2, unit: "week" })).toBe("co 2 tygodnie");
    expect(repeatLabel({ every: 10, unit: "day" })).toBe("co 10 dni");
    expect(repeatLabel({ every: 5, unit: "month" })).toBe("co 5 miesięcy");
    expect(repeatLabel(null)).toBe("");
  });
  it("gotowe wybory i własny odstęp", () => {
    expect(presetOf(null)).toBe("none");
    expect(presetOf({ every: 1, unit: "week" })).toBe("week");
    expect(presetOf({ every: 1, unit: "month" })).toBe("month");
    expect(presetOf({ every: 3, unit: "week" })).toBe("custom");
  });
  it("odczyt z narzędzia: obiekt albo skrót tekstem; zła reguła = bez powtarzania", () => {
    expect(parseRepeat({ every: 2, unit: "month" })).toEqual({ every: 2, unit: "month" });
    expect(parseRepeat("weekly")).toEqual({ every: 1, unit: "week" });
    expect(parseRepeat("co miesiąc")).toEqual({ every: 1, unit: "month" });
    expect(parseRepeat({ every: 0, unit: "week" })).toBeNull();
    expect(parseRepeat({ every: 1, unit: "year" })).toBeNull();
    expect(parseRepeat("")).toBeNull();
  });
  it("następny termin: dni, tygodnie, miesiące (31 → ostatni dzień krótszego miesiąca), przez koniec roku", () => {
    expect(nextDue("2026-11-02", { every: 1, unit: "week" })).toBe("2026-11-09");
    expect(nextDue("2026-12-28", { every: 10, unit: "day" })).toBe("2027-01-07");
    expect(nextDue("2026-01-31", { every: 1, unit: "month" })).toBe("2026-02-28");
    expect(nextDue("2026-11-15", { every: 3, unit: "month" })).toBe("2027-02-15");
    expect(nextDue("2026-10-25", { every: 1, unit: "week" })).toBe("2026-11-01");   // zmiana czasu
  });
});

describe("rodzaj terminu", () => {
  it("wartość z przeglądarki: zła data = brak terminu, nieznany rodzaj = zrób do", () => {
    expect(cleanDue({ due: "2026-11-05", kind: "on", repeat: { every: 1, unit: "week" } })).toEqual({ due: "2026-11-05", kind: "on", repeat: { every: 1, unit: "week" } });
    expect(cleanDue({ due: "jutro", kind: "x", repeat: "nic" })).toEqual({ due: null, kind: "by", repeat: null });
    expect(cleanDue({ due: "2026-13-45" }).due).toBeNull();
  });
  it("chip na kafelku: „do 5 lis”, „5 lis”, dziś, po terminie, ikona powtarzania", () => {
    const now = new Date("2026-11-02T10:00:00+01:00").getTime();
    expect(dueOf("2026-11-20", { kind: "by" }, now)?.text).toBe("do 20 lis");
    expect(dueOf("2026-11-20", { kind: "on" }, now)?.text).toBe("20 lis");
    expect(dueOf("2026-11-02", { kind: "on" }, now)?.text).toBe("dziś");
    expect(dueOf("2026-11-01", { kind: "on" }, now)).toMatchObject({ text: "po terminie", cls: "late" });
    expect(dueOf("2026-11-20", { kind: "by", repeat: { every: 1, unit: "month" } }, now)).toMatchObject({ kind: "by", rep: "co miesiąc" });
    expect(dueOf("2026-11-20", now)?.text).toBe("do 20 lis");   // stary zapis: sam termin = zrób do
  });
  it("opis dla agenta", () => {
    expect(dueText("2026-11-05", "on", null)).toBe("w dniu 2026-11-05");
    expect(dueText("2026-11-05", "by", { every: 1, unit: "week" })).toBe("zrób do 2026-11-05, co tydzień");
    expect(dueText(null, "by", null)).toBe("bez terminu");
  });
  it("kafelek kroku: termin i znak powtarzania w dolnej linii", () => {
    const s = step({ tool: "manual", due: "2099-11-05", dueKind: "on", repeat: { every: 1, unit: "week" } });
    expect(tileMeta(task({ steps: [s] }), s, "ready").meta).toMatch(/· \d+ lis ↻/);
  });
});

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/session", async (orig) => ({ ...(await orig<typeof import("@/lib/session")>()), requireOwner: async () => (await import("@/lib/repo")).ensureOwner() }));

describe.skipIf(!process.env.TEST_DATABASE_URL)("termin w bazie, w akcjach i w narzędziach MCP", async () => {
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
  beforeAll(async () => {
    owner = (await repo.ensureOwner()).id;
    await sql()`delete from tasks where owner_id = ${owner}`;
    await sql()`delete from api_tokens where owner_id = ${owner}`;
    client = await repo.createApiToken(owner, "Claude", "client");
  });
  afterAll(async () => { await sql().end({ timeout: 2 }); });

  it("istniejący termin to „zrób do” bez powtarzania; kontrolka zapisuje rodzaj i regułę naraz", async () => {
    const t = await repo.createTask(owner, { title: "Opłata za prąd", due: "2026-11-10", steps: [{ title: "Zapłać rachunek", tool: "manual" }] });
    expect(t).toMatchObject({ due: "2026-11-10", dueKind: "by", repeat: null });
    await actions.setTaskDue(t.id, { due: "2026-11-15", kind: "on", repeat: { every: 1, unit: "month" } });
    expect(await repo.getTask(owner, t.id)).toMatchObject({ due: "2026-11-15", dueKind: "on", repeat: { every: 1, unit: "month" } });
    await actions.setTaskDue(t.id, { due: null, kind: "on", repeat: null });
    expect(await repo.getTask(owner, t.id)).toMatchObject({ due: null, repeat: null });
    // krok: własny termin z powtarzaniem
    const s = t.steps[0];
    await actions.patchStep(t.id, s.id, { due: { due: "2026-11-20", kind: "by", repeat: { every: 2, unit: "week" } } });
    expect((await repo.getTask(owner, t.id))!.steps[0]).toMatchObject({ due: "2026-11-20", dueKind: "by", repeat: { every: 2, unit: "week" } });
    // lista zadań (lekkie kroki zamkniętych zadań) też czyta nowe kolumny
    expect((await repo.listTasks(owner)).find((x) => x.id === t.id)?.steps[0].repeat).toEqual({ every: 2, unit: "week" });
  });

  it("MCP: create_task, update_task i update_step przyjmują rodzaj i powtarzanie; zła data odmawia; get_task je pokazuje", async () => {
    const out = JSON.parse(await call("create_task", { title: "Czynsz", due: "2026-12-10", dueKind: "on", repeat: { every: 1, unit: "month" }, steps: [{ title: "Przelej czynsz", tool: "manual" }] }));
    const t = (await repo.getTask(owner, out.taskId))!;
    expect(t).toMatchObject({ due: "2026-12-10", dueKind: "on", repeat: { every: 1, unit: "month" } });
    expect(await call("update_task", { taskId: t.id, due: "10 grudnia" })).toContain("YYYY-MM-DD");
    expect(await call("update_task", { taskId: t.id, dueKind: "by", repeat: null })).toBe("Zmieniono.");
    expect(await repo.getTask(owner, t.id)).toMatchObject({ due: "2026-12-10", dueKind: "by", repeat: null });
    expect(await call("update_step", { stepId: t.steps[0].id, due: "2026-12-08", dueKind: "on", repeat: { every: 1, unit: "week" } })).toContain("Zmieniono.");
    expect((await repo.getTask(owner, t.id))!.steps[0]).toMatchObject({ due: "2026-12-08", dueKind: "on", repeat: { every: 1, unit: "week" } });
    const ctx = await call("get_task", { taskId: t.id });
    expect(ctx).toContain("termin: zrób do 2026-12-10");
    expect(ctx).toContain("termin: w dniu 2026-12-08, co tydzień");
  });
});
