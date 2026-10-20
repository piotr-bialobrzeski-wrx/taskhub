import { describe, it, expect } from "vitest";
import { mdToHtml, mdToPlain, publishFormat, hasMarkdown, fromEditorMd, toEditorMd, outsideCode, decodeEntities } from "@/lib/format";
import { draftsText } from "@/lib/agent/context";

const md = "# **Description**\nThe list shows **every** employee and *its* status.\n\n# **Acceptance criteria**\n1. Sorted by **Name**.\n2. See [prototyp](https://example.com/p).\n\n- jeden\n  - zagnieżdżony\n- ~~stary~~ nowy `kod`";

describe("szkic w Markdown przeliczony na format aplikacji", () => {
  it("Slack dostaje Markdown wprost (konektor claude.ai czyta go sam); druga wersja tylko dla starszych szkiców z encjami", () => {
    expect(publishFormat("slack", "A & B **x** <@U07DWN21HJQ>")?.text).toBeNull();
    expect(publishFormat("slack", "&lt;@U07DWN21HJQ&gt; A &amp; B")?.text).toBe("<@U07DWN21HJQ> A & B");
    expect(publishFormat("slack", md)?.how).toContain("zwykły Markdown");
    expect(publishFormat("clickup", "Access &amp; roles")?.text).toBe("Access & roles");
  });
  it("tekst z edytora i do edytora: encje i ucieczki znikają poza kodem, kod zostaje bajt w bajt", () => {
    expect(fromEditorMd("Access &amp; roles")).toBe("Access & roles");
    expect(fromEditorMd("Kod `x &amp; y` i\n```\n<b>&amp;</b>\n```\nkoniec &lt;3")).toBe("Kod `x &amp; y` i\n```\n<b>&amp;</b>\n```\nkoniec <3");
    expect(fromEditorMd("&amp;lt;")).toBe("&lt;");
    expect(fromEditorMd("snake\\_case i plik\\_a\\_b.md")).toBe("snake_case i plik_a_b.md");
    expect(toEditorMd("Typ Array<Item> i `a<b`")).toBe("Typ Array&lt;Item> i `a<b`");
    expect(outsideCode("a ``x`y`` b", (t) => t.toUpperCase())).toBe("A ``x`y`` B");
    expect(decodeEntities("&amp;&lt;&gt;&quot;")).toBe("&<>&quot;");
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
    // starszy szkic po edycji w polu: jedno „&amp;”, nigdy „&amp;amp;”
    expect(mdToHtml("Access &amp; roles")).toBe("<p>Access &amp; roles</p>");
  });
  it("tekst bez znaczników na zapasową wersję maila", () => {
    const p = mdToPlain(md);
    expect(p).toContain("Description\nThe list shows every employee and its status.");
    expect(p).toContain("2. See prototyp (https://example.com/p).");
    expect(p).not.toMatch(/\*|#|~~/);
    expect(mdToPlain("5 \\* 3 i snake\\_case")).toBe("5 * 3 i snake_case");
  });
  it("publishFormat: ClickUp przez markdown_description, Slack i mail z gotową treścią, zwykły tekst bez drugiej wersji", () => {
    expect(publishFormat("clickup", md)?.how).toContain("markdown_description");
    expect(publishFormat("gmail", md)?.text).toContain("<h2>Description</h2>");
    expect(publishFormat("gmail", "Zwykły &amp; tekst")?.text).toBe("<p>Zwykły &amp; tekst</p>\n--- (body, bez znaczników) ---\nZwykły & tekst");
    expect(publishFormat("slack", "Zwykły tekst bez znaczków")?.text).toBeNull();
    expect(publishFormat("figma", md)).toBeNull();
    expect(hasMarkdown("a * b * c")).toBe(false);
  });
  it("get_task podaje przy szkicu sposób formatowania i wersję w formacie celu", () => {
    const out = draftsText([{ id: "s1", title: "Ogłoś", status: "handoff", blocks: [{ type: "draft", target: { app: "slack", where: "#dev", action: "send" }, body: "**Nowa** wersja", status: "approved" }] }]);
    expect(out).toContain("- formatowanie: Slack (konektor claude.ai Slack) przyjmuje zwykły Markdown");
    expect(out).not.toContain("Slack mrkdwn");
    expect(out).not.toContain("treść jako");
  });
});
