// Przegląd zaległości (wariant A „Kawałki i duże przyciski” z zadania „Losowanie zadań w Task Hub”):
// po kolei przez otwarte zadania bez terminu i po terminie; przy każdym jedna z sześciu odpowiedzi ustawia termin
// (Dzisiaj, Jutro, W tym tygodniu = niedziela tego tygodnia, W przyszłym tygodniu = niedziela następnego, Konkretna data)
// albo „Na później”: bez terminu i priorytet niższy o jeden. Czyste funkcje: komponent Review tylko rysuje.

export const REVIEW_ANSWERS = [
  { k: "today", label: "Dzisiaj" },
  { k: "tom", label: "Jutro" },
  { k: "week", label: "W tym tygodniu" },
  { k: "next", label: "W przyszłym tygodniu" },
  { k: "date", label: "Konkretna data" },
  { k: "later", label: "Na później" },
] as const;
export type ReviewAnswer = (typeof REVIEW_ANSWERS)[number]["k"];

// to, czego przegląd potrzebuje z kafelka zadania
export type ReviewTask = { id: string; state: string; base: number; eff: number; due: { iso: string } | null };

// dni liczone na datach YYYY-MM-DD (południe UTC, więc zmiana czasu nie przesuwa dnia)
const d12 = (iso: string) => new Date(iso + "T12:00:00Z");
const isoOf = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (iso: string, n: number) => { const d = d12(iso); d.setUTCDate(d.getUTCDate() + n); return isoOf(d); };
// niedziela tego tygodnia (w niedzielę: dziś)
export const sundayOf = (iso: string) => addDays(iso, (7 - d12(iso).getUTCDay()) % 7);

// do przeglądu: otwarte zadania bez terminu albo po terminie
export const inReview = (t: ReviewTask, today: string) => t.state !== "done" && (!t.due || t.due.iso < today);

// kolejność: najpierw po terminie (najstarszy termin pierwszy), potem od najwyższego priorytetu
export function reviewQueue<T extends ReviewTask>(tasks: T[], today: string): T[] {
  return tasks.filter((t) => inReview(t, today)).sort((a, b) => {
    const la = a.due ? 0 : 1, lb = b.due ? 0 : 1;
    if (la !== lb) return la - lb;
    if (a.due && b.due && a.due.iso !== b.due.iso) return a.due.iso < b.due.iso ? -1 : 1;
    return b.eff - a.eff || b.base - a.base;
  });
}

// termin dla odpowiedzi; „Konkretna data” bierze dzień z pola, „Na później” nie ma terminu
export function dueFor(k: ReviewAnswer, today: string, custom: string | null = null): string | null {
  switch (k) {
    case "today": return today;
    case "tom": return addDays(today, 1);
    case "week": return sundayOf(today);
    case "next": return addDays(sundayOf(today), 7);
    case "date": return custom || null;
    case "later": return null;
  }
}

// zmiana zadania: termin i priorytet. Priorytet liczony od tego sprzed przeglądu (level0), więc zmiana odpowiedzi
// z „Na później” na inną oddaje zadaniu dawny priorytet, a dwa razy „Na później” nie obniża go dwa razy.
export function reviewPatch(k: ReviewAnswer, level0: number, today: string, custom: string | null = null): { due: string | null; level: number } {
  return { due: dueFor(k, today, custom), level: k === "later" ? Math.max(1, level0 - 1) : level0 };
}

// podpowiedź przycisku: dokąd przesunie termin
const DAYS = ["ndz", "pon", "wt", "śr", "czw", "pt", "sob"];
export const fmtDay = (iso: string) => { const d = d12(iso); return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()}.${String(d.getUTCMonth() + 1).padStart(2, "0")}`; };
export function answerTip(k: ReviewAnswer, today: string): string {
  if (k === "later") return "Bez terminu, priorytet niższy o jeden";
  if (k === "date") return "Wybierz dzień w kalendarzu";
  return "Termin: " + fmtDay(dueFor(k, today)!);
}
