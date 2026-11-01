// Układ kanwy (port z prototypu): elementy bez zależności w kolumnie 0, zależne w kolejnych; równoległe jeden pod drugim.
// Kafelek z zapisanym położeniem zostaje, nowy nigdy nie ląduje na innym ani w cudzej grupie.
import { LANES } from "./lanes";

export type Pos = { x: number; y: number };
export type LItem = { id: string; dependsOn: string[]; pos: Pos | null };
export type LGroup = { id: string; x: number; y: number; w: number; h: number; members: string[]; auto: boolean; lane?: string | null };
export type Size = { w: number; h: number };

export const TASK_SIZE: Size = { w: 260, h: 172 };
export const STEP_SIZE: Size = { w: 236, h: 116 };
export const GX = 72, GY = 24, OX = 40, OY = 132, GPAD = 16, GHEAD = 40, GGAP = 40;

export function gridFor(list: LItem[], shift: number) {
  const ids = new Set(list.map((x) => x.id)), map = Object.fromEntries(list.map((x) => [x.id, x]));
  const depth: Record<string, number> = {};
  const d = (x: LItem, seen = new Set<string>()): number => {
    if (depth[x.id] != null) return depth[x.id];
    if (seen.has(x.id)) return 0; seen.add(x.id);
    const deps = x.dependsOn.filter((k) => ids.has(k)).map((k) => map[k]);
    return (depth[x.id] = deps.length ? 1 + Math.max(...deps.map((y) => d(y, seen))) : 0);
  };
  list.forEach((x) => d(x));
  const order = list.map((x, i) => ({ x, i })).sort((a, b) => depth[a.x.id] - depth[b.x.id] || a.i - b.i);
  const occ: Record<number, Set<number>> = {}, grid: Record<string, { c: number; r: number }> = {};
  const take = (c: number, r: number) => { occ[c] = occ[c] || new Set(); while (occ[c].has(r)) r++; occ[c].add(r); return r; };
  if (shift) take(0, 0);
  for (const { x } of order) {
    const c = depth[x.id] + shift, first = x.dependsOn.find((k) => grid[k]);
    grid[x.id] = { c, r: take(c, first ? grid[first].r : 0) };
  }
  return { grid, depth };
}

export type Layout = { P: Record<string, Pos>; origin: Pos | null; groups: LGroup[] };

// shift = true na kanwie kroków (kolumna 0 zajmuje kafelek zadania)
export function computePositions(list: LItem[], groupsIn: LGroup[], size: Size, shift: boolean): Layout {
  const H = size.h, Wn = size.w, sh = shift ? 1 : 0;
  const ids = new Set(list.map((x) => x.id)), memberOf: Record<string, LGroup> = {};
  const groups = groupsIn.map((g) => ({ ...g, members: g.members.filter((id) => ids.has(id)) }));
  groups.forEach((g) => { g.members = g.members.filter((id) => !memberOf[id]); g.members.forEach((id) => (memberOf[id] = g)); });
  const free = list.filter((x) => !memberOf[x.id]), fg = gridFor(free, sh).grid;
  const P: Record<string, Pos> = {};
  const origin = shift ? { x: OX, y: OY } : null;
  let bottom = shift ? OY + H : OY - GGAP;
  // pola „Pilne i szybkie” po „Ułóż” (paczka 31, wariant C): macierz 2×2 w lewym górnym rogu; wolne kafelki i reszta grup pod nią
  const lanes = shift ? [] : groups.filter((g) => g.lane && g.auto && laneIndex(g.lane) >= 0);
  if (lanes.length) {
    const cells: string[][] = [[], [], [], []];
    lanes.forEach((g) => { cells[laneIndex(g.lane!)] = g.members; });
    const box = laneMatrix(cells, size);
    lanes.forEach((g) => { const i = laneIndex(g.lane!); Object.assign(g, box.cells[i]); for (const [id, q] of Object.entries(box.P[i])) P[id] = q; });
    bottom = OY + box.h;
    const per = Math.max(1, Math.floor((box.w + GX) / (Wn + GX)));
    free.forEach((x, i) => { fg[x.id] = { c: i % per, r: Math.floor(i / per) }; });
  }
  const fy = lanes.length ? bottom + GGAP : OY;
  const hasPos = (x: LItem) => !!x.pos && Number.isFinite(x.pos.x);
  const occ = list.filter(hasPos).map((x) => ({ x: x.pos!.x, y: x.pos!.y, w: Wn, h: H }));
  groups.forEach((g) => { if (!g.auto) occ.push({ x: g.x, y: g.y, w: g.w, h: g.h }); });
  const hit = (r: Pos) => occ.some((o) => r.x < o.x + o.w && r.x + Wn > o.x && r.y < o.y + o.h && r.y + H > o.y);
  const place = (x: LItem, g: { c: number; r: number }, x0: number, y0: number, avoid: boolean) => {
    if (hasPos(x)) P[x.id] = { x: x.pos!.x, y: x.pos!.y };
    else {
      const r = { x: x0 + g.c * (Wn + GX), y: y0 + g.r * (H + GY) };
      if (avoid) { while (hit(r)) r.y += H + GY; occ.push({ ...r, w: Wn, h: H }); }
      P[x.id] = r;
    }
    bottom = Math.max(bottom, P[x.id].y + H);
  };
  free.forEach((x) => place(x, fg[x.id], OX, fy, true));
  groups.forEach((g) => {
    if (lanes.includes(g)) return;
    const mem = list.filter((x) => memberOf[x.id] === g);
    if (mem.length) {
      // grupa automatyczna: blok pod wolnymi kafelkami; narysowana ręcznie: nowe kafelki wewnątrz jej prostokąta
      const gg = gridFor(mem, 0).grid, x0 = g.auto ? OX + sh * (Wn + GX) + GPAD : g.x + GPAD, y0 = g.auto ? bottom + GGAP + GHEAD + GPAD : g.y + GHEAD + GPAD;
      mem.forEach((x) => place(x, gg[x.id], x0, y0, false));
      if (g.auto) {
        const xs = mem.map((x) => P[x.id]);
        g.x = Math.min(...xs.map((q) => q.x)) - GPAD; g.y = Math.min(...xs.map((q) => q.y)) - GPAD - GHEAD;
        g.w = Math.max(...xs.map((q) => q.x)) + Wn + GPAD - g.x; g.h = Math.max(...xs.map((q) => q.y)) + H + GPAD - g.y;
      }
    } else if (g.auto || !g.w || !g.h) {
      // pusta grupa automatyczna (albo z zerowym prostokątem): widoczny, pusty prostokąt pod resztą, zamiast punktu 0×0
      g.x = OX + sh * (Wn + GX); g.y = bottom + GGAP; g.w = Wn + 2 * GPAD + 100; g.h = H + GHEAD + 2 * GPAD;
    }
    bottom = Math.max(bottom + GPAD, g.y + g.h);
  });
  return { P, origin, groups };
}

// Macierz pól (wariant C): kolejność pól od lewej do prawej, od góry do dołu (0 1 / 2 3). Liczba kolumn kafelków w polu dobrana tak,
// żeby całość miała proporcje szerokiego ekranu (ok. 1,9 : 1) i mieściła się w jak największym powiększeniu. Puste pole zostaje na swoim miejscu.
export const LANE_ASPECT = 1.9, LANE_GAP = 36, LANE_GX = 28;
const laneIndex = (k: string) => LANES.findIndex((l) => l.key === k);
export function laneMatrix(cells: string[][], size: Size) {
  const Wn = size.w, H = size.h, n = (i: number) => cells[i]?.length ?? 0;
  const make = (q: number) => {
    const cw = [Math.max(1, Math.min(q, Math.max(n(0), n(2)))), Math.max(1, Math.min(q, Math.max(n(1), n(3))))];
    const colW = cw.map((c) => c * Wn + (c - 1) * LANE_GX + 2 * GPAD);
    const rows = (i: number) => Math.max(1, Math.ceil(n(i) / cw[i % 2]));
    const rowH = [Math.max(rows(0), rows(1)), Math.max(rows(2), rows(3))].map((r) => GHEAD + GPAD + r * H + (r - 1) * GY + GPAD);
    const w = colW[0] + LANE_GAP + colW[1], h = rowH[0] + LANE_GAP + rowH[1];
    return { cw, colW, rowH, w, h, fit: Math.min(LANE_ASPECT / w, 1 / h) };
  };
  let m = make(1);
  for (let q = 2; q <= 5; q++) { const c = make(q); if (c.fit > m.fit + 1e-9) m = c; }
  const out: { cells: { x: number; y: number; w: number; h: number }[]; P: Record<string, Pos>[]; w: number; h: number } = { cells: [], P: [], w: m.w, h: m.h };
  for (let i = 0; i < 4; i++) {
    const col = i % 2, row = Math.floor(i / 2), x = OX + (col ? m.colW[0] + LANE_GAP : 0), y = OY + (row ? m.rowH[0] + LANE_GAP : 0);
    out.cells.push({ x, y, w: m.colW[col], h: m.rowH[row] });
    out.P.push(Object.fromEntries((cells[i] ?? []).map((id, j) => [id, { x: x + GPAD + (j % m.cw[col]) * (Wn + LANE_GX), y: y + GHEAD + GPAD + Math.floor(j / m.cw[col]) * (H + GY) }])));
  }
  return out;
}

export const inRect = (g: { x: number; y: number; w: number; h: number }, p: Pos) => p.x >= g.x && p.x <= g.x + g.w && p.y >= g.y && p.y <= g.y + g.h;
export const centerOf = (p: Pos, size: Size): Pos => ({ x: p.x + size.w / 2, y: p.y + size.h / 2 });
// najmniejsza grupa, w której leży punkt
export function groupAt(groups: LGroup[], p: Pos, skip?: string): LGroup | null {
  return groups.filter((g) => g.id !== skip && inRect(g, p)).sort((a, b) => a.w * a.h - b.w * b.h)[0] ?? null;
}
// przynależność po przeciągnięciu: środek kafelka w prostokącie
export function membership(groups: LGroup[], P: Record<string, Pos>, size: Size): Record<string, string[]> {
  const out: Record<string, string[]> = Object.fromEntries(groups.map((g) => [g.id, [] as string[]]));
  for (const [id, p] of Object.entries(P)) { const g = groupAt(groups, centerOf(p, size)); if (g) out[g.id].push(id); }
  return out;
}
// Skład grup po upuszczeniu: zmienia się tylko to, co przeciągnięto. Upuszczony kafelek trafia do najmniejszej grupy pod swoim środkiem
// (albo wychodzi z grupy); przesunięta grupa zabiera swoje kafelki i wolne kafelki pod prostokątem; rozciągnięta dodatkowo gubi te, które wypadły.
// Reszta zostaje w swoich grupach, nawet gdy prostokąty na siebie nachodzą.
export type DropChange = { kind: "tiles"; ids: string[] } | { kind: "group"; id: string; resized: boolean };
export function reassign(groups: LGroup[], P: Record<string, Pos>, size: Size, change: DropChange): Record<string, string[]> {
  const owner: Record<string, string | null> = {};
  for (const id of Object.keys(P)) owner[id] = null;
  groups.forEach((g) => g.members.forEach((id) => { if (id in owner && owner[id] == null) owner[id] = g.id; }));
  if (change.kind === "tiles") {
    for (const id of change.ids) if (P[id]) owner[id] = groupAt(groups, centerOf(P[id], size))?.id ?? null;
  } else {
    const g = groups.find((x) => x.id === change.id);
    if (g) for (const id of Object.keys(P)) {
      const inside = inRect(g, centerOf(P[id], size));
      if (owner[id] == null && inside) owner[id] = g.id;
      else if (change.resized && owner[id] === g.id && !inside) owner[id] = null;
    }
  }
  const out: Record<string, string[]> = Object.fromEntries(groups.map((g) => [g.id, [] as string[]]));
  groups.forEach((g) => g.members.forEach((id) => { if (owner[id] === g.id) out[g.id].push(id); }));   // dotychczasowa kolejność
  for (const [id, gid] of Object.entries(owner)) if (gid && !out[gid].includes(id)) out[gid].push(id);
  return out;
}
// Świat kanwy: od (x0, y0) do (w, h). Góra i lewa działają jak dół i prawa: kafelek odsunięty ponad pierwszy (albo w lewo) poszerza świat w tę stronę z zapasem.
export const MARGIN = { left: OX, top: OY, right: 420, bottom: 160 };
export function bounds(P: Record<string, Pos>, groups: LGroup[], size: Size, origin: Pos | null) {
  let mx = 0, my = 0, nx = Infinity, ny = Infinity;
  const add = (x: number, y: number, w: number, h: number) => { mx = Math.max(mx, x + w); my = Math.max(my, y + h); nx = Math.min(nx, x); ny = Math.min(ny, y); };
  Object.values(P).forEach((p) => add(p.x, p.y, size.w, size.h));
  if (origin) add(origin.x, origin.y, size.w, size.h);
  groups.forEach((g) => add(g.x, g.y, g.w, g.h));
  return { x0: Math.min(0, nx - MARGIN.left), y0: Math.min(0, ny - MARGIN.top), w: mx + MARGIN.right, h: my + MARGIN.bottom };
}

// Linie między kafelkami (paczka 33): zawsze spline, bez łamanych z narożnikami. Linia wychodzi poziomo z prawego boku kafelka A
// i wchodzi poziomo w lewy bok B; w każdej kolumnie kafelków po drodze biegnie poziomo wolnym pasem między kafelkami (tor), a między
// kolumnami łączą ją łuki z poziomymi stycznymi. Wyjścia i wejścia na boku kafelka są rozłożone po wysokości drugiego końca,
// żeby linie nie krzyżowały się przy kafelku. Port z prototypu „Naturalny układ kroków” (notatki/prototypy/2026-10-31-…).
export type Rect = { x: number; y: number; w: number; h: number };
export type EdgeIn = { a: Rect; b: Rect; ay?: number };   // ay = stała wysokość wyjścia (kafelek zadania: 58), inaczej środek boku
const r1 = (v: number) => Math.round(v * 10) / 10;
export function splineD(pts: [number, number][]): string {
  let d = `M${r1(pts[0][0])} ${r1(pts[0][1])}`;
  for (let i = 1; i < pts.length; i++) {
    const [x1, y1] = pts[i - 1], [x2, y2] = pts[i];
    if (Math.abs(y2 - y1) < 0.5 && x2 >= x1) { d += ` L${r1(x2)} ${r1(y2)}`; continue; }
    // linia wstecz (kafelek przeciągnięty w lewo od poprzednika): jeden szerszy łuk, jak przy przeciąganiu połączenia
    const k = x2 >= x1 ? Math.max(18, (x2 - x1) * 0.5) : Math.max(40, (x1 - x2) / 2);
    d += ` C${r1(x1 + k)} ${r1(y1)}, ${r1(x2 - k)} ${r1(y2)}, ${r1(x2)} ${r1(y2)}`;
  }
  return d;
}
// kolumny = kafelki, których zakresy w poziomie na siebie zachodzą (po przeciągnięciu kolumny nie muszą być równe)
function columnsOf(tiles: Rect[]) {
  const cols: { x0: number; x1: number; tiles: Rect[] }[] = [];
  [...tiles].sort((a, b) => a.x - b.x).forEach((t) => {
    const c = cols[cols.length - 1];
    if (c && t.x < c.x1 - 1) { c.x1 = Math.max(c.x1, t.x + t.w); c.tiles.push(t); } else cols.push({ x0: t.x, x1: t.x + t.w, tiles: [t] });
  });
  return cols;
}
const same = (a: Rect, b: Rect) => a.x === b.x && a.y === b.y;
export function routeEdges(E: EdgeIn[], tiles: Rect[]): string[] {
  const cols = columnsOf(tiles), used: number[][] = cols.map(() => []);
  const freeY = (ci: number, want: number, skip: Rect[]) => {
    const blocks = cols[ci].tiles.filter((t) => !skip.some((s) => same(s, t))).map((p) => [p.y - 8, p.y + p.h + 8]);
    used[ci].forEach((v) => blocks.push([v - 7, v + 7]));
    const ok = (v: number) => !blocks.some(([a, b]) => v > a && v < b);
    if (ok(want)) return want;
    return blocks.flatMap(([a, b]) => [a - 0.1, b + 0.1]).filter(ok).sort((a, b) => Math.abs(a - want) - Math.abs(b - want))[0] ?? want;
  };
  const mids = E.map(({ a, b, ay }) => {
    const out: [number, number][] = [], x1 = a.x + a.w, x2 = b.x - 4;
    const y1 = a.y + (ay ?? a.h / 2), y2 = b.y + b.h / 2;
    cols.forEach((c, ci) => {
      if (c.x0 < x1 - 2 || c.x1 > x2 + 6 || c.tiles.some((t) => same(t, a) || same(t, b))) return;
      const t = ((c.x0 + c.x1) / 2 - x1) / Math.max(1, x2 - x1), v = freeY(ci, y1 + (y2 - y1) * t, [a, b]);
      used[ci].push(v); out.push([c.x0 - 4, v], [c.x1 + 4, v]);
    });
    return out;
  });
  // rozłożenie wyjść i wejść na boku kafelka: kolejność po wysokości drugiego końca
  const ys: number[] = [], ye: number[] = [];
  const spread = (list: number[], key: (i: number) => number, center: number, half: number, into: number[]) => {
    list.sort((i, j) => key(i) - key(j));
    const n = list.length, step = Math.min(12, n > 1 ? (2 * half) / (n - 1) : 0);
    list.forEach((i, j) => (into[i] = center + (j - (n - 1) / 2) * step));
  };
  const outs = new Map<string, number[]>(), ins = new Map<string, number[]>();
  const k = (r: Rect) => r.x + "," + r.y;
  E.forEach((e, i) => { outs.set(k(e.a), [...(outs.get(k(e.a)) ?? []), i]); ins.set(k(e.b), [...(ins.get(k(e.b)) ?? []), i]); });
  for (const list of outs.values()) { const e = E[list[0]]; spread(list, (i) => (mids[i].length ? mids[i][0][1] : E[i].b.y + E[i].b.h / 2), e.a.y + (e.ay ?? e.a.h / 2), e.ay != null ? 30 : e.a.h / 2 - 18, ys); }
  for (const list of ins.values()) { const e = E[list[0]]; spread(list, (i) => (mids[i].length ? mids[i][mids[i].length - 1][1] : ys[i]), e.b.y + e.b.h / 2, e.b.h / 2 - 18, ye); }
  return E.map((e, i) => splineD([[e.a.x + e.a.w, ys[i]], ...mids[i], [e.b.x - 4, ye[i]]]));
}

// Naturalny układ kroków (paczka 33, decyzja Piotra: wariant C „Wątki w rzędach”), drugie „Ułóż” na kanwie zadania.
// Kolumna = głębokość jak w siatce. Krok z jednym poprzednikiem, który jest jego pierwszym następcą, idzie dalej w rzędzie poprzednika
// (wątek); każdy inny start albo odgałęzienie zaczyna nowy rząd. Krok łączący kilka wątków stoi w połowie wysokości między poprzednikami,
// na wolnym miejscu w swojej kolumnie, a jego następcy ciągną się w jego rzędzie. Kafelek zadania zostaje w (OX, OY), na wysokości
// pierwszego rzędu (w prototypie stał na środku startów, ale wtedy górne kroki wchodziły pod pasek u góry ekranu).
export const NGX = 80, NGY = 28;
export function naturalLayout(list: LItem[], size: Size): Record<string, Pos> {
  const W = size.w, H = size.h, ids = new Set(list.map((x) => x.id)), by = new Map(list.map((x) => [x.id, x]));
  const deps = (x: LItem) => x.dependsOn.filter((k) => ids.has(k) && k !== x.id);
  const children: Record<string, string[]> = {};
  list.forEach((s) => deps(s).forEach((k) => (children[k] = children[k] || []).push(s.id)));
  const L: Record<string, number> = {};
  const dep = (x: LItem, seen = new Set<string>()): number => {
    if (L[x.id] != null) return L[x.id];
    if (seen.has(x.id)) return 1; seen.add(x.id);
    const ds = deps(x).map((k) => by.get(k)!);
    return (L[x.id] = ds.length ? 1 + Math.max(...ds.map((y) => dep(y, seen))) : 1);
  };
  list.forEach((x) => dep(x));
  const colX = (id: string) => OX + L[id] * (W + NGX);
  const band: Record<string, number> = {}, bands: string[][] = [], rest: string[] = [];
  list.forEach((s) => {
    const ds = deps(s);
    if (ds.length === 1 && band[ds[0]] != null && children[ds[0]][0] === s.id && L[s.id] > L[ds[0]]) { band[s.id] = band[ds[0]]; bands[band[s.id]].push(s.id); }
    else if (!ds.length || (ds.length === 1 && band[ds[0]] != null)) { band[s.id] = bands.length; bands.push([s.id]); }   // start albo odgałęzienie: nowy rząd
    else rest.push(s.id);
  });
  const P: Record<string, Pos> = {};
  bands.forEach((b, i) => b.forEach((id) => (P[id] = { x: colX(id), y: OY + i * (H + NGY) })));
  const place = (id: string) => {
    const ys = deps(by.get(id)!).map((k) => P[k]?.y).filter((v): v is number => v != null);
    let yy = ys.length ? Math.round((Math.min(...ys) + Math.max(...ys)) / 2) : OY;
    const x = colX(id), col = Object.values(P).filter((p) => p.x === x);
    const free = (v: number) => v >= OY && !col.some((p) => v < p.y + H + NGY && v + H + NGY > p.y);
    let dy = 0; while (!free(yy + dy) && !free(yy - dy)) dy += 8;
    yy = free(yy + dy) ? yy + dy : yy - dy;
    P[id] = { x, y: yy };
    // następcy jednego rodzica idą za nim w tym samym rzędzie
    const nx = children[id]?.[0];
    if (nx && !P[nx] && deps(by.get(nx)!).length === 1) place(nx);
  };
  // kroki spoza wątków po kolumnach: najpierw te, których poprzednicy już stoją
  let left = rest.filter((id) => !P[id]);
  while (left.length) {
    const ready = left.filter((id) => deps(by.get(id)!).every((k) => P[k])).sort((a, b) => L[a] - L[b]);
    place((ready[0] ?? left.sort((a, b) => L[a] - L[b])[0]));
    left = left.filter((id) => !P[id]);
  }
  return P;
}

// „Ułóż” na kanwie zadania przełącza dwa układy: gdy wszystkie kroki stoją w siatce (bez zapisanych położeń), układa naturalnie
// (wolne kroki, bez grup); inaczej wraca do siatki (null = wyczyść położenia).
export function nextStepLayout(steps: LItem[], groups: { members: string[] }[], size: Size): Record<string, Pos> | null {
  if (steps.some((s) => s.pos && Number.isFinite(s.pos.x))) return null;
  const inGroup = new Set(groups.flatMap((g) => g.members));
  const free = steps.filter((s) => !inGroup.has(s.id));
  if (free.length < 2) return null;
  return naturalLayout(free, size);
}
