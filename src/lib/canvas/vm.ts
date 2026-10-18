// Modele kafelków liczone na serwerze: stan, etykiety, teksty czasu i terminu. Klient tylko rysuje.
import type { Scored } from "../agent/context";
import { dueLeftH, isComplete, whyText } from "../priority";
import { estOf, fmtMin, spentMin, taskEst, taskSpent } from "../time";
import { toolLabel, type Step, type Task } from "../schema";
import type { StepStateKey, StepTile, TaskStateKey, TaskTile } from "@/components/canvas/ui";

export { fmtDate, fmtTime } from "../clock";   // zawsze czas polski (serwer liczy w UTC)
import { fmtDate, fmtTime } from "../clock";
import type { LiveActivity } from "../live";

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

export const estText = (t: Task) => (t.steps.length ? `~${fmtMin(taskEst(t))}${taskSpent(t) ? ` / ${fmtMin(taskSpent(t))}` : ""}` : "bez kroków");

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
export const taskActivity = (taskId: string, live: LiveActivity | null): TaskTile["activity"] => (live && live.taskId === taskId ? { text: live.text, detail: live.detail, since: live.since } : null);

export function stepTile(t: Task, s: Step, all: Task[], live: LiveActivity | null = null): StepTile & { toolName: string } {
  const state = stepStateOf(t, s, all);
  // bieg mostka związany z tym krokiem (start_step), albo jedyny krok w toku w zadaniu, nad którym mostek pracuje
  const mine = !!live && state === "handoff" && (live.stepId === s.id || (!live.stepId && live.taskId === t.id && t.steps.filter((x) => x.status === "handoff").length === 1));
  const deps = s.dependsOn.map((d) => t.steps.findIndex((x) => x.id === d) + 1).filter((n) => n > 0);
  const meta = state === "handoff" && s.handoffAt
    ? `Pracuje od ${fmtTime(s.handoffAt)}`
    : `${deps.length ? "Po kroku " + deps.join(", ") : "Start od razu"} · ${fmtMin(estOf(s))}${spentMin(s) ? ` / ${fmtMin(spentMin(s))}` : ""}${s.needsApproval ? " · zatw." : ""}`;
  return { id: s.id, idx: t.steps.indexOf(s) + 1, title: s.title, tool: s.tool, toolName: toolLabel(s.tool), state, meta, pos: s.pos, dependsOn: s.dependsOn, activity: mine ? { text: live!.text, detail: live!.detail, since: live!.since } : null };
}
