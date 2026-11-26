// Paczka 42 (wpisy czasu, krok 07): praca w Task Hub z jednego dnia jako materiał do wpisów czasu. Narzędzie MCP day_work daje agentowi kroki
// zamknięte (albo z czasem Piotra zapisanym) tego dnia w zadaniach projektów firm zawodowych, z czasem Piotra i Claude'a i ticketem ClickUp,
// gdy zadanie go wskazuje; kilka kroków przy tym samym tickecie łączy się w jedną pozycję z sumą (zasada „jeden ticket = jeden wpis”).
// Zaokrąglenie, projekt, kategorię i tagi dobiera agent według procedury wpisów czasu; tu nic nie wie o Pirxey Time.
export type DayWorkStep = {
  stepId: string; stepTitle: string; taskId: string; taskTitle: string; project: string | null; company: string | null;
  ownerSec: number; agentSec: number; link: string | null; taskLinks: string[];
};
export type DayWorkItem = {
  ticket: string | null; ticketUrl: string | null; company: string | null; project: string | null; task: string;
  ownerMin: number; agentMin: number; steps: { id: string; title: string; ownerMin: number; agentMin: number }[];
};
const CLICKUP = /https?:\/\/(?:app\.)?clickup\.com\/t\/(?:\d+\/)?([A-Za-z0-9_-]+)/;
export function ticketOf(links: (string | null)[]): { id: string; url: string } | null {
  for (const l of links) { const m = l ? CLICKUP.exec(l) : null; if (m) return { id: m[1], url: m[0] }; }
  return null;
}
const min = (sec: number) => Math.round(sec / 60);
// pozycje dnia: jeden ticket = jedna pozycja (sumy z kroków wszystkich zadań przy nim); bez ticketu jedna pozycja na zadanie
export function groupDayWork(steps: DayWorkStep[]): DayWorkItem[] {
  const out = new Map<string, DayWorkItem>();
  for (const s of steps) {
    const t = ticketOf([s.link, ...s.taskLinks]);
    const key = t ? "t:" + t.id : "z:" + s.taskId;
    const it = out.get(key) ?? { ticket: t?.id ?? null, ticketUrl: t?.url ?? null, company: s.company, project: s.project, task: s.taskTitle, ownerMin: 0, agentMin: 0, steps: [] };
    it.steps.push({ id: s.stepId, title: s.stepTitle, ownerMin: min(s.ownerSec), agentMin: min(s.agentSec) });
    it.ownerMin += min(s.ownerSec); it.agentMin += min(s.agentSec);
    out.set(key, it);
  }
  return [...out.values()];
}

// Paczka 69 (zadanie „Start i koniec pracy we wpisach czasu”, krok 03): godzina pierwszej i ostatniej aktywności Piotra w Task Hub tego dnia
// (HH:MM, Europe/Warsaw) jako materiał do startu i końca dnia we wpisach czasu. Aktywność = jego wiadomość w zadaniu (także odpowiedź
// na pytanie z kartki), odpowiedź na pytanie agenta, zgoda na szkic, krok zamknięty przez niego, zapis jego czasu. Liczą się tylko zadania
// projektów firm zawodowych; zadania z samymi wpisami czasu (kroki-arkusze) nie, bo to rozliczanie pracy, nie praca.
export type ActivityKind = "message" | "answer" | "approval" | "close" | "time";
export type ActivityEvent = { kind: ActivityKind; at: string; taskId: string; taskTitle: string };
export type DayActivity = { first: string; last: string; firstKind: ActivityKind; lastKind: ActivityKind; firstTask: string; lastTask: string; events: number };
const HHMM = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Warsaw", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
export const warsawHHMM = (iso: string) => HHMM.format(new Date(iso));
export function dayActivity(events: ActivityEvent[]): DayActivity | null {
  const ok = events.filter((e) => !Number.isNaN(Date.parse(e.at))).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  if (!ok.length) return null;
  const f = ok[0], l = ok[ok.length - 1];
  return { first: warsawHHMM(f.at), last: warsawHHMM(l.at), firstKind: f.kind, lastKind: l.kind, firstTask: f.taskTitle, lastTask: l.taskTitle, events: ok.length };
}
