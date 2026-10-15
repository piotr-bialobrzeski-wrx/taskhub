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
