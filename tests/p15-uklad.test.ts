// Paczka 15: krótkie dymki, główna treść przed „Skąd”, szkic bez podtytułu doklejonego do listy
import { describe, expect, it } from "vitest";
import { leaveChat, splitMain, whyOf } from "@/lib/stepcard";
import { toEditorMd, unlazy } from "@/lib/format";
import type { Block } from "@/lib/schema";

describe("dymek po oddaniu kroku (punkt 1)", () => {
  it("czekanie na inny krok: stan, bez prośby do Piotra", () => {
    expect(leaveChat("Dodaj grupy projektów", "czeka na krok „Wdróż”", false)).toBe("Krok „Dodaj grupy projektów” czeka na inny krok. Nic nie musisz robić.");
    expect(leaveChat("X", "brak danych", true)).toBe("Krok „X” czeka na inny krok. Nic nie musisz robić.");
  });
  it("projekt w chmurze: Piotr uruchamia", () => {
    expect(leaveChat("X", "do zrobienia w projekcie w chmurze: zmiany w repo", false)).toBe("Krok „X” czeka, aż uruchomisz go w chmurze.");
  });
  it("brak narzędzia albo danych: prośba o działanie; powód zostaje w actions.why", () => {
    expect(leaveChat("X", "Brak konektora Figma na Macu", false)).toBe("Nie zrobiłem kroku „X”. Potrzebuję, abyś coś zrobił.");
    expect(whyOf({ actions: { why: " Brak konektora " } })).toBe("Brak konektora");
    expect(whyOf({ actions: { stepId: "a" } })).toBeNull();
  });
});

describe("główna treść i „Skąd” (punkty 8–9)", () => {
  const facts: Block = { type: "facts", title: "Zanim zaczniesz", facts: [{ label: "Kod", value: "paczka 12", source: { app: "github", ref: "notatki/paczka-zmian-12.md" } }] };
  const table: Block = { type: "table", title: "Trzy próby", columns: ["Próba", "Poziom"], rows: [["Rozpisanie", "Strategia"]] };
  const thread: Block = { type: "thread", messages: [{ author: "Ala", text: "hej" }] };
  it("treść bez pochodzenia idzie na wierzch, materiał ze źródłem do „Skąd”", () => {
    expect(splitMain([facts, table, thread])).toEqual({ main: [table], sources: [facts, thread] });
  });
  it("bez głównej treści materiał zostaje jedyną treścią", () => {
    expect(splitMain([facts, thread])).toEqual({ main: [], sources: [facts, thread] });
  });
});

describe("podtytuł pod listą w szkicu (punkt 15)", () => {
  const md = "**A: Columns**\n\n1. one\n2. two\n3. three\n**B: Table behavior**\n4. four";
  it("pusta linia przed linią od brzegu tuż pod punktem listy", () => {
    expect(unlazy(md)).toBe("**A: Columns**\n\n1. one\n2. two\n3. three\n\n**B: Table behavior**\n4. four");
    expect(toEditorMd(md)).toContain("3. three\n\n**B: Table behavior**");
  });
  it("wcięta kontynuacja punktu, kolejne punkty i kod zostają", () => {
    expect(unlazy("- a\n  ciąg dalszy\n- b")).toBe("- a\n  ciąg dalszy\n- b");
    expect(unlazy("- a\n```\nkod\n```")).toBe("- a\n```\nkod\n```");
    expect(unlazy("- a\n\nakapit")).toBe("- a\n\nakapit");
  });
});
