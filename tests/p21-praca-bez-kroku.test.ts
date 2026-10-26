// Paczka 21: bieg pracuje w zadaniu, ale nie wskazał kroku (po rozpisaniu od razu zbiera fakty do szkicu).
// Pierwszy gotowy krok agenta pokazuje wtedy „Agent pracuje” i czynność biegu, a nie „Zaplanowane” z „Uruchom”.
import { describe, it, expect } from "vitest";
import { stepTile, liveStepId, taskTile } from "@/lib/canvas/vm";
import { step, task } from "./helpers";

const run = (taskId: string, extra = {}) => ({ taskId, stepId: null, text: "używa: conversations search messages", detail: null, since: "2026-10-26T09:15:00Z", kind: "work", ...extra }) as never;

describe("bieg w zadaniu bez wskazanego kroku", () => {
  it("pierwszy gotowy krok agenta pracuje, z czynnością biegu", () => {
    const s = step({ tool: "slack" }), t = task({ steps: [s] });
    const tile = stepTile(t, s, [t], run(t.id));
    expect(tile.look.key).toBe("live");
    expect(tile.glow).toBe("live");
    expect(tile.activity?.since).toBe("2026-10-26T09:15:00Z");
  });
  it("pomija kroki Piotra, zrobione, czekające i zlecone do chmury", () => {
    const a = step({ status: "done", tool: "claude" }), me = step({ tool: "manual" }), wait = step({ tool: "gmail", dependsOn: [me.id] }), ag = step({ tool: "slack" });
    const t = task({ steps: [a, me, wait, ag] });
    expect(liveStepId(t, [t], run(t.id))).toBe(ag.id);
    const only = task({ steps: [step({ tool: "manual" })] });
    expect(liveStepId(only, [only], run(only.id))).toBeNull();
  });
  it("wskazany krok wygrywa; bieg w innym zadaniu i bieg wysyłki nic nie zmieniają", () => {
    const s1 = step({ tool: "slack" }), s2 = step({ tool: "gmail" }), t = task({ steps: [s1, s2] });
    expect(liveStepId(t, [t], run(t.id, { stepId: s2.id }))).toBe(s2.id);
    expect(liveStepId(t, [t], run("inne"))).toBeNull();
    expect(liveStepId(t, [t], run(t.id, { kind: "send" }))).toBeNull();
    expect(stepTile(t, s1, [t], run("inne")).look.key).toBe("plan-ag");
  });
  it("kafelek zadania: Agent pracuje", () => {
    const s = step({ tool: "slack" }), t = task({ steps: [s] });
    expect(taskTile({ task: t, score: { base: 0, eff: 0, why: [] } } as never, [t], 0, run(t.id)).look.key).toBe("live");
  });
});
