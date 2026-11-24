// Paczka 68 (zadanie „Jasne instrukcje w krokach Piotra”, wariant A „Instrukcja na wierzchu”): klocek howto, jego adresy i miejsce na kartce
import { describe, it, expect } from "vitest";
import { Block, HowtoBlock } from "@/lib/schema";
import { depCardsFor, howtoFor } from "@/lib/stepcard";
import { renderToStaticMarkup } from "react-dom/server";
import { Howto } from "@/components/BlockRenderer";

const howto = (from?: string) => HowtoBlock.parse({
  type: "howto", goal: "Codex ma być zalogowany kontem ChatGPT.", from,
  items: [
    { text: "Zainstaluj Codex CLI", where: "Terminal", cmd: "brew install codex", open: { label: "Otwórz Terminal", href: "taskhub://terminal" } },
    { text: "Sprawdź logowanie", cmd: "codex login status", expect: "Logged in using ChatGPT", open: { label: "Otwórz Ustawienia aplikacji", href: "taskhub://settings" } },
  ],
});

describe("klocek howto", () => {
  it("przyjmuje http(s), ścieżkę Task Hub i dwa linki do aplikacji na Macu", () => {
    for (const href of ["https://chatgpt.com", "/settings", "taskhub://settings", "taskhub://terminal"])
      expect(Block.safeParse({ type: "howto", items: [{ text: "x", open: { label: "Otwórz", href } }] }).success).toBe(true);
  });
  it("odrzuca inne schematy i linki do aplikacji z parametrami", () => {
    for (const href of ["javascript:alert(1)", "taskhub://add-folder?kind=code&path=/", "taskhub://connect?token=x", "//evil.example", "file:///etc/passwd"])
      expect(Block.safeParse({ type: "howto", items: [{ text: "x", open: { label: "Otwórz", href } }] }).success).toBe(false);
  });
  it("wymaga co najmniej jednej czynności", () => {
    expect(Block.safeParse({ type: "howto", items: [] }).success).toBe(false);
  });
  it("pokazuje cel, numerowane czynności, komendę z „Kopiuj” i przycisk do miejsca", () => {
    const html = renderToStaticMarkup(<Howto b={howto()} />);
    expect(html).toContain("Codex ma być zalogowany kontem ChatGPT.");
    expect(html).toContain("Co zrobić");
    expect(html).toContain("brew install codex");
    expect(html).toContain("Kopiuj");
    expect(html).toContain('href="taskhub://terminal"');
    expect(html).toContain("Powinno pokazać: <b>Logged in using ChatGPT</b>");
    expect(html).not.toContain('target="_blank"');   // link do aplikacji na Macu w tym samym oknie
  });
});

describe("instrukcja na wierzchu kroku Piotra", () => {
  const agent = { id: "a", title: "Zleć w projekcie: Codex jako drugi wykonawca", status: "done" as const, tool: "cloud", doneBy: "agent" as const, blocks: [howto(), { type: "free", markdown: "notatka" } as Block] };
  const own = { id: "b", title: "Zaloguj Codex kontem ChatGPT na Macu", status: "todo" as const, tool: "manual", doneBy: null, blocks: [howto("a")], dependsOn: ["a"] };
  const steps = [agent, own];
  it("z własnej kartki (from = krok agenta) i z zrobionego kroku agenta, od którego zależy", () => {
    const r = howtoFor(steps, own);
    expect(r.map((h) => h.from?.idx)).toEqual([1, 1]);
    expect(r[0].block).toBe(own.blocks[0]);
  });
  it("nic dla zrobionego kroku Piotra ani kroku agenta", () => {
    expect(howtoFor(steps, { ...own, status: "done" })).toEqual([]);
    expect(howtoFor(steps, { ...agent, dependsOn: [] })).toEqual([]);
  });
  it("materiał z kroku agenta nie powtarza instrukcji", () => {
    expect(depCardsFor(steps, own)[0].blocks.map((b) => b.type)).toEqual(["free"]);
  });
});
