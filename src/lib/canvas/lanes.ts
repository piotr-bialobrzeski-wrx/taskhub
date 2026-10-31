// Układ kafelków „Pilne i szybkie” (paczka 31, wariant C): cztery pola na głównej kanwie, pilne albo nie × szybkie albo dłuższe.
// Pole zadania ustala asystent według zasady w bazie (tasks.lane, update_task lane); bez niego liczymy je z priorytetu efektywnego
// i pozostałej pracy Piotra, tak jak w prototypie. Kolejność pól: od lewej do prawej, od góry do dołu.
export const LANES = [
  { key: "pilne-szybkie", name: "Pilne i szybkie", color: 0 },
  { key: "pilne-dluzsze", name: "Pilne, dłuższe", color: 4 },
  { key: "szybkie-poczekaja", name: "Szybkie, mogą poczekać", color: 2 },
  { key: "przy-okazji", name: "Przy okazji", color: 6 },
] as const;
export type LaneKey = (typeof LANES)[number]["key"];
export const LANE_KEYS = LANES.map((l) => l.key) as unknown as [LaneKey, ...LaneKey[]];
export const isLane = (v: unknown): v is LaneKey => typeof v === "string" && LANES.some((l) => l.key === v);
export const laneName = (k: string | null | undefined) => LANES.find((l) => l.key === k)?.name ?? null;

export const URGENT_EFF = 4;   // priorytet efektywny (z terminem i ważnością projektu) od 4 = pilne
export const QUICK_MIN = 30;   // Piotrowi zostało do 30 minut pracy = szybkie

export type LaneInput = { lane?: string | null; eff: number; remainMin: number; hasSteps: boolean };
export function laneOf(t: LaneInput): LaneKey {
  if (isLane(t.lane)) return t.lane;
  const urgent = t.eff >= URGENT_EFF, quick = t.hasSteps && t.remainMin <= QUICK_MIN;   // nierozpisane zadanie: nie wiadomo, ile pracy, więc „dłuższe”
  return urgent ? (quick ? "pilne-szybkie" : "pilne-dluzsze") : quick ? "szybkie-poczekaja" : "przy-okazji";
}

// kolejność w polu: wyższy priorytet, potem mniej pracy, potem bliższy termin
export type LaneSortable = { id: string; eff: number; remainMin: number; due: string | null };
export const laneOrder = (a: LaneSortable, b: LaneSortable) =>
  b.eff - a.eff || a.remainMin - b.remainMin || (a.due ?? "9999").localeCompare(b.due ?? "9999");

export function assignLanes<T extends LaneInput & LaneSortable>(tasks: T[]): Record<LaneKey, string[]> {
  const out = Object.fromEntries(LANES.map((l) => [l.key, [] as T[]])) as Record<LaneKey, T[]>;
  tasks.forEach((t) => out[laneOf(t)].push(t));
  return Object.fromEntries(LANES.map((l) => [l.key, out[l.key].sort(laneOrder).map((t) => t.id)])) as Record<LaneKey, string[]>;
}
