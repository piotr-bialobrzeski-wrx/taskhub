// Transfer z Supabase: zamknięte zadania na liście bez treści kartek, pełne po otwarciu; zasady z pamięci instancji czyszczonej przy zapisie
import { describe, it, expect, beforeAll } from "vitest";

const DB = !!process.env.TEST_DATABASE_URL;

describe.skipIf(!DB)("lekkie zamknięte zadania i pamięć zasad", async () => {
  const repo = await import("@/lib/repo");
  const { sql } = await import("@/lib/db");
  let owner = "";
  beforeAll(async () => {
    owner = (await repo.ensureOwner()).id;
    await sql()`delete from tasks where owner_id = ${owner}`;
    await sql()`delete from rules where owner_id = ${owner}`;
  });

  it("zamknięte zadanie: lista bez kartki i wyniku, getTask i listTasks({ full }) w całości; otwarte zawsze w całości", async () => {
    const open = await repo.createTask(owner, { title: "Otwarte", steps: [{ title: "Krok A" }] });
    const done = await repo.createTask(owner, { title: "Zamknięte", steps: [{ title: "Krok B" }] });
    const blocks = [{ type: "text", title: "Wynik", body: "długa treść" }];
    for (const t of [open, done]) await sql()`update steps set output = 'wynik', report = 'raport', blocks = ${sql().json(blocks)} where task_id = ${t.id}`;
    await sql()`update tasks set done_at = now() where id = ${done.id}`;
    const list = await repo.listTasks(owner);
    const o = list.find((t) => t.id === open.id)!.steps[0], d = list.find((t) => t.id === done.id)!.steps[0];
    expect(o).toMatchObject({ output: "wynik", report: "raport" }); expect(o.blocks).toHaveLength(1);
    expect(d).toMatchObject({ title: "Krok B", output: "", report: null, blocks: null });
    expect((await repo.listTasks(owner, { all: true, full: done.id })).find((t) => t.id === done.id)!.steps[0]).toMatchObject({ output: "wynik", report: "raport" });
    const full = (await repo.getTask(owner, done.id))!.steps[0];
    expect(full).toMatchObject({ output: "wynik", report: "raport" }); expect(full.blocks).toHaveLength(1);
    // ponowne otwarcie zadania (zmiana odcisku) = znów otwarte, czyli w całości na liście
    await sql()`update tasks set done_at = null where id = ${done.id}`;
    expect((await repo.listTasks(owner)).find((t) => t.id === done.id)!.steps[0]).toMatchObject({ output: "wynik", report: "raport" });
  });

  it("zasady: druga lista z pamięci, zapis i usunięcie widać od razu", async () => {
    const r = await repo.upsertRule(owner, { scope: "global", title: "Styl", body: "Krótko" });
    expect((await repo.listRules(owner)).map((x) => x.body)).toEqual(["Krótko"]);
    await sql()`update rules set body = 'z innej instancji' where id = ${r.id}`;
    expect((await repo.listRules(owner))[0].body).toBe("Krótko");   // pamięć instancji
    await repo.upsertRule(owner, { id: r.id, scope: "global", title: "Styl", body: "Bardzo krótko" });
    expect((await repo.listRules(owner))[0].body).toBe("Bardzo krótko");
    await repo.deleteRule(owner, r.id);
    expect(await repo.listRules(owner)).toEqual([]);
  });
});
