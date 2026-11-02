// Paczka 40: menu „Ułóż” z gotowymi układami (zadanie „Menu Ułóż z gotowymi układami kanwy”, wersja A „Lista z opisem”).
// Układy liczą się w aplikacji bez agenta; grupy automatyczne na głównej kanwie stoją w rzędach o proporcjach ekranu, nie w kolumnie.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { daysBetween, isPreset, presetGroups, type PresetTask } from "@/lib/canvas/presets";
import { computePositions, packGroups, LANE_ASPECT, TASK_SIZE, type LGroup } from "@/lib/canvas/layout";

const t = (id: string, o: Partial<PresetTask> = {}): PresetTask => ({ id, eff: 3, remainMin: 30, due: null, projectId: null, dueDays: null, look: "plan-ag", mine: false, hasSteps: true, ...o });

describe("gotowe układy: podział na grupy", () => {
  it("klucze z menu", () => {
    expect(isPreset("projects")).toBe(true); expect(isPreset("lanes")).toBe(true); expect(isPreset("x")).toBe(false);
  });
  it("według projektów: od najważniejszego projektu, „Bez projektu” na końcu, bez pustych grup", () => {
    const projects = [{ id: "a", name: "Finanse", color: 1, weight: 3 }, { id: "b", name: "Shiftwow", color: 2, weight: 4 }, { id: "c", name: "Pusty", color: 3, weight: 5 }];
    const g = presetGroups("projects", [t("1", { projectId: "a" }), t("2", { projectId: "b" }), t("3"), t("4", { projectId: "b", eff: 5 }), t("5", { projectId: "zniknął" })], projects);
    expect(g.map((x) => x.name)).toEqual(["Shiftwow", "Finanse", "Bez projektu"]);
    expect(g[0]).toMatchObject({ color: 2, ids: ["4", "2"] });
    expect(g[2].ids.sort()).toEqual(["3", "5"]);
  });
  it("według terminu: po terminie, dziś, ten tydzień, później, bez terminu", () => {
    const g = presetGroups("due", [t("late", { dueDays: -2 }), t("today", { dueDays: 0 }), t("week", { dueDays: 7 }), t("later", { dueDays: 8 }), t("none")], []);
    expect(g.map((x) => [x.name, x.ids])).toEqual([["Po terminie", ["late"]], ["Dziś", ["today"]], ["Ten tydzień", ["week"]], ["Później", ["later"]], ["Bez terminu", ["none"]]]);
  });
  it("według stanu: Twój ruch, agent pracuje, czeka, nowe (nierozpisane)", () => {
    const g = presetGroups("state", [t("new", { hasSteps: false, look: "mine" }), t("me", { look: "mine" }), t("both", { look: "live", mine: true }), t("ag", { look: "live" }), t("wait", { look: "plan-me" }), t("help", { look: "help" })], []);
    expect(g.map((x) => x.name)).toEqual(["Twój ruch", "Agent pracuje", "Czeka na kogoś", "Nowe"]);
    expect(g[0].ids.sort()).toEqual(["both", "help", "me"]);
    expect(g[1].ids).toEqual(["ag"]); expect(g[2].ids).toEqual(["wait"]); expect(g[3].ids).toEqual(["new"]);
  });
  it("dni do terminu liczone po dniach kalendarza", () => {
    expect(daysBetween("2026-11-02", "2026-11-02")).toBe(0);
    expect(daysBetween("2026-11-02", "2026-11-01")).toBe(-1);
    expect(daysBetween("2026-10-30", "2026-11-02")).toBe(3);
  });
});

describe("rozkład grup w kształcie ekranu", () => {
  it("pięć grup nie stoi w jednej kolumnie; całość bliżej proporcji ekranu niż wysoka kolumna", () => {
    const pk = packGroups([7, 5, 1, 1, 1], TASK_SIZE);
    expect(new Set(pk.pos.map((p) => p.y)).size).toBeLessThan(5);
    expect(pk.w / pk.h).toBeGreaterThan(1);
    expect(pk.w / pk.h).toBeLessThan(LANE_ASPECT * 2.5);
  });
  it("grupy z czatu (automatyczne) na głównej kanwie: kafelki w swoich prostokątach, prostokąty bez nakładania", () => {
    const ids = (n: number, p: string) => Array.from({ length: n }, (_, i) => `${p}${i}`);
    const groupsIn: LGroup[] = [ids(7, "a"), ids(4, "b"), ids(2, "c"), ids(1, "d")].map((m, i) => ({ id: "g" + i, x: 0, y: 0, w: 0, h: 0, members: m, auto: true }));
    const items = groupsIn.flatMap((g) => g.members).map((id) => ({ id, dependsOn: [], pos: null }));
    const L = computePositions(items, groupsIn, TASK_SIZE, false);
    L.groups.forEach((g) => g.members.forEach((id) => {
      const q = L.P[id];
      expect(q.x).toBeGreaterThanOrEqual(g.x); expect(q.x + TASK_SIZE.w).toBeLessThanOrEqual(g.x + g.w);
      expect(q.y).toBeGreaterThanOrEqual(g.y + 40); expect(q.y + TASK_SIZE.h).toBeLessThanOrEqual(g.y + g.h);
    }));
    for (const a of L.groups) for (const b of L.groups) if (a !== b) {
      const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
      expect(apart).toBe(true);
    }
    const xs = new Set(L.groups.map((g) => g.x));
    expect(xs.size).toBeGreaterThan(1);   // nie jedna kolumna
  });
  it("kanwa zadania (kroki) bez zmian: grupy pod sobą", () => {
    const g: LGroup[] = [{ id: "x", x: 0, y: 0, w: 0, h: 0, members: ["s1"], auto: true }, { id: "y", x: 0, y: 0, w: 0, h: 0, members: ["s2"], auto: true }];
    const L = computePositions([{ id: "s1", dependsOn: [], pos: null }, { id: "s2", dependsOn: [], pos: null }], g, TASK_SIZE, true);
    expect(L.groups[1].y).toBeGreaterThan(L.groups[0].y + L.groups[0].h - 1);
  });
});

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

describe.skipIf(!process.env.TEST_DATABASE_URL)("gotowe układy na serwerze", async () => {
  const repo = await import("@/lib/repo");
  const { sql } = await import("@/lib/db");
  const { layoutPreset } = await import("@/lib/services");
  let owner = "";
  beforeAll(async () => {
    owner = (await repo.ensureOwner()).id;
    await sql()`delete from tasks where owner_id = ${owner}`;
    await sql()`delete from canvas_groups where owner_id = ${owner}`;
    await sql()`delete from projects where owner_id = ${owner}`;
  });
  afterAll(async () => { await sql().end({ timeout: 2 }); });

  it("według projektów: wszystkie poprzednie grupy znikają, nowe są automatyczne, położenia od nowa", async () => {
    const sw = await repo.createProject(owner, "Shiftwow", 4), fin = await repo.createProject(owner, "Finanse", 3);
    const a = await repo.createTask(owner, { title: "Retro", projectId: sw.id, steps: [{ title: "Dopisz", tool: "manual", estMin: 5 }] });
    const b = await repo.createTask(owner, { title: "Konto", projectId: fin.id });
    const c = await repo.createTask(owner, { title: "Pieski", projectId: null });
    await sql()`update tasks set project_id = null where id = ${c.id}`;
    const manual = await repo.createGroup(owner, null, "Ręczna", [a.id], { x: 10, y: 10, w: 400, h: 300 });
    await repo.setTaskPositions(owner, [{ id: b.id, x: 999, y: 999 }]);

    await layoutPreset(owner, "projects");
    const gs = await repo.listGroups(owner, null);
    expect(gs.some((g) => g.id === manual.id)).toBe(false);
    expect(gs.map((g) => [g.name, g.members, g.auto])).toEqual([["Shiftwow", [a.id], true], ["Finanse", [b.id], true], ["Bez projektu", [c.id], true]]);
    expect((await repo.getTask(owner, b.id))!.pos).toBeNull();

    // powrót do „Pilne i szybkie”: same pola, grupy projektów puste i usunięte
    await layoutPreset(owner, "lanes");
    expect((await repo.listGroups(owner, null)).every((g) => !!g.lane)).toBe(true);
  });
});
