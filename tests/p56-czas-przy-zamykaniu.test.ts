// Paczka 56 (zadanie „Czas pracy przy zamykaniu kroku”): krok Piotra zamyka się od razu, a „Ile czasu to zajęło?” zostaje na dole kartki,
// dopóki nie wybierze albo nie pominie; to samo po jego zgodzie na szkic. Wybrany czas poprawia próbkę kalibracji.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { timeAskOf } from "@/lib/stepcard";

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const base = { status: "todo" as const, tool: "manual", doneBy: null, spentManual: false, spentSec: 0, approval: null };

describe("kiedy kartka pyta o czas", () => {
  it("krok Piotra: pyta dopiero po zamknięciu przez Piotra", () => {
    expect(timeAskOf(base)).toBeNull();
    expect(timeAskOf({ ...base, status: "done", doneBy: "owner" })).toBe("ask");
    expect(timeAskOf({ ...base, status: "done", doneBy: "agent" })).toBeNull();   // np. „Wdróż na produkcję” zamknięty przez chmurę
  });
  it("po wyborze pokazuje zapisany czas, po „Pomiń” bez czasu znika", () => {
    expect(timeAskOf({ ...base, status: "done", doneBy: "owner", spentManual: true, spentSec: 1800 })).toBe("saved");
    expect(timeAskOf({ ...base, status: "done", doneBy: "owner", spentManual: true, spentSec: 0 })).toBeNull();
  });
  it("szkic agenta: pyta po kliknięciu „Zatwierdź”, także zanim wysyłka zamknie krok", () => {
    const approval = { at: new Date().toISOString(), by: "Piotr", source: "click" as const };
    expect(timeAskOf({ ...base, tool: "slack", status: "handoff", approval })).toBe("ask");
    expect(timeAskOf({ ...base, tool: "slack", status: "done", doneBy: "agent", approval })).toBe("ask");
    expect(timeAskOf({ ...base, tool: "slack", status: "done", doneBy: "agent" })).toBeNull();
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)("czas po zamknięciu kroku", async () => {
  const repo = await import("@/lib/repo");
  const { sql } = await import("@/lib/db");
  const { finishStep } = await import("@/lib/services");
  let owner = "";
  const stepOf = async (taskId: string, id: string) => (await repo.getTask(owner, taskId))!.steps.find((s) => s.id === id)!;
  const sample = async (stepId: string) => (await sql()`select spent_min from time_samples where step_id = ${stepId} and who = 'owner'`).map((r) => Number(r.spentMin));

  beforeAll(async () => {
    owner = (await repo.ensureOwner()).id;
    await sql()`delete from tasks where owner_id = ${owner}`;
  });
  afterAll(async () => { await sql().end({ timeout: 2 }); });

  it("„Zrobione” zamyka od razu, wybrany czas zapisuje się potem i trafia do kalibracji", async () => {
    const t = await repo.createTask(owner, { title: "Czas", steps: [{ title: "Zaloguj Codex", tool: "manual", estMin: 10 }, { title: "Potem", tool: "manual" }] });
    const id = t.steps[0].id;
    await finishStep(owner, t.id, id, { by: "owner" });
    let s = await stepOf(t.id, id);
    expect(s.status).toBe("done");
    expect(timeAskOf(s)).toBe("ask");
    expect(await sample(id)).toEqual([]);
    await repo.setOwnSpent(owner, (await repo.getTask(owner, t.id))!, s, 30 * 60);
    s = await stepOf(t.id, id);
    expect(s.spentSec).toBe(1800);
    expect(timeAskOf(s)).toBe("saved");
    expect(await sample(id)).toEqual([30]);
    // „Zmień”: poprawka nadpisuje próbkę, nie dokłada drugiej
    await repo.setOwnSpent(owner, (await repo.getTask(owner, t.id))!, s, 45 * 60);
    expect(await sample(id)).toEqual([45]);
  });

  it("„Pomiń” zostawia czas zmierzony na kartce i chowa pytanie", async () => {
    const t = await repo.createTask(owner, { title: "Pomiń", steps: [{ title: "Bez czasu", tool: "manual" }, { title: "Zmierzony", tool: "manual" }] });
    const [a, b] = t.steps.map((x) => x.id);
    await finishStep(owner, t.id, a, { by: "owner" });
    await repo.setOwnSpent(owner, (await repo.getTask(owner, t.id))!, await stepOf(t.id, a), null);
    expect(timeAskOf(await stepOf(t.id, a))).toBeNull();
    expect(await sample(a)).toEqual([]);
    await repo.addOwnSec(b, 6 * 60);   // zegar kartki
    await finishStep(owner, t.id, b, { by: "owner" });
    expect(await sample(b)).toEqual([6]);
    await repo.setOwnSpent(owner, (await repo.getTask(owner, t.id))!, await stepOf(t.id, b), null);
    const s = await stepOf(t.id, b);
    expect(s.spentSec).toBe(360);
    expect(timeAskOf(s)).toBe("saved");
  });
});
