// Czas: szacunki w kwantach 5 min, kalibracja z historii, formatowanie.
import type { Step, Task, TimeSample } from "./schema";

export const Q = 5;              // kwant szacunku w minutach
export const WORK_HOURS = 6;     // ile godzin pracy liczymy na dzień

export const roundQ = (min: number) => Math.max(Q, Math.round(min / Q) * Q);
export const estOf = (s: Pick<Step, "estMin">) => roundQ(s.estMin || Q);
export const spentMin = (s: Pick<Step, "spentSec">) => { const m = (s.spentSec || 0) / 60; return m <= 0 ? 0 : roundQ(m); };
export const taskEst = (t: Pick<Task, "steps">) => t.steps.reduce((a, s) => a + estOf(s), 0);
export const remainEst = (t: Pick<Task, "steps">) => t.steps.filter((s) => s.status !== "done").reduce((a, s) => a + estOf(s), 0);
export const taskSpent = (t: Pick<Task, "steps">) => t.steps.reduce((a, s) => a + spentMin(s), 0);

export function fmtMin(m: number): string {
  if (!m) return "0 min";
  const h = Math.floor(m / 60), r = m % 60;
  return h ? `${h} h${r ? " " + r + " min" : ""}` : `${r} min`;
}

// ---------- kalibracja: mediana rzeczywisty/szacunek ----------
export type Calibration = { k: number; n: number; scope: "tool" | "all" };

const median = (a: number[]) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : 1; };

export function calibrationFor(samples: TimeSample[], tool: string): Calibration | null {
  const ok = samples.filter((x) => x.estMin > 0 && x.spentMin > 0);
  const mine = ok.filter((x) => x.tool === tool);
  const use = mine.length >= 3 ? mine : ok.length >= 5 ? ok : null;
  if (!use) return null;
  return { k: Math.round(median(use.map((x) => x.spentMin / x.estMin)) * 10) / 10, n: use.length, scope: use === mine ? "tool" : "all" };
}
export const calEst = (s: Pick<Step, "estMin" | "tool">, samples: TimeSample[]) => {
  const c = calibrationFor(samples, s.tool);
  return c ? roundQ(estOf(s) * c.k) : estOf(s);
};
export const remainCal = (t: Pick<Task, "steps">, samples: TimeSample[]) =>
  t.steps.filter((s) => s.status !== "done").reduce((a, s) => a + calEst(s, samples), 0);

// tekst kalibracji dla agenta
export function calibrationText(samples: TimeSample[], toolLabel: (t: string) => string): string {
  const tools = [...new Set(samples.map((s) => s.tool))].map((t) => [t, calibrationFor(samples, t)] as const).filter(([, c]) => c && c.scope === "tool");
  const all = calibrationFor(samples, "__all__");
  if (!tools.length && !all) return "";
  const parts = tools.map(([t, c]) => `${toolLabel(t)} ×${c!.k} (${c!.n} kroków)`);
  if (all) parts.push(`ogólnie ×${all.k} (${all.n} kroków)`);
  return `KALIBRACJA SZACUNKÓW z historii czasów (rzeczywisty / szacowany): ${parts.join(", ")}. Proponując szacunki, uwzględnij ją.`;
}

export const todayISO = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
