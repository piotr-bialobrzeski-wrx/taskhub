// Paczka 32, losowanie zadania (wariant A „Bęben”): kto bierze udział, ile Twojej pracy zostało, waga priorytetu, pamięć wyniku.
import { describe, it, expect } from "vitest";
import { taskTile } from "@/lib/canvas/vm";
import { drawPick, drawPool, drawRestore, type DrawTask } from "@/lib/canvas/draw";
import { step, task } from "./helpers";

const tile = (t: ReturnType<typeof task>, questions = 0, all = [t]) => taskTile({ task: t, score: { base: 3, eff: 3, why: [] } } as never, all, questions);

describe("kafelek zadania: dane do losowania", () => {
  it("Twój gotowy krok: tytuł kroku i suma Twoich szacunków", () => {
    const a = step({ tool: "claude", status: "done" }), me = step({ tool: "manual", title: "Zdecyduj wariant", estMin: 10, dependsOn: [a.id] }), me2 = step({ tool: "manual", title: "Wdróż", estMin: 5, dependsOn: [me.id] });
    expect(tile(task({ steps: [a, me, me2] })).draw).toEqual({ min: 15, step: "Zdecyduj wariant" });
  });
  it("szkic do zatwierdzenia też jest Twoim krokiem", () => {
    expect(tile(task({ steps: [step({ tool: "slack", status: "draft", title: "Odpowiedz Kindze" })] })).draw?.step).toBe("Odpowiedz Kindze");
  });
  it("nic dla Ciebie (agent pracuje albo Twój krok czeka na inne): poza losowaniem", () => {
    const a = step({ tool: "claude" }), me = step({ tool: "manual", dependsOn: [a.id] });
    expect(tile(task({ steps: [a, me] })).draw).toBeNull();
  });
  it("pytanie od agenta bez kroku Piotra", () => {
    expect(tile(task({ steps: [step({ tool: "claude" })] }), 1).draw).toEqual({ min: 0, step: "Odpowiedz na pytanie agenta" });
  });
});

const T = (id: string, eff: number, min: number | null, state = "active"): DrawTask => ({ id, eff, state, draw: min == null ? null : { min, step: "x" } });

describe("losowanie", () => {
  const all = [T("a", 5, 5), T("b", 3, 30), T("c", 4, 120), T("d", 5, null), T("e", 5, 10, "done"), T("f", 5, 10, "blocked")];
  it("pula: tylko Twoje zadania mieszczące się w czasie, bez wykluczonego", () => {
    expect(drawPool(all, 15).map((t) => t.id)).toEqual(["a"]);
    expect(drawPool(all, 30).map((t) => t.id)).toEqual(["a", "b"]);
    expect(drawPool(all, 120, "a").map((t) => t.id)).toEqual(["b", "c"]);
  });
  it("waga = kwadrat priorytetu: ważniejsze wypadają częściej", () => {
    const p = [T("lo", 1, 5), T("hi", 3, 5)];   // wagi 1 i 9
    expect(drawPick(p, 0)?.id).toBe("lo");
    expect(drawPick(p, 0.09)?.id).toBe("lo");
    expect(drawPick(p, 0.11)?.id).toBe("hi");
    expect(drawPick(p, 0.999)?.id).toBe("hi");
    expect(drawPick([], 0.5)).toBeNull();
  });
  it("zapamiętany wynik wraca, dopóki zadanie czeka na Piotra", () => {
    const raw = JSON.stringify({ id: "a", limit: 15, rerolled: true });
    expect(drawRestore(raw, all)).toMatchObject({ id: "a", limit: 15, rerolled: true });
    expect(drawRestore(JSON.stringify({ id: "e", limit: 15 }), all)).toBeNull();   // zrobione
    expect(drawRestore(JSON.stringify({ id: "d", limit: 15 }), all)).toBeNull();   // nic dla Piotra
    expect(drawRestore("{zepsute", all)).toBeNull();
    expect(drawRestore(null, all)).toBeNull();
  });
});
