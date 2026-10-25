// Paczka 18, ramki i etykiety kafelka (wariant B): 5 stanów kafelka kroku i zadania z jednej palety.
import { describe, it, expect } from "vitest";
import { stepTile, taskLook, stepLook, stepStateOf } from "@/lib/canvas/vm";
import { step, task } from "./helpers";

const look = (s = step(), extra: Partial<Parameters<typeof task>[0]> = {}) => { const t = task({ steps: [s], ...extra }); return stepTile(t, s, [t]).look; };

describe("wygląd kafelka kroku", () => {
  it("krok w toku, zlecony do chmury albo „teraz” biegu: Agent pracuje", () => {
    expect(look(step({ tool: "claude", status: "handoff", agentStartedAt: "2026-10-25T10:00:00Z" }))).toEqual({ key: "live", label: "Agent pracuje" });
    expect(look(step({ tool: "manual", cloud: { state: "queued", at: "2026-10-25T10:00:00Z" } })).key).toBe("live");
    const s = step({ tool: "claude" }), t = task({ steps: [s] });
    expect(stepTile(t, s, [t], { taskId: t.id, stepId: s.id, text: "Read", detail: null, since: "2026-10-25T10:00:00Z" } as never).look.key).toBe("live");
  });
  it("zatwierdzony szkic czeka na wysyłkę: Zaplanowane dla agenta", () => {
    expect(look(step({ tool: "slack", status: "handoff", approvedAt: "2026-10-25T10:00:00Z" }))).toEqual({ key: "plan-ag", label: "Zaplanowane" });
  });
  it("krok oddany bez czekania: Potrzebna pomoc", () => {
    expect(look(step({ tool: "gmail", leftAt: "2026-10-25T10:00:00Z" }))).toEqual({ key: "help", label: "Potrzebna pomoc" });
  });
  it("Twoja kolej: szkic, decyzja albo czynność", () => {
    expect(look(step({ tool: "slack", status: "draft" }))).toEqual({ key: "mine", label: "Zatwierdź szkic" });
    expect(look(step({ tool: "manual", title: "Zdecyduj, które tickety wracają" })).label).toBe("Zdecyduj");
    expect(look(step({ tool: "manual", blocks: [{ type: "question", text: "A czy B?", options: [{ label: "A" }, { label: "B" }] }] as never })).label).toBe("Zdecyduj");
    expect(look(step({ tool: "manual", title: "Nagraj wideo" }))).toEqual({ key: "mine", label: "Zrób" });
  });
  it("Zaplanowane: kolor mówi, kto zrobi krok", () => {
    const a = step({ status: "done" }), me = step({ tool: "manual", dependsOn: [a.id] }), ag = step({ tool: "claude", dependsOn: [a.id] });
    const b = step(), me2 = step({ tool: "manual", dependsOn: [b.id] });
    const t = task({ steps: [b, me2, ag] });
    expect(stepTile(t, me2, [t]).look.key).toBe("plan-me");
    expect(stepTile(t, ag, [t]).look.key).toBe("plan-ag");
    expect(look(step({ tool: "claude" })).key).toBe("plan-ag");   // gotowy krok agenta: weźmie go sam
    void me;
  });
  it("zrobiony krok", () => { expect(look(step({ status: "done" }))).toEqual({ key: "done", label: "Zrobione" }); });
});

describe("wygląd kafelka zadania", () => {
  const L = (t: ReturnType<typeof task>, working = false, q = 0) => taskLook(t, "active", t.steps.map((s) => stepLook(s, stepStateOf(t, s, [t]), false)), working, q);
  it("kolejność: Twoja kolej, Agent oddał, Agent pracuje, Zaplanowane", () => {
    const live = step({ tool: "claude", status: "handoff", agentStartedAt: "x" }), help = step({ tool: "gmail", leftAt: "x" }), mine = step({ tool: "slack", status: "draft" });
    expect(L(task({ steps: [live, help, mine] }))).toEqual({ key: "mine", label: "Zatwierdź szkic" });
    expect(L(task({ steps: [live, help] })).key).toBe("help");
    expect(L(task({ steps: [live] })).key).toBe("live");
    expect(L(task({ steps: [step({ tool: "claude" })] }), true).key).toBe("live");
    expect(L(task({ steps: [step({ tool: "claude" })] }), false, 1)).toEqual({ key: "mine", label: "Zdecyduj" });
  });
  it("Zaplanowane w kolorze pierwszego otwartego kroku; bez kroków agent rozpisze", () => {
    const d = step({ status: "done" }), ag = step({ tool: "claude", dependsOn: [d.id] });
    expect(L(task({ steps: [d, ag] })).key).toBe("plan-ag");
    expect(L(task({ steps: [] })).key).toBe("plan-ag");
    expect(taskLook(task(), "done", [], false, 0).key).toBe("done");
  });
});
