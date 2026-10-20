// Czas: szacunki w kwantach 5 min, kalibracja z historii, formatowanie. Czas Piotra (kroki „Ty”) i czas Claude'a (reszta) liczą się osobno:
// szacunki i „zostało” dotyczą tylko kroków Piotra, czas Claude'a liczy się sam co do sekundy.
import { isOwnerStep, type Step, type Task, type TimeSample } from "./schema";

export const Q = 5;              // kwant szacunku w minutach
export const WORK_HOURS = 6;     // ile godzin pracy liczymy na dzień
export const AGENT_MAX_SEC = 45 * 60;   // najdłuższy bieg Claude Code: dłuższy odstęp to zostawiony krok, nie praca

export const roundQ = (min: number) => Math.max(Q, Math.round(min / Q) * Q);
export const estOf = (s: Pick<Step, "estMin">) => roundQ(s.estMin || Q);
// zmierzony czas Piotra w minutach, bez zaokrąglania do kwantu (zegar karty liczy sekundy: pół minuty to nie „5 min”); poniżej minuty 0
export const spentMin = (s: Pick<Step, "spentSec">) => { const m = (s.spentSec || 0) / 60; return m < 1 ? 0 : Math.round(m); };
// sekundy od chwili do teraz, nie więcej niż cap; bez chwili 0
export const elapsedSec = (from: string | null | undefined, cap = AGENT_MAX_SEC, now = Date.now()) => (from ? Math.max(0, Math.min(cap, Math.round((now - new Date(from).getTime()) / 1000))) : 0);
// czas Claude'a w minutach: dokładny (nie w kwantach), poniżej minuty 1, gdy cokolwiek zmierzono
export const agentMinOf = (s: Pick<Step, "agentSec">) => { const sec = s.agentSec ?? 0; return sec <= 0 ? 0 : Math.max(1, Math.round(sec / 60)); };
export const taskEst = (t: Pick<Task, "steps">) => t.steps.filter(isOwnerStep).reduce((a, s) => a + estOf(s), 0);
export const remainEst = (t: Pick<Task, "steps">) => t.steps.filter((s) => isOwnerStep(s) && s.status !== "done").reduce((a, s) => a + estOf(s), 0);
export const taskSpent = (t: Pick<Task, "steps">) => t.steps.reduce((a, s) => a + spentMin(s), 0);
export const taskAgent = (t: Pick<Task, "steps">) => t.steps.reduce((a, s) => a + agentMinOf(s), 0);

export function fmtMin(m: number): string {
  if (!m) return "0 min";
  const h = Math.floor(m / 60), r = m % 60;
  return h ? `${h} h${r ? " " + r + " min" : ""}` : `${r} min`;
}

// ---------- kalibracja: mediana rzeczywisty/szacunek, osobno dla czasów Piotra i Claude'a ----------
export type Calibration = { k: number; n: number; scope: "tool" | "all" };
export type Who = "owner" | "agent";

const median = (a: number[]) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : 1; };

export function calibrationFor(samples: TimeSample[], tool: string, who: Who = "owner"): Calibration | null {
  const ok = samples.filter((x) => x.estMin > 0 && x.spentMin > 0 && (x.who ?? "owner") === who);
  const mine = ok.filter((x) => x.tool === tool);
  const use = mine.length >= 3 ? mine : ok.length >= 5 ? ok : null;
  if (!use) return null;
  return { k: Math.round(median(use.map((x) => x.spentMin / x.estMin)) * 10) / 10, n: use.length, scope: use === mine ? "tool" : "all" };
}
export const calEst = (s: Pick<Step, "estMin" | "tool">, samples: TimeSample[]) => {
  const c = calibrationFor(samples, s.tool, isOwnerStep(s) ? "owner" : "agent");
  return c ? roundQ(estOf(s) * c.k) : estOf(s);
};
export const remainCal = (t: Pick<Task, "steps">, samples: TimeSample[]) =>
  t.steps.filter((s) => isOwnerStep(s) && s.status !== "done").reduce((a, s) => a + calEst(s, samples), 0);

// tekst kalibracji dla agenta: tylko czasy Piotra, bo tylko jego kroki agent szacuje
export function calibrationText(samples: TimeSample[]): string {
  const c = calibrationFor(samples, "manual", "owner");
  if (!c) return "";
  return `KALIBRACJA SZACUNKÓW PIOTRA z historii czasów (rzeczywisty / szacowany): ×${c.k} (${c.n} kroków). Szacując kroki Piotra (manual), uwzględnij ją.`;
}

export const todayISO = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
