"use client";
// Silnik kanwy (port z prototypu): kafelki, strzałki zależności, grupy, zaznaczanie ramką, przeciąganie, zoom kółkiem, przesuwanie środkowym przyciskiem.
// Rysuje tylko to, co dostanie; co znaczy kafelek i co robią akcje, decyduje rodzic (Board / TaskCanvas).
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { bounds, centerOf, computePositions, groupAt, reassign, type DropChange, type LGroup, type LItem, type Pos, type Size } from "@/lib/canvas/layout";
import { GCOL, Icon } from "./ui";

export type CanvasItem = LItem & { cls: string; done?: boolean; aria: string };
export type CanvasGroup = LGroup & { name: string; color: number };
export type CanvasApi = { positions: () => Record<string, Pos>; groupRects: () => Record<string, Rect>; viewCenter: () => Pos; centerOn: (id: string) => void };
type Rect = { x: number; y: number; w: number; h: number };
type Held = { k: string; ox: number; oy: number; base: Pos };   // ox/oy: skąd ciągniemy; base: położenie wg serwera w chwili chwycenia
const DBL_MS = 400;                                              // dwa kliknięcia w ten sam kafelek w tym czasie = dwuklik

type Drag =
  | { kind: "move"; id: string; sx: number; sy: number; group: Held[]; moved: boolean }
  | { kind: "gmove" | "gresize"; corner: string; g: CanvasGroup; base: Rect; sx: number; sy: number; ox: number; oy: number; ow: number; oh: number; mem: Held[]; moved: boolean }
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
  onOpen: (id: string | null) => void;          // dwuklik (liczony z pointerup, bo przechwycenie wskaźnika psuje zwykły dblclick) / Enter: null = kafelek zadania (origin)
  onClickTile?: (id: string) => void;            // pojedyncze kliknięcie (poziom kroków otwiera panel)
  onMenu?: (id: string | null, at: { x: number; y: number }) => void;   // prawy klik na kafelku: menu kafelka w miejscu kliknięcia (null = kafelek zadania)
  onMove: (items: { id: string; x: number; y: number }[]) => void;
  onLink?: (from: string, to: string) => void;
  onUnlink?: (from: string, to: string) => void;
  onGroupChange: (id: string, patch: Partial<CanvasGroup>) => void;
  onGroupCreate: (rect: { x: number; y: number; w: number; h: number }, members: string[]) => void;
  onAutoLayout: () => void;
  onUndoLayout?: (() => void) | null;                 // po „Ułóż” ten sam przycisk przez chwilę cofa do poprzedniego układu
  empty?: ReactNode;
  showPorts?: boolean;
};

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const fmtPct = (z: number) => Math.round(z * 100) + "%";

export function Canvas(p: CanvasProps) {
  const canvasRef = useRef<HTMLDivElement>(null), worldRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoomState] = useState(1);
  const [override, setOverride] = useState<Record<string, Pos>>({});      // położenia w trakcie przeciągania i po upuszczeniu, do czasu zapisu
  const [gOverride, setGOverride] = useState<Record<string, Partial<CanvasGroup>>>({});
  const dropped = useRef<Record<string, Pos>>({});                        // upuszczone kafelki: położenie wg serwera w chwili chwycenia
  const gDropped = useRef<Record<string, Rect>>({});                      // upuszczone/zmienione grupy: prostokąt wg serwera w chwili chwycenia
  const lastClick = useRef<{ id: string; t: number } | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const [band, setBand] = useState<{ x0: number; y0: number; x: number; y: number; base: Set<string>; moved: boolean } | null>(null);
  const bandRef = useRef<typeof band>(null);
  const panRef = useRef<{ x: number; y: number; l: number; t: number } | null>(null);
  const [panning, setPanning] = useState(false);

  useEffect(() => { try { const z = Number(localStorage.getItem("th-zoom-" + p.zoomKey)); if (z) setZoomState(clamp(z, 0.35, 1.6)); } catch { /* brak storage */ } }, [p.zoomKey]);

  // Margines dookoła świata równy widocznej kanwie: widok da się przesunąć w każdą stronę, aż treść dotknie przeciwległej krawędzi
  // (a więc i wyśrodkować dowolny kafelek). Na starcie treść leży w lewym górnym rogu, jak dotąd.
  const [pad, setPad] = useState({ x: 0, y: 0 });
  const padRef = useRef(pad);
  useLayoutEffect(() => {
    const c = canvasRef.current; if (!c) return;
    const set = () => {
      const n = { x: c.clientWidth, y: c.clientHeight }, o = padRef.current;
      if (n.x === o.x && n.y === o.y) return;
      padRef.current = n; setPad(n);
      requestAnimationFrame(() => { c.scrollLeft += n.x - o.x; c.scrollTop += n.y - o.y; });   // po przerysowaniu sceny: widok zostaje w miejscu
    };
    set();
    const ro = new ResizeObserver(set); ro.observe(c);
    return () => ro.disconnect();
  }, []);

  // zmiana powiększenia: punkt pod kursorem (albo środek) zostaje w miejscu; przewinięcie liczymy po przerysowaniu sceny, nie przed
  const anchor = useRef<{ wx: number; wy: number; px: number; py: number } | null>(null);
  const setZoom = useCallback((nz: number, cx?: number, cy?: number) => {
    const c = canvasRef.current; if (!c) return;
    nz = clamp(nz, 0.35, 1.6);
    const px = cx ?? c.clientWidth / 2, py = cy ?? c.clientHeight / 2, pd = padRef.current;
    setZoomState((z) => { anchor.current = { wx: (c.scrollLeft + px - pd.x) / z, wy: (c.scrollTop + py - pd.y) / z, px, py }; return nz; });
    try { localStorage.setItem("th-zoom-" + p.zoomKey, String(nz)); } catch { /* brak storage */ }
  }, [p.zoomKey]);
  useLayoutEffect(() => {
    const a = anchor.current, c = canvasRef.current; if (!a || !c) return;
    anchor.current = null; const pd = padRef.current;
    c.scrollLeft = a.wx * zoom + pd.x - a.px; c.scrollTop = a.wy * zoom + pd.y - a.py;
  }, [zoom]);
  // pole z procentami: wpisanie liczby ustawia powiększenie (35–160)
  const [zEdit, setZEdit] = useState<string | null>(null);
  const zCancel = useRef(false), zFocus = useRef(0);
  const commitZoom = (v: string) => { const n = parseInt(v, 10); if (Number.isFinite(n) && n > 0) setZoom(n / 100); setZEdit(null); };

  const groups = useMemo(() => p.groups.map((g) => ({ ...g, ...(gOverride[g.id] ?? {}) })), [p.groups, gOverride]);
  const sLayout = useMemo(() => computePositions(p.items, p.groups, p.size, !!p.origin), [p.items, p.groups, p.size, p.origin]);   // układ wg serwera, bez przeciągania
  const layout = useMemo(() => (Object.keys(gOverride).length ? computePositions(p.items, groups, p.size, !!p.origin) : sLayout), [p.items, groups, p.size, p.origin, gOverride, sLayout]);
  const P = useMemo(() => ({ ...layout.P, ...override }), [layout.P, override]);
  const lg = useMemo(() => layout.groups.map((g) => ({ ...(p.groups.find((x) => x.id === g.id) ?? ({} as CanvasGroup)), ...g, ...(gOverride[g.id] ?? {}) })) as CanvasGroup[], [layout.groups, p.groups, gOverride]);
  const bb = bounds(P, lg, p.size, layout.origin);

  const worldPoint = (ev: { clientX: number; clientY: number }): Pos => {
    const r = worldRef.current!.getBoundingClientRect();
    return { x: (ev.clientX - r.left) / zoom, y: (ev.clientY - r.top) / zoom };
  };
  const itemsDone = useMemo(() => new Map(p.items.map((x) => [x.id, !!x.done])), [p.items]);

  // ---------- przeciąganie kafelków, grup, strzałek ----------
  const hold = (k: string): Held => ({ k, ox: P[k].x, oy: P[k].y, base: dropped.current[k] ?? sLayout.P[k] });
  // drugie kliknięcie w to samo w ciągu DBL_MS = dwuklik (zwykłe zdarzenie dblclick trafia w .world przez przechwycenie wskaźnika)
  const isDouble = (id: string) => {
    const now = Date.now(), prev = lastClick.current;
    if (prev && prev.id === id && now - prev.t < DBL_MS) { lastClick.current = null; return true; }
    lastClick.current = { id, t: now }; return false;
  };
  const onWorldDown = (ev: React.PointerEvent) => {
    if (ev.button !== 0) return;
    const t = ev.target as HTMLElement;
    if (t.closest(".g-input")) { ev.stopPropagation(); return; }
    const gh = t.closest<HTMLElement>("[data-ghead],[data-gresize]");
    if (gh) {
      ev.preventDefault(); ev.stopPropagation(); (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
      const g = lg.find((x) => x.id === (gh.dataset.ghead || gh.dataset.gresize)); if (!g) return;
      const mem = g.members.filter((k) => P[k]).map((k) => hold(k));
      const sg = sLayout.groups.find((x) => x.id === g.id), base = gDropped.current[g.id] ?? (sg ? { x: sg.x, y: sg.y, w: sg.w, h: sg.h } : { x: g.x, y: g.y, w: g.w, h: g.h });
      const d: Drag = { kind: gh.dataset.ghead ? "gmove" : "gresize", corner: gh.dataset.corner || "br", g, base, sx: ev.clientX, sy: ev.clientY, ox: g.x, oy: g.y, ow: g.w, oh: g.h, mem, moved: false };
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
    const d: Drag = { kind: "move", id, sx: ev.clientX, sy: ev.clientY, group: keys.map(hold), moved: false };
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
  // Po upuszczeniu zmienia się skład tylko tam, gdzie coś przeciągnięto (patrz reassign); zapisujemy każdą grupę, której skład się zmienił,
  // oraz przesuniętą/rozciągniętą. Z prostokątem, bo grupa automatyczna ma zostać tam, gdzie jest narysowana.
  const syncMembers = (change: DropChange) => {
    const mem = reassign(lg, P, p.size, change);
    lg.forEach((g) => {
      const next = mem[g.id], cur = g.members;
      if ((change.kind === "group" && g.id === change.id) || next.length !== cur.length || next.some((k) => !cur.includes(k))) p.onGroupChange(g.id, { x: Math.round(g.x), y: Math.round(g.y), w: Math.round(g.w), h: Math.round(g.h), members: next, auto: false });
    });
  };
  const endDrag = () => {
    const d = dragRef.current; dragRef.current = null; setDrag(null);
    if (!d) return;
    if (d.kind === "move") {
      if (!d.moved) {
        if (isDouble(d.id)) { p.onOpen(d.id); return; }
        if (p.onClickTile) p.onClickTile(d.id); else p.onSelect(new Set([d.id]));
        p.onSelectGroup(null); return;
      }
      // kafelki zostają w nowym miejscu (override) aż serwer przyśle zapisane położenia; patrz efekt niżej
      d.group.forEach((g) => { dropped.current[g.k] = g.base; });
      const moved = d.group.map((g) => ({ id: g.k, x: P[g.k].x, y: P[g.k].y }));
      p.onMove(moved);
      syncMembers({ kind: "tiles", ids: d.group.map((g) => g.k) });
    } else if (d.kind === "gmove" || d.kind === "gresize") {
      if (!d.moved) { if (d.kind === "gmove" && isDouble("g:" + d.g.id)) p.onRename(d.g.id, d.g.name); return; }
      const g = lg.find((x) => x.id === d.g.id); if (!g) return;
      gDropped.current[g.id] = d.base;
      if (d.kind === "gmove") d.mem.forEach((m) => { dropped.current[m.k] = m.base; });
      syncMembers({ kind: "group", id: g.id, resized: d.kind === "gresize" });
      if (d.kind === "gmove") p.onMove(d.mem.map((m) => ({ id: m.k, x: P[m.k].x, y: P[m.k].y })));
    } else if (d.kind === "link") {
      if (d.to && p.onLink) p.onLink(d.from, d.to);
    } else if (d.kind === "origin") {
      if (isDouble("__origin")) p.onOpen(null);
      else if (p.onClickTile) p.onClickTile("__origin"); else p.onOpen(null);
    }
  };
  // Po upuszczeniu kafelek (grupa) zostaje tam, gdzie go położono, dopóki serwer nie przyśle innego położenia niż w chwili chwycenia:
  // wtedy zapis dotarł (albo „Ułóż” je skasował) i wracamy do położeń z serwera. Bez tego kafelek skakał na stare miejsce zaraz po upuszczeniu.
  useEffect(() => {
    const same = (a: Pos | undefined, b: Pos) => !!a && Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5;
    const stale = Object.keys(dropped.current).filter((k) => !same(sLayout.P[k], dropped.current[k]));
    if (stale.length) { stale.forEach((k) => delete dropped.current[k]); setOverride((prev) => { const n = { ...prev }; stale.forEach((k) => delete n[k]); return n; }); }
    const gStale = Object.keys(gDropped.current).filter((id) => { const g = sLayout.groups.find((x) => x.id === id), b = gDropped.current[id]; return !g || !same(g, b) || Math.abs(g.w - b.w) >= 0.5 || Math.abs(g.h - b.h) >= 0.5; });
    if (gStale.length) { gStale.forEach((id) => delete gDropped.current[id]); setGOverride((prev) => { const n = { ...prev }; gStale.forEach((id) => delete n[id]); return n; }); }
  }, [sLayout]);
  useEffect(() => {
    if (!p.apiRef) return;
    p.apiRef.current = {
      positions: () => P,
      groupRects: () => Object.fromEntries(lg.map((g) => [g.id, { x: g.x, y: g.y, w: g.w, h: g.h }])),
      viewCenter: () => { const c = canvasRef.current, pd = padRef.current; return c ? { x: (c.scrollLeft + c.clientWidth / 2 - pd.x) / zoom, y: (c.scrollTop + c.clientHeight / 2 - pd.y) / zoom } : { x: 300, y: 300 }; },
      // środek widoku na kafelku (margines wokół świata pozwala wyśrodkować każdy, także skrajny)
      centerOn: (id) => { const c = canvasRef.current, q = P[id], pd = padRef.current; if (!c || !q) return; c.scrollTo({ left: (q.x + p.size.w / 2) * zoom + pd.x - c.clientWidth / 2, top: (q.y + p.size.h / 2) * zoom + pd.y - c.clientHeight / 2, behavior: "smooth" }); },
    };
  });

  // ---------- kanwa: ramka zaznaczenia, przesuwanie, strzałki ----------
  const onCanvasDown = (ev: React.PointerEvent) => {
    const c = canvasRef.current!;
    if (ev.button === 1) { ev.preventDefault(); c.setPointerCapture(ev.pointerId); setPanning(true); panRef.current = { x: ev.clientX, y: ev.clientY, l: c.scrollLeft, t: c.scrollTop }; return; }
    const t = ev.target as HTMLElement;
    if (t.closest("button, input, a, .zoom")) return;   // przyciski na kanwie (zoom, Dopasuj, Ułóż): bez przechwycenia wskaźnika, inaczej ich klik trafia w kanwę
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
    if (!pinch && !mouse) return;   // preventDefault robi natywny nasłuch niżej (React podpina wheel jako pasywny)
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
    setZoomState(z); c.scrollTo(padRef.current.x, padRef.current.y);
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
      <div className="stage" style={{ width: Math.max(bb.w * zoom, 10) + 2 * pad.x, height: Math.max(bb.h * zoom, 10) + 2 * pad.y }}>
        <div ref={worldRef} className="world" style={{ transform: `scale(${zoom})`, width: bb.w, height: bb.h, left: pad.x, top: pad.y }} onPointerDown={onWorldDown} onPointerMove={onWorldMove} onPointerUp={endDrag} onPointerCancel={endDrag}
          onContextMenu={(ev) => { const n = (ev.target as HTMLElement).closest<HTMLElement>(".node"); if (!n) return; ev.preventDefault(); if (p.onMenu) p.onMenu(n.dataset.origin ? null : n.dataset.id ?? null, { x: ev.clientX, y: ev.clientY }); }}   /* prawy klik na kafelku: własne menu zamiast menu przeglądarki („Wczytaj ponownie” w aplikacji na Maca) */
          onKeyDown={(ev) => { if (ev.key !== "Enter" && ev.key !== " ") return; const n = (ev.target as HTMLElement).closest<HTMLElement>(".node"); if (!n) return; ev.preventDefault(); if (n.dataset.origin) p.onOpen(null); else if (n.dataset.id) p.onOpen(n.dataset.id); }}>
          {lg.map((g) => (
            <div key={g.id} className={"group" + (p.selectedGroup === g.id ? " on" : "") + (dropGroup === g.id ? " drop" : "")} data-group={g.id} style={{ left: g.x, top: g.y, width: g.w, height: g.h, ["--g" as string]: GCOL[g.color % GCOL.length] }}>
              <div className={"g-head" + (p.renaming === g.id ? " edit" : "")} data-ghead={g.id} title="Przeciągnij, aby przesunąć grupę z kafelkami · dwuklik zmienia nazwę">
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
        <input value={zEdit ?? fmtPct(zoom)} inputMode="numeric" aria-label="Powiększenie w procentach (35–160)" title="Wpisz powiększenie w procentach (35–160)"
          onFocus={(e) => { zFocus.current = Date.now(); e.currentTarget.select(); }} onMouseUp={(e) => { if (Date.now() - zFocus.current < 400) e.preventDefault(); }}   /* klik zaznacza całość; mouseup nie cofa zaznaczenia */
          onChange={(e) => setZEdit(e.currentTarget.value.replace(/\D/g, "").slice(0, 3))}
          onBlur={(e) => { if (zCancel.current) { zCancel.current = false; setZEdit(null); return; } commitZoom(e.currentTarget.value); }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } else if (e.key === "Escape") { e.preventDefault(); zCancel.current = true; e.currentTarget.blur(); } }} />
        <button className="icobtn" type="button" onClick={() => setZoom(zoom * 1.15)} aria-label="Przybliż"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M3 8h10M8 3v10" /></svg></button>
        <button className="icobtn txt" type="button" onClick={fit}>Dopasuj</button>
        {p.onUndoLayout ? <button className="icobtn txt undo" type="button" onClick={p.onUndoLayout} title="Przywróć układ sprzed ułożenia"><Icon k="undo" size={12} sw={2} />Cofnij</button>
          : <button className="icobtn txt" type="button" onClick={p.onAutoLayout} title="Ułóż kafelki automatycznie">Ułóż</button>}
      </div>
    </div>
  );
}
