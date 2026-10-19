// Szukajka: typy i dopasowanie wspólne dla serwera (budowa indeksu) i klienta (pigułka). Bez importów z bazy.

export type SearchKind = "task" | "step" | "project" | "done" | "trash" | "setting" | "rule";
export type SearchItem = {
  kind: SearchKind; id: string; title: string;
  hay: string;                 // znormalizowany tekst, po którym szukamy
  href: string;                // dokąd prowadzi kliknięcie, gdy ekran nie obsłuży go u siebie
  sub?: string;                // krótki dopisek po prawej (data, miejsce w ustawieniach)
  badge?: string;              // plakietka stanu albo narzędzia
  badgeCls?: string;           // klasa plakietki (stan zadania/kroku)
  lvl?: { base: number; eff: number };
  tag?: { name: string; color: number };   // projekt zadania
  color?: number;              // projekt: jego kolor
  tool?: string;               // krok: narzędzie
  taskId?: string;             // krok: zadanie, do którego należy
};

// ekran decyduje o kolejności sekcji: najpierw to, co na nim widać
export type Screen = "canvas" | "task" | "projects" | "done" | "trash" | "settings" | "rules";
export const ORDER: Record<Screen, SearchKind[]> = {
  canvas: ["task", "step", "project", "done", "trash", "rule", "setting"],
  task: ["step", "task", "project", "done", "trash", "rule", "setting"],
  projects: ["project", "task", "step", "done", "trash", "rule", "setting"],
  done: ["done", "trash", "task", "step", "project", "rule", "setting"],
  trash: ["trash", "done", "task", "step", "project", "rule", "setting"],
  settings: ["setting", "rule", "task", "step", "project", "done", "trash"],
  rules: ["rule", "setting", "task", "step", "project", "done", "trash"],
};
export const KIND_LABEL: Record<SearchKind, string> = { task: "Zadania", step: "Kroki", project: "Projekty", done: "Ukończone", trash: "Kosz", setting: "Ustawienia", rule: "Zasady pracy" };

// bez wielkości liter i ogonków; każde wpisane słowo musi wystąpić w tekście
export const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ł/g, "l");
export const tokens = (q: string) => norm(q).split(/\s+/).filter(Boolean);
export const matches = (hay: string, words: string[]) => words.every((w) => hay.includes(w));

// ukończone przed dzisiejszą północą idą do archiwum; dzisiejsze zostają na kanwie
// ukończone zadanie schodzi z kanwy do archiwum po 5 minutach (chwila na „jednak wracam”); nowy niezrobiony krok albo cofnięcie kroku wyciąga je z powrotem
export const ARCHIVE_AFTER_MS = 5 * 60_000;
export function isArchivedDone(doneAt: string | null, now = Date.now()): boolean {
  if (!doneAt) return false;
  return now - new Date(doneAt).getTime() >= ARCHIVE_AFTER_MS;
}

export type Section = { kind: SearchKind; items: SearchItem[]; more: number };
// wyniki w sekcjach wg ekranu: pierwsza sekcja do 6 wierszy, kolejne do 3; kroki bieżącego zadania (here) na początku swojej sekcji
export function sections(index: SearchItem[], words: string[], screen: Screen, here?: string | null): Section[] {
  if (!words.length) return [];
  const out: Section[] = [];
  ORDER[screen].forEach((kind, i) => {
    let list = index.filter((it) => it.kind === kind && matches(it.hay, words));
    if (!list.length) return;
    if (kind === "step" && here) list = [...list.filter((it) => it.taskId === here), ...list.filter((it) => it.taskId !== here)];
    const max = i === 0 ? 6 : 3;
    out.push({ kind, items: list.slice(0, max), more: Math.max(0, list.length - max) });
  });
  return out;
}
