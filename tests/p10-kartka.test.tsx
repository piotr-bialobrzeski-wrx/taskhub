// Paczka 10, punkt 2: karta źródła tylko do odczytu. Klocek free z adresem http(s) renderuje się jak karta szkicu (nagłówek z aplikacją,
// „tylko do odczytu”, przycisk otwarcia, tytuł, linia meta, treść na białym polu bez paska formatowania); każdy klocek źródłowy
// ma jeden kształt przycisku otwarcia; agent widzi meta i źródło w get_task i w czacie, a bez nich tekst nie zmienia się ani o bajt.
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Blocks, type Block } from "@/lib/schema";
import { cardText } from "@/lib/agent/context";
import { stepContextText } from "@/lib/agent/chat";
import { BlockView } from "@/components/BlockRenderer";
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
