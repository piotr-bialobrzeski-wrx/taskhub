// Priorytet efektywny = ustawiony + ważność projektu + termin + ilość pracy + co zadanie blokuje.
// Każdy składnik jest wypisany, żeby Piotr i agent widzieli, skąd wynik.
import type { Project, Task, TimeSample } from "./schema";
import { fmtMin, remainCal, remainEst, WORK_HOURS } from "./time";

export const LEVELS: Record<number, string> = { 5: "Krytyczny", 4: "Wysoki", 3: "Średni", 2: "Niski", 1: "Najniższy" };
export const PW_DEF = 3;

export type Reason = { v: number; txt: string };
export type Score = { base: number; eff: number; why: Reason[] };

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const plural = (n: number, a: string, b: string, c: string) => (n === 1 ? a : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? b : c);

export const isComplete = (t: Pick<Task, "steps">) => t.steps.length > 0 && t.steps.every((s) => s.status === "done");
export const dueLeftH = (due: string, now = Date.now()) => (new Date(due + "T23:59:59").getTime() - now) / 36e5;

export type ScoreInput = {
  task: Task;
  project: Project | null;
  blockedCount: number;        // ile otwartych zadań czeka na to zadanie
  samples: TimeSample[];
  now?: number;
};

export function scoreOf({ task: t, project: pr, blockedCount, samples, now = Date.now() }: ScoreInput): Score {
  const base = t.level, why: Reason[] = [];
  let d = 0;
  if (isComplete(t) || t.deletedAt) return { base, eff: base, why };
  const pw = pr?.weight ?? PW_DEF;
  if (pr && pw !== PW_DEF) { const v = (pw - PW_DEF) * 0.5; d += v; why.push({ v, txt: `projekt „${pr.name}” ma ważność ${pw}/5` }); }
  if (t.due) {
    const left = dueLeftH(t.due, now), days = Math.max(0, Math.ceil(left / 24));
    if (left < 0) { d += 2; why.push({ v: 2, txt: "termin minął" }); }
    else if (left < 24) { d += 2; why.push({ v: 2, txt: "termin dziś" }); }
    else if (days <= 2) { d += 1; why.push({ v: 1, txt: "termin w ciągu 2 dni" }); }
    const need = remainCal(t, samples), cal = need !== remainEst(t);
    if (left >= 0 && need / 60 > days * WORK_HOURS * 0.6) {
      d += 1; why.push({ v: 1, txt: `zostało ~${fmtMin(need)} pracy${cal ? " (wg Twoich czasów)" : ""} na ${days} ${plural(days, "dzień", "dni", "dni")}` });
    }
  }
  if (blockedCount) { d += 0.5; why.push({ v: 0.5, txt: `blokuje ${blockedCount} ${plural(blockedCount, "inne zadanie", "inne zadania", "innych zadań")}` }); }
  return { base, eff: clamp(Math.round(base + d), 1, 5), why };
}

export const whyText = (s: Score) => s.why.map((w) => `${w.v > 0 ? "+" : ""}${w.v} ${w.txt}`).join("; ");

// kolejność na kanwie: najważniejsze na górze, potem bliższy termin, potem starsze
export function sortByPriority<T extends { task: Task; score: Score }>(list: T[]): T[] {
  return [...list].sort((a, b) =>
    b.score.eff - a.score.eff ||
    (a.task.due ?? "9999").localeCompare(b.task.due ?? "9999") ||
    a.task.createdAt.localeCompare(b.task.createdAt));
}
