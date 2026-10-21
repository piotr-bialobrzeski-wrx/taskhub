// Paczka 10, kartka porównania. Punkt 2: karta źródła tylko do odczytu. Klocek free z adresem http(s) renderuje się jak karta szkicu
// (nagłówek z aplikacją, „tylko do odczytu”, przycisk otwarcia, tytuł, linia meta, treść na białym polu bez paska formatowania); każdy klocek
// źródłowy ma jeden kształt przycisku otwarcia; agent widzi meta i źródło w get_task i w czacie, a bez nich tekst nie zmienia się ani o bajt.
// Punkt 1: 2+ kolejne klocki źródłowe z adresem stoją obok siebie w siatce .cmp; pytanie, notatka albo klocek bez adresu przerywa ciąg.
// Punkt 3b/4: karta publikacji z opcjami: każda we własnej karcie z własnym formularzem i „Zatwierdź: Opcja X”, po wyborze wybrana w nagłówku,
// reszta pod „Odrzucone wersje”; nagłówek „Teraz” mówi „Wybierz opcję”; przycisk celu stoi w nagłówku karty, także przy jednym szkicu.
// Punkt 3c: agent widzi opcje w get_task (sekcja na każdą z nazwą, niewybrana „nie wysyłaj”, ten, kto wysyła, dostaje tylko wybraną) i w czacie.
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Blocks, type Block, type Step } from "@/lib/schema";
import { cardText, draftsText } from "@/lib/agent/context";
import { stepContextText } from "@/lib/agent/chat";
import { shownSig, type Draft } from "@/lib/agent/approval";
import { groupBlocks, hasComparison, isSourceBlock, nowHeading } from "@/lib/stepcard";
import { BlocksView, BlockView } from "@/components/BlockRenderer";
import { cardModeOf, PublishCard, type CardMode } from "@/components/PublishCard";
import { step, task } from "./helpers";

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

describe("get_task i czat: opcje (punkt 3c)", () => {
  const opt = (body: string, extra: Partial<Draft> = {}): Draft => ({ type: "draft", target: { app: "slack", where: "#dev", action: "send" }, body, status: "proposed", ...extra });
  const A = opt("Wersja krótka."), B = opt("Wersja długa, z uzasadnieniem.");
  it("draftsText: dwie opcje do zatwierdzenia = sekcja na każdą, z nazwą z title albo z pozycji", () => {
    const out = draftsText([{ id: "s1", title: "Odpisz", status: "draft", blocks: [A, { ...B, title: "Długo" }] }]);
    expect(out.match(/SZKIC KROKU/g)).toHaveLength(2);
    expect(out).toContain("SZKIC KROKU s1 „Odpisz” · Opcja A (czeka na zatwierdzenie Piotra: nie wysyłaj)\n- dokąd: slack · #dev · akcja send");
    expect(out).toContain("SZKIC KROKU s1 „Odpisz” · Długo (czeka na zatwierdzenie Piotra: nie wysyłaj)");
  });
  it("draftsText: B zatwierdzona w handoff: A „opcja niewybrana (Piotr wybrał „Opcja B”): nie wysyłaj”; ten, kto wysyła, widzi tylko B", () => {
    const s = { id: "s1", title: "Odpisz", status: "handoff" as const, blocks: [A, { ...B, status: "approved" as const }] };
    const out = draftsText([s], { send: () => false });
    expect(out.match(/SZKIC KROKU/g)).toHaveLength(2);
    expect(out).toContain("SZKIC KROKU s1 „Odpisz” · Opcja A (opcja niewybrana (Piotr wybrał „Opcja B”): nie wysyłaj)");
    expect(out).toContain("SZKIC KROKU s1 „Odpisz” · Opcja B (zatwierdzony przez Piotra: wyśle go mostek Task Hub w osobnym biegu wysyłki; nie wysyłaj)");
    const send = draftsText([s], { send: () => true });
    expect(send.match(/SZKIC KROKU/g)).toHaveLength(1);
    expect(send).toContain("SZKIC KROKU s1 „Odpisz” · Opcja B (ZATWIERDZONY: wyślij dokładnie tę treść)");
    expect(send).toContain(B.body); expect(send).not.toContain(A.body);
    // nazwa wybranej z title; po wysyłce B „wysłany”, A dalej niewybrana (nikt już nie wysyła, więc obie widoczne)
    const named = draftsText([{ ...s, blocks: [A, { ...B, title: "Długo", status: "approved" as const }] }], { send: () => false });
    expect(named).toContain("· Opcja A (opcja niewybrana (Piotr wybrał „Długo”): nie wysyłaj)");
    const done = draftsText([{ ...s, status: "done" as const, blocks: [A, { ...B, status: "sent" as const }] }], { send: () => false });
    expect(done).toContain("· Opcja B (wysłany)");
    expect(done).toContain("· Opcja A (opcja niewybrana (Piotr wybrał „Opcja B”): nie wysyłaj)");
    // „Zatrzymaj” zdjęło zgodę: obie znów zwykłe propozycje, bez „niewybrana”
    expect(draftsText([{ ...s, status: "todo" as const, blocks: [A, B] }], { send: () => false })).not.toContain("niewybrana");
  });
  it("stepContextText: SZKIC z nazwą opcji, niewybrana oznaczona; jeden szkic bez title jak dotąd", () => {
    const out = stepContextText(step({ status: "handoff", blocks: [{ ...A, title: "Krótko" }, { ...B, status: "approved" }] }));
    expect(out).toContain("- SZKIC „Krótko” (proposed, niewybrana) do slack #dev: Wersja krótka.");
    expect(out).toContain("- SZKIC „Opcja B” (approved) do slack #dev: Wersja długa, z uzasadnieniem.");
    expect(stepContextText(step({ blocks: [A] }))).toContain("- SZKIC (proposed) do slack #dev: Wersja krótka.");
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

describe("opcje na karcie publikacji (punkt 3b/4)", () => {
  const opt = (n: string, body: string, extra: Partial<Draft> = {}): Draft => ({ type: "draft", target: { app: "clickup", action: "update", url: `https://app.clickup.com/t/${n}`, where: `Ticket ${n}` }, body, status: "proposed", ...extra });
  const A = opt("869aaaaa1", "Zmieniamy termin na piątek."), B = opt("869bbbbb2", "Termin zostaje, dokładamy osobę.");
  const card = (s: Step, mode: CardMode, link: string | null = null) =>
    renderToStaticMarkup(<PublishCard t={task({ steps: [s] })} s={s} mode={mode} aiOn={false} ownerName="Piotr" link={link} connections={[]} company={null} />);
  const count = (h: string, re: RegExp) => h.match(re)?.length ?? 0;

  it("nagłówek „Teraz”: przy 2+ szkicach „Wybierz opcję”, przy jednym i w innych stanach jak dotąd", () => {
    expect(nowHeading("draft", "proposed", 0, false, undefined, 2)).toEqual({ title: "Wybierz opcję", cls: "draft" });
    expect(nowHeading("draft", "proposed", 0, false, undefined, 1)).toEqual({ title: "Do zatwierdzenia", cls: "draft" });
    expect(nowHeading("draft", "proposed", 0, false)).toEqual({ title: "Do zatwierdzenia", cls: "draft" });
    expect(nowHeading("ready", "parked", 0, false, undefined, 2)).toEqual({ title: "Odłożony szkic", cls: "draft" });
  });
  it("do zatwierdzenia z dwiema opcjami: siatka kart, każda z nagłówkiem, przyciskiem celu, własnym formularzem (option, seen) i „Zatwierdź: Opcja X”", () => {
    const s = step({ status: "draft", tool: "clickup", needsApproval: true, blocks: [A, B] });
    const h = card(s, "proposed");
    expect(count(h, /class="cmp"/g)).toBe(1);
    expect(count(h, /class="block pub opt"/g)).toBe(2);
    expect(h).toContain("<b>Do zatwierdzenia</b> · Opcja A");
    expect(h).toContain("<b>Do zatwierdzenia</b> · Opcja B");
    expect(h).toContain("Zatwierdź: Opcja A");
    expect(h).toContain("Zatwierdź: Opcja B");
    expect(h).not.toContain("Zatwierdź i ");
    expect(h).toContain(`id="pub-${s.id}-0"`);
    expect(h).toContain(`id="pub-${s.id}-1"`);
    expect(h).not.toContain(`id="pub-${s.id}"`);
    expect(h).toContain('name="option" value="0"');
    expect(h).toContain('name="option" value="1"');
    const seen = h.match(/name="seen" value="[0-9a-f]+"/g) ?? [];
    expect(seen).toHaveLength(2);
    expect(seen[0]).not.toBe(seen[1]);
    expect(seen).toEqual([`name="seen" value="${shownSig(s, A, true)}"`, `name="seen" value="${shownSig(s, B, true)}"`]);
    expect(count(h, /name="seenFull"/g)).toBe(2);
    // przycisk celu każdej opcji w jej nagłówku; wspólny nagłówek nad siatką mówi tylko, dokąd (aplikacja)
    expect(h).toContain('href="https://app.clickup.com/t/869aaaaa1"');
    expect(h).toContain('href="https://app.clickup.com/t/869bbbbb2"');
    expect(count(h, /Otwórz w ClickUpie/g)).toBe(2);
    expect(h.indexOf("<b>ClickUp</b>")).toBeLessThan(h.indexOf('class="cmp"'));
    expect(h).toContain("Odłóż");
  });
  it("jeden szkic jak dotąd: formularz „pub-<krok>” bez pola option, bez siatki; przycisk celu przeniesiony do nagłówka karty", () => {
    const s = step({ status: "draft", tool: "clickup", needsApproval: true, blocks: [A] });
    const h = card(s, "proposed");
    expect(h).toContain(`id="pub-${s.id}"`);
    expect(h).not.toContain('name="option"');
    expect(h).not.toContain("cmp");
    expect(h).not.toContain("pub opt");
    expect(h).toContain("Zatwierdź i zaktualizuj");
    const head = h.slice(h.indexOf('class="pub-h"'), h.indexOf("pub-edit"));
    expect(head).toContain('<a class="btn ico" href="https://app.clickup.com/t/869aaaaa1" target="_blank" rel="noopener" title="Tu trafi wynik kroku: https://app.clickup.com/t/869aaaaa1">Otwórz w ClickUpie<svg');
  });
  it("odłożone opcje: „Odłożony szkic · Opcja X” na każdej karcie i „Zamknij bez wysyłki” pod siatką", () => {
    const s = step({ status: "todo", tool: "clickup", needsApproval: true, blocks: [A, B] });
    const h = card(s, "parked");
    expect(h).toContain("<b>Odłożony szkic</b> · Opcja A");
    expect(h).toContain("<b>Odłożony szkic</b> · Opcja B");
    expect(count(h, /Zatwierdź: Opcja/g)).toBe(2);
    expect(h).toContain("Zamknij bez wysyłki");
  });
  it("po wysyłce [sent B, proposed A]: wybrana w nagłówku, jeden przycisk otwarcia, „Odrzucone wersje (1)” bez przycisku i bez formularza", () => {
    const At = { ...A, title: "Opcja A" }, Bt = { ...B, title: "Opcja B", status: "sent" as const };
    const s = step({ status: "done", tool: "clickup", needsApproval: true, blocks: [Bt, At] });
    expect(cardModeOf(s)).toBe("sent");
    const h = card(s, "sent", "https://app.clickup.com/t/869bbbbb2");
    expect(h).toContain("<b>ClickUp</b> · Opcja B · Ticket 869bbbbb2");
    expect(h).toContain("Odrzucone wersje (1)");
    expect(h).toContain('class="fold rej"');
    expect(count(h, /href="/g)).toBe(1);
    expect(h).toContain('href="https://app.clickup.com/t/869bbbbb2"');
    expect(h).not.toContain("<form");
    expect(h).not.toContain("cmp");
    const rej = h.slice(h.indexOf('class="fold rej"'));
    expect(rej).toContain("<h4>Opcja A</h4>");
    expect(rej).toContain("Zmieniamy termin na piątek.");
    expect(rej).not.toContain("Otwórz");
    expect(h.slice(0, h.indexOf('class="fold rej"'))).toContain("Termin zostaje, dokładamy osobę.");
  });
  it("zamknięty bez wyboru: „Nie wysłano”, opcje tylko do odczytu, bez formularzy i bez odrzuconych", () => {
    const s = step({ status: "done", tool: "clickup", needsApproval: true, blocks: [A, B] });
    expect(cardModeOf(s)).toBe("unsent");
    const h = card(s, "unsent");
    expect(h).toContain("<b>Nie wysłano</b>");
    expect(count(h, /class="block pub opt"/g)).toBe(2);
    expect(h).toContain("<b>Opcja A</b>");
    expect(h).toContain("<b>Opcja B</b>");
    expect(h).not.toContain("<form");
    expect(h).not.toContain("Zatwierdź");
    expect(h).not.toContain("Odrzucone wersje");
  });
});
