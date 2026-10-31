// Paczka 31: układ kafelków „Pilne i szybkie” (wariant C). Cztery pola w macierzy 2×2 na głównej kanwie: pilne albo nie × szybkie albo dłuższe.
// Pole ustala asystent (update_task lane, według zasady w bazie); bez niego liczy się z priorytetu efektywnego i pracy Piotra.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { assignLanes, laneOf } from "@/lib/canvas/lanes";
import { computePositions, laneMatrix, TASK_SIZE, type LGroup, type LItem } from "@/lib/canvas/layout";

describe("pola kafelków: przydział", () => {
  it("bez pola od asystenta: pilne = priorytet efektywny 4+, szybkie = do 30 minut; nierozpisane = dłuższe", () => {
    expect(laneOf({ eff: 5, remainMin: 5, hasSteps: true })).toBe("pilne-szybkie");
    expect(laneOf({ eff: 4, remainMin: 60, hasSteps: true })).toBe("pilne-dluzsze");
    expect(laneOf({ eff: 3, remainMin: 30, hasSteps: true })).toBe("szybkie-poczekaja");
    expect(laneOf({ eff: 2, remainMin: 0, hasSteps: false })).toBe("przy-okazji");
  });
  it("pole od asystenta wygrywa; nieznane pole jest pomijane", () => {
    expect(laneOf({ lane: "przy-okazji", eff: 5, remainMin: 5, hasSteps: true })).toBe("przy-okazji");
    expect(laneOf({ lane: "coś", eff: 5, remainMin: 5, hasSteps: true })).toBe("pilne-szybkie");
  });
  it("w polu: wyższy priorytet, potem mniej pracy, potem bliższy termin", () => {
    const t = (id: string, eff: number, remainMin: number, due: string | null = null) => ({ id, eff, remainMin, due, hasSteps: true });
    const out = assignLanes([t("a", 4, 20), t("b", 5, 25), t("c", 4, 10), t("d", 4, 10, "2026-11-01")]);
    expect(out["pilne-szybkie"]).toEqual(["b", "d", "c", "a"]);
    expect(out["przy-okazji"]).toEqual([]);
  });
});

describe("pola kafelków: macierz", () => {
  const ids = (n: number, p: string) => Array.from({ length: n }, (_, i) => `${p}${i}`);
  it("cztery pola od lewej do prawej i od góry do dołu, bez nakładania; wszystkie kafelki w swoich polach", () => {
    const cells = [ids(7, "a"), ids(3, "b"), ids(1, "c"), ids(3, "d")];
    const m = laneMatrix(cells, TASK_SIZE);
    const [uq, ul, lq, ll] = m.cells;
    expect(ul.x).toBeGreaterThan(uq.x + uq.w);
    expect(lq.y).toBeGreaterThan(uq.y + uq.h);
    expect(ll.x).toBe(ul.x); expect(ll.y).toBe(lq.y);
    cells.forEach((c, i) => c.forEach((id) => {
      const q = m.P[i][id], r = m.cells[i];
      expect(q.x).toBeGreaterThanOrEqual(r.x); expect(q.x + TASK_SIZE.w).toBeLessThanOrEqual(r.x + r.w);
      expect(q.y).toBeGreaterThan(r.y); expect(q.y + TASK_SIZE.h).toBeLessThanOrEqual(r.y + r.h);
    }));
    // pierwsze pole czyta się jak tekst: drugi kafelek obok pierwszego, nie pod nim
    expect(m.P[0].a1.y).toBe(m.P[0].a0.y);
    expect(m.P[0].a1.x).toBeGreaterThan(m.P[0].a0.x);
    // proporcje szerokiego ekranu, nie jedna kolumna
    expect(m.w / m.h).toBeGreaterThan(1.2);
  });
  it("puste pole zostaje na swoim miejscu", () => {
    const m = laneMatrix([[], ids(2, "b"), ids(2, "c"), []], TASK_SIZE);
    expect(m.cells[0].w).toBeGreaterThan(0);
    expect(m.cells[0].h).toBeGreaterThan(0);
  });
  it("computePositions: pola automatyczne w macierzy, wolne kafelki pod nią w wierszu; po zapisaniu (auto false) prostokąty zostają", () => {
    const items: LItem[] = [...ids(4, "t"), "f1", "f2"].map((id) => ({ id, dependsOn: [], pos: null }));
    const g = (id: string, lane: string, members: string[]): LGroup => ({ id, lane, members, auto: true, x: 0, y: 0, w: 0, h: 0 });
    const groups = [g("G4", "przy-okazji", ["t3"]), g("G1", "pilne-szybkie", ["t0", "t1"]), g("G2", "pilne-dluzsze", ["t2"]), g("G3", "szybkie-poczekaja", [])];
    const L = computePositions(items, groups, TASK_SIZE, false);
    const by = Object.fromEntries(L.groups.map((x) => [x.id, x]));
    expect(by.G1.x).toBeLessThan(by.G2.x);
    expect(by.G1.y).toBeLessThan(by.G3.y);
    expect(by.G4.x).toBe(by.G2.x); expect(by.G4.y).toBe(by.G3.y);
    const bottom = Math.max(...L.groups.map((x) => x.y + x.h));
    expect(L.P.f1.y).toBeGreaterThan(bottom);
    expect(L.P.f2.y).toBe(L.P.f1.y);
    const frozen = L.groups.map((x) => ({ ...x, auto: false }));
    const placed = items.map((x) => ({ ...x, pos: L.P[x.id] ?? null }));
    const again = computePositions(placed, frozen, TASK_SIZE, false);
    expect(again.groups.find((x) => x.id === "G1")).toMatchObject({ x: by.G1.x, y: by.G1.y, w: by.G1.w, h: by.G1.h });
  });
  it("kanwa kroków nie zna pól: zwykły układ po zależnościach", () => {
    const items: LItem[] = [{ id: "s1", dependsOn: [], pos: null }];
    const L = computePositions(items, [{ id: "G", lane: "pilne-szybkie", members: ["s1"], auto: true, x: 0, y: 0, w: 0, h: 0 }], TASK_SIZE, true);
    expect(L.groups[0].x).toBeGreaterThan(TASK_SIZE.w);   // obok kafelka zadania, jak każda grupa automatyczna
  });
});

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

describe.skipIf(!process.env.TEST_DATABASE_URL)("pola kafelków: „Ułóż” na głównej kanwie i pole od asystenta", async () => {
  const repo = await import("@/lib/repo");
  const { sql } = await import("@/lib/db");
  const { layoutLanes } = await import("@/lib/services");
  let owner = "";
  beforeAll(async () => {
    owner = (await repo.ensureOwner()).id;
    await sql()`delete from tasks where owner_id = ${owner}`;
    await sql()`delete from canvas_groups where owner_id = ${owner}`;
    await sql()`delete from projects where owner_id = ${owner}`;
  });
  afterAll(async () => { await sql().end({ timeout: 2 }); });

  it("„Ułóż”: każde otwarte zadanie w swoim polu, pola z kolejnością, pusta grupa znika, ukończone zostaje poza polami", async () => {
    const quickUrgent = await repo.createTask(owner, { title: "Zgoda na szkic", level: 5, steps: [{ title: "Zatwierdź szkic", tool: "manual", estMin: 5 }] });
    const longUrgent = await repo.createTask(owner, { title: "Faktura", level: 4, steps: [{ title: "Rozlicz godziny", tool: "manual", estMin: 90 }] });
    const quickLater = await repo.createTask(owner, { title: "Retro", level: 3, steps: [{ title: "Dopisz temat", tool: "manual", estMin: 10 }] });
    const later = await repo.createTask(owner, { title: "Certyfikaty", level: 2 });
    const byAgent = await repo.createTask(owner, { title: "Wideo dla behawiorystki", level: 5, steps: [{ title: "Wyślij", tool: "manual", estMin: 5 }] });
    await repo.updateTask(owner, byAgent.id, { lane: "przy-okazji" });
    const done = await repo.createTask(owner, { title: "Zrobione", level: 5, steps: [{ title: "Coś", tool: "manual", estMin: 5 }] });
    await sql()`update steps set status = 'done' where task_id = ${done.id}`;
    const old = await repo.createGroup(owner, null, "Shiftwow", [longUrgent.id, quickLater.id]);
    const keep = await repo.createGroup(owner, null, "Z ukończonym", [done.id]);
    await repo.setTaskPositions(owner, [{ id: later.id, x: 999, y: 999 }]);

    await layoutLanes(owner);
    const gs = await repo.listGroups(owner, null);
    const lane = (k: string) => gs.find((g) => g.lane === k)!;
    expect(lane("pilne-szybkie")).toMatchObject({ name: "Pilne i szybkie", auto: true, members: [quickUrgent.id] });
    expect(lane("pilne-dluzsze").members).toEqual([longUrgent.id]);
    expect(lane("szybkie-poczekaja").members).toEqual([quickLater.id]);
    expect(lane("przy-okazji").members.sort()).toEqual([later.id, byAgent.id].sort());
    expect(gs.some((g) => g.id === old.id)).toBe(false);          // pusta po ułożeniu
    expect(gs.find((g) => g.id === keep.id)?.members).toEqual([done.id]);
    expect((await repo.getTask(owner, later.id))!.pos).toBeNull();   // położenia od nowa

    // drugie „Ułóż” nie robi drugiego kompletu pól
    await layoutLanes(owner);
    expect((await repo.listGroups(owner, null)).filter((g) => g.lane)).toHaveLength(4);
  });
});
