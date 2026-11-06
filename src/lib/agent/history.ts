// Paczka 57, krok 03: wspólna pamięć rozmów agenta. Wątki rozmowy są osobne tylko na ekranie; agent widzi całą rozmowę zadania
// z oznaczeniem wątku i może szukać wcześniejszych próśb i decyzji Piotra w innych zadaniach (z nazwą zadania i numerem kroku).

// trafienie w historii: wiadomość Piotra w rozmowie zadania albo odpowiedź na kartce kroku decyzji
export type HistoryHit = {
  kind: "chat" | "decision";
  taskId: string; taskTitle: string; taskDone: boolean;
  stepId: string | null; stepTitle: string | null; stepNo: number | null;
  at: string; text: string;
};

// słowa zapytania: małe litery, bez znaków przestankowych, co najmniej trzy znaki, bez powtórzeń
export function queryWords(q: string): string[] {
  const w = q.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((x) => x.length >= 3);
  return [...new Set(w)].slice(0, 12);
}
// rdzeń słowa do szukania: polskie końcówki odmiany odcięte („wątek” i „wątków” mają wspólne „wąt”), krótkie słowa całe
export const stem = (w: string): string => (w.length >= 5 ? w.slice(0, w.length - 2) : w);
// ile słów zapytania jest w tekście
export function hitScore(text: string, words: string[]): number {
  const t = text.toLowerCase();
  return words.reduce((n, w) => n + (t.includes(stem(w)) ? 1 : 0), 0);
}
// najpierw najwięcej trafionych słów, potem najświeższe; decyzja z kartki i wiadomość „Decyzja w kroku …” o tym samym kroku liczą się raz
export function rankHits(hits: HistoryHit[], words: string[], limit: number): HistoryHit[] {
  const decided = new Set(hits.filter((h) => h.kind === "decision" && h.stepId).map((h) => h.stepId));
  const uniq = hits.filter((h) => !(h.kind === "chat" && h.stepId && decided.has(h.stepId) && /^Decyzja w kroku/.test(h.text)));
  const scored = uniq.map((h) => ({ h, s: words.length ? hitScore(`${h.taskTitle} ${h.stepTitle ?? ""} ${h.text}`, words) : 1 })).filter((x) => x.s > 0);
  scored.sort((a, b) => b.s - a.s || b.h.at.localeCompare(a.h.at));
  return scored.slice(0, limit).map((x) => x.h);
}
export const stepNo = (n: number | null) => (n ? String(n).padStart(2, "0") : "");
const cap = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "…" : s);
// jedna linia trafienia: gdzie (zadanie, krok, data) i co Piotr powiedział
export function hitLine(h: HistoryHit, max = 400): string {
  const where = `zadanie „${h.taskTitle}” [${h.taskId}]${h.taskDone ? " (ukończone)" : ""}${h.stepId ? `, krok ${stepNo(h.stepNo)} „${h.stepTitle}” [${h.stepId}]` : ", wątek zadania"}`;
  const what = h.kind === "decision" ? `decyzja na kartce: ${h.text}` : `Piotr napisał: ${h.text}`;
  return `- ${h.at.slice(0, 10)} · ${where} · ${cap(what.replace(/\s+/g, " ").trim(), max)}`;
}
export function historyText(hits: HistoryHit[], head: string): string {
  return hits.length ? `${head}\n${hits.map((h) => hitLine(h)).join("\n")}` : "";
}
// oznaczenie wątku przy wpisie rozmowy zadania: agent wie, w którym kroku padło każde zdanie (podział na wątki jest tylko na ekranie)
export function threadLabel(stepId: string | null | undefined, steps: { id: string; title: string }[]): string {
  if (!stepId) return " w wątku zadania";
  const i = steps.findIndex((s) => s.id === stepId);
  return i >= 0 ? ` w wątku kroku ${stepNo(i + 1)} [${steps[i].id}] „${steps[i].title}”` : " w wątku kroku, którego już nie ma";
}
// nagłówek sekcji w kontekście zadania (get_task i czat w aplikacji)
export const PAST_HEAD = "WCZEŚNIEJSZE PROŚBY I DECYZJE PIOTRA W INNYCH ZADANIACH TEGO PROJEKTU (ostatnie 60 dni; starsze i z innych projektów znajdzie search_history; gdy nowa prośba kłóci się z którąś, powiedz to wprost z nazwą zadania i kroku):";
