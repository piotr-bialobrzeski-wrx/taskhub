// Paczka 40, kroki 02: losowanie, przegląd, priorytet i pole na kanwie według rodzaju terminu („Dwa rodzaje terminu zadań”)
// oraz kolejne wystąpienie po zakończeniu („Cykliczne terminy zadań i kroków"). Część z bazą pomijana bez TEST_DATABASE_URL.
import { describe, it, expect, beforeAll } from "vitest";
import { beforeItsDay, dueReached } from "@/lib/due";
import { drawPool, drawRestore } from "@/lib/canvas/draw";
import { inReview, reviewQueue } from "@/lib/canvas/review";
import { laneOf } from "@/lib/canvas/lanes";
import { scoreOf } from "@/lib/priority";
import { step, task } from "./helpers";

const TODAY = "2026-11-10";
const tile = (id: string, due: { iso: string; kind?: "by" | "on" } | null) => ({ id, eff: 3, base: 3, state: "todo", draw: { min: 15, step: "Zrób" }, due });

describe("„w dniu” przed swoim dniem", () => {
  it("pomocnicze: przed dniem, dziś, po dniu", () => {
    expect(beforeItsDay("2026-11-12", "on", TODAY)).toBe(true);
    expect(beforeItsDay("2026-11-10", "on", TODAY)).toBe(false);
    expect(beforeItsDay("2026-11-12", "by", TODAY)).toBe(false);
    expect(dueReached("2026-11-10", TODAY)).toBe(true);
    expect(dueReached("2026-11-09", TODAY)).toBe(true);
    expect(dueReached("2026-11-11", TODAY)).toBe(false);
    expect(dueReached(null, TODAY)).toBe(false);
  });
  it("losowanie: „w dniu” dopiero od swojego dnia, „zrób do” jak dotąd", () => {
    const ts = [tile("a", { iso: "2026-11-12", kind: "on" }), tile("b", { iso: "2026-11-10", kind: "on" }), tile("c", { iso: "2026-11-01", kind: "on" }), tile("d", { iso: "2026-11-12", kind: "by" }), tile("e", null)];
    expect(drawPool(ts, 60, null, TODAY).map((t) => t.id)).toEqual(["b", "c", "d", "e"]);
    expect(drawRestore(JSON.stringify({ id: "a", limit: 60 }), ts, TODAY)).toBeNull();
    expect(drawRestore(JSON.stringify({ id: "b", limit: 60 }), ts, TODAY)?.id).toBe("b");
  });
  it("przegląd: „w dniu” tylko po swoim dniu, bez terminu i po terminie jak dotąd", () => {
    expect(inReview(tile("a", { iso: "2026-11-12", kind: "on" }), TODAY)).toBe(false);
    expect(inReview(tile("b", { iso: "2026-11-10", kind: "on" }), TODAY)).toBe(false);
    expect(inReview(tile("c", { iso: "2026-11-09", kind: "on" }), TODAY)).toBe(true);
    expect(inReview(tile("d", { iso: "2026-11-09", kind: "by" }), TODAY)).toBe(true);
    expect(reviewQueue([tile("a", { iso: "2026-11-12", kind: "on" }), tile("e", null)], TODAY).map((t) => t.id)).toEqual(["e"]);
  });
  it("priorytet: przed dniem termin nic nie dodaje, w dniu +2, po dniu +2; „zrób do” blisko terminu dalej podnosi", () => {
    const now = new Date("2026-11-10T10:00:00").getTime();
    const sc = (due: string, kind: "by" | "on") => scoreOf({ task: task({ level: 2, due, dueKind: kind, steps: [step({ estMin: 600 })] }), project: null, blockedCount: 0, samples: [], now });
    expect(sc("2026-11-11", "on").eff).toBe(2);
    expect(sc("2026-11-11", "on").why).toEqual([]);
    expect(sc("2026-11-10", "on").eff).toBe(4);
    expect(sc("2026-11-08", "on").why[0].txt).toBe("termin minął");
    expect(sc("2026-11-11", "by").eff).toBeGreaterThan(2);
  });
  it("pole na kanwie: termin dziś albo po terminie = pilne, także przy niskim priorytecie; „w dniu” przed dniem nie", () => {
    const base = { eff: 2, remainMin: 15, hasSteps: true, today: TODAY };
    expect(laneOf({ ...base, due: "2026-11-10" })).toBe("pilne-szybkie");
    expect(laneOf({ ...base, due: "2026-11-01", remainMin: 120 })).toBe("pilne-dluzsze");
    expect(laneOf({ ...base, due: "2026-11-12" })).toBe("szybkie-poczekaja");
    expect(laneOf({ ...base, due: "2026-11-10", waiting: true })).toBe("przy-okazji");
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)("kolejne wystąpienie po zakończeniu", async () => {
  const repo = await import("@/lib/repo");
  const { sql } = await import("@/lib/db");
  let owner = "";
  beforeAll(async () => {
    owner = (await repo.ensureOwner()).id;
    await sql()`delete from tasks where owner_id = ${owner}`;
  });

  it("zadanie: po zakończeniu nowe zadanie z kolejnym terminem, tym samym rodzajem i krokami od nowa; stare bez reguły", async () => {
    const t = await repo.createTask(owner, { title: "Opłata za prąd", due: "2026-01-31", dueKind: "on", repeat: { every: 1, unit: "month" }, level: 4,
      steps: [{ title: "Sprawdź kwotę", tool: "claude" }, { title: "Zapłać rachunek", tool: "manual", dependsOn: ["n1"] }] });
    await repo.updateStep(t.steps[1].id, { due: "2026-01-30", repeat: null });
    for (const s of (await repo.getTask(owner, t.id))!.steps) await repo.completeStep(owner, (await repo.getTask(owner, t.id))!, s, { report: "ok", by: "agent" });
    const old = (await repo.getTask(owner, t.id))!;
    expect(old.doneAt).not.toBeNull();
    expect(old.repeat).toBeNull();
    const all = (await repo.listTasks(owner)).filter((x) => x.title === "Opłata za prąd");
    expect(all).toHaveLength(2);
    const n = all.find((x) => x.id !== t.id)!;
    expect(n).toMatchObject({ due: "2026-02-28", dueKind: "on", repeat: { every: 1, unit: "month" }, level: 4, doneAt: null });
    expect(n.steps.map((s) => [s.title, s.status])).toEqual([["Sprawdź kwotę", "todo"], ["Zapłać rachunek", "todo"]]);
    expect(n.steps[1].dependsOn).toEqual([n.steps[0].id]);
    expect(n.steps[1].due).toBe("2026-02-27");   // przesunięty o tyle, o ile termin zadania (28 dni)
    expect(n.steps[0].report).toBeNull();
    // ponowne otwarcie i zamknięcie starego nie tworzy drugiej kopii
    await repo.reopenStep(owner, t.id, old.steps[1]);
    await repo.completeStep(owner, (await repo.getTask(owner, t.id))!, (await repo.getTask(owner, t.id))!.steps[1], { by: "owner" });
    expect((await repo.listTasks(owner)).filter((x) => x.title === "Opłata za prąd")).toHaveLength(2);
  });

  it("krok: po zakończeniu nowy krok tuż za nim w tym samym zadaniu, z kolejnym terminem; zadanie zostaje otwarte", async () => {
    const t = await repo.createTask(owner, { title: "Porządki", steps: [{ title: "Podlej kwiaty", tool: "manual" }, { title: "Wynieś śmieci", tool: "manual" }] });
    await repo.updateStep(t.steps[0].id, { due: "2026-11-10", dueKind: "on", repeat: { every: 1, unit: "week" } });
    const cur = (await repo.getTask(owner, t.id))!;
    await repo.completeStep(owner, cur, cur.steps[0], { by: "owner" });
    const after = (await repo.getTask(owner, t.id))!;
    expect(after.steps.map((s) => [s.title, s.status, s.due ?? null])).toEqual([["Podlej kwiaty", "done", "2026-11-10"], ["Podlej kwiaty", "todo", "2026-11-17"], ["Wynieś śmieci", "todo", null]]);
    expect(after.steps[0].repeat).toBeNull();
    expect(after.steps[1]).toMatchObject({ dueKind: "on", repeat: { every: 1, unit: "week" } });
    expect(after.doneAt).toBeNull();
  });
});
