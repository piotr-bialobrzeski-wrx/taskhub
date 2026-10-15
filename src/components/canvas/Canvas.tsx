"use client";
// Silnik kanwy (port z prototypu): kafelki, strzałki zależności, grupy, zaznaczanie ramką, przeciąganie, zoom kółkiem, przesuwanie środkowym przyciskiem.
// Rysuje tylko to, co dostanie; co znaczy kafelek i co robią akcje, decyduje rodzic (Board / TaskCanvas).
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { bounds, centerOf, computePositions, groupAt, membership, type LGroup, type LItem, type Pos, type Size } from "@/lib/canvas/layout";
import { GCOL } from "./ui";

export type CanvasItem = LItem & { cls: string; done?: boolean; aria: string };
export type CanvasGroup = LGroup & { name: string; color: number };
export type CanvasApi = { positions: () => Record<string, Pos>; viewCenter: () => Pos };

type Drag =
  | { kind: "move"; id: string; sx: number; sy: number; group: { k: string; ox: number; oy: number }[]; moved: boolean }
  | { kind: "gmove" | "gresize"; corner: string; g: CanvasGroup; sx: number; sy: number; ox: number; oy: number; ow: number; oh: number; mem: { k: string; ox: number; oy: number }[]; moved: boolean }
  | { kind: "link"; from: string; to: string | null; p: Pos }
  | { kind: "origin"; sx: number; sy: number };

export type CanvasProps = {
  zoomKey: string;
  apiRef?: React.RefObject<CanvasApi | null>;        // rodzic odczytuje położenia (np. prostokąt nowej grupy)
  items: CanvasItem[];
  size: Size;
  render: (id: string) => ReactNode;
  origin?: { node: ReactNode; cls: string } | null;
  groups: CanvasGroup[];
  selected: Set<string>;
  onSelect: (ids: Set<string>) => void;
  selectedGroup: string | null;
  onSelectGroup: (id: string | null) => void;
  renaming: string | null;
  onRename: (id: string, name: string | null) => void;
  onOpen: (id: string | null) => void;          // dwuklik / Enter: null = kafelek zadania (origin)
  onClickTile?: (id: string) => void;            // pojedyncze kliknięcie (poziom kroków otwiera panel)
  onMove: (items: { id: string; x: number; y: number }[]) => void;
  onLink?: (from: string, to: string) => void;
  onUnlink?: (from: string, to: string) => void;
  onGroupChange: (id: string, patch: Partial<CanvasGroup>) => void;
  onGroupCreate: (rect: { x: number; y: number; w: number; h: number }, members: string[]) => void;
  onAutoLayout: () => void;
  empty?: ReactNode;
  showPorts?: boolean;
};

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const fmtPct = (z: number) => Math.round(z * 100) + "%";

export function Canvas(p: CanvasProps) {
  const canvasRef = useRef<HTMLDivElement>(null), worldRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoomState] = useState(1);
  const [override, setOverride] = useState<Record<string, Pos>>({});      // położenia w trakcie przeciągania
  const [gOverride, setGOverride] = useState<Record<string, Partial<CanvasGroup>>>({});
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const [band, setBand] = useState<{ x0: number; y0: number; x: number; y: number; base: Set<string>; moved: boolean } | null>(null);
  const bandRef = useRef<typeof band>(null);
  const panRef = useRef<{ x: number; y: number; l: number; t: number } | null>(null);
  const [panning, setPanning] = useState(false);

  useEffect(() => { try { const z = Number(localStorage.getItem("th-zoom-" + p.zoomKey)); if (z) setZoomState(clamp(z, 0.35, 1.6)); } catch { /* brak storage */ } }, [p.zoomKey]);
  const setZoom = useCallback((nz: number, cx?: number, cy?: number) => {
    const c = canvasRef.current; if (!c) return;
    const r = c.getBoundingClientRect(); nz = clamp(nz, 0.35, 1.6);
    const px = cx ?? r.width / 2, py = cy ?? r.height / 2;
    setZoomState((z) => { const wx = (c.scrollLeft + px) / z, wy = (c.scrollTop + py) / z; requestAnimationFrame(() => { c.scrollLeft = wx * nz - px; c.scrollTop = wy * nz - py; }); return nz; });
    try { localStorage.setItem("th-zoom-" + p.zoomKey, String(nz)); } catch { /* brak storage */ }
  }, [p.zoomKey]);

  const groups = useMemo(() => p.groups.map((g) => ({ ...g, ...(gOverride[g.id] ?? {}) })), [p.groups, gOverride]);
  const layout = useMemo(() => computePositions(p.items, groups, p.size, !!p.origin), [p.items, groups, p.size, p.origin]);
  const P = useMemo(() => ({ ...layout.P, ...override }), [layout.P, override]);
  const lg = useMemo(() => layout.groups.map((g) => ({ ...(p.groups.find((x) => x.id === g.id) ?? ({} as CanvasGroup)), ...g, ...(gOverride[g.id] ?? {}) })) as CanvasGroup[], [layout.groups, p.groups, gOverride]);
  const bb = bounds(P, lg, p.size, layout.origin);

  const worldPoint = (ev: { clientX: number; clientY: number }): Pos => {
    const r = worldRef.current!.getBoundingClientRect();
    return { x: (ev.clientX - r.left) / zoom, y: (ev.clientY - r.top) / zoom };
  };
  const itemsDone = useMemo(() => new Map(p.items.map((x) => [x.id, !!x.done])), [p.items]);

  // ---------- przeciąganie kafelków, grup, strzałek ----------
  const onWorldDown = (ev: React.PointerEvent) => {
    if (ev.button !== 0) return;
    const t = ev.target as HTMLElement;
    if (t.closest(".g-input")) { ev.stopPropagation(); return; }
    const gh = t.closest<HTMLElement>("[data-ghead],[data-gresize]");
    if (gh) {
      ev.preventDefault(); ev.stopPropagation(); (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
      const g = lg.find((x) => x.id === (gh.dataset.ghead || gh.dataset.gresize)); if (!g) return;
      const mem = g.members.filter((k) => P[k]).map((k) => ({ k, ox: P[k].x, oy: P[k].y }));
      const d: Drag = { kind: gh.dataset.ghead ? "gmove" : "gresize", corner: gh.dataset.corner || "br", g, sx: ev.clientX, sy: ev.clientY, ox: g.x, oy: g.y, ow: g.w, oh: g.h, mem, moved: false };
      dragRef.current = d; setDrag(d); p.onSelectGroup(g.id); p.onSelect(new Set());
      return;
    }
    const node = t.closest<HTMLElement>(".node"); if (!node) return;
    ev.preventDefault(); ev.stopPropagation(); (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
    const port = t.closest<HTMLElement>("[data-port]");
    if (port && p.onLink) { const d: Drag = { kind: "link", from: port.dataset.port!, to: null, p: worldPoint(ev) }; dragRef.current = d; setDrag(d); return; }
    if (node.dataset.origin) { const d: Drag = { kind: "origin", sx: ev.clientX, sy: ev.clientY }; dragRef.current = d; setDrag(d); return; }
    const id = node.dataset.id!;
    if (ev.shiftKey || ev.metaKey || ev.ctrlKey) { const s = new Set(p.selected); if (s.has(id)) s.delete(id); else s.add(id); p.onSelect(s); return; }
    const keys = p.selected.has(id) && p.selected.size > 1 ? [...p.selected].filter((k) => P[k]) : [id];
    const d: Drag = { kind: "move", id, sx: ev.clientX, sy: ev.clientY, group: keys.map((k) => ({ k, ox: P[k].x, oy: P[k].y })), moved: false };
    dragRef.current = d; setDrag(d);
  };
  const onWorldMove = (ev: React.PointerEvent) => {
    const d = dragRef.current; if (!d) return;
    if (d.kind === "move") {
      const dx = (ev.clientX - d.sx) / zoom, dy = (ev.clientY - d.sy) / zoom;
      if (!d.moved && Math.hypot(dx, dy) < 4) return;
      d.moved = true;
      const o: Record<string, Pos> = {};
      d.group.forEach((g) => { o[g.k] = { x: Math.max(0, g.ox + dx), y: Math.max(60, g.oy + dy) }; });
      setOverride((prev) => ({ ...prev, ...o }));
    } else if (d.kind === "gmove" || d.kind === "gresize") {
      const dx = (ev.clientX - d.sx) / zoom, dy = (ev.clientY - d.sy) / zoom;
      if (!d.moved && Math.hypot(dx, dy) < 4) return;
      d.moved = true;
      const g: Partial<CanvasGroup> = { auto: false };
      if (d.kind === "gmove") {
        const mx = Math.max(dx, -d.ox), my = Math.max(dy, 60 - d.oy);
        g.x = d.ox + mx; g.y = d.oy + my;
        const o: Record<string, Pos> = {}; d.mem.forEach((m) => { o[m.k] = { x: m.ox + mx, y: m.oy + my }; });
        setOverride((prev) => ({ ...prev, ...o }));
      } else if (d.corner === "tr") { g.w = Math.max(200, d.ow + dx); g.h = Math.max(120, d.oh - Math.max(dy, 60 - d.oy)); g.y = d.oy + d.oh - g.h; }
      else if (d.corner === "bl") { g.h = Math.max(120, d.oh + dy); g.w = Math.max(200, d.ow - Math.max(dx, -d.ox)); g.x = d.ox + d.ow - g.w; }
      else { g.w = Math.max(200, d.ow + dx); g.h = Math.max(120, d.oh + dy); }
      setGOverride((prev) => ({ ...prev, [d.g.id]: { ...(prev[d.g.id] ?? {}), ...g } }));
    } else if (d.kind === "link") {
      const over = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest<HTMLElement>(".node[data-id]");
      d.p = worldPoint(ev); d.to = over && over.dataset.id !== d.from ? over.dataset.id! : null;
      setDrag({ ...d });
    }
  };
  const endDrag = () => {
    const d = dragRef.current; dragRef.current = null; setDrag(null);
    if (!d) return;
    if (d.kind === "move") {
      if (!d.moved) { if (p.onClickTile) p.onClickTile(d.id); else p.onSelect(new Set([d.id])); p.onSelectGroup(null); return; }
      const moved = d.group.map((g) => ({ id: g.k, x: P[g.k].x, y: P[g.k].y }));
      p.onMove(moved);
      // przynależność do grup po upuszczeniu
      const mem = membership(lg, P, p.size);
      lg.forEach((g) => { const next = mem[g.id], cur = g.members; if (next.length !== cur.length || next.some((k) => !cur.includes(k))) p.onGroupChange(g.id, { members: next, auto: false }); });
    } else if (d.kind === "gmove" || d.kind === "gresize") {
      if (!d.moved) return;
      const g = lg.find((x) => x.id === d.g.id); if (!g) return;
      const mem = membership(lg, P, p.size);
      p.onGroupChange(g.id, { x: Math.round(g.x), y: Math.round(g.y), w: Math.round(g.w), h: Math.round(g.h), members: mem[g.id], auto: false });
      if (d.kind === "gmove") p.onMove(d.mem.map((m) => ({ id: m.k, x: P[m.k].x, y: P[m.k].y })));
      setGOverride((prev) => { const n = { ...prev }; delete n[g.id]; return n; });
    } else if (d.kind === "link") {
      if (d.to && p.onLink) p.onLink(d.from, d.to);
    } else if (d.kind === "origin") { p.onClickTile ? p.onClickTile("__origin") : p.onOpen(null); }
  };
  useEffect(() => { if (!drag) setOverride({}); }, [p.items, drag]);   // po zapisie serwer podaje nowe położenia
  useEffect(() => {
    if (!p.apiRef) return;
    p.apiRef.current = { positions: () => P, viewCenter: () => { const c = canvasRef.current; return c ? { x: (c.scrollLeft + c.clientWidth / 2) / zoom, y: (c.scrollTop + c.clientHeight / 2) / zoom } : { x: 300, y: 300 }; } };
  });

  // ---------- kanwa: ramka zaznaczenia, przesuwanie, strzałki ----------
  const onCanvasDown = (ev: React.PointerEvent) => {
    const c = canvasRef.current!;
    if (ev.button === 1) { ev.preventDefault(); c.setPointerCapture(ev.pointerId); setPanning(true); panRef.current = { x: ev.clientX, y: ev.clientY, l: c.scrollLeft, t: c.scrollTop }; return; }
    const t = ev.target as HTMLElement;
    const hit = ev.button === 0 && t.closest<HTMLElement>("[data-edge]");
    if (hit) { ev.preventDefault(); const [from, to] = hit.dataset.edge!.split(">"); p.onUnlink?.(from, to); return; }
    if (ev.button !== 0 || ev.pointerType === "touch" || t.closest(".node") || t.closest(".group")) return;
    if (!p.items.length) return;
    ev.preventDefault(); c.setPointerCapture(ev.pointerId);
    const q = worldPoint(ev), add = ev.shiftKey || ev.metaKey || ev.ctrlKey;
    const b = { x0: q.x, y0: q.y, x: q.x, y: q.y, base: add ? new Set(p.selected) : new Set<string>(), moved: false };
    bandRef.current = b; setBand(b);
  };
  const onCanvasMove = (ev: React.PointerEvent) => {
    const c = canvasRef.current!;
    if (panRef.current) { c.scrollLeft = panRef.current.l - (ev.clientX - panRef.current.x); c.scrollTop = panRef.current.t - (ev.clientY - panRef.current.y); return; }
    const b = bandRef.current; if (!b) return;
    const q = worldPoint(ev);
    if (!b.moved && Math.hypot(q.x - b.x0, q.y - b.y0) < 4) return;
    b.moved = true; b.x = q.x; b.y = q.y; setBand({ ...b });
    const x = Math.min(b.x0, b.x), y = Math.min(b.y0, b.y), w = Math.abs(b.x - b.x0), h = Math.abs(b.y - b.y0);
    const s = new Set(b.base);
    p.items.forEach((it) => { const r = P[it.id]; if (r && r.x < x + w && r.x + p.size.w > x && r.y < y + h && r.y + p.size.h > y) s.add(it.id); });
    p.onSelect(s);
  };
  const endBand = () => {
    if (panRef.current) { panRef.current = null; setPanning(false); return; }
    const b = bandRef.current; bandRef.current = null; setBand(null);
    if (!b) return;
    if (!b.moved) { p.onSelect(new Set()); p.onSelectGroup(null); p.onRename("", null); }
  };
  const onWheel = (ev: React.WheelEvent) => {
    const pinch = ev.ctrlKey || ev.metaKey;
    const mouse = ev.deltaMode !== 0 || (ev.deltaX === 0 && Math.abs(ev.deltaY) >= 40 && Number.isInteger(ev.deltaY));
    if (!pinch && !mouse) return;
    ev.preventDefault();
    const r = canvasRef.current!.getBoundingClientRect(), dy = ev.deltaMode === 1 ? ev.deltaY * 33 : ev.deltaY;
    setZoom(zoom * Math.exp(-dy * (pinch ? 0.01 : 0.0015)), ev.clientX - r.left, ev.clientY - r.top);
  };
  useEffect(() => { const c = canvasRef.current; if (!c) return; const h = (e: WheelEvent) => { if (e.ctrlKey || e.metaKey || e.deltaMode !== 0 || (e.deltaX === 0 && Math.abs(e.deltaY) >= 40)) e.preventDefault(); }; c.addEventListener("wheel", h, { passive: false }); return () => c.removeEventListener("wheel", h); }, []);

  const fit = () => {
    const c = canvasRef.current; if (!c) return;
    let mx = 0, my = 0;
    Object.values(P).forEach((q) => { mx = Math.max(mx, q.x + p.size.w); my = Math.max(my, q.y + p.size.h); });
    lg.forEach((g) => { mx = Math.max(mx, g.x + g.w); my = Math.max(my, g.y + g.h); });
    if (!mx) return;
    const panel = document.querySelector<HTMLElement>(".detail:not([hidden])");
    const avail = c.clientWidth - (panel ? panel.offsetWidth + 40 : 40);
    const z = clamp(Math.min(avail / (mx + 20), (c.clientHeight - 100) / (my + 20), 1.2), 0.35, 1.6);
    setZoomState(z); c.scrollTo(0, 0);
  };

  // ---------- strzałki ----------
  const edges: ReactNode[] = [];
  const H = p.size.h;
  const curve = (a: Pos, aw: number, ay: number, b: Pos, done: boolean, key: string | null) => {
    const x1 = a.x + aw, y1 = a.y + ay, x2 = b.x - 4, y2 = b.y + H / 2, k = Math.max(40, Math.abs(x2 - x1) / 2);
    const d = `M${x1} ${y1} C${x1 + k} ${y1}, ${x2 - k} ${y2}, ${x2} ${y2}`;
    if (!key) return <path key={"s" + b.x + b.y} className="edge start" markerEnd="url(#ah)" d={d} />;
    return <g key={key}><path className="edge-hit" data-edge={key} d={d}><title>Kliknij, aby usunąć to połączenie</title></path><path className={"edge" + (done ? " done" : "")} markerEnd={`url(#${done ? "ah-done" : "ah"})`} d={d} /></g>;
  };
  p.items.forEach((x) => {
    const deps = x.dependsOn.filter((k) => P[k]);
    if (layout.origin && !deps.length && P[x.id]) edges.push(curve(layout.origin, p.size.w, 58, P[x.id], false, null));
    deps.forEach((k) => edges.push(curve(P[k], p.size.w, H / 2, P[x.id], !!itemsDone.get(k), k + ">" + x.id)));
  });
  const temp = drag?.kind === "link" && P[drag.from] ? (() => { const a = P[drag.from]; const x1 = a.x + p.size.w, y1 = a.y + H / 2, k = Math.max(40, Math.abs(drag.p.x - x1) / 2); return <path className="edge temp" d={`M${x1} ${y1} C${x1 + k} ${y1}, ${drag.p.x - k} ${drag.p.y}, ${drag.p.x} ${drag.p.y}`} />; })() : null;
  const linkTarget = drag?.kind === "link" ? drag.to : null;
  const dropGroup = drag?.kind === "move" && drag.moved && P[drag.id] ? groupAt(lg, centerOf(P[drag.id], p.size))?.id ?? null : null;

  return (
    <div ref={canvasRef} className={"canvas" + (panning ? " panning" : "") + (drag?.kind === "link" ? " connecting" : "")} onPointerDown={onCanvasDown} onPointerMove={onCanvasMove} onPointerUp={endBand} onPointerCancel={endBand} onWheel={onWheel}>
      <div className="stage" style={{ width: Math.max(bb.w * zoom, 10), height: Math.max(bb.h * zoom, 10) }}>
        <div ref={worldRef} className="world" style={{ transform: `scale(${zoom})`, width: bb.w, height: bb.h }} onPointerDown={onWorldDown} onPointerMove={onWorldMove} onPointerUp={endDrag} onPointerCancel={endDrag}
          onDoubleClick={(ev) => { const n = (ev.target as HTMLElement).closest<HTMLElement>(".node"); if (!n) return; if (n.dataset.origin) p.onOpen(null); else if (n.dataset.id) p.onOpen(n.dataset.id); }}
          onKeyDown={(ev) => { if (ev.key !== "Enter" && ev.key !== " ") return; const n = (ev.target as HTMLElement).closest<HTMLElement>(".node"); if (!n) return; ev.preventDefault(); if (n.dataset.origin) p.onOpen(null); else if (n.dataset.id) p.onOpen(n.dataset.id); }}>
          {lg.map((g) => (
            <div key={g.id} className={"group" + (p.selectedGroup === g.id ? " on" : "") + (dropGroup === g.id ? " drop" : "")} data-group={g.id} style={{ left: g.x, top: g.y, width: g.w, height: g.h, ["--g" as string]: GCOL[g.color % GCOL.length] }}>
              <div className={"g-head" + (p.renaming === g.id ? " edit" : "")} data-ghead={g.id} title="Przeciągnij, aby przesunąć grupę z kafelkami · dwuklik zmienia nazwę" onDoubleClick={(e) => { e.stopPropagation(); p.onRename(g.id, g.name); }}>
                {p.renaming === g.id
                  ? <input className="g-input" defaultValue={g.name} aria-label="Nazwa grupy" autoFocus onFocus={(e) => e.currentTarget.select()}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); p.onGroupChange(g.id, { name: e.currentTarget.value.trim() || g.name }); p.onRename("", null); } else if (e.key === "Escape") { e.preventDefault(); p.onRename("", null); } }}
                      onBlur={(e) => { const v = e.currentTarget.value.trim(); if (v && v !== g.name) p.onGroupChange(g.id, { name: v }); p.onRename("", null); }} />
                  : <><span className="g-name">{g.name}</span><span className="g-count">{g.members.length}</span></>}
              </div>
              {["br", "tr", "bl"].map((c) => <div key={c} className={"g-rs " + c} data-gresize={g.id} data-corner={c} title="Przeciągnij, aby zmienić rozmiar grupy" />)}
            </div>
          ))}
          <svg aria-hidden="true" width={bb.w} height={bb.h}>
            <defs>
              <marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="var(--edge)" /></marker>
              <marker id="ah-done" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="var(--accent)" /></marker>
            </defs>
            {edges}{temp}
          </svg>
          {p.origin && layout.origin ? (
            <div className={"node origin " + p.origin.cls} style={{ left: layout.origin.x, top: layout.origin.y }} data-origin="1" tabIndex={0} role="button" aria-label="Szczegóły zadania">{p.origin.node}</div>
          ) : null}
          {p.items.map((it) => {
            const q = P[it.id]; if (!q) return null;
            return (
              <div key={it.id} className={"node " + it.cls + (p.selected.has(it.id) ? " picked" : "") + (drag?.kind === "move" && drag.moved && drag.group.some((g) => g.k === it.id) ? " dragging" : "") + (linkTarget === it.id ? " drop" : "")} style={{ left: q.x, top: q.y }} data-id={it.id} tabIndex={0} role="button" aria-label={it.aria}>
                {p.render(it.id)}
                {p.showPorts !== false && p.onLink ? <span className="port" data-port={it.id} title="Przeciągnij do kafelka, który ma być po tym" /> : null}
              </div>
            );
          })}
          {band?.moved ? <div className="marquee" style={{ left: Math.min(band.x0, band.x), top: Math.min(band.y0, band.y), width: Math.abs(band.x - band.x0), height: Math.abs(band.y - band.y0) }} /> : null}
        </div>
      </div>
      {p.empty}
      <div className="zoom glass gpill">
        <button className="icobtn" type="button" onClick={() => setZoom(zoom / 1.15)} aria-label="Oddal"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M3 8h10" /></svg></button>
        <span>{fmtPct(zoom)}</span>
        <button className="icobtn" type="button" onClick={() => setZoom(zoom * 1.15)} aria-label="Przybliż"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M3 8h10M8 3v10" /></svg></button>
        <button className="icobtn txt" type="button" onClick={fit}>Dopasuj</button>
        <button className="icobtn txt" type="button" onClick={p.onAutoLayout}>Ułóż</button>
      </div>
    </div>
  );
}
