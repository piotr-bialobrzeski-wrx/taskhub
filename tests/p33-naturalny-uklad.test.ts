import { describe, it, expect } from "vitest";
import { naturalLayout, nextStepLayout, routeEdges, STEP_SIZE, OX, OY, type LItem } from "@/lib/canvas/layout";
import { sample } from "./path-sample";

const S = STEP_SIZE;
const it0 = (id: string, d: string[] = []): LItem => ({ id, dependsOn: d, pos: null });
// zrzut Piotra: 6 kroków zadania „Rysunkowy widok zadania w Task Hub”
const small = [it0("s1"), it0("s2"), it0("s3", ["s2"]), it0("s4", ["s1", "s2", "s3"]), it0("s5", ["s4"]), it0("s6", ["s5"])];

describe("paczka 33: naturalny układ kroków (wariant C) i same łuki", () => {
  it("wątek idzie w jednym rzędzie, krok łączący stoi między poprzednikami, kolumny rosną z głębokością", () => {
    const P = naturalLayout(small, S);
    expect(P.s2.y).toBe(P.s3.y);                     // s3 kontynuuje wątek s2
    expect(P.s1.y).not.toBe(P.s2.y);                 // dwa starty = dwa rzędy
    expect(P.s4.x).toBeGreaterThan(P.s3.x);
    expect(P.s5.y).toBe(P.s4.y); expect(P.s6.y).toBe(P.s4.y);   // następcy łączącego w jego rzędzie
    expect(P.s4.y).toBeGreaterThanOrEqual(Math.min(P.s1.y, P.s2.y));
    expect(P.s4.y).toBeLessThanOrEqual(Math.max(P.s1.y, P.s2.y));
  });

  it("kafelki się nie nakładają, także przy odgałęzieniach i cyklu", () => {
    const list = [it0("a"), it0("b", ["a"]), it0("c", ["a"]), it0("d", ["a"]), it0("e", ["b", "c", "d"]), it0("f", ["e"]), it0("g", ["c"]), it0("x", ["y"]), it0("y", ["x"])];
    const P = naturalLayout(list, S);
    const ids = Object.keys(P);
    expect(ids.sort()).toEqual(list.map((x) => x.id).sort());
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const p = P[ids[i]], q = P[ids[j]];
      expect(p.x < q.x + S.w && p.x + S.w > q.x && p.y < q.y + S.h && p.y + S.h > q.y).toBe(false);
    }
    // kafelek zadania zostaje w (OX, OY): kroki stoją w kolumnach na prawo od niego
    ids.forEach((id) => expect(P[id].x).toBeGreaterThan(OX + S.w));
    ids.forEach((id) => expect(P[id].y).toBeGreaterThanOrEqual(OY));   // nic nie wchodzi pod pasek u góry
  });

  it("„Ułóż” przełącza: siatka → naturalny → siatka", () => {
    expect(nextStepLayout(small, [], S)).not.toBeNull();           // dziś siatka (bez położeń): następny = naturalny
    const placed = small.map((s, i) => ({ ...s, pos: { x: i, y: i } }));
    expect(nextStepLayout(placed, [], S)).toBeNull();              // ułożone albo przeciągnięte: wraca siatka
    // kroki w grupach nie biorą udziału
    const P = nextStepLayout(small, [{ members: ["s5", "s6"] }], S)!;
    expect(Object.keys(P).sort()).toEqual(["s1", "s2", "s3", "s4"]);
  });

  it("linie z jednego kafelka wychodzą w różnych miejscach, w kolejności celów, i nie przechodzą przez kafelki", () => {
    const P = naturalLayout(small, S);
    const r = (id: string) => ({ ...P[id], ...S }), T = { x: OX, y: OY, ...S };
    const E = [{ a: T, b: r("s1"), ay: 58 }, { a: T, b: r("s2"), ay: 58 }, { a: r("s2"), b: r("s3") }, { a: r("s1"), b: r("s4") }, { a: r("s2"), b: r("s4") }, { a: r("s3"), b: r("s4") }, { a: r("s4"), b: r("s5") }, { a: r("s5"), b: r("s6") }];
    const tiles = [T, ...Object.keys(P).map(r)];
    const D = routeEdges(E, tiles);
    D.forEach((d) => expect(d).not.toContain("Q"));
    const y0 = (d: string) => Number(d.split(" ")[1]);
    expect(y0(D[0])).not.toBe(y0(D[1]));
    E.forEach((e, i) => {
      const others = tiles.filter((t) => t !== e.a && t !== e.b);
      for (const [x, y] of sample(D[i])) expect(others.some((t) => x > t.x + 2 && x < t.x + t.w - 2 && y > t.y + 2 && y < t.y + t.h - 2)).toBe(false);
    });
  });
});
