// Losowanie zadania (paczka 32, wariant A „Bęben” z zadania „Losowanie zadań w Task Hub”):
// Piotr wybiera czas (15 min, 30 min, 1 h, 2 h), losowanie bierze tylko zadania, w których ma następny krok i których jego praca
// mieści się w tym czasie; ważniejsze wypadają częściej (waga = kwadrat priorytetu efektywnego). Po wyniku jedno ponowne losowanie.
// Wynik zostaje na ekranie (pamięć przeglądarki), dopóki zadanie nie jest zrobione albo nie przestanie czekać na Piotra.

export const DRAW_TIMES = [15, 30, 60, 120] as const;

// to, czego losowanie potrzebuje z kafelka zadania
export type DrawInfo = { min: number; step: string };
export type DrawTask = { id: string; eff: number; state: string; draw: DrawInfo | null };

// zapamiętany wynik: które zadanie, na jaki czas, czy ponowne losowanie już wykorzystane
export type DrawSaved = { id: string; limit: number; rerolled: boolean };
export const DRAW_KEY = "th-draw";

export const drawPool = <T extends DrawTask>(tasks: T[], limit: number, except: string | null = null): T[] =>
  tasks.filter((t) => t.state !== "done" && t.state !== "blocked" && !!t.draw && t.draw.min <= limit && t.id !== except);

// rnd w [0, 1): Math.random w aplikacji, stała wartość w testach
export function drawPick<T extends DrawTask>(pool: T[], rnd: number): T | null {
  if (!pool.length) return null;
  const w = (t: T) => Math.max(1, t.eff) ** 2;
  let r = rnd * pool.reduce((a, t) => a + w(t), 0);
  for (const t of pool) { r -= w(t); if (r < 0) return t; }
  return pool[pool.length - 1];
}

// zapamiętany wynik jest ważny, dopóki zadanie nadal czeka na Piotra (bez względu na czas: zostaje, dopóki go nie zrobi)
export function drawRestore<T extends DrawTask>(raw: string | null, tasks: T[]): (DrawSaved & { task: T }) | null {
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as Partial<DrawSaved>;
    if (typeof s.id !== "string" || typeof s.limit !== "number") return null;
    const task = tasks.find((t) => t.id === s.id);
    if (!task || task.state === "done" || !task.draw) return null;
    return { id: s.id, limit: s.limit, rerolled: !!s.rerolled, task };
  } catch { return null; }
}
