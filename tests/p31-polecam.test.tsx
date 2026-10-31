// Paczka 31: zalecana opcja pytania ma „Polecam” i jedno zdanie uzasadnienia tuż przy swoim przycisku; pozostałe opcje dalej są przyciskami.
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { OptionButtons } from "@/components/BlockRenderer";
import { QuestionBlock } from "@/lib/schema";

const opts = [{ label: "A. Jedna pigułka" }, { label: "B. Tam, gdzie patrzysz" }, { label: "C. Kafelek niesie stan" }];

describe("rekomendacja przy przycisku opcji", () => {
  it("zalecana opcja: wyróżniony przycisk, „Polecam” i uzasadnienie w tym samym wierszu", () => {
    const html = renderToStaticMarkup(<OptionButtons options={opts} recommended={0} why="Bieżąca praca jest w jednym miejscu." />);
    const row = html.slice(html.indexOf('class="opt-rec"'), html.indexOf('class="opt"'));
    expect(row).toContain('class="btn primary"');
    expect(row).toContain("A. Jedna pigułka");
    expect(row).toContain("Polecam");
    expect(row).toContain("Bieżąca praca jest w jednym miejscu.");
    expect(html.match(/name="option"/g)).toHaveLength(3);
    expect(html.match(/Polecam/g)).toHaveLength(1);
  });
  it("bez zalecenia: jeden rząd przycisków, bez „Polecam”; indeks spoza opcji nic nie psuje", () => {
    for (const r of [null, 7]) {
      const html = renderToStaticMarkup(<OptionButtons options={opts} recommended={r} />);
      expect(html).not.toContain("Polecam");
      expect(html).not.toContain("has-rec");
    }
  });
  it("klocek pytania przyjmuje why", () => {
    expect(QuestionBlock.parse({ type: "question", text: "Który?", options: opts, recommended: 0, why: "Bo tak." }).why).toBe("Bo tak.");
  });
});
