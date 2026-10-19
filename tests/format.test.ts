import { describe, it, expect } from "vitest";
import { mdToHtml, mdToPlain, mdToSlack, publishFormat, hasMarkdown } from "@/lib/format";
import { draftsText } from "@/lib/agent/context";

const md = "# **Description**\nThe list shows **every** employee and *its* status.\n\n# **Acceptance criteria**\n1. Sorted by **Name**.\n2. See [prototyp](https://example.com/p).\n\n- jeden\n  - zagnieżdżony\n- ~~stary~~ nowy `kod`";

describe("szkic w Markdown przeliczony na format aplikacji", () => {
  it("Slack: nagłówek jako pogrubiona linia, *pogrubienie*, _kursywa_, link <url|tekst>, punkty •", () => {
    const s = mdToSlack(md);
    expect(s).toContain("*Description*\nThe list shows *every* employee and _its_ status.");
    expect(s).toContain("1. Sorted by *Name*.");
    expect(s).toContain("2. See <https://example.com/p|prototyp>.");
    expect(s).toContain("• jeden\n    • zagnieżdżony\n• ~stary~ nowy `kod`");
    expect(s).not.toContain("**");
    expect(s).not.toContain("#");
  });
  it("HTML: nagłówki, listy (także zagnieżdżone), znaczniki i link; tekst jest ucieczkowany", () => {
    const h = mdToHtml(md + "\n\n<script>x</script> & co");
    expect(h).toContain("<h2>Description</h2>");
    expect(h).toContain("<p>The list shows <b>every</b> employee and <i>its</i> status.</p>");
    expect(h).toContain("<ol><li>Sorted by <b>Name</b>.\n</li><li>See <a href=\"https://example.com/p\">prototyp</a>.\n</li></ol>");
    expect(mdToHtml("3. trzeci")).toBe("<ol start=\"3\"><li>trzeci\n</li></ol>");
    expect(h).toContain("<ul><li>jeden\n<ul><li>zagnieżdżony\n</li></ul>\n</li><li><s>stary</s> nowy <code>kod</code>\n</li></ul>");
    expect(h).toContain("&lt;script&gt;x&lt;/script&gt; &amp; co");
    expect(h).not.toContain("<script>");
  });
  it("tekst bez znaczników na zapasową wersję maila", () => {
    const p = mdToPlain(md);
    expect(p).toContain("Description\nThe list shows every employee and its status.");
    expect(p).toContain("2. See prototyp (https://example.com/p).");
    expect(p).not.toMatch(/\*|#|~~/);
  });
  it("publishFormat: ClickUp przez markdown_description, Slack i mail z gotową treścią, zwykły tekst bez drugiej wersji", () => {
    expect(publishFormat("clickup", md)?.how).toContain("markdown_description");
    expect(publishFormat("slack", md)?.text).toBe(mdToSlack(md));
    expect(publishFormat("gmail", md)?.text).toContain("<h2>Description</h2>");
    expect(publishFormat("slack", "Zwykły tekst bez znaczków")?.text).toBeNull();
    expect(publishFormat("figma", md)).toBeNull();
    expect(hasMarkdown("a * b * c")).toBe(false);
  });
  it("get_task podaje przy szkicu sposób formatowania i wersję w formacie celu", () => {
    const out = draftsText([{ id: "s1", title: "Ogłoś", status: "handoff", blocks: [{ type: "draft", target: { app: "slack", where: "#dev", action: "send" }, body: "**Nowa** wersja", status: "approved" }] }]);
    expect(out).toContain("- formatowanie: Slack nie czyta Markdown");
    expect(out).toContain("- treść jako Slack mrkdwn (wyślij tę wersję):\n---\n*Nowa* wersja\n---");
  });
});
