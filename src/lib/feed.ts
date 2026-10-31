// Zdarzenia agenta (paczka 31, wariant C dymków: lista „Co się stało” w panelu kolejki, bez stosu dymków): ostatnie odpowiedzi z historii rozmowy (najnowsza na dole), tylko świeże, żeby rano nie wracały wczorajsze;
// i dymek pracy (paczka 7, punkt 3): co Claude robi teraz nad tym zadaniem albo co się dzieje z wysłaną wiadomością, zanim ktoś ją weźmie.
import { fmtTime, nextAutoAt } from "./clock";
import { holdText, msgCount, type Worker } from "./auto";
import { nowText } from "./live";
import type { ChatMessage } from "./repo";
import type { Task } from "./schema";
import type { AgentQueue } from "./agent/work";

// kolejka agenta: wszystkie wiadomości z głównej kanwy i paska to jedna pozycja (paczka 29)
export const CANVAS_KEY = "chat:canvas";

// steps: inne kroki, których agent dotknął w tym biegu (małe przyciski „04”, „05” obok „Otwórz krok 03”)
// open: odpowiedź z głównej kanwy prowadzi do zadania albo kroku (reply_canvas, paczka 29): przycisk „Otwórz zadanie” / „Otwórz krok 02”
// need (paczka 31, wariant C dymków): zdarzenie dotyczy kroku, który czeka na Piotra (jego otwarty krok albo szkic do zgody); na liście
// „Co się stało” stoi na górze, barwi licznik w pigułce i nie znika po „Wyczyść”, tylko gdy krok przestanie czekać
export type FeedItem = { id: string; text: string; at: string; stepId: string | null; link: string | null; steps: string[]; open?: { href: string; label: string } | null; need?: boolean };
export const FEED_MAX = 8;
const FRESH_MS = 12 * 3600_000;

export function agentFeed(log: ChatMessage[], now = Date.now(), waiting?: (stepId: string) => boolean): FeedItem[] {
  return log.filter((m) => m.role === "agent" && now - new Date(m.createdAt).getTime() < FRESH_MS).slice(-FEED_MAX).map((m) => {
    const a = (m.actions ?? null) as { stepId?: string; link?: string; steps?: unknown; taskId?: string; label?: string } | null;
    const steps = Array.isArray(a?.steps) ? a.steps.filter((x): x is string => typeof x === "string") : [];
    const open = typeof a?.taskId === "string" ? { href: `/tasks/${a.taskId}${a.stepId ? `?step=${a.stepId}` : ""}`, label: a.stepId && a.label ? `Otwórz krok ${a.label}` : "Otwórz zadanie" } : null;
    const need = !!(waiting && typeof a?.stepId === "string" && waiting(a.stepId));
    return { id: m.id, text: m.text, at: fmtTime(m.createdAt), stepId: open ? null : a?.stepId ?? null, link: a?.link ?? null, steps, open, need };
  });
}

// ---------- dymek pracy ----------
// working: mostek pracuje nad tym zadaniem (albo wziął jego wiadomość): co robi teraz, które kroki w tej pracy, skąd i od kiedy, „Zatrzymaj” dla biegu v2.
// sent: wiadomość Piotra czeka: kto ją weźmie i kiedy (jedna linia tytułu, czasem druga), z cytatem i podpisem „Ty · 19:41”.
export type WorkChip = { id: string; label: string; now: boolean };
export type WorkBubble =
  | { kind: "working"; head?: string; runId: string; quote: string | null; now: string; detail: string | null; chips: WorkChip[]; more: number; where: string; since: string; at: string; later: number; stoppable: boolean }
  | { kind: "sent"; id: string; title: string; line: string | null; quote: string; at: string; queue?: SentQueue };
// paczka 18: wiadomość czeka w kolejce agenta: pozycja (1 = następna), z ilu, kto teraz pracuje (link do zadania), klucz do „Następne”
export type SentQueue = { pos: number; of: number; key: string; nowTask: { id: string; title: string } | null };
export const CHIPS_MAX = 2;
const pad = (n: number) => String(n).padStart(2, "0");

export function workBubble({ task, w, pending, busy, queue = null, now = new Date() }: { task: Pick<Task, "id" | "steps">; w: Worker; pending: ChatMessage[]; busy: string | null; queue?: AgentQueue | null; now?: Date }): WorkBubble | null {
  const run = w.run, newest = pending.at(-1) ?? null;
  const taken = pending.filter((m) => m.seenAt && run && m.seenAt >= run.since);
  if (run && run.kind !== "send" && (run.taskId === task.id || taken.length)) {
    // główna kanwa (task.id pusty, paczka 29): bieg wziął wiadomość z kanwy
    const canvas = !task.id;
    const here = !canvas && run.taskId === task.id;
    const idx = here && run.stepId ? task.steps.findIndex((s) => s.id === run.stepId) + 1 : 0;
    const nowLine = canvas ? "robi to, o co prosisz" : !here ? "kończy inne zadanie" : !task.steps.length ? "rozpisuje kroki" : nowText(run, idx || null);
    // kroki tej pracy: krok „teraz” pierwszy, potem dotknięte w kolejności kroków; nad chipami się nie zawija, reszta jako „+N”
    const touched = task.steps.filter((s) => s.id !== run.stepId && run.steps?.[s.id]);
    const all = [...(idx ? [task.steps[idx - 1]] : []), ...touched].map((s) => ({ id: s.id, label: pad(task.steps.indexOf(s) + 1), now: s.id === run.stepId }));
    return {
      kind: "working", ...(canvas ? { head: "Claude czyta Twoją wiadomość" } : {}), runId: run.runId ?? "", quote: taken.at(-1)?.text ?? null, now: nowLine, detail: here ? run.detail : busy, chips: all.slice(0, CHIPS_MAX), more: Math.max(0, all.length - CHIPS_MAX),
      where: run.bridge, since: run.since, at: fmtTime(run.since), later: pending.filter((m) => !m.seenAt).length, stoppable: !!run.stoppable,
    };
  }
  if (!newest) return null;
  const base = { kind: "sent" as const, id: newest.id, quote: newest.text, at: fmtTime(newest.createdAt), line: null };
  // kolejka agenta: wiadomość tego zadania ma swoje miejsce w kolejce, a Claude pracuje gdzie indziej albo przed nią jest inna praca
  const key = task.id ? `chat:${task.id}` : CANVAS_KEY, at = queue ? queue.items.findIndex((x) => x.key === key) : -1;
  if (queue && at >= 0 && (run || at > 0) && !(run && run.kind === "send")) {
    const nowTask = queue.now?.taskId ? { id: queue.now.taskId, title: queue.now.taskTitle } : null;
    return { ...base, title: `W kolejce: ${at + 1}. z ${queue.items.length}`, line: nowTask ? `Claude kończy zadanie „${nowTask.title}”` : null, queue: { pos: at + 1, of: queue.items.length, key, nowTask } };
  }
  if (run && run.kind === "send") return { ...base, title: "Wysłane, Claude zacznie po bieżącej wysyłce" };
  if (run) return { ...base, title: "Wysłane, Claude zacznie po bieżącej pracy", line: busy ? `Teraz kończy: „${busy}”` : null };
  if (w.alive && w.hold) return { ...base, title: `Wysłane, ale ${w.name ? w.name : "Mac"} stoi: ${holdText(w.hold)}` };
  if (w.alive) return { ...base, title: "Wysłane, Claude zaraz zacznie" };
  if (newest.seenAt) return { ...base, title: `Claude w chmurze wziął to o ${fmtTime(newest.seenAt)}` };
  return { ...base, title: `${w.name ? w.name : "Mac"} śpi, weźmie to automat ${nextAutoAt(now).text}` };
}
// stopka dymka w toku: „MacBook Piotra · od 19:41 · potem 1 wiadomość”
export const workFoot = (b: Extract<WorkBubble, { kind: "working" }>) => [b.where, `od ${b.at}`, b.later ? `potem ${msgCount(b.later)}` : null].filter(Boolean).join(" · ");

// krok czeka na Piotra: jego otwarty krok (nie w pracy agenta) albo szkic do zgody
export const stepWaits = (s: Pick<Task["steps"][number], "status" | "tool"> | undefined | null): boolean =>
  !!s && s.status !== "done" && s.status !== "handoff" && (s.status === "draft" || s.tool === "manual");
