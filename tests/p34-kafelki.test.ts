// Paczka 34, wariant C „Szeroka obwódka”: zaplanowany krok mówi, kto ruszy, a kafelek zadania ma pasek planu (jeden odcinek na krok).
import { describe, it, expect } from "vitest";
import { stepTile, taskTile } from "@/lib/canvas/vm";
import { step, task } from "./helpers";

describe("zaplanowane: kto ruszy", () => {
  it("krok agenta czekający na inny krok rusza sam, krok Piotra będzie jego ruchem", () => {
    const b = step({ tool: "claude" }), me = step({ tool: "manual", dependsOn: [b.id] }), ag = step({ tool: "claude", dependsOn: [b.id] });
    const t = task({ steps: [b, me, ag] });
    expect(stepTile(t, me, [t]).look).toEqual({ key: "plan-me", label: "Będzie Twój ruch" });
    expect(stepTile(t, ag, [t]).look).toEqual({ key: "plan-ag", label: "Ruszy samo" });
  });
  it("krok „Zleć w projekcie” uzbrojony zgodą z decyzji rusza sam", () => {
    const d = step({ tool: "manual", title: "Wybierz wariant" }), c = step({ tool: "manual", title: "Zleć w projekcie: zmiana", dependsOn: [d.id], cloud: { state: "auto", at: "2026-11-01T10:00:00Z" } as never });
    const t = task({ steps: [d, c] });
    expect(stepTile(t, c, [t]).look.label).toBe("Ruszy samo");
  });
});

describe("pasek planu na kafelku zadania", () => {
  it("jeden odcinek na krok w kolejności kroków", () => {
    const a = step({ status: "done" }), b = step({ tool: "manual", dependsOn: [a.id], title: "Zdecyduj" }), c = step({ tool: "claude", dependsOn: [b.id] }), d = step({ tool: "manual", dependsOn: [c.id], title: "Wdróż na produkcję" });
    const t = task({ steps: [a, b, c, d] });
    expect(taskTile({ task: t, score: { base: 3, eff: 3, why: [] } } as never, [t], 0).plan).toEqual(["me-done", "me-now", "ag-plan", "me-plan"]);
  });
  it("paczka 39: zrobiony odcinek ma kolor tego, kto zrobił, oddany krok jest czerwony", () => {
    const a = step({ status: "done", tool: "manual", doneBy: "owner" }), b = step({ status: "done", tool: "manual", doneBy: "agent" }),
      c = step({ tool: "claude", leftAt: "2026-11-02T08:00:00Z" } as never), d = step({ tool: "claude", status: "handoff", dependsOn: [] });
    const t = task({ steps: [a, b, c, d] });
    expect(taskTile({ task: t, score: { base: 3, eff: 3, why: [] } } as never, [t], 0).plan).toEqual(["me-done", "ag-done", "fail", "ag-now"]);
  });
});
