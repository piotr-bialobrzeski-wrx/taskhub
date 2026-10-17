import { describe, it, expect } from "vitest";
import { Blocks, Fact } from "@/lib/schema";
import { composeStatic } from "@/lib/agent/compose";
import { step } from "./helpers";

describe("uniwersalne bloki", () => {
  it("przyjmuje każdy rodzaj bloku z pochodzeniem i odrzuca nieznany", () => {
    const ok = Blocks.safeParse([
      { type: "text", body: "x" },
      { type: "facts", facts: [{ label: "Termin", value: "piątek", source: { app: "clickup", url: "https://app.clickup.com/t/1" } }] },
      { type: "thread", messages: [{ author: "Ania", text: "hej", mine: false }], source: { app: "slack" } },
      { type: "draft", target: { app: "slack", where: "#ogolny", action: "send" }, body: "Treść", status: "proposed" },
      { type: "list", items: [{ title: "a", done: false }] },
      { type: "media", items: [{ kind: "image", url: "https://x/y.png", caption: "zrzut" }, { kind: "file", url: "https://x/f.pdf", name: "oferta.pdf" }] },
      { type: "link", links: [{ url: "https://x" }] },
      { type: "question", text: "Które?", options: [{ label: "A" }, { label: "B" }], recommended: 0 },
    ]);
    expect(ok.success).toBe(true);
    expect(Blocks.safeParse([{ type: "clickup_card" }]).success).toBe(false);
    expect(Fact.safeParse({ label: "x" }).success).toBe(false);
  });
  it("składanie bez modelu: szczegóły, fakty, szkic, załączniki; link zostaje przyciskiem akcji", () => {
    const s = step({ detail: "Napisz do Ani", output: "Cześć Aniu…", needsApproval: true, tool: "slack", link: "https://slack.com/x" });
    const blocks = composeStatic(s, [{ label: "Adresat", value: "Ania", pinned: false, hidden: false }, { label: "Szum", value: "1", pinned: false, hidden: true }], [
      { id: "a1", kind: "image", name: "z.png", url: "https://x/z.png", caption: null, analysis: null, keep: false, expiresAt: null, mime: "image/png" },
    ]);
    expect(blocks.map((b) => b.type)).toEqual(["text", "facts", "draft", "media"]);
    const facts = blocks[1] as { facts: unknown[] }; expect(facts.facts).toHaveLength(1);
    const draft = blocks[2] as { target: { app: string } }; expect(draft.target.app).toBe("slack");
  });
});

import { Markdown } from "@/lib/markdown";
import { cardModeOf } from "@/components/PublishCard";
import { stepContextText } from "@/lib/agent/chat";
import { renderToStaticMarkup } from "react-dom/server";

describe("biała kartka: nowe klocki, markdown, tryb karty, kontekst kroku w czacie", () => {
  it("przyjmuje mail, komentarz, tabelę i wolną treść; szkic może nieść wiersze arkusza", () => {
    const ok = Blocks.safeParse([
      { type: "mail", source: { app: "gmail", ref: "Wersja 2.3 a zakres umowy" }, messages: [{ from: "Jan", to: "piotr@x.pl", subject: "Zakres", text: "Czy drag & drop wchodzi?" }] },
      { type: "comment", source: { app: "figma", ref: "frame 12:40", url: "https://www.figma.com/file/x" }, author: "Ola", text: "Zrobimy prototyp?" },
      { type: "table", source: { app: "sheet", ref: "Rozliczenia 2026" }, columns: ["Osoba", "Godziny"], rows: [["Marek", "86"]], highlightFrom: 0 },
      { type: "free", markdown: "# Zrzut\n\nKlient przysłał **zrzut**.\n\n![grafik](https://x/z.png)" },
      { type: "draft", target: { app: "sheet", where: "Rozliczenia 2026", action: "update" }, body: "3 wiersze", columns: ["Osoba", "Godziny"], rows: [["Marek", "86"], ["Kasia", "41"]] },
    ]);
    expect(ok.success).toBe(true);
    expect(Blocks.safeParse([{ type: "mail", messages: [] }]).success).toBe(false);
    expect(Blocks.safeParse([{ type: "table", columns: [], rows: [] }]).success).toBe(false);
  });
  it("markdown wolnej treści: nagłówki, listy, pogrubienie, linki i obrazki tylko http(s), bez surowego HTML", () => {
    const html = renderToStaticMarkup(<Markdown text={"# Tytuł\n\n- jeden **dwa**\n- [link](https://a.pl) i [zły](javascript:alert(1))\n\n![z](https://x/z.png) <script>alert(1)</script>\n\n```\nkod\n```"} />);
    expect(html).toContain("<h4>Tytuł</h4>");
    expect(html).toContain("<li>jeden <b>dwa</b></li>");
    expect(html).toContain('href="https://a.pl"');
    expect(html).not.toContain("javascript:");
    expect(html).toContain('<img src="https://x/z.png" alt="z"/>');
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain('<pre class="code">kod</pre>');
  });
  it("tryb karty publikacji wynika ze stanu kroku i bloku draft", () => {
    const d = { type: "draft" as const, target: { app: "slack", action: "send" as const }, body: "x", status: "proposed" as const };
    expect(cardModeOf(step({ status: "draft" }))).toBe("proposed");
    expect(cardModeOf(step({ status: "todo", blocks: [d] }))).toBe("parked");
    expect(cardModeOf(step({ status: "handoff", prevStatus: "draft", blocks: [{ ...d, status: "approved" }] }))).toBe("sending");
    expect(cardModeOf(step({ status: "done", blocks: [{ ...d, status: "sent" }] }))).toBe("sent");
    expect(cardModeOf(step({ status: "todo" }))).toBeNull();
    expect(cardModeOf(step({ status: "handoff", prevStatus: "todo" }))).toBeNull();
  });
  it("czat w otwartym kroku dostaje jego klocki i szkic jako domyślny kontekst", () => {
    const s = step({ title: "Odpowiedz Ani", detail: "krótko", status: "draft", blocks: [
      { type: "thread", source: { app: "slack", ref: "#dev" }, messages: [{ author: "Ania", text: "Co z 2.3?" }] },
      { type: "draft", target: { app: "slack", where: "#dev", action: "send" }, body: "2.3 wchodzi dziś o 15:00", status: "proposed" },
    ] });
    const txt = stepContextText(s);
    expect(txt).toContain(`OTWARTY KROK: [${s.id}] "Odpowiedz Ani"`);
    expect(txt).toContain("wątek (slack #dev): Ania: Co z 2.3?");
    expect(txt).toContain("SZKIC (proposed) do slack #dev: 2.3 wchodzi dziś o 15:00");
    expect(txt).toContain("dotyczy TEGO KROKU");
  });
});
