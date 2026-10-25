// Paczka 19, punkt 1: kartka decyzji po prototypie ma przycisk „Otwórz prototyp” z adresem najnowszego podglądu
import { describe, it, expect } from "vitest";
import { prototypeLink } from "@/lib/stepcard";
import type { Block } from "@/lib/schema";

const q = (answer?: string): Block => ({ type: "question", text: "Który wariant?", options: [{ label: "A" }, { label: "B" }], ...(answer ? { answer } : {}) } as Block);
const step = (id: string, title: string, o: Partial<{ status: "todo" | "done"; dependsOn: string[]; link: string | null; doneAt: string | null; blocks: Block[]; tool: string }> = {}) =>
  ({ id, title, status: "done" as "todo" | "done", tool: "manual", dependsOn: [] as string[], link: null as string | null, doneAt: null as string | null, blocks: [] as Block[], ...o });

const proto1 = step("p1", "Zleć w projekcie: prototyp ramek", { link: "https://a.vercel.app/prototyp/kafelki", doneAt: "2026-10-25T17:00:00Z" });
const fix = step("p2", "Zleć w projekcie: poprawki prototypu kafelków", { dependsOn: ["p1"], link: "https://b.vercel.app/prototyp/kafelki", doneAt: "2026-10-25T18:00:00Z" });
const first = step("d1", "Zdecyduj o ramkach", { dependsOn: ["p1", "p2"], blocks: [q("Najpierw prototyp")] });
const proto3 = step("p3", "Zleć w projekcie: prototyp kafelków z 5 stanami", { dependsOn: ["d1"], link: "https://c.vercel.app/prototyp/kafelki", doneAt: "2026-10-25T18:40:00Z" });
const pick = step("d2", "Wybierz wariant ramek", { status: "todo", dependsOn: ["d1", "p3"], blocks: [q()] });
const steps = [proto1, fix, first, proto3, pick];

describe("Otwórz prototyp przy decyzji", () => {
  it("bierze najnowszy podgląd, także sprzed wcześniejszej decyzji", () => {
    expect(prototypeLink(steps, pick)).toBe("https://c.vercel.app/prototyp/kafelki");
    expect(prototypeLink([proto1, fix, first, { ...proto3, status: "todo" as const }, pick], pick)).toBe("https://b.vercel.app/prototyp/kafelki");
  });
  it("podgląd z bloku zmian wygrywa z linkiem, commit na GitHubie to nie podgląd", () => {
    const viaChanges = { ...proto3, link: "https://github.com/x/y/commit/abc", blocks: [{ type: "changes", summary: "s", files: [], preview: "https://d.vercel.app/prototyp" } as unknown as Block] };
    expect(prototypeLink([viaChanges, pick], { ...pick, dependsOn: ["p3"] })).toBe("https://d.vercel.app/prototyp");
    expect(prototypeLink([{ ...proto3, link: "https://github.com/x/y/commit/abc" }, pick], { ...pick, dependsOn: ["p3"] })).toBeNull();
  });
  it("bez przycisku: decyzja zrobiona, bez otwartego pytania, krok Claude'a albo bez prototypu w zależnościach", () => {
    expect(prototypeLink(steps, { ...pick, status: "done" })).toBeNull();
    expect(prototypeLink(steps, { ...pick, blocks: [q("B")] })).toBeNull();
    expect(prototypeLink(steps, { ...pick, tool: "claude" })).toBeNull();
    expect(prototypeLink(steps, { ...pick, dependsOn: [] })).toBeNull();
    const code = step("c1", "Zleć w projekcie: ramki", { dependsOn: ["p1"], link: "https://e.vercel.app" });
    expect(prototypeLink([proto1, code, pick], { ...pick, dependsOn: ["c1"] })).toBeNull();
  });
});
