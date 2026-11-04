// @vitest-environment jsdom
// Pole z formatowaniem: to, co napisał agent, po otwarciu w edytorze i zapisie wraca bez zmian (bez „&amp;”, bez zgubionych tabel i ucieczek).
import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import { editorOut, richExtensions } from "@/lib/richtext";
import { toEditorMd } from "@/lib/format";

const roundTrip = (md: string) => {
  const e = new Editor({ extensions: richExtensions(), content: toEditorMd(md), contentType: "markdown" });
  try { return editorOut(e); } finally { e.destroy(); }
};

describe("obieg treści przez edytor", () => {
  it.each([
    "Access & roles",
    "Oznacz <@U07DWN21HJQ> i <#C123|dev>",
    "Typ Array<Item> oraz <button>",
    "Kod `x &amp; y`",
    "```\n<b>&amp;</b>\n```",
    "- [ ] D1 & D2\n- [x] gotowe",
    "A\n\n---\n\nB",
    "snake_case i plik_a_b.md",
    "[link](https://x.pl/a?b=1&c=2)",
    "# Opis\n\nTekst z **pogrubieniem** i *kursywą*.\n\n1. jeden\n2. dwa\n\n- a\n  - b",
  ])("%j wraca bajt w bajt", (md) => {
    expect(roundTrip(md)).toBe(md);
  });
  it("tabela zachowuje komórki (edytor może zmienić wyrównanie kolumn)", () => {
    const out = roundTrip("| Kol A | Kol B |\n| --- | --- |\n| Access & roles | **x** |");
    const cells = out.split("\n").map((l) => l.split("|").map((c) => c.trim()).filter(Boolean));
    expect(cells[0]).toEqual(["Kol A", "Kol B"]);
    expect(cells[2]).toEqual(["Access & roles", "**x**"]);
    expect(out).not.toContain("&amp;");
    expect(out.startsWith("|")).toBe(true);
  });
});

describe("wzmianka osoby w polu z formatowaniem", () => {
  it.each([
    "Cześć <@slack:U09HEQ6BFE3|Piotr Białobrzeski>, zerknij.",
    "- <@clickup:81234567|Kinga Nowak> i <@slack:U1|Jan_Kowalski>\n- **Pilne:** <@whatsapp:+48600100200|Ania>",
    "Bez id: @Jan Kowalski oraz <@U07DWN21HJQ>",
    "Kod `<@slack:U1|Jan>` zostaje",
  ])("%j wraca bajt w bajt", (md) => {
    expect(roundTrip(md)).toBe(md);
  });
  it("w polu wzmianka jest jednym znacznikiem z nazwą osoby", () => {
    const e = new Editor({ extensions: richExtensions(), content: toEditorMd("Hej <@slack:U1|Jan Kowalski>!"), contentType: "markdown" });
    try {
      const nodes: string[] = [];
      e.state.doc.descendants((n) => { if (n.type.name === "mention") nodes.push(`${n.attrs.app}/${n.attrs.id}/${n.attrs.name}`); });
      expect(nodes).toEqual(["slack/U1/Jan Kowalski"]);
      expect(e.getText()).toBe("Hej @Jan Kowalski!");
    } finally { e.destroy(); }
  });
});
