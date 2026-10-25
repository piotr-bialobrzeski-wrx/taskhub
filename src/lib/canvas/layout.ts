// Układ kanwy (port z prototypu): elementy bez zależności w kolumnie 0, zależne w kolejnych; równoległe jeden pod drugim.
// Kafelek z zapisanym położeniem zostaje, nowy nigdy nie ląduje na innym ani w cudzej grupie.
export type Pos = { x: number; y: number };
export type LItem = { id: string; dependsOn: string[]; pos: Pos | null };
export type LGroup = { id: string; x: number; y: number; w: number; h: number; members: string[]; auto: boolean };
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
  free.forEach((x) => place(x, fg[x.id], OX, OY, true));
  groups.forEach((g) => {
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

// Strzałka od prawej krawędzi kafelka A (wysokość ay) do lewej krawędzi B. Zwykle łuk; gdy łuk przeszedłby przez inny kafelek
// (zależność przez kilka kolumn), strzałka idzie szczeliną: w prawo do odstępu za A, pionowo do wolnego pasa między wierszami,
// poziomo do odstępu przed B i do B. Kafelki to prostokąty `obstacles` (bez A i B).
export type Rect = { x: number; y: number; w: number; h: number };
const PADR = 6;
const hitsRect = (x: number, y: number, rs: Rect[]) => rs.some((r) => x > r.x - PADR && x < r.x + r.w + PADR && y > r.y - PADR && y < r.y + r.h + PADR);
const segHits = (x1: number, y1: number, x2: number, y2: number, rs: Rect[]) =>
  rs.some((r) => Math.max(x1, x2) > r.x - PADR && Math.min(x1, x2) < r.x + r.w + PADR && Math.max(y1, y2) > r.y - PADR && Math.min(y1, y2) < r.y + r.h + PADR);
export function edgePath(x1: number, y1: number, x2: number, y2: number, obstacles: Rect[]): string {
  const k = Math.max(40, Math.abs(x2 - x1) / 2);
  const curve = `M${x1} ${y1} C${x1 + k} ${y1}, ${x2 - k} ${y2}, ${x2} ${y2}`;
  if (x2 - x1 < 2 * GX) return curve;   // sąsiednie kolumny (albo strzałka wstecz): między nimi nie ma kafelków
  const between = obstacles.filter((r) => r.x + r.w > x1 && r.x < x2);
  // próbki łuku Béziera: czy przechodzi przez kafelek
  let crosses = false;
  for (let i = 1; i < 24 && !crosses; i++) {
    const t = i / 24, u = 1 - t;
    const x = u * u * u * x1 + 3 * u * u * t * (x1 + k) + 3 * u * t * t * (x2 - k) + t * t * t * x2;
    const y = u * u * u * y1 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y2;
    crosses = hitsRect(x, y, between);
  }
  if (!crosses) return curve;
  const xa = x1 + GX / 2, xb = x2 - GX / 2;
  // pas poziomy: wysokość źródła, celu, albo tuż nad / pod którymś kafelkiem po drodze; najbliższy wolny
  const cands = [y1, y2, ...between.flatMap((r) => [r.y - GY / 2, r.y + r.h + GY / 2])];
  const ok = (y: number) => !segHits(xa, y, xb, y, between) && !segHits(xa, y1, xa, y, between) && !segHits(xb, y, xb, y2, between);
  const yc = cands.filter(ok).sort((a, b) => Math.abs(a - y1) + Math.abs(a - y2) - (Math.abs(b - y1) + Math.abs(b - y2)))[0];
  if (yc === undefined) return curve;
  // łamana z zaokrąglonymi narożnikami
  const pts: [number, number][] = [[x1, y1], [xa, y1], [xa, yc], [xb, yc], [xb, y2], [x2, y2]]
    .filter((p, i, a) => i === 0 || p[0] !== a[i - 1][0] || p[1] !== a[i - 1][1]) as [number, number][];
  let d = `M${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i - 1], [cx, cy] = pts[i], [nx, ny] = pts[i + 1];
    const r = Math.min(12, Math.hypot(cx - px, cy - py) / 2, Math.hypot(nx - cx, ny - cy) / 2);
    const ax = cx - Math.sign(cx - px) * r, ay = cy - Math.sign(cy - py) * r, bx = cx + Math.sign(nx - cx) * r, by = cy + Math.sign(ny - cy) * r;
    d += ` L${ax} ${ay} Q${cx} ${cy}, ${bx} ${by}`;
  }
  return d + ` L${pts[pts.length - 1][0]} ${pts[pts.length - 1][1]}`;
}
