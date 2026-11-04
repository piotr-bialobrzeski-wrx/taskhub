// Paczka 49, punkt 3: porównanie „było / będzie” obok siebie (obecna treść i nowa wersja ze szkicu), tabela zmian bez pary
import { describe, expect, it } from "vitest";
import type { Block, Step } from "@/lib/schema";
import { beforeOf, groupBlocks } from "@/lib/stepcard";
import { changedWords, wordsOf } from "@/lib/textdiff";

const URL = "https://app.clickup.com/t/869f46dab";
const old: Block = { type: "free", title: "Obecny opis ticketu", source: { app: "clickup", ref: "869f46dab", url: URL }, markdown: "# Description\n\nOld text." };
const table: Block = { type: "table", title: "Co się zmienia", source: { app: "clickup", url: URL }, columns: ["Obecnie", "W nowej wersji"], rows: [["a", "b"]] };
const facts: Block = { type: "facts", facts: [{ label: "Skąd", value: "ticket", source: { app: "clickup", url: URL } }] };
const draft = (extra: Record<string, unknown> = {}): Block => ({ type: "draft", target: { app: "clickup", where: "Backlog", url: URL, action: "update" }, body: "# Description\n\nNew text.", status: "proposed", ...extra } as Block);
const step = (blocks: Block[]): Pick<Step, "tool" | "title" | "blocks"> => ({ tool: "clickup", title: "Zaktualizuj story", blocks });

describe("beforeOf: obecna wersja rzeczy, którą zmienia szkic", () => {
  it("kartka ze zrzutu: free z adresem ticketu + tabela + fakty + szkic update = free stoi w parze ze szkicem", () => {
    expect(beforeOf(step([old, table, facts, draft()]))).toBe(old);
  });
  it("adres porównuje się bez końcowego ukośnika i kotwicy", () => {
    const o2 = { ...old, source: { app: "clickup", url: URL + "/#x" } } as Block;
    expect(beforeOf(step([o2, draft()]))).toBe(o2);
  });
  it("bez pary: nowa rzecz (create), odpowiedź, inny adres, kilka opcji, arkusz, brak szkicu", () => {
    expect(beforeOf(step([old, draft({ target: { app: "clickup", url: URL, action: "create" } })]))).toBeNull();
    expect(beforeOf(step([old, draft({ target: { app: "clickup", url: URL, action: "comment" } })]))).toBeNull();
    expect(beforeOf(step([old, draft({ target: { app: "clickup", url: "https://app.clickup.com/t/inny1", action: "update" } })]))).toBeNull();
    expect(beforeOf(step([old, draft(), draft({ body: "Inna wersja" })]))).toBeNull();
    expect(beforeOf(step([old, draft({ columns: ["a"], rows: [["1"]] })]))).toBeNull();
    expect(beforeOf(step([old, table]))).toBeNull();
  });
  it("szkic bez target.url: miejscem jest jedyne źródło tej aplikacji na kartce", () => {
    expect(beforeOf(step([old, draft({ target: { app: "clickup", action: "update" } })]))).toBe(old);
  });
  it("tabela zmian nie staje w parze z obecnym opisem", () => {
    expect(groupBlocks([old, table, facts])).toEqual([old, table, facts]);
  });
});

describe("changedWords: które słowa znikają, a które dochodzą", () => {
  const w = (t: string) => wordsOf(t).map((x) => x.w);
  it("zmiana w środku zdania", () => {
    const d = changedWords(w("As a manager I want one modal"), w("As a manager I want one confirmation now"));
    expect(d.del).toEqual([false, false, false, false, false, false, true]);
    expect(d.ins).toEqual([false, false, false, false, false, false, true, true]);
  });
  it("interpunkcja i wielkość liter na brzegu słowa to nie zmiana", () => {
    const d = changedWords(w("Story covers the flow."), w("story covers the flow"));
    expect(d.del.some(Boolean)).toBe(false);
    expect(d.ins.some(Boolean)).toBe(false);
  });
  it("pusta strona: wszystko po drugiej to zmiana", () => {
    expect(changedWords([], w("a b")).ins).toEqual([true, true]);
    expect(changedWords(w("a b"), []).del).toEqual([true, true]);
  });
  it("wordsOf podaje położenie słów w tekście", () => {
    expect(wordsOf(" ab  c")).toEqual([{ w: "ab", from: 1, to: 3 }, { w: "c", from: 5, to: 6 }]);
  });
});
