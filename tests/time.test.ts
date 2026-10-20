import { describe, it, expect } from "vitest";
import { agentMinOf, calEst, calibrationFor, calibrationText, elapsedSec, estOf, fmtMin, remainCal, remainEst, roundQ, spentMin, taskAgent, taskEst } from "@/lib/time";
import { step, task } from "./helpers";

describe("czas i kalibracja", () => {
  it("zaokrągla do kwantów 5 minut, minimum 5", () => {
    expect(roundQ(1)).toBe(5); expect(roundQ(7)).toBe(5); expect(roundQ(8)).toBe(10); expect(roundQ(22)).toBe(20); expect(roundQ(103)).toBe(105);
    expect(estOf(step({ estMin: 0 }))).toBe(5);
    expect(spentMin(step({ spentSec: 0 }))).toBe(0); expect(spentMin(step({ spentSec: 70 }))).toBe(5);
    // czas mierzony co do sekundy przez wszystkie przerwy, pokazywany co 5 min, minimum 5 gdy cokolwiek zmierzono
    expect(spentMin(step({ spentSec: 20 }))).toBe(5); expect(spentMin(step({ spentSec: 250 + 240 }))).toBe(10); expect(spentMin(step({ spentSec: 12 * 60 + 20 }))).toBe(10);
  });
  it("formatuje minuty czytelnie", () => {
    expect(fmtMin(45)).toBe("45 min"); expect(fmtMin(60)).toBe("1 h"); expect(fmtMin(90)).toBe("1 h 30 min");
  });
  it("kalibracja per narzędzie od 3 próbek, ogólna od 5, inaczej brak", () => {
    const code = Array.from({ length: 3 }, () => ({ tool: "code", projectId: null, estMin: 30, spentMin: 60 }));
    expect(calibrationFor(code, "code")).toEqual({ k: 2, n: 3, scope: "tool" });
    expect(calibrationFor(code, "slack")).toBeNull();
    const five = [...code, { tool: "slack", projectId: null, estMin: 30, spentMin: 30 }, { tool: "gmail", projectId: null, estMin: 30, spentMin: 30 }];
    expect(calibrationFor(five, "clickup")?.scope).toBe("all");
    // próbka bez „who” (sprzed paczki 7) liczy się jak czas Piotra
    // próbki Claude'a kalibrują tylko kroki Claude'a (tool code = krok Claude'a)
    const agentCode = code.map((x) => ({ ...x, who: "agent" as const }));
    expect(calEst(step({ estMin: 30, tool: "code" }), agentCode)).toBe(60);
    expect(calEst(step({ estMin: 30, tool: "code" }), code)).toBe(30);
  });
  it("pozostały czas liczy tylko niegotowe kroki Piotra, z kalibracją z jego czasów", () => {
    const t = task({ steps: [step({ estMin: 30, tool: "manual" }), step({ estMin: 30, tool: "manual", status: "done" }), step({ estMin: 240, tool: "code" })] });
    const own = Array.from({ length: 3 }, () => ({ tool: "manual", projectId: null, estMin: 30, spentMin: 45, who: "owner" as const }));
    expect(remainEst(t)).toBe(30); expect(taskEst(t)).toBe(60);
    expect(remainCal(t, [])).toBe(30);
    expect(remainCal(t, own)).toBe(45);
  });
  it("czas Claude'a: sekundy od chwili z sufitem 45 min, minuty dokładne (poniżej minuty 1), suma w zadaniu", () => {
    const now = Date.parse("2026-10-20T10:00:00Z");
    expect(elapsedSec(null)).toBe(0);
    expect(elapsedSec("2026-10-20T09:56:00Z", undefined, now)).toBe(240);
    expect(elapsedSec("2026-10-20T08:00:00Z", undefined, now)).toBe(45 * 60);
    expect(elapsedSec("2026-10-20T10:01:00Z", undefined, now)).toBe(0);
    expect(agentMinOf({ agentSec: 0 })).toBe(0); expect(agentMinOf({ agentSec: 20 })).toBe(1); expect(agentMinOf({ agentSec: 250 })).toBe(4); expect(agentMinOf({})).toBe(0);
    expect(taskAgent(task({ steps: [step({ agentSec: 240 }), step({ agentSec: 60 }), step({ tool: "manual", spentSec: 900 })] }))).toBe(5);
  });
  it("kalibracja osobno dla czasów Piotra i Claude'a; tekst dla agenta tylko z czasów Piotra", () => {
    const own = Array.from({ length: 3 }, () => ({ tool: "manual", projectId: null, estMin: 20, spentMin: 30, who: "owner" as const }));
    const agent = Array.from({ length: 4 }, () => ({ tool: "code", projectId: null, estMin: 20, spentMin: 80, who: "agent" as const }));
    expect(calibrationFor([...own, ...agent], "manual")).toEqual({ k: 1.5, n: 3, scope: "tool" });
    expect(calibrationFor([...own, ...agent], "manual", "agent")).toBeNull();
    expect(calibrationFor([...own, ...agent], "code", "agent")).toEqual({ k: 4, n: 4, scope: "tool" });
    expect(calibrationText([...own, ...agent])).toBe("KALIBRACJA SZACUNKÓW PIOTRA z historii czasów (rzeczywisty / szacowany): ×1.5 (3 kroków). Szacując kroki Piotra (manual), uwzględnij ją.");
    expect(calibrationText(agent)).toBe("");
  });
});
