// Paczka 69 (zadanie „Start i koniec pracy we wpisach czasu”, krok 03): day_work zwraca też godzinę pierwszej i ostatniej aktywności
// Piotra w Task Hub tego dnia (HH:MM, Europe/Warsaw), tylko z zadań firm zawodowych i bez zadań z samymi wpisami czasu.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { Block as BlockSchema } from "@/lib/schema";
import { dayActivity, warsawHHMM } from "@/lib/day-work";

describe("godziny aktywności dnia", () => {
  it("HH:MM w czasie Warszawy (zima UTC+1, lato UTC+2), bez sekund", () => {
    expect(warsawHHMM("2026-11-02T07:05:59Z")).toBe("08:05");
    expect(warsawHHMM("2026-07-02T07:05:00Z")).toBe("09:05");
    expect(warsawHHMM("2026-11-01T23:30:00Z")).toBe("00:30");
  });
  it("pierwsza i ostatnia aktywność niezależnie od kolejności; brak zdarzeń = null", () => {
    const a = dayActivity([
      { kind: "time", at: "2026-11-02T16:40:00Z", taskId: "b", taskTitle: "B" },
      { kind: "message", at: "2026-11-02T07:12:00Z", taskId: "a", taskTitle: "A" },
      { kind: "approval", at: "2026-11-02T10:00:00Z", taskId: "a", taskTitle: "A" },
    ]);
    expect(a).toEqual({ first: "08:12", last: "17:40", firstKind: "message", lastKind: "time", firstTask: "A", lastTask: "B", events: 3 });
    expect(dayActivity([])).toBeNull();
  });
});

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

describe.skipIf(!process.env.TEST_DATABASE_URL)("godziny aktywności w bazie i przez day_work", async () => {
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

  it("wiadomości, odpowiedzi, zgody, zamknięcia i czas Piotra z zadań firm zawodowych; bez prywatnych, agenta i wpisów czasu", async () => {
    const work = await repo.createCompany(owner, "Pirxey & Widelab", "work");
    const own = await repo.createCompany(owner, "Dom", "private");
    const pw = await repo.createProject(owner, "Shiftwow", 4, work.id);
    const pp = await repo.createProject(owner, "Finanse", 3, own.id);
    const a = await repo.createTask(owner, { title: "Story onboardingu", projectId: pw.id, steps: [{ title: "Napisz story", tool: "claude" }, { title: "Zatwierdź story", tool: "manual" }, { title: "Popraw opis", tool: "manual" }] });
    const b = await repo.createTask(owner, { title: "Przelew", projectId: pp.id, steps: [{ title: "Zrób przelew", tool: "manual" }] });
    const m = await repo.createTask(owner, { title: "Wpisy czasu: listopad 2026", projectId: pw.id, steps: [{ title: "Wpisy z 2 listopada", tool: "pirxey-time" }] });
    const sheet = BlockSchema.parse({ type: "draft", target: { app: "pirxey-time", where: "Wpisy z dnia", action: "create" }, body: "", columns: ["Data", "Czas trwania"], sheet: [{ kind: "date" }, { kind: "duration" }], rows: [["2026-11-02", "1:00"]], status: "proposed" });
    // dzień 2.11 w Warszawie (UTC+1): 07:50Z = 08:50 to pierwsza aktywność zawodowa; prywatna 06:00Z, agent 05:00Z i wpisy czasu 20:00Z się nie liczą
    const msg = await repo.addChat(owner, a.id, "user", "Zacznij story");
    await sql()`update chat_messages set created_at = '2026-11-02T07:50:00Z' where id = ${msg}`;
    const priv = await repo.addChat(owner, b.id, "user", "Przelew");
    await sql()`update chat_messages set created_at = '2026-11-02T06:00:00Z' where id = ${priv}`;
    const agent = await repo.addChat(owner, a.id, "agent", "Robię");
    await sql()`update chat_messages set created_at = '2026-11-02T05:00:00Z' where id = ${agent}`;
    await sql()`update steps set status = 'done', done_at = '2026-11-02T05:30:00Z', done_by = 'agent' where id = ${a.steps[0].id}`;
    await sql()`update steps set approval = ${sql().json({ at: "2026-11-02T12:00:00.000Z", by: "owner", source: "click" } as never)} where id = ${a.steps[1].id}`;
    await sql()`update steps set status = 'done', done_at = '2026-11-02T15:20:00Z', done_by = 'owner', spent_sec = 300, spent_at = '2026-11-02T15:10:00Z' where id = ${a.steps[2].id}`;
    await sql()`update steps set status = 'done', done_at = '2026-11-02T19:00:00Z', done_by = 'owner' where id = ${b.steps[0].id}`;
    await sql()`update steps set blocks = ${sql().json([sheet] as never)}, spent_sec = 60, spent_at = '2026-11-02T20:00:00Z' where id = ${m.steps[0].id}`;
    const mm = await repo.addChat(owner, m.id, "user", "Zatwierdzam wpisy");
    await sql()`update chat_messages set created_at = '2026-11-02T20:05:00Z' where id = ${mm}`;

    const ev = await repo.dayActivityEvents(owner, "2026-11-02");
    expect(ev.map((e) => e.kind)).toEqual(["message", "approval", "time", "close"]);
    expect(dayActivity(ev)).toMatchObject({ first: "08:50", last: "16:20", firstKind: "message", lastKind: "close", firstTask: "Story onboardingu" });
    expect(await repo.dayActivityEvents(owner, "2026-11-02", ["Veloza"])).toEqual([]);
    const out = JSON.parse(await call("day_work", { date: "2026-11-02" }));
    expect(out.activity).toMatchObject({ first: "08:50", last: "16:20" });
    expect(out.items.map((i: { task: string }) => i.task)).toEqual(["Story onboardingu"]);
    expect(await call("day_work", { date: "2026-11-05" })).toMatch(/Brak pracy w Task Hub w dniu 2026-11-05/);
  });
});
