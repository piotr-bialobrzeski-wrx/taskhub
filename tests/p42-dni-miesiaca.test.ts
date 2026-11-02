// Paczka 42, krok 07 „zadanie miesiąca i wysyłka do Pirxey Time”: kalendarz dni z kroków-arkuszy (stan dnia, liczba wpisów, suma czasu,
// dni robocze bez kroku), praca w Task Hub z jednego dnia połączona po tickecie (day_work) i arkusz w szkicu dla biegu wysyłki (wiersz = wpis).
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { Block as BlockSchema, type Block } from "@/lib/schema";
import { dayOf, dayState, isWorkday, monthOf, monthView, plHoliday, sheetMinutes, type DayStep } from "@/lib/sheet-month";
import { groupDayWork, ticketOf, type DayWorkStep } from "@/lib/day-work";
import { draftsText } from "@/lib/agent/context";
import { sendPrompt } from "@/lib/bridge";

const COLUMNS = ["Projekt", "Tytuł", "Kategoria", "Tagi", "Data", "Czas trwania", "Rozliczalność"];
const SHEET = [{ kind: "choice" }, { kind: "text" }, { kind: "choice" }, { kind: "multi" }, { kind: "date" }, { kind: "duration" }, { kind: "toggle", on: "Rozliczalne" }];
const sheetDraft = (date: string, rows: number, status: "proposed" | "approved" | "sent" = "proposed"): Block => BlockSchema.parse({
  type: "draft", target: { app: "pirxey-time", where: "Wpisy z dnia", action: "create" }, body: "", columns: COLUMNS, sheet: SHEET, status,
  rows: Array.from({ length: rows }, (_, i) => ["ShiftWow", i ? `869b4k2m1: Ticket ${i}` : "Daily", "Meeting", "AI", date, i ? "1:00" : "0:15", "tak"]),
});
let n = 0;
const day = (date: string, rows: number, status: "proposed" | "approved" | "sent" = "proposed", stepStatus: DayStep["status"] = "draft"): DayStep =>
  ({ id: "d" + ++n, title: `Wpisy z ${date}`, status: stepStatus, blocks: [sheetDraft(date, rows, status)] });

describe("dni miesiąca z kroków-arkuszy", () => {
  it("święta w Polsce, w tym ruchome (Wielkanoc 2026: 5.04)", () => {
    expect(plHoliday("2026-11-11")).toBe("Święto Niepodległości");
    expect(plHoliday("2026-04-06")).toBe("Poniedziałek Wielkanocny");
    expect(plHoliday("2026-06-04")).toBe("Boże Ciało");
    expect(plHoliday("2026-12-24")).toBe("Wigilia");
    expect(plHoliday("2026-11-12")).toBeNull();
    expect(isWorkday("2026-11-02")).toBe(true);   // poniedziałek
    expect(isWorkday("2026-11-07")).toBe(false);  // sobota
    expect(isWorkday("2026-11-11")).toBe(false);
  });
  it("dzień kroku to najczęstsza data w wierszach; suma czasu z kolumny rodzaju duration", () => {
    const s = day("2026-11-03", 3);
    expect(dayOf(s)).toBe("2026-11-03");
    expect(sheetMinutes((s.blocks![0] as Extract<Block, { type: "draft" }>))).toBe(135);
    expect(dayOf({ blocks: [{ type: "text", body: "x" }] })).toBeNull();
  });
  it("stan dnia: wysłany, zatwierdzony, szkic, zamknięty bez wysyłki", () => {
    expect(dayState(day("2026-11-02", 1, "sent", "done"))).toBe("sent");
    expect(dayState(day("2026-11-02", 1, "approved", "handoff"))).toBe("approved");
    expect(dayState(day("2026-11-02", 1, "proposed", "draft"))).toBe("draft");
    expect(dayState(day("2026-11-02", 1, "proposed", "done"))).toBe("closed");
  });
  it("miesiąc z tytułu zadania; dni robocze bez kroku przed dziś, dziś osobno, weekend i święto wolne", () => {
    expect(monthOf({ title: "Wpisy czasu: listopad 2026", due: null }, [], "2026-12-01")).toEqual({ year: 2026, month: 11 });
    expect(monthOf({ title: "Wpisy", due: "2026-10-31" }, [], "2026-12-01")).toEqual({ year: 2026, month: 10 });
    const steps = [day("2026-11-02", 3, "sent", "done"), day("2026-11-03", 4, "approved", "handoff"), day("2026-11-05", 2)];
    const v = monthView({ title: "Wpisy czasu: listopad 2026", due: "2026-11-30", steps: [{ id: "x", title: "Inny krok", status: "todo", blocks: null }, ...steps] }, "2026-11-12")!;
    expect(v.label).toBe("listopad 2026");
    expect(v.cells).toHaveLength(30);
    expect(v.cells[0]).toMatchObject({ date: "2026-11-01", weekday: 6, kind: "free", holiday: "Wszystkich Świętych" });
    expect(v.cells[1]).toMatchObject({ kind: "sent", rows: 3, minutes: 135, step: { no: 2 } });
    expect(v.cells[2]).toMatchObject({ kind: "approved", rows: 4 });
    expect(v.cells[4]).toMatchObject({ kind: "draft", rows: 2 });
    expect(v.cells[10]).toMatchObject({ kind: "free", holiday: "Święto Niepodległości" });
    expect(v.cells[11]).toMatchObject({ kind: "today" });
    expect(v.cells[12]).toMatchObject({ kind: "future" });
    expect(v.missing).toEqual(["2026-11-04", "2026-11-06", "2026-11-09", "2026-11-10"]);
    expect(v.count).toEqual({ sent: 1, approved: 1, draft: 1, closed: 0 });
    expect(v.minutes).toBe(135 + 195 + 75);
  });
  it("zwykłe zadanie (bez kroków-arkuszy z datą) nie ma kalendarza; drugi krok tego samego dnia jest policzony jako „więcej”", () => {
    expect(monthView({ title: "Paczka zmian", due: null, steps: [{ id: "a", title: "Krok", status: "todo", blocks: null }] }, "2026-11-12")).toBeNull();
    const v = monthView({ title: "Wpisy czasu: listopad 2026", due: null, steps: [day("2026-11-02", 1), day("2026-11-02", 2)] }, "2026-11-12")!;
    expect(v.cells[1].more).toBe(1);
  });
});

describe("praca w Task Hub z dnia (day_work)", () => {
  const s = (p: Partial<DayWorkStep>): DayWorkStep => ({ stepId: "s" + ++n, stepTitle: "Krok", taskId: "t1", taskTitle: "Zadanie", project: "Shiftwow", company: "Pirxey & Widelab", ownerSec: 0, agentSec: 0, link: null, taskLinks: [], ...p });
  it("ticket ClickUp z linku kroku albo zadania", () => {
    expect(ticketOf([null, "https://app.clickup.com/t/869b4k2m1"])).toEqual({ id: "869b4k2m1", url: "https://app.clickup.com/t/869b4k2m1" });
    expect(ticketOf(["https://app.clickup.com/t/9015123/869c8af60?comment=1"])?.id).toBe("869c8af60");
    expect(ticketOf(["https://example.com/t/abc"])).toBeNull();
  });
  it("kroki przy tym samym tickecie łączą się w jedną pozycję z sumą; bez ticketu jedna pozycja na zadanie", () => {
    const items = groupDayWork([
      s({ taskId: "t1", ownerSec: 600, agentSec: 300, link: "https://app.clickup.com/t/869b4k2m1" }),
      s({ taskId: "t2", taskTitle: "Story", ownerSec: 1200, taskLinks: ["https://app.clickup.com/t/869b4k2m1"] }),
      s({ taskId: "t3", taskTitle: "Bez ticketu", agentSec: 900 }),
      s({ taskId: "t3", taskTitle: "Bez ticketu", ownerSec: 300 }),
    ]);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ ticket: "869b4k2m1", ownerMin: 30, agentMin: 5 });
    expect(items[0].steps).toHaveLength(2);
    expect(items[1]).toMatchObject({ ticket: null, task: "Bez ticketu", ownerMin: 5, agentMin: 15 });
  });
});

describe("wysyłka arkusza przez mostek", () => {
  it("szkic-arkusz w get_task mówi, że każdy wiersz to osobny element, i jak czytać kolumny", () => {
    const st = { id: "s1", title: "Wpisy z 2 listopada", status: "handoff" as const, blocks: [sheetDraft("2026-11-02", 2, "approved")] };
    const t = draftsText([st], { send: () => true });
    expect(t).toMatch(/- arkusz: każdy wiersz to osobny element do utworzenia .*\(2 wierszy\)/);
    expect(t).toMatch(/Tagi \(kilka wartości z listy, po przecinku\)/);
    expect(t).toMatch(/Czas trwania \(czas trwania h:mm\)/);
    expect(t).toMatch(/ShiftWow \| Daily \| Meeting \| AI \| 2026-11-02 \| 0:15 \| tak/);
  });
  it("bieg wysyłki tworzy wiersz po wierszu, bez ponawiania", () => {
    const p = sendPrompt({ stepId: "s1", taskId: "t1", app: "pirxey-time", action: "create", servers: ["pirxey-time"] });
    expect(p).toMatch(/linię „arkusz”.*jeden wiersz = jeden wpis/);
    expect(p).toMatch(/które wiersze poszły, a które nie/);
  });
});

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

describe.skipIf(!process.env.TEST_DATABASE_URL)("day_work w bazie i przez MCP", async () => {
  const repo = await import("@/lib/repo");
  const { sql } = await import("@/lib/db");
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
    await sql()`delete from projects where owner_id = ${owner}`;
    await sql()`delete from companies where owner_id = ${owner}`;
    await sql()`delete from api_tokens where owner_id = ${owner}`;
    client = await repo.createApiToken(owner, "Claude", "client");
  });
  afterAll(async () => { await sql().end({ timeout: 2 }); });

  it("kroki zamknięte tego dnia (czas Warszawy) w zadaniach firm zawodowych, bez prywatnych i bez samych wpisów czasu", async () => {
    const work = await repo.createCompany(owner, "Pirxey & Widelab", "work");
    const own = await repo.createCompany(owner, "Dom", "private");
    const pw = await repo.createProject(owner, "Shiftwow", 4, work.id);
    const pp = await repo.createProject(owner, "Finanse", 3, own.id);
    const a = await repo.createTask(owner, { title: "Story onboardingu", projectId: pw.id, steps: [{ title: "Napisz story", tool: "claude", link: "https://app.clickup.com/t/869b4k2m1" }, { title: "Zatwierdź story", tool: "manual" }, { title: "Popraw opis", tool: "manual" }] });
    const b = await repo.createTask(owner, { title: "Przelew", projectId: pp.id, steps: [{ title: "Zrób przelew", tool: "manual" }] });
    const m = await repo.createTask(owner, { title: "Wpisy czasu: listopad 2026", projectId: pw.id, steps: [{ title: "Wpisy z 2 listopada", tool: "pirxey-time" }] });
    // 23:30 UTC 1.11 = 00:30 w Warszawie 2.11 (liczy się dzień w Warszawie); krok z dnia wcześniej i krok bez czasu poza dniem
    await sql()`update steps set status = 'done', done_at = '2026-11-01T23:30:00Z', agent_sec = 600 where id = ${a.steps[0].id}`;
    await sql()`update steps set status = 'done', done_at = '2026-11-02T10:00:00Z', spent_sec = 1500 where id = ${a.steps[1].id}`;
    await sql()`update steps set status = 'done', done_at = '2026-11-01T10:00:00Z', spent_sec = 600 where id = ${a.steps[2].id}`;
    await sql()`update steps set status = 'done', done_at = '2026-11-02T10:00:00Z', spent_sec = 600 where id = ${b.steps[0].id}`;
    await sql()`update steps set status = 'done', done_at = '2026-11-02T10:00:00Z', blocks = ${sql().json([sheetDraft("2026-11-02", 1, "sent")] as never)} where id = ${m.steps[0].id}`;
    const rows = await repo.dayWork(owner, "2026-11-02");
    expect(rows.map((r) => r.stepTitle).sort()).toEqual(["Napisz story", "Zatwierdź story"]);
    expect(await repo.dayWork(owner, "2026-11-02", ["Veloza"])).toEqual([]);
    const out = JSON.parse(await call("day_work", { date: "2026-11-02" }));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ ticket: "869b4k2m1", company: "Pirxey & Widelab", project: "Shiftwow", ownerMin: 25, agentMin: 10 });
    expect(await call("day_work", { date: "2026-11-05" })).toMatch(/Brak pracy w Task Hub w dniu 2026-11-05/);
  });
});
