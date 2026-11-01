// Przegląd zaległości (wariant A „Kawałki i duże przyciski”): kto trafia do przeglądu, kolejność, terminy z odpowiedzi, „Na później”.
import { describe, it, expect } from "vitest";
import { addDays, answerTip, dueFor, inReview, reviewPatch, reviewQueue, sundayOf, type ReviewTask } from "@/lib/canvas/review";

const t = (id: string, due: string | null, eff = 3, state = "ready", base = eff): ReviewTask => ({ id, state, base, eff, due: due ? { iso: due } : null });
const TODAY = "2026-11-04";   // środa

describe("kto trafia do przeglądu", () => {
  it("bez terminu i po terminie tak; termin od dziś w górę i zrobione nie", () => {
    expect(inReview(t("a", null), TODAY)).toBe(true);
    expect(inReview(t("b", "2026-11-03"), TODAY)).toBe(true);
    expect(inReview(t("c", TODAY), TODAY)).toBe(false);
    expect(inReview(t("d", "2026-11-20"), TODAY)).toBe(false);
    expect(inReview(t("e", null, 3, "done"), TODAY)).toBe(false);
  });
  it("kolejność: po terminie od najstarszego, potem bez terminu od najwyższego priorytetu", () => {
    const q = reviewQueue([t("low", null, 2), t("late2", "2026-11-02"), t("hi", null, 5), t("late1", "2026-10-28"), t("ok", "2026-11-10")], TODAY);
    expect(q.map((x) => x.id)).toEqual(["late1", "late2", "hi", "low"]);
  });
});

describe("termin z odpowiedzi", () => {
  it("dzisiaj, jutro, niedziela tego i następnego tygodnia", () => {
    expect(dueFor("today", TODAY)).toBe(TODAY);
    expect(dueFor("tom", TODAY)).toBe("2026-11-05");
    expect(dueFor("week", TODAY)).toBe("2026-11-08");
    expect(dueFor("next", TODAY)).toBe("2026-11-15");
  });
  it("w niedzielę „W tym tygodniu” to dziś", () => {
    expect(sundayOf("2026-11-08")).toBe("2026-11-08");
    expect(dueFor("next", "2026-11-08")).toBe("2026-11-15");
  });
  it("przez koniec miesiąca i zmianę czasu", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-10-24", 7)).toBe("2026-10-31");
  });
  it("konkretna data z pola; bez dnia brak terminu", () => {
    expect(dueFor("date", TODAY, "2026-12-01")).toBe("2026-12-01");
    expect(dueFor("date", TODAY, "")).toBeNull();
  });
});

describe("zmiana zadania", () => {
  it("Na później: bez terminu i priorytet niższy o jeden, najniżej 1", () => {
    expect(reviewPatch("later", 3, TODAY)).toEqual({ due: null, level: 2 });
    expect(reviewPatch("later", 1, TODAY)).toEqual({ due: null, level: 1 });
  });
  it("inna odpowiedź po „Na później” oddaje dawny priorytet", () => {
    expect(reviewPatch("tom", 3, TODAY)).toEqual({ due: "2026-11-05", level: 3 });
  });
  it("podpowiedź przycisku mówi, jaki dzień ustawi", () => {
    expect(answerTip("week", TODAY)).toBe("Termin: ndz 8.11");
    expect(answerTip("later", TODAY)).toBe("Bez terminu, priorytet niższy o jeden");
  });
});
