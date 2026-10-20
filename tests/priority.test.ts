import { describe, it, expect } from "vitest";
import { scoreOf, sortByPriority, whyText } from "@/lib/priority";
import { todayISO } from "@/lib/time";
import { project, step, task } from "./helpers";

const plusDays = (d: number) => { const x = new Date(); x.setDate(x.getDate() + d); return todayISO(x); };

describe("priorytet efektywny", () => {
  it("bez powodów równa się poziomowi", () => {
    const s = scoreOf({ task: task({ level: 2 }), project: null, blockedCount: 0, samples: [] });
    expect(s).toEqual({ base: 2, eff: 2, why: [] });
  });
  it("ważność projektu przesuwa o pół punktu na stopień i jest wypisana", () => {
    const s = scoreOf({ task: task({ level: 3 }), project: project({ weight: 5, name: "Klient A" }), blockedCount: 0, samples: [] });
    expect(s.eff).toBe(4);
    expect(whyText(s)).toContain("Klient A");
    const low = scoreOf({ task: task({ level: 3 }), project: project({ weight: 1 }), blockedCount: 0, samples: [] });
    expect(low.eff).toBe(2);
    expect(low.why[0].v).toBe(-1);
  });
  it("termin dziś lub miniony daje +2, w ciągu 2 dni +1, wynik nie przekracza 5", () => {
    expect(scoreOf({ task: task({ level: 4, due: todayISO() }), project: null, blockedCount: 0, samples: [] }).eff).toBe(5);
    expect(scoreOf({ task: task({ level: 1, due: plusDays(-3) }), project: null, blockedCount: 0, samples: [] }).eff).toBe(3);
    expect(scoreOf({ task: task({ level: 2, due: plusDays(1) }), project: null, blockedCount: 0, samples: [] }).eff).toBe(3);
  });
  it("za dużo pracy Piotra na dni do terminu dodaje +1 i liczy czas wg kalibracji; praca Claude'a nie liczy się", () => {
    const t = task({ level: 2, due: plusDays(1), steps: [step({ estMin: 240, tool: "manual" })] });
    const samples = Array.from({ length: 3 }, () => ({ tool: "manual", projectId: null, estMin: 60, spentMin: 120, who: "owner" as const }));
    const s = scoreOf({ task: t, project: null, blockedCount: 0, samples });
    expect(s.why.map((w) => w.txt).join(" ")).toContain("wg Twoich czasów");
    expect(s.eff).toBe(4); // 2 + 1 (termin) + 1 (praca)
    const claude = scoreOf({ task: task({ level: 2, due: plusDays(1), steps: [step({ estMin: 240, tool: "code" })] }), project: null, blockedCount: 0, samples });
    expect(claude.why.map((w) => w.txt).join(" ")).not.toContain("zostało ~");
  });
  it("blokowanie innych dodaje pół punktu, ukończone zadanie nie dostaje bonusów", () => {
    const s = scoreOf({ task: task({ level: 3 }), project: null, blockedCount: 2, samples: [] });
    expect(s.eff).toBe(4);
    const done = scoreOf({ task: task({ level: 3, due: todayISO(), steps: [step({ status: "done" })] }), project: null, blockedCount: 2, samples: [] });
    expect(done.eff).toBe(3);
  });
  it("sortowanie: wyższy efektywny pierwszy", () => {
    const a = task({ level: 2, title: "a" }), b = task({ level: 4, title: "b" });
    const list = sortByPriority([{ task: a, score: scoreOf({ task: a, project: null, blockedCount: 0, samples: [] }) }, { task: b, score: scoreOf({ task: b, project: null, blockedCount: 0, samples: [] }) }]);
    expect(list[0].task.title).toBe("b");
  });
});
