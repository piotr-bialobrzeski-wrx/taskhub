// Paczka 31, krótsza kartka decyzji (wariant A): opis każdej opcji jednym zdaniem przy jej przycisku, przy zalecanej uzasadnienie.
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { OptionButtons } from "@/components/BlockRenderer";

const opts = [
  { label: "A. Jedna pigułka", note: "Bieżąca praca tylko w pigułce na dole." },
  { label: "B. Tam, gdzie patrzysz", note: "W otwartym zadaniu tylko dymek." },
  { label: "C. Kafelek niesie stan" },
];

describe("opis opcji przy przycisku", () => {
  it("każda opcja z opisem ma jego zdanie obok przycisku; zalecana ma uzasadnienie zamiast opisu", () => {
    const html = renderToStaticMarkup(<OptionButtons options={opts} recommended={0} why="Praca w jednym miejscu." />);
    expect(html).toContain('<span class="rec-why">Praca w jednym miejscu.</span>');
    expect(html).toContain('<span class="opt-note">W otwartym zadaniu tylko dymek.</span>');
    expect(html).not.toContain(">Bieżąca praca tylko w pigułce na dole.<");
    expect(html.match(/opt-note/g)).toHaveLength(1);
  });
  it("zalecana bez uzasadnienia pokazuje swój opis", () => {
    const html = renderToStaticMarkup(<OptionButtons options={opts} recommended={0} />);
    expect(html).toContain('<span class="rec-why">Bieżąca praca tylko w pigułce na dole.</span>');
  });
  it("bez zalecenia, ale z opisami: opcje jedna pod drugą z opisami, bez „Polecam”", () => {
    const html = renderToStaticMarkup(<OptionButtons options={opts} />);
    expect(html).toContain("has-rec");
    expect(html).not.toContain("Polecam");
    expect(html.match(/opt-note/g)).toHaveLength(2);
  });
});
