// Automat: kto i kiedy wykonuje pracę agenta bez klucza API.
// Główna ścieżka: mostek na komputerze Piotra (jak w Project Hub) pracuje na bieżąco. Zapas: zadanie zaplanowane na jego koncie Claude co godzinę.
// Każde zdanie „kto pracuje i kiedy” (pasek nad kanwą, komunikat po dodaniu zadania, odpowiedź na wiadomość w czacie) bierze się stąd.
import { nextAutoAt } from "./clock";
import type { LiveActivity } from "./live";
import type { Task } from "./schema";

export const AUTO_EVERY = "co godzinę";
export const AUTO_TEXT = `Gdy mostek nie działa (komputer śpi), Claude zagląda tu ${AUTO_EVERY} z zadania zaplanowanego na Twoim koncie Claude: rozpisuje nowe zadania na kroki, robi analizy, research i szkice, a na zewnątrz wysyła tylko to, co zatwierdzisz.`;
export const BRIDGE_TEXT = "Mostek na Twoim komputerze pracuje na bieżąco: nowe zadanie dostaje kroki, analizy, research i szkice w ciągu chwili od dodania, a na zewnątrz wychodzi tylko to, co zatwierdzisz.";

// skrót nazwy do komunikatu: jedno zdanie, bez urywania w pół słowa
export const shortTitle = (title: string, max = 60) => { const t = title.replace(/\s+/g, " ").trim(); if (t.length <= max) return t; const cut = t.slice(0, max); return (cut.includes(" ") ? cut.slice(0, cut.lastIndexOf(" ")) : cut) + "…"; };

// kto może pracować: mostek (żywy? jak się nazywa? co robi teraz?) albo automat co godzinę
export type Worker = { alive: boolean; name: string | null; run: LiveActivity | null };
export type Who = { kind: "decomposing" | "busy" | "soon" | "auto"; who: string; text: string };   // who = krótka etykieta do paska, text = pełne zdanie
export const bridgeLabel = (w: Pick<Worker, "name">) => (w.name ? `Mostek (${w.name})` : "Mostek na Twoim komputerze");

// nad czym mostek pracuje teraz: tytuł kroku, a gdy nie wiadomo, tytuł zadania albo sama czynność
export function busyWith(run: LiveActivity | null, tasks: Pick<Task, "id" | "title" | "steps">[]): string | null {
  if (!run) return null;
  const t = run.taskId ? tasks.find((x) => x.id === run.taskId) : null;
  const s = run.stepId ? tasks.flatMap((x) => x.steps).find((x) => x.id === run.stepId) : null;
  return s ? shortTitle(s.title, 50) : t ? shortTitle(t.title, 50) : run.text;
}

// zadanie bez kroków: kto je rozpisze i kiedy
export function noStepsWho(w: Worker, taskId: string, busy: string | null = null, now = new Date()): Who {
  const b = bridgeLabel(w);
  if (w.run && w.run.taskId === taskId) return { kind: "decomposing", who: b, text: `${b} rozpisuje kroki tego zadania.` };
  if (w.run) return { kind: "busy", who: b, text: `${b} kończy${busy ? `: ${busy}` : " inną pracę"}, potem weźmie to zadanie i rozpisze kroki.` };
  if (w.alive) return { kind: "soon", who: b, text: `${b} weźmie to zadanie w ciągu minuty i rozpisze kroki.` };
  const n = nextAutoAt(now);
  return { kind: "auto", who: `Claude ${n.text}`, text: `Nikt teraz nie pracuje: mostek na komputerze nie działa. Claude zajrzy tu ${n.text} (automat ${AUTO_EVERY}) i rozpisze kroki.` };
}
// wiadomość Piotra w zadaniu: kto ją przeczyta i kiedy (odpowiedź w rozmowie zamiast „wezmę pod uwagę”)
export function chatWho(w: Worker, taskId: string, busy: string | null = null, now = new Date()): string {
  const b = bridgeLabel(w);
  if (w.run && w.run.taskId === taskId) return `${b} właśnie pracuje nad tym zadaniem: przeczyta to za chwilę i odpowie tutaj.`;
  if (w.run) return `${b} kończy${busy ? `: ${busy}` : " inną pracę"}, potem przeczyta Twoją wiadomość i odpowie tutaj; gdy prośba zmienia zakres, dopisze kroki.`;
  if (w.alive) return `Przekazałem mostkowi na Twoim komputerze. Odpowie tutaj w ciągu minuty; gdy prośba zmienia zakres, dopisze kroki.`;
  const n = nextAutoAt(now);
  return `Mostek na komputerze nie działa, więc nikt nie czyta tego teraz. Claude zajrzy tu ${n.text} (automat ${AUTO_EVERY}), odpowie i w razie potrzeby dopisze kroki.`;
}
// komunikat po dodaniu zadania z doku: to samo zdanie, co pasek nad kanwą zadania
export const newTaskText = (title: string, who: Who) => `Dodałem zadanie „${shortTitle(title)}”. ${who.text}`;

// ---------- kolejka wiadomości Piotra w zadaniu (paczka 2, punkt 1) ----------
// odmiana: „1 wiadomość”, „2 wiadomości”, „5 wiadomości”; „Twoją wiadomość” / „Twoje 2 wiadomości”
export const msgCount = (n: number) => `${n} ${n === 1 ? "wiadomość" : "wiadomości"}`;
export const yourMsgs = (n: number) => (n === 1 ? "Twoją wiadomość" : `Twoje ${n} wiadomości`);          // biernik: „odpowie na …”
export const yourMsgsNom = (n: number) => (n === 1 ? "Twoja wiadomość" : `${n} Twoje wiadomości`);        // mianownik: dopisek w pasku
const overMsgs = (n: number) => (n === 1 ? "Twoją wiadomością" : `Twoimi ${n} wiadomościami`);            // narzędnik: „pracuje nad …”
const waiting = (n: number) => (n === 1 ? "1 wiadomość czeka" : `${n} wiadomości czekają`);
// stan kolejki: kto zajmie się wiadomościami bez odpowiedzi i kiedy. text = linia na karcie nad dokiem i w pasku nad kanwą (z czynnością mostka obok, gdy pracuje),
// short = linia pod dymkiem w historii; activity = bieg mostka nad tym zadaniem (kropki i minuty)
export type Queue = { n: number; kind: "working" | "busy" | "soon" | "auto"; who: string; text: string; short: string; activity: LiveActivity | null };
export function queueWho(w: Worker, taskId: string, n: number, busy: string | null = null, now = new Date()): Queue {
  const b = bridgeLabel(w);
  if (w.run && w.run.taskId === taskId) return { n, kind: "working", who: b, text: `${b} pracuje nad ${overMsgs(n)}`, short: "Mostek pracuje nad tym", activity: w.run };
  if (w.run) return { n, kind: "busy", who: b, text: `${b} kończy${busy ? `: ${busy}` : " inną pracę"}, potem przeczyta ${yourMsgs(n)}`, short: `Czeka: mostek kończy${busy ? ` „${shortTitle(busy, 40)}”` : " inną pracę"}`, activity: null };
  if (w.alive) return { n, kind: "soon", who: b, text: `${waiting(n)} na mostek · weźmie ${n === 1 ? "ją" : "je"} w ciągu minuty`, short: "Czeka na mostek · weźmie w ciągu minuty", activity: null };
  const a = nextAutoAt(now);
  return { n, kind: "auto", who: `Claude ${a.text}`, text: `${waiting(n)} na Claude · zajrzy ${a.text} (automat ${AUTO_EVERY})`, short: `Czeka na Claude ${a.text}`, activity: null };
}
// wszystkie kroki gotowe, ale zadanie nie zamyka się, dopóki agent nie odpowie na wiadomości
export const allDoneWaitText = (q: Queue) => `Wszystkie kroki gotowe; czekam, aż ${q.kind === "auto" ? "Claude" : "mostek"} odpowie na ${yourMsgs(q.n)}.`;
