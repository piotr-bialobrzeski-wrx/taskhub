// Paczka 7, punkt 2: chip narzędzia na kafelku i w wierszu listy nigdy nie zasłania chipu stanu.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { ToolChip } from "@/components/canvas/ui";

const html = (tool: string, label: string) => renderToStaticMarkup(<ToolChip tool={tool} label={label} />);

describe("chip narzędzia", () => {
  it("nazwa siedzi w wewnętrznym <span> (to on dostaje wielokropek), pełna nazwa w dymku", () => {
    expect(html("code", "Claude Code")).toBe('<span class="chip tool" style="--c:var(--t-claude)" title="Claude Code"><span>Claude Code</span></span>');
    expect(html("docs", "Dokument Google")).toBe('<span class="chip tool" style="--c:var(--sub)" title="Dokument Google"><span>Dokument Google</span></span>');
    expect(html("google drive", "google drive")).toContain('title="google drive"><span>google drive</span>');
  });
  it("kafelek i wiersz listy używają tylko ToolChip, a reguła ucinania w chipie zostaje", () => {
    const canvas = readFileSync("src/components/canvas/TaskCanvas.tsx", "utf8");
    expect(canvas).not.toContain('className="chip tool"');
    expect(canvas.match(/<ToolChip /g)?.length).toBe(2);
    const css = readFileSync("src/app/globals.css", "utf8");
    expect(css).toMatch(/\.chip > span \{[^}]*text-overflow: ellipsis/);
    expect(css).toContain(".n-top > .n-num, .n-top > .st, .lrow > .n-num, .lrow > .st { flex: none; }");
    expect(css).toContain(".lrow > .chip.tool { max-width: 30%; }");
  });
});
