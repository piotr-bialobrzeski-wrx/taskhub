// Modele kafelków liczone na serwerze: stan, etykiety, teksty czasu i terminu. Klient tylko rysuje.
import type { Scored } from "../agent/context";
import { dueLeftH, isComplete, whyText } from "../priority";
import { estOf, fmtMin, spentMin, taskEst, taskSpent } from "../time";
import { toolLabel, type Step, type Task } from "../schema";
import type { StepStateKey, StepTile, TaskStateKey, TaskTile } from "@/components/canvas/ui";

export const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("pl-PL", { day: "numeric", month: "short" });
export const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });

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

export function taskTile(s: Scored, all: Task[], questions: number): TaskTile {
  const t = s.task, state = taskStateOf(t, all);
  return {
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

export function stepTile(t: Task, s: Step, all: Task[]): StepTile & { toolName: string } {
  const state = stepStateOf(t, s, all);
  const deps = s.dependsOn.map((d) => t.steps.findIndex((x) => x.id === d) + 1).filter((n) => n > 0);
  const meta = state === "handoff" && s.handoffAt
    ? `Pracuje od ${fmtTime(s.handoffAt)}`
    : `${deps.length ? "Po kroku " + deps.join(", ") : "Start od razu"} · ${fmtMin(estOf(s))}${spentMin(s) ? ` / ${fmtMin(spentMin(s))}` : ""}${s.needsApproval ? " · zatw." : ""}`;
  return { id: s.id, idx: t.steps.indexOf(s) + 1, title: s.title, tool: s.tool, toolName: toolLabel(s.tool), state, meta, pos: s.pos, dependsOn: s.dependsOn };
}
