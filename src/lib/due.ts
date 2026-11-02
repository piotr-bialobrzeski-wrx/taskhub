// Termin zadania i kroku: rodzaj („zrób do” = najpóźniejsza data, „w dniu” = konkretny dzień) i powtarzanie jak w Google Calendar
// (co tydzień, co miesiąc albo własny odstęp: co N dni, tygodni lub miesięcy). Zadania „Dwa rodzaje terminu zadań” i „Cykliczne terminy zadań i kroków”.
import { z } from "zod";

export const DUE_KINDS = ["by", "on"] as const;
export type DueKind = (typeof DUE_KINDS)[number];
export const DUE_KIND_LABELS: Record<DueKind, string> = { by: "Zrób do", on: "W dniu" };
export const DUE_KIND_HINTS: Record<DueKind, string> = { by: "najpóźniejsza data wykonania", on: "do zrobienia dokładnie tego dnia" };

export const REPEAT_UNITS = ["day", "week", "month"] as const;
export type RepeatUnit = (typeof REPEAT_UNITS)[number];
export const Repeat = z.object({ every: z.number().int().min(1).max(365), unit: z.enum(REPEAT_UNITS) });
export type Repeat = z.infer<typeof Repeat>;

// gotowe wybory w kontrolce; reszta to „Własny odstęp”
export const REPEAT_PRESETS: { key: string; label: string; repeat: Repeat | null }[] = [
  { key: "none", label: "Nie powtarzaj", repeat: null },
  { key: "week", label: "Co tydzień", repeat: { every: 1, unit: "week" } },
  { key: "month", label: "Co miesiąc", repeat: { every: 1, unit: "month" } },
];
export const presetOf = (r: Repeat | null | undefined): string =>
  !r ? "none" : REPEAT_PRESETS.find((p) => p.repeat && p.repeat.every === r.every && p.repeat.unit === r.unit)?.key ?? "custom";

const plural = (n: number, a: string, b: string, c: string) => (n === 1 ? a : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? b : c);
export const UNIT_FORMS: Record<RepeatUnit, [string, string, string]> = { day: ["dzień", "dni", "dni"], week: ["tydzień", "tygodnie", "tygodni"], month: ["miesiąc", "miesiące", "miesięcy"] };

export const unitForm = (u: RepeatUnit, n: number) => plural(n, ...UNIT_FORMS[u]);

// „co tydzień”, „co miesiąc”, „codziennie”, „co 2 tygodnie”, „co 10 dni”
export function repeatLabel(r: Repeat | null | undefined): string {
  if (!r) return "";
  if (r.every === 1) return r.unit === "day" ? "codziennie" : `co ${UNIT_FORMS[r.unit][0]}`;
  return `co ${r.every} ${unitForm(r.unit, r.every)}`;
}

// reguła z bazy albo z narzędzia: obiekt {every, unit} albo skrót tekstem („weekly”, „monthly”, „daily”, „co tydzień”); zła reguła = brak powtarzania
export function parseRepeat(v: unknown): Repeat | null {
  if (v == null || v === "") return null;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (/^(weekly|week|co tydzień|tydzień)$/.test(s)) return { every: 1, unit: "week" };
    if (/^(monthly|month|co miesiąc|miesiąc)$/.test(s)) return { every: 1, unit: "month" };
    if (/^(daily|day|codziennie)$/.test(s)) return { every: 1, unit: "day" };
    return null;
  }
  const p = Repeat.safeParse(v);
  return p.success ? p.data : null;
}
export const parseDueKind = (v: unknown): DueKind => (v === "on" ? "on" : "by");

// następny termin po `due` według reguły; miesiące trzymają dzień miesiąca, a gdy go brakuje (31 → luty), biorą ostatni dzień miesiąca
export function nextDue(due: string, r: Repeat): string {
  const [y, m, d] = due.split("-").map(Number);
  if (r.unit === "month") {
    const total = y * 12 + (m - 1) + r.every;
    const ny = Math.floor(total / 12), nm = total % 12;
    const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
    return `${ny}-${String(nm + 1).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
  }
  const days = r.unit === "week" ? 7 * r.every : r.every;
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

// „w dniu” przed swoim dniem (paczka 40, krok 02 zadania „Dwa rodzaje terminu zadań”): zadanie nie trafia do losowania ani do przeglądu,
// termin nie podnosi priorytetu i nie robi go pilnym; w swoim dniu jest pilne, po nim przeterminowane. „Zrób do” liczy się jak dotąd.
export const beforeItsDay = (due: string | null | undefined, kind: DueKind | null | undefined, today: string): boolean =>
  !!due && kind === "on" && due.slice(0, 10) > today;
// termin dziś albo po terminie (oba rodzaje): pole „pilne” na kanwie
export const dueReached = (due: string | null | undefined, today: string): boolean => !!due && due.slice(0, 10) <= today;

// opis terminu dla agenta i podpowiedzi: „zrób do 2026-11-05, co tydzień”
export function dueText(due: string | null, kind: DueKind | null | undefined, repeat: Repeat | null | undefined): string {
  if (!due) return repeat ? `bez terminu (${repeatLabel(repeat)})` : "bez terminu";
  return `${kind === "on" ? "w dniu" : "zrób do"} ${due}${repeat ? `, ${repeatLabel(repeat)}` : ""}`;
}

// jedna wartość kontrolki terminu: data, rodzaj, powtarzanie
export type DueValue = { due: string | null; kind: DueKind; repeat: Repeat | null };
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
export const isIsoDay = (v: unknown): v is string => typeof v === "string" && ISO_DAY.test(v) && !Number.isNaN(Date.parse(v + "T12:00:00Z"));
// wartość z przeglądarki albo narzędzia przed zapisem: zła data = brak terminu, zły rodzaj = „zrób do”, zła reguła = bez powtarzania
export function cleanDue(v: { due?: unknown; kind?: unknown; repeat?: unknown }): DueValue {
  return { due: isIsoDay(v.due) ? v.due : null, kind: parseDueKind(v.kind), repeat: parseRepeat(v.repeat) };
}
