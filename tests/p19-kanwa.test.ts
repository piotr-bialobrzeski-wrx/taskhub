import { describe, it, expect } from "vitest";
import { sample } from "./path-sample";
import { bounds, computePositions, gridFor, routeEdges, GX, OX, OY, STEP_SIZE } from "@/lib/canvas/layout";

const S = STEP_SIZE;
describe("paczka 19: układ kafelków, strzałki i granice kanwy", () => {
  it("kroki z tym samym poprzednikiem stoją jeden pod drugim, krok zbiorczy w osobnej kolumnie za nimi", () => {
    const items = [
      { id: "a", dependsOn: [], pos: null },
      { id: "b", dependsOn: ["a"], pos: null }, { id: "c", dependsOn: ["a"], pos: null }, { id: "d", dependsOn: ["a"], pos: null },
      { id: "dep", dependsOn: ["b", "c", "d"], pos: null },
    ];
    const { grid } = gridFor(items, 1);
    expect([grid.b.c, grid.c.c, grid.d.c]).toEqual([2, 2, 2]);
    expect(new Set([grid.b.r, grid.c.r, grid.d.r]).size).toBe(3);
    expect(grid.dep.c).toBe(3);
  });

  it("kolumna = najdłuższa droga zależności", () => {
    const { grid } = gridFor([{ id: "a", dependsOn: [], pos: null }, { id: "b", dependsOn: ["a"], pos: null }, { id: "c", dependsOn: ["a", "b"], pos: null }], 0);
    expect(grid.c.c).toBe(2);
  });

  it("ręcznie przesunięty kafelek zostaje na miejscu, także nad pierwszym i na lewo (ujemne położenie)", () => {
    const L = computePositions([{ id: "a", dependsOn: [], pos: { x: -300, y: -200 } }, { id: "b", dependsOn: [], pos: null }], [], S, true);
    expect(L.P.a).toEqual({ x: -300, y: -200 });
    const b = bounds(L.P, L.groups, S, L.origin);
    expect(b.x0).toBe(-300 - OX); expect(b.y0).toBe(-200 - OY);
  });

  it("bez kafelków nad i na lewo świat zaczyna się w 0, 0 jak dotąd", () => {
    const L = computePositions([{ id: "a", dependsOn: [], pos: null }], [], S, true);
    const b = bounds(L.P, L.groups, S, L.origin);
    expect([b.x0, b.y0]).toEqual([0, 0]);
  });

  it("strzałka przez kilka kolumn omija kafelek po drodze łukiem (paczka 33: bez łamanej)", () => {
    const col = (c: number) => OX + c * (S.w + GX);
    const a = { x: col(0), y: OY, w: S.w, h: S.h }, mid = { x: col(1), y: OY, w: S.w, h: S.h }, b = { x: col(2), y: OY, w: S.w, h: S.h };
    const [far] = routeEdges([{ a, b }], [a, mid, b]);
    expect(far).not.toContain("Q");
    expect(far).toContain("C");
    for (const [px, py] of sample(far)) expect(px > mid.x + 2 && px < mid.x + mid.w - 2 && py > mid.y + 2 && py < mid.y + mid.h - 2).toBe(false);
    // sąsiednie kolumny: jeden łuk albo prosta
    const [near] = routeEdges([{ a, b: mid }], [a, mid]);
    expect(near.startsWith("M")).toBe(true);
    expect(near).not.toContain("Q");
  });
});
