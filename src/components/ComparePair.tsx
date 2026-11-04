"use client";
// Porównanie „było / będzie” (paczka 49, punkt 3; układ „Wspólna oś” z 2026-11-02): obecna treść po lewej, nowa wersja ze szkicu po prawej,
// każda kolumna do 660 px, na telefonie jedna pod drugą (siatka .cmp). Słowa, które znikają, świecą się po lewej, a te, które dochodzą,
// po prawej. Podświetlenie idzie przez CSS Custom Highlight API: nie zmienia drzewa DOM, więc nie przeszkadza Reactowi ani edytorowi
// szkicu (pole zostaje edytowalne jak dotąd, podświetlenie liczy się na nowo po każdej zmianie). Bez wsparcia w przeglądarce: bez podświetleń.
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { changedWords, wordsOf } from "@/lib/textdiff";

type Side = "before" | "after";
type Ctx = { words: Record<Side, string[]>; set: (side: Side, w: string[]) => void };
const PairCtx = createContext<Ctx | null>(null);

// wspólny rejestr podświetleń strony: każda kolumna trzyma swoje zakresy, zestaw nazwy składa się z nich wszystkich
const NAMES: Record<Side, string> = { before: "th-del", after: "th-ins" };
const ranges = new Map<symbol, { side: Side; list: Range[] }>();
type HL = { set: (n: string, h: unknown) => void; delete: (n: string) => void };
function paint(side: Side) {
  const css = (globalThis as { CSS?: { highlights?: HL } }).CSS;
  const H = (globalThis as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
  if (!css?.highlights || !H) return;
  const all = [...ranges.values()].filter((x) => x.side === side).flatMap((x) => x.list);
  if (all.length) css.highlights.set(NAMES[side], new H(...all)); else css.highlights.delete(NAMES[side]);
}

export function ComparePair({ children }: { children: ReactNode }) {
  const [words, setWords] = useState<Record<Side, string[]>>({ before: [], after: [] });
  const set = (side: Side, w: string[]) => setWords((p) => (p[side].length === w.length && p[side].every((x, i) => x === w[i]) ? p : { ...p, [side]: w }));
  return <PairCtx.Provider value={{ words, set }}><div className="cmp pair">{children}</div></PairCtx.Provider>;
}

// sel: gdzie w kolumnie jest sama treść (bez nagłówka karty, przycisków i paska formatowania)
export function CompareSide({ side, label, sel, children }: { side: Side; label: string; sel: string; children: ReactNode }) {
  const ctx = useContext(PairCtx);
  const box = useRef<HTMLDivElement>(null);
  const id = useRef(Symbol(side));
  const [tick, setTick] = useState(0);
  // tekst kolumny po każdej zmianie w DOM (edytor szkicu przerysowuje akapity przy pisaniu)
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const mo = new MutationObserver(() => setTick((n) => n + 1));
    mo.observe(el, { subtree: true, childList: true, characterData: true });
    return () => { mo.disconnect(); ranges.delete(id.current); paint(side); };
  }, [side]);
  const other = ctx?.words[side === "before" ? "after" : "before"] ?? [];
  useEffect(() => {
    const el = box.current;
    if (!el || !ctx) return;
    const nodes: { node: Text; w: string; from: number; to: number }[] = [];
    for (const root of el.querySelectorAll(sel)) {
      const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) for (const x of wordsOf(n.nodeValue ?? "")) nodes.push({ node: n as Text, ...x });
    }
    const mine = nodes.map((x) => x.w);
    ctx.set(side, mine);
    if (!other.length) { ranges.delete(id.current); paint(side); return; }
    const d = changedWords(side === "before" ? mine : other, side === "before" ? other : mine);
    const flags = side === "before" ? d.del : d.ins;
    const list: Range[] = [];
    nodes.forEach((x, i) => {
      if (!flags[i]) return;
      const r = document.createRange();
      r.setStart(x.node, x.from); r.setEnd(x.node, x.to);
      list.push(r);
    });
    ranges.set(id.current, { side, list });
    paint(side);
  }, [tick, other, side, sel]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div ref={box} className={"cmp-side " + side}>
      <div className="cmp-lbl">{label}</div>
      {children}
    </div>
  );
}
