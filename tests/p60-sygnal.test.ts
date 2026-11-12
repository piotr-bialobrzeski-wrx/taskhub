// Paczka 60: sygnał w chwili zmiany (Supabase Realtime) zamiast odpytywania; adres kanału, wyzwalacze w bazie, jeden sygnał na transakcję
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { supabaseUrl, realtimeSocket } from "@/lib/live-signal";

const DB = !!process.env.TEST_DATABASE_URL;

describe("adres Realtime", () => {
  it("z SUPABASE_URL albo z DATABASE_URL (pooler i połączenie bezpośrednie)", () => {
    expect(supabaseUrl({ SUPABASE_URL: "https://abcdefghijklmnop.supabase.co/" })).toBe("https://abcdefghijklmnop.supabase.co");
    expect(supabaseUrl({ DATABASE_URL: "postgresql://postgres.pcpybmiirtqpeklqfpdi:x@aws-0-eu-central-1.pooler.supabase.com:6543/postgres" })).toBe("https://pcpybmiirtqpeklqfpdi.supabase.co");
    expect(supabaseUrl({ DATABASE_URL: "postgresql://postgres:x@db.pcpybmiirtqpeklqfpdi.supabase.co:5432/postgres" })).toBe("https://pcpybmiirtqpeklqfpdi.supabase.co");
    expect(supabaseUrl({ DATABASE_URL: "postgres://th:th@localhost/taskhub_core" })).toBeNull();
    expect(realtimeSocket("https://ab.supabase.co", "sb_publishable_x")).toBe("wss://ab.supabase.co/realtime/v1/websocket?apikey=sb_publishable_x&vsn=1.0.0");
  });
  it("bez klucza: brak kanału, wszystko jak dotąd", async () => {
    const { liveConfig } = await import("@/lib/live-signal");
    expect(await liveConfig("x", { SUPABASE_URL: "https://abcdefghijklmnop.supabase.co" })).toBeNull();
  });
});

describe.skipIf(!DB)("sygnał z bazy", async () => {
  const repo = await import("@/lib/repo");
  const { sql } = await import("@/lib/db");
  const { liveConfig } = await import("@/lib/live-signal");
  let owner = "";
  beforeAll(async () => {
    owner = (await repo.ensureOwner()).id;
    await sql().unsafe(`create schema if not exists realtime;
      create table if not exists realtime.p60_log (payload jsonb, event text, topic text, priv boolean);
      create or replace function realtime.send(payload jsonb, event text, topic text, private boolean default true) returns void language sql as $f$ insert into realtime.p60_log values (payload, event, topic, private) $f$;`);
  });
  afterAll(async () => { await sql().unsafe(`drop function if exists realtime.send(jsonb,text,text,boolean); drop table if exists realtime.p60_log;`); });

  it("zmiana zadania i kroków = po jednym sygnale na tabelę w transakcji, na kanał właściciela, bez danych", async () => {
    const c = await liveConfig(owner, { SUPABASE_URL: "https://abcdefghijklmnop.supabase.co", SUPABASE_PUBLISHABLE_KEY: "k" });
    expect(c?.topic).toMatch(/^th-[0-9a-f]{32}$/);
    await sql()`truncate realtime.p60_log`;
    await repo.createTask(owner, { title: "P60", steps: [{ title: "A" }, { title: "B" }, { title: "C" }] });
    const rows = await sql()`select payload, event, topic, priv from realtime.p60_log`;
    expect(rows.every((r) => r.topic === c!.topic && r.event === "change" && r.priv === false)).toBe(true);
    const tables = rows.map((r) => (r.payload as { t: string }).t);
    expect(tables).toContain("tasks"); expect(tables).toContain("steps");
    // kilka zapisów w jednej transakcji = jeden sygnał na tabelę
    const t = await repo.createTask(owner, { title: "P60 b" });
    await sql()`truncate realtime.p60_log`;
    await sql().begin(async (tx) => { for (const n of [1, 2, 3]) await tx`insert into steps (task_id, title, position) values (${t.id}, ${"K" + n}, ${n})`; });
    expect((await sql()`select payload from realtime.p60_log`).map((r) => (r.payload as { t: string }).t)).toEqual(["steps"]);
  });

  it("bez Realtime w bazie zapis działa dalej", async () => {
    await sql().unsafe(`drop function if exists realtime.send(jsonb,text,text,boolean)`);
    const t = await repo.createTask(owner, { title: "P60 bez Realtime", steps: [{ title: "A" }] });
    expect(t.id).toBeTruthy();
  });
});
