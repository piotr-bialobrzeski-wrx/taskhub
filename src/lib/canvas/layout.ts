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
export function bounds(P: Record<string, Pos>, groups: LGroup[], size: Size, origin: Pos | null) {
  let mx = 0, my = 0;
  Object.values(P).forEach((p) => { mx = Math.max(mx, p.x + size.w); my = Math.max(my, p.y + size.h); });
  if (origin) { mx = Math.max(mx, origin.x + size.w); my = Math.max(my, origin.y + size.h); }
  groups.forEach((g) => { mx = Math.max(mx, g.x + g.w); my = Math.max(my, g.y + g.h); });
  return { w: mx + 420, h: my + 160 };
}
