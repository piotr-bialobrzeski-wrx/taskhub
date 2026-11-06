// Paczka 58 (zadanie „Materiał decyzji na wierzchu kartki”, wariant C „Podział po rodzaju klocka”): na otwartej kartce decyzji tabele, listy,
// treści i notatki stoją pod pytaniem także ze źródłem; pod „Skąd to wiemy” zostają tylko fakty, wątki, maile, komentarze, pliki i linki.
import { describe, it, expect } from "vitest";
import { splitDecision } from "@/lib/stepcard";
import { DECISION_RULE } from "@/lib/agent/work";
import type { Block } from "@/lib/schema";

const cu = { app: "clickup", url: "https://app.clickup.com/t/abc" };
const blocks: Block[] = [
  { type: "table", title: "Proponowane zadania", columns: ["Nr", "Zadanie"], rows: [["1", "Mapa ticketów"]] },
  { type: "list", title: "Poza mapami", items: [{ title: "Tickety ogólne", source: cu }] },
  { type: "free", title: "Zadanie 1: onboarding", source: cu, markdown: "| a |\n|---|\n| b |" },
  { type: "text", text: "Różnica: zakres zadania 4." },
  { type: "facts", facts: [{ label: "Ticketów", value: "341", source: cu }] },
  { type: "thread", source: { app: "slack", url: "https://slack.com/x" }, messages: [] },
  { type: "link", links: [{ label: "Dokument", url: "https://docs.google.com/x" }] },
] as unknown as Block[];

describe("materiał wyboru na kartce decyzji", () => {
  it("tabele, listy, treści i notatki stoją pod pytaniem, także ze źródłem", () => {
    const { choice } = splitDecision(blocks);
    expect(choice.map((b) => b.type)).toEqual(["table", "list", "free", "text"]);
  });
  it("pod „Skąd to wiemy” zostają fakty, wątki i linki, w kolejności z kartki", () => {
    const { background } = splitDecision(blocks);
    expect(background.map((b) => b.type)).toEqual(["facts", "thread", "link"]);
  });
  it("kartka bez tła nie ma nic do zwinięcia", () => {
    expect(splitDecision(blocks.slice(0, 2)).background).toEqual([]);
  });
  it("polecenie dla agenta mówi, co stoi pod pytaniem", () => {
    expect(DECISION_RULE).toContain("rozwinięte zaraz pod pytaniem");
    expect(DECISION_RULE).toContain("nie dawaj jako facts");
  });
});
