// Paczka 10, kartka porównania. Punkt 2: karta źródła tylko do odczytu. Klocek free z adresem http(s) renderuje się jak karta szkicu
// (nagłówek z aplikacją, „tylko do odczytu”, przycisk otwarcia, tytuł, linia meta, treść na białym polu bez paska formatowania); każdy klocek
// źródłowy ma jeden kształt przycisku otwarcia; agent widzi meta i źródło w get_task i w czacie, a bez nich tekst nie zmienia się ani o bajt.
// Punkt 1: 2+ kolejne klocki źródłowe z adresem stoją obok siebie w siatce .cmp; pytanie, notatka albo klocek bez adresu przerywa ciąg.
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Blocks, type Block } from "@/lib/schema";
import { cardText } from "@/lib/agent/context";
import { stepContextText } from "@/lib/agent/chat";
import { groupBlocks, hasComparison, isSourceBlock } from "@/lib/stepcard";
import { BlocksView, BlockView } from "@/components/BlockRenderer";
import { step } from "./helpers";

const URL = "https://app.clickup.com/t/869x";
const ticket: Block = { type: "free", title: "Logowanie przez Google", source: { app: "ClickUp", ref: "869x", url: URL }, meta: "Status: Open · Lista: Backlog · Ola · 12.10.2026", markdown: "# Cel\n\nUżytkownik loguje się **kontem Google**." };
const html = (b: Block) => renderToStaticMarkup(<BlockView b={b} />);

describe("schemat: free.meta", () => {
  it("Blocks.safeParse zachowuje meta klocka free; limit 300 znaków", () => {
    const ok = Blocks.safeParse([ticket]);
    expect(ok.success).toBe(true);
    expect(ok.success && (ok.data[0] as { meta?: string }).meta).toBe("Status: Open · Lista: Backlog · Ola · 12.10.2026");
    expect(Blocks.safeParse([{ type: "free", markdown: "x", meta: "m".repeat(301) }]).success).toBe(false);
    expect(Blocks.safeParse([{ type: "free", markdown: "x" }]).success).toBe(true);
  });
});

describe("get_task i czat: meta i źródło klocka", () => {
  it("cardText: free z meta i źródłem drukuje je w nagłówku klocka; wątek, mail i komentarz dostają źródło", () => {
    const out = cardText([{ id: "s1", title: "Porównaj", status: "todo", blocks: [
      { type: "free", title: "T", source: { app: "clickup", ref: "869x", url: URL }, meta: "Status: Open", markdown: "Treść" },
      { type: "thread", source: { app: "slack", ref: "#dev", url: "https://x.slack.com/archives/C1/p2" }, messages: [{ author: "Ania", text: "hej" }] },
      { type: "mail", source: { app: "gmail", ref: "Zakres" }, messages: [{ from: "Jan", text: "x" }] },
      { type: "comment", source: { app: "figma", url: "https://www.figma.com/file/x" }, author: "Ola", text: "y" },
    ] }]);
    expect(out).toContain(`[0] free „T” [Status: Open] (źródło: clickup 869x ${URL}):\nTreść`);
    expect(out).toContain("[1] thread (źródło: slack #dev https://x.slack.com/archives/C1/p2): Ania: hej");
    expect(out).toContain("[2] mail (źródło: gmail Zakres): Jan: x");
    expect(out).toContain("[3] comment (źródło: figma https://www.figma.com/file/x): Ola: y");
  });
  it("cardText bez meta i bez źródła: bajt w bajt jak dotąd", () => {
    const out = cardText([{ id: "s1", title: "T", status: "todo", blocks: [
      { type: "free", title: "Ticket", markdown: "Treść" },
      { type: "thread", messages: [{ author: "Ania", text: "hej" }] },
      { type: "mail", messages: [{ from: "Jan", text: "x" }] },
      { type: "comment", author: "Ola", text: "y" },
    ] }]);
    expect(out).toBe("KARTKA KROKU s1 „T”:\n[0] free „Ticket”:\nTreść\n[1] thread: Ania: hej\n[2] mail: Jan: x\n[3] comment: Ola: y");
  });
  it("stepContextText: linia treści z meta w nawiasie kwadratowym, bez meta jak dotąd", () => {
    expect(stepContextText(step({ blocks: [ticket] }))).toContain("- treść [Status: Open · Lista: Backlog · Ola · 12.10.2026]: # Cel");
    expect(stepContextText(step({ blocks: [{ type: "free", markdown: "notatka" }] }))).toContain("- treść: notatka");
  });
});

describe("render: karta źródła i przycisk otwarcia", () => {
  it("free z adresem http(s) = SourceDoc: aplikacja, „tylko do odczytu”, przycisk „Otwórz w ClickUpie”, tytuł, meta, treść na białym polu bez paska formatowania", () => {
    const h = html(ticket);
    expect(h).toContain('class="block kctx srcdoc"');
    expect(h).toContain("<b>ClickUp</b>");
    expect(h).toContain("tylko do odczytu");
    expect(h).toContain(`<a class="btn ico sm" href="${URL}" target="_blank" rel="noopener">Otwórz w ClickUpie<svg`);
    expect(h).toContain("<h4>Logowanie przez Google</h4>");
    expect(h).toContain('<div class="src-meta">Status: Open · Lista: Backlog · Ola · 12.10.2026</div>');
    expect(h).toContain('<div class="msg doc"><div class="md"><h4>Cel</h4>');
    expect(h).toContain("<b>kontem Google</b>");
    expect(h).not.toContain("rf-bar");
    expect(h).not.toContain('class="chip"');
  });
  it("free bez adresu renderuje się jak dotąd: bez karty źródła, treść wprost", () => {
    const h = html({ type: "free", title: "Notatka", source: { app: "clickup", ref: "869x" }, markdown: "Treść" });
    expect(h).not.toContain("srcdoc");
    expect(h).not.toContain("tylko do odczytu");
    expect(h).not.toContain("Otwórz");
    expect(h).toContain('<div class="md"><p>Treść</p></div>');
    expect(html({ type: "free", markdown: "x" })).not.toContain("srcdoc");
  });
  it("nagłówek klocka źródłowego (wątek): „Otwórz na Slacku” jako przycisk, nie chip", () => {
    const h = html({ type: "thread", source: { app: "slack", ref: "#dev", url: "https://x.slack.com/archives/C1/p2" }, messages: [{ author: "Ania", text: "hej" }] });
    expect(h).toContain('<a class="btn ico sm" href="https://x.slack.com/archives/C1/p2" target="_blank" rel="noopener">Otwórz na Slacku<svg');
    expect(h).not.toContain('class="chip"');
    expect(h).toContain("<b>Slack</b>");
  });
  it("blok zmian w kodzie: przycisk „Otwórz podgląd” (adres to podgląd, nie GitHub)", () => {
    const h = html({ type: "changes", repo: "a/b", preview: "https://podglad.example/x", files: [] });
    expect(h).toContain('<a class="btn ico sm" href="https://podglad.example/x" target="_blank" rel="noopener">Otwórz podgląd<svg');
    expect(h).not.toContain("Otwórz na GitHubie");
  });
  it("zły adres (taskhub:, javascript:) nie trafia do href i nie daje przycisku; free z takim adresem nie jest kartą źródła", () => {
    const bad = "taskhub://connect?url=https://zly.example&token=x";
    const hs = [
      html({ type: "thread", source: { app: "slack", ref: "#dev", url: bad }, messages: [{ author: "Ania", text: "hej" }] }),
      html({ type: "free", title: "T", source: { app: "clickup", url: bad }, markdown: "Treść" }),
      html({ type: "free", title: "T", source: { app: "clickup", url: "javascript:alert(1)" }, markdown: "Treść" }),
    ];
    for (const h of hs) {
      expect(h).not.toContain('href="taskhub:');
      expect(h).not.toContain('href="javascript:');
      expect(h).not.toContain("Otwórz");
      expect(h).not.toContain("srcdoc");
    }
    expect(hs[0]).toContain("<b>Slack</b>");
    expect(hs[1]).toContain("Treść");
  });
});

describe("porównanie obok siebie: groupBlocks i hasComparison", () => {
  const src = (n: string, extra: Partial<Extract<Block, { type: "free" }>> = {}): Block => ({ type: "free", title: n, source: { app: "clickup", ref: n, url: `https://app.clickup.com/t/${n}` }, markdown: "Treść " + n, ...extra });
  const q: Block = { type: "question", text: "Który?", options: [{ label: "A" }, { label: "B" }] };
  const note: Block = { type: "text", body: "Różnica: termin." };
  it("klocek źródłowy = typ z zestawu porównania z adresem http(s); bez adresu, ze złym adresem albo innego typu nie", () => {
    expect(isSourceBlock(src("a"))).toBe(true);
    expect(isSourceBlock({ type: "thread", source: { app: "slack", url: "https://x.slack.com/archives/C1/p2" }, messages: [{ author: "A", text: "x" }] })).toBe(true);
    expect(isSourceBlock({ type: "mail", source: { app: "gmail", url: "https://mail.google.com/mail/u/0/#inbox/1" }, messages: [{ from: "J", text: "x" }] })).toBe(true);
    expect(isSourceBlock({ type: "comment", source: { app: "figma", url: "https://www.figma.com/file/x" }, author: "O", text: "y" })).toBe(true);
    expect(isSourceBlock({ type: "table", source: { app: "clickup", url: "https://app.clickup.com/t/1" }, columns: ["a"], rows: [["1"]] })).toBe(true);
    expect(isSourceBlock({ type: "free", title: "n", source: { app: "clickup", ref: "869x" }, markdown: "x" })).toBe(false);
    expect(isSourceBlock({ type: "free", source: { app: "clickup", url: "taskhub://connect?url=https://zly.example" }, markdown: "x" })).toBe(false);
    expect(isSourceBlock({ type: "facts", source: { app: "clickup", url: "https://app.clickup.com/t/1" }, facts: [{ label: "a", value: "b" }] } as Block)).toBe(false);
    expect(isSourceBlock({ type: "list", items: [{ title: "a", url: "https://x.example/" }] })).toBe(false);
    expect(isSourceBlock(q)).toBe(false);
  });
  it("dwa kolejne klocki źródłowe = jedna grupa, reszta pojedynczo; kolejność kartki zostaje", () => {
    const a = src("a"), b = src("b");
    expect(groupBlocks([note, a, b])).toEqual([note, [a, b]]);
    expect(groupBlocks([a, b, note])).toEqual([[a, b], note]);
    expect(groupBlocks([q, a, b, note])).toEqual([q, [a, b], note]);
    expect(hasComparison([q, a, b, note])).toBe(true);
    expect(groupBlocks([])).toEqual([]);
    expect(hasComparison([])).toBe(false);
  });
  it("trzy kolejne źródła = jedna grupa z trzech; dwa ciągi rozdzielone notatką = dwie grupy", () => {
    const a = src("a"), b = src("b"), c = src("c"), d = src("d");
    expect(groupBlocks([a, b, c])).toEqual([[a, b, c]]);
    expect(groupBlocks([a, b, note, c, d])).toEqual([[a, b], note, [c, d]]);
  });
  it("jeden klocek źródłowy, źródło bez adresu albo pytanie między źródłami: bez grupy", () => {
    const a = src("a"), b = src("b"), noUrl = src("n", { source: { app: "clickup", ref: "n" } });
    expect(groupBlocks([note, a])).toEqual([note, a]);
    expect(hasComparison([note, a])).toBe(false);
    expect(groupBlocks([a, noUrl, b])).toEqual([a, noUrl, b]);
    expect(hasComparison([a, noUrl, b])).toBe(false);
    expect(groupBlocks([a, q, b])).toEqual([a, q, b]);
    expect(hasComparison([a, q, b])).toBe(false);
    expect(groupBlocks([a, note, b])).toEqual([a, note, b]);
  });
  it("fakty i lista nie grupują się, nawet z adresami w środku", () => {
    const facts: Block = { type: "facts", facts: [{ label: "Status", value: "Open", source: { app: "clickup", url: "https://app.clickup.com/t/1" } }] };
    const list: Block = { type: "list", items: [{ title: "x", url: "https://app.clickup.com/t/2" }] };
    expect(groupBlocks([facts, list])).toEqual([facts, list]);
    expect(hasComparison([facts, list])).toBe(false);
    expect(groupBlocks([facts, src("a"), src("b"), list])).toEqual([facts, [src("a"), src("b")], list]);
  });
  it("mieszane typy źródeł (ticket obok wątku, mail obok komentarza) też stoją obok siebie", () => {
    const thread: Block = { type: "thread", source: { app: "slack", url: "https://x.slack.com/archives/C1/p2" }, messages: [{ author: "A", text: "x" }] };
    const mail: Block = { type: "mail", source: { app: "gmail", url: "https://mail.google.com/mail/u/0/#inbox/1" }, messages: [{ from: "J", text: "x" }] };
    const comment: Block = { type: "comment", source: { app: "figma", url: "https://www.figma.com/file/x" }, author: "O", text: "y" };
    expect(groupBlocks([src("a"), thread, mail, comment])).toEqual([[src("a"), thread, mail, comment]]);
  });
});

describe("porównanie obok siebie: BlocksView", () => {
  const src = (n: string): Block => ({ type: "free", title: "Ticket " + n, source: { app: "clickup", ref: n, url: `https://app.clickup.com/t/${n}` }, markdown: "Treść " + n });
  const q: Block = { type: "question", text: "Który?", options: [{ label: "A" }, { label: "B" }] };
  const form = { taskId: "t1", stepId: "s1" };
  it("dwa źródła obok siebie: siatka .cmp z obiema kartami, w kolejności kartki", () => {
    const h = renderToStaticMarkup(<BlocksView blocks={[{ type: "text", body: "Różnica" }, src("a"), src("b")]} />);
    expect(h).toContain('<div class="cmp">');
    expect(h.match(/class="cmp"/g)?.length).toBe(1);
    const cmp = h.slice(h.indexOf('<div class="cmp">'));
    expect(cmp.match(/class="block kctx srcdoc"/g)?.length).toBe(2);
    expect(cmp.indexOf("Ticket a")).toBeLessThan(cmp.indexOf("Ticket b"));
    expect(h.indexOf("Różnica")).toBeLessThan(h.indexOf('<div class="cmp">'));
  });
  it("jedno źródło albo źródła rozdzielone pytaniem: bez siatki, karty renderują się jak dotąd", () => {
    expect(renderToStaticMarkup(<BlocksView blocks={[{ type: "text", body: "Różnica" }, src("a")]} />)).not.toContain("cmp");
    expect(renderToStaticMarkup(<BlocksView blocks={[src("a")]} />)).not.toContain("cmp");
    const h = renderToStaticMarkup(<BlocksView blocks={[src("a"), q, src("b")]} form={form} />);
    expect(h).not.toContain("cmp");
    expect(h.match(/class="block kctx srcdoc"/g)?.length).toBe(2);
  });
  it("indeks klocka to pozycja na całej kartce także po grupie: pytanie za dwoma źródłami zapisuje odpowiedź pod indeksem 2, a indexOf ma pierwszeństwo", () => {
    const blocks: Block[] = [src("a"), src("b"), q];
    expect(renderToStaticMarkup(<BlocksView blocks={blocks} form={form} />)).toContain('name="index" value="2"');
    const part = blocks.slice(1);   // tylko część kartki: indeks z indexOf, nie z pozycji w wycinku
    expect(renderToStaticMarkup(<BlocksView blocks={part} form={form} indexOf={(b) => blocks.indexOf(b)} />)).toContain('name="index" value="2"');
  });
});
