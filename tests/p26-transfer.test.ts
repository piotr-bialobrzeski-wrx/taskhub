// Transfer z Supabase: odczyty z pamięci serwera, póki odcisk tabel (liczba wierszy, ostatnia zmiana) się nie zmienił.
// Zmiana wprost w bazie, z pominięciem repo, też musi być widoczna przy następnym czytaniu. Pomijane bez TEST_DATABASE_URL.
import { describe, it, expect, beforeAll } from "vitest";

describe.skipIf(!process.env.TEST_DATABASE_URL)("pamięć odczytów", async () => {
  const repo = await import("@/lib/repo");
  const { sql } = await import("@/lib/db");
  let owner = "";
  beforeAll(async () => { owner = (await repo.ensureOwner()).id; });

  it("odcisk tabel zmienia się po każdej zmianie, usunięciu i dodaniu", async () => {
    const t = await repo.createTask(owner, { title: "Transfer: odcisk", steps: [{ title: "Krok" }] });
    const v1 = await repo.tablesVersion(["tasks", "steps"]);
    expect(await repo.tablesVersion(["tasks", "steps"])).toBe(v1);
    await sql()`update steps set title = 'Zmieniony' where task_id = ${t.id}`;
    const v2 = await repo.tablesVersion(["tasks", "steps"]);
    expect(v2).not.toBe(v1);
    await sql()`delete from tasks where id = ${t.id}`;
    expect(await repo.tablesVersion(["tasks", "steps"])).not.toBe(v2);
  });

  it("lista zadań i jedno zadanie widzą zmianę zrobioną z pominięciem repo; kopia nie psuje pamięci", async () => {
    const t = await repo.createTask(owner, { title: "Transfer: lista", steps: [{ title: "Pierwszy" }] });
    const a = (await repo.listTasks(owner)).find((x) => x.id === t.id)!;
    a.steps[0].title = "zepsute przez wołającego";
    expect((await repo.listTasks(owner)).find((x) => x.id === t.id)!.steps[0].title).toBe("Pierwszy");
    await sql()`update steps set title = 'Drugi' where task_id = ${t.id}`;
    expect((await repo.listTasks(owner)).find((x) => x.id === t.id)!.steps[0].title).toBe("Drugi");
    expect((await repo.getTask(owner, t.id))!.steps[0].title).toBe("Drugi");
    await sql()`update tasks set deleted_at = now() where id = ${t.id}`;
    expect((await repo.listTasks(owner)).some((x) => x.id === t.id)).toBe(false);
    expect((await repo.listTasks(owner, { trash: true })).some((x) => x.id === t.id)).toBe(true);
    await sql()`delete from tasks where id = ${t.id}`;
    expect((await repo.listTasks(owner, { all: true })).some((x) => x.id === t.id)).toBe(false);
  });

  it("zasady i projekty: zmiana w bazie widoczna od razu", async () => {
    const before = await repo.listProjects(owner);
    const [p] = await sql()`insert into projects (owner_id, name) values (${owner}, 'Transfer: projekt') returning id`;
    expect((await repo.listProjects(owner)).length).toBe(before.length + 1);
    await sql()`update projects set name = 'Transfer: inny' where id = ${p.id}`;
    expect((await repo.listProjects(owner)).find((x) => x.id === p.id)!.name).toBe("Transfer: inny");
    await sql()`delete from projects where id = ${p.id}`;
    expect((await repo.listProjects(owner)).length).toBe(before.length);
  });
});
