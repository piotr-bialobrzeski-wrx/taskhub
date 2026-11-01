// Paczka 32: czas kroku z „Ile to zajęło?” i pola „Twój czas”: przyciski co 15 minut i wpis „godziny:minuty”
import { describe, expect, it } from "vitest";
import { SPENT_CHIPS, fmtHM, parseSpent } from "@/lib/time";

describe("czas kroku podany przez Piotra", () => {
  it("przyciski co 15 minut do 2 h", () => {
    expect(SPENT_CHIPS.map((c) => c.min)).toEqual([15, 30, 45, 60, 90, 120]);
    expect(SPENT_CHIPS.map((c) => c.label)).toEqual(["15 min", "30 min", "45 min", "1 h", "1,5 h", "2 h"]);
  });
  it("godziny:minuty zapisuje jako minuty", () => {
    expect(parseSpent("2:15")).toBe(135);
    expect(parseSpent(" 0:40 ")).toBe(40);
    expect(parseSpent("10:05")).toBe(605);
  });
  it("inne zapisy: same minuty, ułamek godzin, h i min", () => {
    expect(parseSpent("45")).toBe(45);
    expect(parseSpent("45 min")).toBe(45);
    expect(parseSpent("1,5")).toBe(90);
    expect(parseSpent("1.25 h")).toBe(75);
    expect(parseSpent("1 h 30")).toBe(90);
    expect(parseSpent("2h")).toBe(120);
    expect(parseSpent("1h30m")).toBe(90);
  });
  it("nieczytelny wpis nic nie zapisuje", () => {
    for (const x of ["", "  ", "abc", "2:75", "1:2:3", "-5", "1 h 90"]) expect(parseSpent(x)).toBeNull();
  });
  it("minuty do pola wpisu", () => {
    expect(fmtHM(135)).toBe("2:15");
    expect(fmtHM(40)).toBe("0:40");
    expect(parseSpent(fmtHM(605))).toBe(605);
  });
});
