import { describe, it, expect } from "vitest";
import { calEst, calibrationFor, estOf, fmtMin, remainCal, roundQ, spentMin } from "@/lib/time";
import { step, task } from "./helpers";

describe("czas i kalibracja", () => {
  it("zaokrągla do kwantów 5 minut, minimum 5", () => {
    expect(roundQ(1)).toBe(5); expect(roundQ(7)).toBe(5); expect(roundQ(8)).toBe(10); expect(roundQ(22)).toBe(20); expect(roundQ(103)).toBe(105);
    expect(estOf(step({ estMin: 0 }))).toBe(5);
    expect(spentMin(step({ spentSec: 0 }))).toBe(0); expect(spentMin(step({ spentSec: 70 }))).toBe(5);
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
    expect(calEst(step({ estMin: 30, tool: "code" }), code)).toBe(60);
  });
  it("pozostały czas liczy tylko niegotowe kroki, z kalibracją", () => {
    const t = task({ steps: [step({ estMin: 30, tool: "code" }), step({ estMin: 30, tool: "code", status: "done" })] });
    const code = Array.from({ length: 3 }, () => ({ tool: "code", projectId: null, estMin: 30, spentMin: 45 }));
    expect(remainCal(t, [])).toBe(30);
    expect(remainCal(t, code)).toBe(45);
  });
});
