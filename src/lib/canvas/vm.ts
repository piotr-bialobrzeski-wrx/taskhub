// Modele kafelków liczone na serwerze: stan, etykiety, teksty czasu i terminu. Klient tylko rysuje.
import type { Scored } from "../agent/context";
import { dueLeftH, isComplete, whyText } from "../priority";
import { agentMinOf, estOf, fmtMin, spentMin, taskAgent, taskEst, taskSpent } from "../time";
import { isOwnerStep, toolLabel, type Step, type Task } from "../schema";
import { destOf, tileDest, tileDestHref, whoDid } from "../stepcard";
import type { StepStateKey, StepTile, TaskStateKey, TaskTile } from "@/components/canvas/ui";

export { fmtDate, fmtTime } from "../clock";   // zawsze czas polski (serwer liczy w UTC)
import { fmtDate, fmtTime } from "../clock";
import { onTileText, type LiveActivity } from "../live";

export function dueOf(due: string | null, now = Date.now()): TaskTile["due"] {
  if (!due) return null;
  const h = dueLeftH(due, now);
  return { iso: due, cls: h < 0 ? "late" : h < 48 ? "soon" : "", text: h < 0 ? "po terminie" : fmtDate(due + "T12:00") };
}

// zadania, na które to zadanie czeka (nieukończone, nie w koszu)
export const taskWaits = (t: Task, all: Task[]) => t.dependsOn.map((id) => all.find((x) => x.id === id)).filter((x): x is Task => !!x && !x.deletedAt && !isComplete(x));

export function taskStateOf(t: Task, all: Task[]): TaskStateKey {
  if (isComplete(t) || t.doneAt) return "done";
  if (taskWaits(t, all).length) return "blocked";
  if (t.steps.some((s) => s.status === "draft")) return "draft";
  if (t.steps.some((s) => s.status === "done" || s.status === "handoff")) return "active";
  return "new";
}
export function stepStateOf(t: Task, s: Step, all: Task[]): StepStateKey {
  if (s.status === "done") return "done";
  if (s.status === "draft") return "draft";
  if (s.status === "handoff") return "handoff";
  if (taskWaits(t, all).length) return "blocked";
  return s.dependsOn.every((d) => t.steps.find((x) => x.id === d)?.status === "done") ? "ready" : "blocked";
}

// czas na kafelku zadania: szacunek i czas Piotra (jego kroki); zadanie bez kroków Piotra pokazuje czas Claude'a
export function estText(t: Task): string {
  if (!t.steps.length) return "bez kroków";
  if (t.steps.some(isOwnerStep)) return `~${fmtMin(taskEst(t))}${taskSpent(t) ? ` / ${fmtMin(taskSpent(t))}` : ""}`;
  const a = taskAgent(t);
  return a ? `Claude ${fmtMin(a)}` : "tylko Claude";
}

// activity: co mostek robi teraz, gdy pracuje nad tym zadaniem (kafelek pokazuje to zamiast licznika); pending: wiadomości Piotra bez odpowiedzi
export function taskTile(s: Scored, all: Task[], questions: number, live: LiveActivity | null = null, pending = 0): TaskTile {
  const t = s.task, state = taskStateOf(t, all);
  return {
    activity: taskActivity(t.id, live), pending,
    id: t.id, title: t.title, summary: state === "done" && t.noteSummary ? t.noteSummary : t.summary, state,
    base: s.score.base, eff: s.score.eff, why: whyText(s.score),
    project: s.project ? { id: s.project.id, name: s.project.name, color: s.project.color } : null,
    due: dueOf(t.due),
    progress: { done: t.steps.filter((x) => x.status === "done").length, all: t.steps.length },
    estText: estText(t),
    drafts: t.steps.filter((x) => x.status === "draft").length,
    handed: t.steps.filter((x) => x.status === "handoff").length,
    questions,
    tool: t.steps[0]?.tool ?? "claude",
    pos: t.pos, dependsOn: t.dependsOn,
  };
}

// bieg mostka związany z tym zadaniem: wiersz czynności na kafelku zadania (kanwa główna i kafelek zadania na kanwie kroków)
export const taskActivity = (taskId: string, live: LiveActivity | null): TaskTile["activity"] => (live && live.taskId === taskId ? { text: onTileText(live.text), detail: live.detail, since: live.since } : null);

export function stepTile(t: Task, s: Step, all: Task[], live: LiveActivity | null = null): StepTile & { toolName: string } {
  const state = stepStateOf(t, s, all);
  const m = tileMeta(t, s, state);
  // krok zrobiony przez Claude bez śladu na zewnątrz (wysyłka, zmiany w kodzie) jest przygaszony: kroki Piotra widać od razu
  const dim = state === "done" && whoDid(s) === "Claude" && !(s.blocks ?? []).some((b) => (b.type === "draft" && b.status === "sent") || b.type === "changes");
  // praca na żywo (paczka 7, punkt 3): krok „teraz” biegu ma biegnące światełko, kroki dotknięte w tym biegu stałą obwódkę z tym, co Claude zrobił;
  // po biegu kropka, póki Piotr nie otworzy zmienionego kroku (nigdy razem z obwódką)
  const run = live?.steps?.[s.id] ?? null;
  const glow: StepTile["glow"] = live?.stepId === s.id ? "live" : run ? "touched" : null;
  const touched = glow === "touched" && run ? `Claude ${run.what} · ${fmtTime(run.at)}` : null;
  const fresh = !glow && !!s.agentAt && (!s.openedAt || s.agentAt > s.openedAt);
  const activity = live && live.stepId === s.id ? { text: onTileText(live.text), detail: live.detail, since: live.since } : null;
  return { id: s.id, idx: t.steps.indexOf(s) + 1, title: s.title, tool: s.tool, toolName: toolLabel(s.tool), state, ...m, dim, glow, touched, fresh, pos: s.pos, dependsOn: s.dependsOn, activity };
}

// jedna dolna linia kafelka i wiersza listy: praca w toku → dokąd poszło albo pójdzie → kto zrobił, o której, ile to zajęło → plan
// (po czym; krok Piotra: szacunek i jego czas, krok Claude'a: „Claude” i jego czas)
export function tileMeta(t: Task, s: Step, state: StepStateKey): { meta: string; dest: string | null; destHref: string | null } {
  if (state === "handoff" && s.handoffAt) return { meta: `Pracuje od ${fmtTime(s.handoffAt)}`, dest: null, destHref: null };
  const d = destOf(s);
  const dest = tileDest(d, s);
  if (dest) return { meta: dest, dest, destHref: tileDestHref(d, s) };
  if (state === "done") {
    const who = whoDid(s), took = who === "Ty" ? spentMin(s) : agentMinOf(s);
    return { meta: [who, s.doneAt ? fmtTime(s.doneAt) : null, took ? fmtMin(took) : null].filter(Boolean).join(" · "), dest: null, destHref: null };
  }
  const deps = s.dependsOn.map((x) => t.steps.findIndex((y) => y.id === x) + 1).filter((n) => n > 0);
  const plan = deps.length ? "Po kroku " + deps.join(", ") : "Start od razu";
  const time = isOwnerStep(s) ? `~${fmtMin(estOf(s))}${spentMin(s) ? ` / ${fmtMin(spentMin(s))}` : ""}` : `Claude${agentMinOf(s) ? " " + fmtMin(agentMinOf(s)) : ""}`;
  return { meta: `${plan} · ${time}${s.needsApproval ? " · zatw." : ""}`, dest: null, destHref: null };
}
