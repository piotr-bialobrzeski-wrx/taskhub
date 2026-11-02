// Gotowe układy głównej kanwy (paczka 40, menu „Ułóż”, wersja A „Lista z opisem” z zadania „Menu Ułóż z gotowymi układami kanwy”).
// Każdy układ liczy się od razu w aplikacji, bez agenta: dzieli otwarte zadania na grupy w stałej kolejności. Rozkład grup
// w kształcie ekranu robi kanwa (packGroups w layout.ts), „Pilne i szybkie” zostaje macierzą 2×2 (layoutLanes).
import { laneOrder, type LaneSortable } from "./lanes";
import type { LookKey } from "@/components/canvas/ui";

export const PRESETS = [
  { key: "lanes", name: "Pilne i szybkie", desc: "Cztery pola: co zrobić najpierw, co zaplanować" },
  { key: "projects", name: "Według projektów", desc: "Grupa na projekt, bez projektu na końcu" },
  { key: "due", name: "Według terminu", desc: "Po terminie, dziś, ten tydzień, później" },
  { key: "state", name: "Według stanu", desc: "Twój ruch, agent pracuje, czeka, nowe" },
] as const;
export type PresetKey = (typeof PRESETS)[number]["key"];
export const isPreset = (v: unknown): v is PresetKey => typeof v === "string" && PRESETS.some((p) => p.key === v);
export const presetName = (k: string) => PRESETS.find((p) => p.key === k)?.name ?? null;

// dueDays: dni do terminu wg kalendarza w Warszawie (ujemne = po terminie, 0 = dziś, null = bez terminu)
// look: stan kafelka (taskLook, najgorszy stan kroków), mine = Piotr ma ruch (Twoja kolej albo Potrzebna pomoc)
export type PresetTask = LaneSortable & { projectId: string | null; dueDays: number | null; look: LookKey; mine: boolean; hasSteps: boolean };
export type PresetProject = { id: string; name: string; color: number; weight: number };
export type PresetGroup = { name: string; color: number; ids: string[] };

const sorted = (list: PresetTask[]) => [...list].sort(laneOrder).map((t) => t.id);
function buckets(tasks: PresetTask[], defs: { name: string; color: number; test: (t: PresetTask) => boolean }[]): PresetGroup[] {
  const left = new Set(tasks.map((t) => t.id));
  return defs.map((d) => {
    const mem = tasks.filter((t) => left.has(t.id) && d.test(t));
    mem.forEach((t) => left.delete(t.id));
    return { name: d.name, color: d.color, ids: sorted(mem) };
  }).filter((g) => g.ids.length);
}

// projekty od najważniejszego (ważność malejąco, potem kolejność założenia), „Bez projektu” na końcu; puste grupy pomijamy
export function presetGroups(key: Exclude<PresetKey, "lanes">, tasks: PresetTask[], projects: PresetProject[]): PresetGroup[] {
  if (key === "projects") {
    const order = projects.map((p, i) => ({ p, i })).sort((a, b) => b.p.weight - a.p.weight || a.i - b.i).map((x) => x.p);
    const known = new Set(projects.map((p) => p.id));
    return buckets(tasks, [
      ...order.map((p) => ({ name: p.name, color: p.color, test: (t: PresetTask) => t.projectId === p.id })),
      { name: "Bez projektu", color: 4, test: (t: PresetTask) => !t.projectId || !known.has(t.projectId) },
    ]);
  }
  if (key === "due") return buckets(tasks, [
    { name: "Po terminie", color: 4, test: (t) => t.dueDays != null && t.dueDays < 0 },
    { name: "Dziś", color: 0, test: (t) => t.dueDays === 0 },
    { name: "Ten tydzień", color: 2, test: (t) => t.dueDays != null && t.dueDays <= 7 },
    { name: "Później", color: 1, test: (t) => t.dueDays != null },
    { name: "Bez terminu", color: 3, test: () => true },
  ]);
  // stan: nierozpisane to „Nowe”; potem kolejka Piotra, praca agenta, reszta czeka (na agenta, inne kroki albo inne zadanie)
  return buckets(tasks, [
    { name: "Nowe", color: 3, test: (t) => !t.hasSteps },
    { name: "Twój ruch", color: 0, test: (t) => t.mine || t.look === "mine" || t.look === "help" },
    { name: "Agent pracuje", color: 2, test: (t) => t.look === "live" },
    { name: "Czeka na kogoś", color: 1, test: () => true },
  ]).sort((a, b) => STATE_ORDER.indexOf(a.name) - STATE_ORDER.indexOf(b.name));
}
const STATE_ORDER = ["Twój ruch", "Agent pracuje", "Czeka na kogoś", "Nowe"];

// dni między dniem dziś a terminem (oba jako YYYY-MM-DD w Warszawie)
export const daysBetween = (today: string, due: string) => Math.round((Date.parse(due + "T12:00:00Z") - Date.parse(today + "T12:00:00Z")) / 864e5);
