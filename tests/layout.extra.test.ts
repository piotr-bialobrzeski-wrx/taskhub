// Pusta grupa automatyczna dostaje widoczny prostokąt; skład grup po upuszczeniu zmienia się tylko tam, gdzie coś przeciągnięto.
import { describe, it, expect } from "vitest";
import { computePositions, reassign, TASK_SIZE, type LGroup } from "@/lib/canvas/layout";

describe("layout: pusta grupa automatyczna", () => {
  it("ma domyślny prostokąt pod wolnymi kafelkami", () => {
    const items = [{ id: "a", dependsOn: [], pos: null }];
    const L = computePositions(items, [{ id: "g", x: 0, y: 0, w: 0, h: 0, members: [], auto: true }], TASK_SIZE, false);
    const g = L.groups[0];
    expect(g.w).toBeGreaterThan(200); expect(g.h).toBeGreaterThan(120);
    expect(g.y).toBeGreaterThan(L.P.a.y + TASK_SIZE.h);
  });
});

describe("layout: skład grup po upuszczeniu", () => {
  // duża grupa „big” nachodzi na małą „small”; a leży w obu prostokątach, ale należy do big
  const small: LGroup = { id: "small", x: 0, y: 500, w: 600, h: 250, members: ["b"], auto: false };
  const big: LGroup = { id: "big", x: 0, y: 0, w: 320, h: 800, members: ["a", "c"], auto: false };
  const P = { a: { x: 20, y: 560 }, b: { x: 300, y: 560 }, c: { x: 20, y: 60 }, free: { x: 900, y: 60 } };
  it("przeciągnięty kafelek idzie do najmniejszej grupy pod środkiem, reszta zostaje", () => {
    const m = reassign([small, big], { ...P, free: { x: 100, y: 560 } }, TASK_SIZE, { kind: "tiles", ids: ["free"] });
    expect(m.small).toEqual(["b", "free"]); expect(m.big).toEqual(["a", "c"]);
  });
  it("wyciągnięty kafelek wypada z grupy", () => {
    const m = reassign([small, big], { ...P, a: { x: 900, y: 500 } }, TASK_SIZE, { kind: "tiles", ids: ["a"] });
    expect(m.big).toEqual(["c"]); expect(m.small).toEqual(["b"]);
  });
  it("przesunięta grupa zabiera swoje kafelki i wolne pod prostokątem, nie cudze", () => {
    const m = reassign([small, big], { ...P, free: { x: 40, y: 300 } }, TASK_SIZE, { kind: "group", id: "big", resized: false });
    expect(m.big).toEqual(["a", "c", "free"]); expect(m.small).toEqual(["b"]);
  });
  it("rozciągnięta grupa gubi kafelki, które wypadły", () => {
    const m = reassign([small, { ...big, h: 300 }], P, TASK_SIZE, { kind: "group", id: "big", resized: true });
    expect(m.big).toEqual(["c"]); expect(m.small).toEqual(["b"]);
  });
});
