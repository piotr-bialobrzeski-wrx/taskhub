// Paczka 42 (wpisy czasu, krok 07): miesiąc dni z kroków ze szkicem-arkuszem. Zadanie miesiąca („Wpisy czasu: listopad 2026”) ma krok na dzień
// ze szkicem wierszy, którego kolumna rodzaju date mówi, którego dnia dotyczy. Z tego składa się kalendarz w panelu zadania: stan każdego dnia
// (wysłany, zatwierdzony, szkic, brak kroku), liczba wpisów i suma czasu. Nic tu nie zna Pirxey Time: działa dla każdego zadania z krokami-arkuszami.
// Czyste funkcje (bez bazy i Reacta), więc korzysta z nich i strona zadania (serwer), i arkusz w przeglądarce, i testy.
import type { Block, Step } from "./schema";

// ---------- czas trwania (wspólne z arkuszem) ----------
// czas trwania z tego, co Piotr wpisze: 1:15, 1,25 h, 75 min, 1.5 (do 12 to godziny, wyżej minuty) → minuty
export function parseDuration(s: string): number | null {
  const v = s.trim().toLowerCase().replace(",", ".");
  let m: RegExpExecArray | null;
  if ((m = /^(\d{1,3}):([0-5]\d)$/.exec(v))) return Number(m[1]) * 60 + Number(m[2]);
  if ((m = /^(\d+(?:\.\d+)?)\s*h$/.exec(v))) return Math.round(Number(m[1]) * 60);
  if ((m = /^(\d+)\s*(m|min)$/.exec(v))) return Number(m[1]);
  if ((m = /^(\d+)\s*h\s*(\d+)\s*(m|min)?$/.exec(v))) return Number(m[1]) * 60 + Number(m[2]);
  if ((m = /^(\d+(?:\.\d+)?)$/.exec(v))) { const n = Number(m[1]); return n <= 12 ? Math.round(n * 60) : Math.round(n); }
  return null;
}
export const fmtDuration = (n: number) => `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
export const longDuration = (n: number) => { const h = Math.floor(n / 60), m = n % 60; return h && m ? `${h} h ${m} min` : h ? `${h} h` : `${m} min`; };

// godzina z tego, co Piotr wpisze: 9, 930, 9:30, 9.30 → „09:30”; null = to nie godzina
export function parseClock(s: string): string | null {
  const v = s.trim().replace(".", ":");
  const m = /^(\d{1,2})(?::?(\d{2}))?$/.exec(v);
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2] ?? 0);
  return h < 24 && mi < 60 ? `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}` : null;
}
export const clockMins = (t: string | null | undefined): number | null => { const v = t ? parseClock(t) : null; return v ? Number(v.slice(0, 2)) * 60 + Number(v.slice(3)) : null; };

// ---------- ramy dnia przy arkuszu (zadanie „Start i koniec pracy”, wariant C) ----------
// span szkicu = start i koniec (HH:MM), w których mieści się cała praca z wierszy. Wariant C: wiersze mają od-do dowolnie (mogą na siebie
// zachodzić), ale suma czasów trwania równa się długości dnia, a żadna godzina wiersza nie wychodzi poza start i koniec.
export type SpanCheck = {
  from: string | null; to: string | null;
  len: number | null;        // minuty od startu do końca; null, gdy brak którejś godziny albo koniec nie jest po starcie
  total: number | null;      // suma czasów wierszy; null, gdy arkusz nie ma kolumny czasu trwania
  diff: number | null;       // total - len (0 = zgadza się)
  outside: number[];         // indeksy wierszy z godziną poza startem i końcem
  reversed: boolean;         // koniec nie jest po starcie
};
export function spanCheck(sheet: { kind?: string }[] | undefined, rows: string[][] | undefined, span: { from?: string; to?: string } | null | undefined): SpanCheck | null {
  if (!span) return null;
  const from = span.from ? parseClock(span.from) : null, to = span.to ? parseClock(span.to) : null;
  const a = clockMins(from), b = clockMins(to);
  const reversed = a != null && b != null && b <= a;
  const len = a != null && b != null && !reversed ? b - a : null;
  const dur = sheet?.findIndex((c) => c.kind === "duration") ?? -1;
  const times = (sheet ?? []).map((c, i) => (c.kind === "time" ? i : -1)).filter((i) => i >= 0);
  const total = dur >= 0 ? (rows ?? []).reduce((s, r) => s + (parseDuration(r[dur] ?? "") ?? 0), 0) : null;
  const outside: number[] = [];
  if (len != null) (rows ?? []).forEach((r, k) => {
    if (times.some((i) => { const m = clockMins(r[i]); return m != null && (m < a! || m > b!); })) outside.push(k);
  });
  return { from, to, len, total, diff: len != null && total != null ? total - len : null, outside, reversed };
}

// ---------- święta w Polsce (dni wolne od pracy) ----------
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const isoOf = (d: Date) => d.toISOString().slice(0, 10);
function easter(y: number): Date {   // algorytm Meeusa/Jonesa/Butchera (kalendarz gregoriański)
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  return utc(y, Math.floor((h + l - 7 * m + 114) / 31), ((h + l - 7 * m + 114) % 31) + 1);
}
const FIXED: Record<string, string> = {
  "01-01": "Nowy Rok", "01-06": "Trzech Króli", "05-01": "Święto Pracy", "05-03": "Święto Konstytucji 3 Maja", "08-15": "Wniebowzięcie NMP",
  "11-01": "Wszystkich Świętych", "11-11": "Święto Niepodległości", "12-25": "Boże Narodzenie", "12-26": "Drugi dzień Świąt",
};
export function plHoliday(iso: string): string | null {
  const m = ISO.exec(iso); if (!m) return null;
  const y = Number(m[1]), md = iso.slice(5);
  if (FIXED[md]) return FIXED[md];
  if (md === "12-24" && y >= 2025) return "Wigilia";
  const e = easter(y), add = (n: number) => { const d = new Date(e); d.setUTCDate(d.getUTCDate() + n); return isoOf(d); };
  if (iso === isoOf(e)) return "Wielkanoc";
  if (iso === add(1)) return "Poniedziałek Wielkanocny";
  if (iso === add(49)) return "Zielone Świątki";
  if (iso === add(60)) return "Boże Ciało";
  return null;
}
// 0 = poniedziałek … 6 = niedziela
export const weekday = (iso: string) => (new Date(iso + "T12:00:00Z").getUTCDay() + 6) % 7;
export const isWorkday = (iso: string) => weekday(iso) < 5 && !plHoliday(iso);

// ---------- krok dnia ----------
type Draft = Extract<Block, { type: "draft" }>;
export type DayStep = Pick<Step, "id" | "title" | "status" | "blocks"> & Partial<Pick<Step, "approvedAt" | "sendStartedAt">>;
// szkic-arkusz z kolumną daty: krok dnia
// (wybór szkicu jak draftOf w agent/approval, bez jego importu: tamten ciągnie node:crypto, a arkusz działa w przeglądarce)
export const sheetDraftOf = (s: Pick<Step, "blocks">): Draft | null => {
  const ds = (s.blocks ?? []).filter((b): b is Draft => b.type === "draft");
  const d = ds.find((x) => x.status === "sent") ?? ds.find((x) => x.status === "approved") ?? ds[0] ?? null;
  return d?.sheet?.some((c) => c.kind === "date") && d.columns?.length ? d : null;
};
// dzień kroku: najczęstsza data w wierszach (wpis ręczny do innego dnia nie przestawia kroku); bez wierszy null
export function dayOf(s: Pick<Step, "blocks">): string | null {
  const d = sheetDraftOf(s); if (!d) return null;
  const col = d.sheet!.findIndex((c) => c.kind === "date");
  const n = new Map<string, number>();
  for (const r of d.rows ?? []) { const v = (r[col] ?? "").trim(); if (ISO.test(v)) n.set(v, (n.get(v) ?? 0) + 1); }
  let best: string | null = null, top = 0;
  for (const [k, c] of n) if (c > top || (c === top && best !== null && k < best)) { best = k; top = c; }
  return best;
}
// suma czasu wierszy (kolumna rodzaju duration) w minutach
export function sheetMinutes(d: Draft): number {
  const col = d.sheet?.findIndex((c) => c.kind === "duration") ?? -1;
  if (col < 0) return 0;
  return (d.rows ?? []).reduce((a, r) => a + (parseDuration(r[col] ?? "") ?? 0), 0);
}

export type DayState = "sent" | "approved" | "draft" | "closed";
// stan dnia z kroku: wysłany (szkic poszedł), zatwierdzony (czeka na wysyłkę przez mostek), szkic (czeka na zgodę), zamknięty bez wysyłki
export function dayState(s: DayStep): DayState {
  const d = sheetDraftOf(s);
  if (d?.status === "sent") return "sent";
  if (s.status === "done") return "closed";
  if (d?.status === "approved") return "approved";
  return "draft";
}

// ---------- miesiąc ----------
export type DayCell = {
  date: string; day: number; weekday: number;
  kind: DayState | "missing" | "today" | "free" | "future";
  holiday: string | null;
  step: { id: string; no: number; title: string } | null;
  rows: number; minutes: number;
  more: number;   // drugi i kolejny krok tego samego dnia (powinien być jeden: Piotr widzi, że coś jest do scalenia)
};
export type MonthView = {
  year: number; month: number; label: string; cells: DayCell[];
  count: Record<DayState, number>; missing: string[]; minutes: number;
};
const MONTHS = ["styczeń", "luty", "marzec", "kwiecień", "maj", "czerwiec", "lipiec", "sierpień", "wrzesień", "październik", "listopad", "grudzień"];
const MONTH_RE = new RegExp(`\\b(${MONTHS.join("|")})\\s+(\\d{4})\\b`, "i");
// miesiąc zadania: z tytułu („Wpisy czasu: listopad 2026”), inaczej z terminu, inaczej z najnowszego kroku dnia
export function monthOf(task: { title: string; due: string | null }, days: string[], today: string): { year: number; month: number } {
  const m = MONTH_RE.exec(task.title);
  if (m) return { year: Number(m[2]), month: MONTHS.indexOf(m[1].toLowerCase()) + 1 };
  const src = task.due && ISO.test(task.due.slice(0, 10)) ? task.due.slice(0, 10) : [...days].sort().pop() ?? today;
  return { year: Number(src.slice(0, 4)), month: Number(src.slice(5, 7)) };
}

// kalendarz miesiąca z kroków zadania; null = zadanie nie ma kroków-arkuszy z datą (zwykłe zadanie, panel nic nie pokazuje)
export function monthView(task: { title: string; due: string | null; steps: DayStep[] }, today: string): MonthView | null {
  const days = task.steps.map((s, i) => ({ s, i, date: dayOf(s) })).filter((x): x is { s: DayStep; i: number; date: string } => !!x.date);
  if (!days.length) return null;
  const { year, month } = monthOf(task, days.map((x) => x.date), today);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const count: Record<DayState, number> = { sent: 0, approved: 0, draft: 0, closed: 0 };
  const cells: DayCell[] = [], missing: string[] = [];
  let minutes = 0;
  for (let d = 1; d <= last; d++) {
    const date = isoOf(utc(year, month, d)), wd = weekday(date), holiday = plHoliday(date);
    const mine = days.filter((x) => x.date === date);
    const first = mine[0];
    const cell: DayCell = { date, day: d, weekday: wd, kind: "future", holiday, step: null, rows: 0, minutes: 0, more: Math.max(0, mine.length - 1) };
    if (first) {
      const st = dayState(first.s), dr = sheetDraftOf(first.s)!;
      cell.kind = st; cell.step = { id: first.s.id, no: first.i + 1, title: first.s.title };
      cell.rows = dr.rows?.length ?? 0; cell.minutes = sheetMinutes(dr);
      count[st]++; minutes += cell.minutes;
    } else if (date === today) cell.kind = "today";
    else if (wd >= 5 || holiday) cell.kind = "free";
    else if (date < today) { cell.kind = "missing"; missing.push(date); }
    cells.push(cell);
  }
  return { year, month, label: `${MONTHS[month - 1]} ${year}`, cells, count, missing, minutes };
}
