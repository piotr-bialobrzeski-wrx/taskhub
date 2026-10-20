// Dymki agenta w prawym dolnym rogu: ostatnie odpowiedzi z historii rozmowy (najnowsza na dole), tylko świeże, żeby rano nie wracały wczorajsze;
// i dymek pracy (paczka 7, punkt 3): co Claude robi teraz nad tym zadaniem albo co się dzieje z wysłaną wiadomością, zanim ktoś ją weźmie.
import { fmtTime, nextAutoAt } from "./clock";
import { holdText, msgCount, type Worker } from "./auto";
import { nowText } from "./live";
import type { ChatMessage } from "./repo";
import type { Task } from "./schema";

// steps: inne kroki, których agent dotknął w tym biegu (małe przyciski „04”, „05” obok „Otwórz krok 03”)
export type FeedItem = { id: string; text: string; at: string; stepId: string | null; link: string | null; steps: string[] };
export const FEED_MAX = 3;
const FRESH_MS = 12 * 3600_000;

export function agentFeed(log: ChatMessage[], now = Date.now()): FeedItem[] {
  return log.filter((m) => m.role === "agent" && now - new Date(m.createdAt).getTime() < FRESH_MS).slice(-FEED_MAX).map((m) => {
    const a = (m.actions ?? null) as { stepId?: string; link?: string; steps?: unknown } | null;
    const steps = Array.isArray(a?.steps) ? a.steps.filter((x): x is string => typeof x === "string") : [];
    return { id: m.id, text: m.text, at: fmtTime(m.createdAt), stepId: a?.stepId ?? null, link: a?.link ?? null, steps };
  });
}

// ---------- dymek pracy ----------
// working: mostek pracuje nad tym zadaniem (albo wziął jego wiadomość): co robi teraz, które kroki w tej pracy, skąd i od kiedy, „Zatrzymaj” dla biegu v2.
// sent: wiadomość Piotra czeka: kto ją weźmie i kiedy (jedna linia tytułu, czasem druga), z cytatem i podpisem „Ty · 19:41”.
export type WorkChip = { id: string; label: string; now: boolean };
export type WorkBubble =
  | { kind: "working"; runId: string; quote: string | null; now: string; detail: string | null; chips: WorkChip[]; more: number; where: string; since: string; at: string; later: number; stoppable: boolean }
  | { kind: "sent"; id: string; title: string; line: string | null; quote: string; at: string };
export const CHIPS_MAX = 2;
const pad = (n: number) => String(n).padStart(2, "0");

export function workBubble({ task, w, pending, busy, now = new Date() }: { task: Pick<Task, "id" | "steps">; w: Worker; pending: ChatMessage[]; busy: string | null; now?: Date }): WorkBubble | null {
  const run = w.run, newest = pending.at(-1) ?? null;
  const taken = pending.filter((m) => m.seenAt && run && m.seenAt >= run.since);
  if (run && run.kind !== "send" && (run.taskId === task.id || taken.length)) {
    const here = run.taskId === task.id;
    const idx = run.stepId ? task.steps.findIndex((s) => s.id === run.stepId) + 1 : 0;
    const nowLine = !here ? "kończy inne zadanie" : !task.steps.length ? "rozpisuje kroki" : nowText(run, idx || null);
    // kroki tej pracy: krok „teraz” pierwszy, potem dotknięte w kolejności kroków; nad chipami się nie zawija, reszta jako „+N”
    const touched = task.steps.filter((s) => s.id !== run.stepId && run.steps?.[s.id]);
    const all = [...(idx ? [task.steps[idx - 1]] : []), ...touched].map((s) => ({ id: s.id, label: pad(task.steps.indexOf(s) + 1), now: s.id === run.stepId }));
    return {
      kind: "working", runId: run.runId ?? "", quote: taken.at(-1)?.text ?? null, now: nowLine, detail: here ? run.detail : busy, chips: all.slice(0, CHIPS_MAX), more: Math.max(0, all.length - CHIPS_MAX),
      where: run.bridge, since: run.since, at: fmtTime(run.since), later: pending.filter((m) => !m.seenAt).length, stoppable: !!run.stoppable,
    };
  }
  if (!newest) return null;
  const base = { kind: "sent" as const, id: newest.id, quote: newest.text, at: fmtTime(newest.createdAt), line: null };
  if (run && run.kind === "send") return { ...base, title: "Wysłane, Claude zacznie po bieżącej wysyłce" };
  if (run) return { ...base, title: "Wysłane, Claude zacznie po bieżącej pracy", line: busy ? `Teraz kończy: „${busy}”` : null };
  if (w.alive && w.hold) return { ...base, title: `Wysłane, ale ${w.name ? w.name : "Mac"} stoi: ${holdText(w.hold)}` };
  if (w.alive) return { ...base, title: "Wysłane, Claude zaraz zacznie" };
  if (newest.seenAt) return { ...base, title: `Claude w chmurze wziął to o ${fmtTime(newest.seenAt)}` };
  return { ...base, title: `${w.name ? w.name : "Mac"} śpi, weźmie to automat ${nextAutoAt(now).text}` };
}
// stopka dymka w toku: „MacBook Piotra · od 19:41 · potem 1 wiadomość”
export const workFoot = (b: Extract<WorkBubble, { kind: "working" }>) => [b.where, `od ${b.at}`, b.later ? `potem ${msgCount(b.later)}` : null].filter(Boolean).join(" · ");
