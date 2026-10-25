// Paczka 17, punkt 1: otwarty krok Piotra pokazuje kartki zrobionych kroków Claude'a, od których zależy (materiał, na którym pracuje)
import { describe, it, expect } from "vitest";
import { depCardsFor } from "@/lib/stepcard";
import type { Block } from "@/lib/schema";

const free = (markdown: string): Block => ({ type: "free", markdown } as Block);
const prep = { id: "a", title: "Przygotuj test", status: "done" as const, tool: "claude", doneBy: "agent" as const,
  blocks: [free("1. Pytanie"), { type: "question", text: "Ok?", options: [{ label: "Tak" }] } as Block, { type: "draft", body: "x", status: "proposed" } as Block] };
const other = { id: "b", title: "Zbierz dane", status: "done" as const, tool: "claude", doneBy: "agent" as const, blocks: [free("dane")] };
const mine = { id: "c", title: "Wybierz", status: "done" as const, tool: "manual", doneBy: "owner" as const, blocks: [free("opcje")] };
const solve = { id: "d", title: "Rozwiąż test", status: "todo" as const, tool: "manual", doneBy: null, blocks: [], dependsOn: ["a", "c"] };
const steps = [prep, other, mine, solve];

describe("kartki zrobionych zależności w kroku Piotra", () => {
  it("pokazuje treść zrobionego kroku Claude'a, od którego zależy, bez pytań i szkiców", () => {
    const r = depCardsFor(steps, solve);
    expect(r.map((d) => [d.id, d.idx, d.title])).toEqual([["a", 1, "Przygotuj test"]]);
    expect(r[0].blocks.map((b) => b.type)).toEqual(["free"]);
  });
  it("nic dla zrobionego kroku, kroku Claude'a ani niezrobionej zależności", () => {
    expect(depCardsFor(steps, { ...solve, status: "done" })).toEqual([]);
    expect(depCardsFor(steps, { ...solve, tool: "claude" })).toEqual([]);
    expect(depCardsFor([{ ...prep, status: "todo" }, solve], solve)).toEqual([]);
    expect(depCardsFor([{ ...prep, blocks: [{ type: "text", body: "Test jest w kroku 02." } as Block] }, solve], solve)).toEqual([]);
  });
});
