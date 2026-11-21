// Paczka 66: proste zadanie (jedna czynność Piotra bez szkicu i bez pytań) nie pokazuje kanwy kroków ani łańcucha na kafelku.
import { describe, it, expect } from "vitest";
import { isSimpleTask } from "@/lib/stepcard";
import { step, task } from "./helpers";

describe("proste zadanie", () => {
  it("jeden krok Piotra poza aplikacją = proste", () => {
    expect(isSimpleTask(task({ steps: [step({ tool: "manual", title: "Zadzwoń do Kasi" })] }))).toBe(true);
  });
  it("krok Claude'a, pytanie, szkic albo kilka kroków = zadanie z krokami", () => {
    expect(isSimpleTask(task({ steps: [step({ tool: "claude" })] }))).toBe(false);
    expect(isSimpleTask(task({ steps: [step({ tool: "manual", blocks: [{ type: "question", id: "q", text: "Który?", options: [{ label: "A" }, { label: "B" }] }] as never })] }))).toBe(false);
    expect(isSimpleTask(task({ steps: [step({ tool: "manual" }), step({ tool: "manual" })] }))).toBe(false);
    expect(isSimpleTask(task({ steps: [] }))).toBe(false);
  });
});
