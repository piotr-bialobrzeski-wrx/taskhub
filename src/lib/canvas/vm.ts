// Modele kafelków liczone na serwerze: stan, etykiety, teksty czasu i terminu. Klient tylko rysuje.
import type { Scored } from "../agent/context";
import { dueLeftH, isComplete, whyText } from "../priority";
import { agentMinOf, estOf, fmtMin, remainEst, spentMin, taskAgent, taskEst, taskSpent } from "../time";
import { isOwnerStep, toolLabel, type Step, type Task } from "../schema";
import { destOf, tileDest, tileDestHref, whoDid } from "../stepcard";
import type { Look, StepStateKey, StepTile, TaskStateKey, TaskTile } from "@/components/canvas/ui";

export { fmtDate, fmtTime } from "../clock";   // zawsze czas polski (serwer liczy w UTC)
import { fmtDate, fmtTime } from "../clock";
import { onTileText, type LiveActivity } from "../live";

export function dueOf(due: string | null, now = Date.now()): TaskTile["due"] {
  if (!due) return null;
  const h = dueLeftH(due, now);
  return { iso: due, cls: h < 0 ? "late" : h < 48 ? "soon" : "", text: h < 0 ? "po terminie" : fmtDate(due + "T12:00") };
}

// zadania, na które to zadanie czeka (nieukończone, nie w koszu)
// paczka 32: czy zadanie self po dopisaniu zależności after czekałoby pośrednio samo na siebie
export function chainLoops(all: Pick<Task, "id" | "dependsOn">[], self: string, after: string[]): boolean {
  const seen = new Set<string>(), todo = [...after];
  while (todo.length) {
    const id = todo.pop()!;
    if (id === self) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    todo.push(...(all.find((t) => t.id === id)?.dependsOn ?? []));
  }
  return false;
}
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

// wygląd kafelka kroku (paczka 18, tabela stanów z kroku „Zdecyduj o ramkach i etykietach kafelka”):
// Agent pracuje (bieg mostka „teraz”, krok w toku, zlecenie do chmury; zlecone w rozmowie, a czekające na inne kroki to Zaplanowane) → Agent oddał → Twoja kolej (szkic, decyzja, czynność) → Zaplanowane (kto zrobi) → Zrobione
const DECIDE_RE = /^\s*(zdecyduj|wybierz|rozstrzygnij)\b/i;
// asked: godzina najstarszej wiadomości Piotra przy tym kroku bez odpowiedzi agenta (paczka 32): Piotr już coś zlecił na kartce,
// więc krok nie czeka na niego, tylko na agenta („Zlecone agentowi · 10:30”, kolor agenta); gdy bieg nad nim siedzi, „Agent pracuje”
export function stepLook(s: Step, state: StepStateKey, now: boolean, asked: string | null = null): Look {
  if (state === "done") return { key: "done", label: "Zrobione" };
  // zatwierdzony szkic czeka na bieg wysyłki: agent weźmie go sam, ale jeszcze nie pracuje
  const sendWait = state === "handoff" && !!s.approvedAt && !s.agentStartedAt;
  if (now || (s.cloud && s.cloud.state !== "auto") || (state === "handoff" && !sendWait)) return { key: "live", label: "Agent pracuje" };
  if (asked) return { key: "plan-ag", label: `Zlecone agentowi · ${fmtTime(asked)}` };
  if (s.leftAt) return { key: "help", label: "Potrzebna pomoc" };
  // paczka 22: szkic bez zgody mówi wprost, że czeka (bez ptaszka, który wyglądał jak „zatwierdzone”); po zgodzie godzina kliknięcia Piotra
  if (state === "draft") return { key: "mine", label: "Czeka na Twoją zgodę" };
  if (sendWait) return { key: "plan-ag", label: `Zatwierdziłeś ${fmtTime(s.approval?.at ?? s.approvedAt!)}` };
  const own = isOwnerStep(s);
  if (state === "ready" && own) {
    const ask = (s.blocks ?? []).some((b) => b.type === "question") || DECIDE_RE.test(s.title);
    return { key: "mine", label: ask ? "Zdecyduj" : "Zrób" };
  }
  // zlecone do chmury, a czekające na inne kroki (zgoda z rozmowy albo z decyzji, paczka 22): ruszy samo, więc to nie Twoja kolej
  return { key: own && s.cloud?.state !== "auto" ? "plan-me" : "plan-ag", label: "Zaplanowane" };
}
// krok „teraz” biegu: wskazany przez agenta albo, gdy bieg pracuje w zadaniu bez wskazania kroku (np. po rozpisaniu od razu zbiera fakty
// do szkicu), pierwszy gotowy krok agenta; inaczej taki krok udawałby „Zaplanowane” z przyciskiem „Uruchom”, choć agent już nad nim siedzi
export function liveStepId(t: Task, all: Task[], live: LiveActivity | null): string | null {
  if (!live || live.taskId !== t.id) return null;
  if (live.stepId) return t.steps.some((x) => x.id === live.stepId) ? live.stepId : null;
  if (live.kind === "send") return null;
  return t.steps.find((x) => x.status === "todo" && !isOwnerStep(x) && !x.cloud && stepStateOf(t, x, all) === "ready")?.id ?? null;
}
// kafelek zadania bierze stan najważniejszego kroku w kolejności: Agent pracuje, Twoja kolej, Agent oddał, Zaplanowane (kolor wg pierwszego otwartego kroku).
// Paczka 32: praca agenta nad którymkolwiek krokiem wygrywa, żeby na głównej kanwie było widać, że zadanie jest w toku; gdy przy tym
// coś czeka na Piotra (Zdecyduj, Zrób, zgoda, pomoc), pasek pokazuje to po prawej (also), więc jego kolej nie znika
export function taskLook(t: Task, state: TaskStateKey, steps: Look[], working: boolean, questions: number): Look {
  if (state === "done") return { key: "done", label: "Zrobione" };
  // paczka 32: zadanie w łańcuchu czeka na wcześniejsze zadanie; jego kroki jeszcze nie są niczyją kolejką
  if (state === "blocked") return { key: "plan-ag", label: "Czeka na inne zadanie" };
  const yours = steps.find((l) => l.key === "mine") ?? (questions ? { key: "mine" as const, label: "Zdecyduj" } : null) ?? steps.find((l) => l.key === "help") ?? null;
  if (working || steps.some((l) => l.key === "live")) return yours ? { key: "live", label: "Agent pracuje", also: { key: yours.key, label: yours.label } } : { key: "live", label: "Agent pracuje" };
  if (yours) return yours;
  const next = t.steps.findIndex((x) => x.status !== "done");
  return next >= 0 ? steps[next] : { key: "plan-ag", label: "Zaplanowane" };
}

// czas na kafelku zadania: szacunek i czas Piotra (jego kroki); zadanie bez kroków Piotra pokazuje czas Claude'a
export function estText(t: Task): string {
  if (!t.steps.length) return "bez kroków";
  if (t.steps.some(isOwnerStep)) return `~${fmtMin(taskEst(t))}${taskSpent(t) ? ` / ${fmtMin(taskSpent(t))}` : ""}`;
  const a = taskAgent(t);
  return a ? `Claude ${fmtMin(a)}` : "tylko Claude";
}

// activity: co mostek robi teraz, gdy pracuje nad tym zadaniem (kafelek pokazuje to zamiast licznika); pending: wiadomości Piotra bez odpowiedzi
// asked: krok → godzina najstarszej wiadomości Piotra przy nim bez odpowiedzi (stepAsked)
export function taskTile(s: Scored, all: Task[], questions: number, live: LiveActivity | null = null, pending = 0, asked: Map<string, string> = new Map()): TaskTile {
  const t = s.task, state = taskStateOf(t, all);
  const activity = taskActivity(t.id, live);
  const nowId = liveStepId(t, all, live);
  const looks = t.steps.map((x) => stepLook(x, stepStateOf(t, x, all), nowId === x.id, asked.get(x.id) ?? null));
  return {
    look: taskLook(t, state, looks, !!activity, questions),
    draw: drawInfo(t, state, looks, questions),
    activity, pending,
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

// losowanie zadania (paczka 32): zadanie bierze udział, gdy Piotr ma w nim następny krok (Zrób, Zdecyduj, zgoda na szkic) albo pytanie od agenta;
// min = ile jego pracy zostało (ten sam szacunek co „Piotrowi zostało”), step = tytuł jego pierwszego kroku na kafelku wyniku
export function drawInfo(t: Task, state: TaskStateKey, looks: Look[], questions: number): TaskTile["draw"] {
  if (state === "done" || state === "blocked") return null;
  const i = looks.findIndex((l) => l.key === "mine");
  if (i < 0 && !questions) return null;
  return { min: remainEst(t), step: i >= 0 ? t.steps[i].title : "Odpowiedz na pytanie agenta" };
}

// bieg mostka związany z tym zadaniem: wiersz czynności na kafelku zadania (kanwa główna i kafelek zadania na kanwie kroków)
export const taskActivity = (taskId: string, live: LiveActivity | null): TaskTile["activity"] => (live && live.taskId === taskId ? { text: onTileText(live.text), detail: live.detail, since: live.since } : null);

// wiadomości Piotra bez odpowiedzi agenta → krok, przy którym je napisał, i godzina najstarszej (kafelek „Zlecone agentowi”)
export function stepAsked(pending: { actions: unknown; createdAt: string }[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const x of pending) {
    const id = (x.actions as { stepId?: string } | null)?.stepId;
    if (id && (!m.has(id) || x.createdAt < m.get(id)!)) m.set(id, x.createdAt);
  }
  return m;
}

export function stepTile(t: Task, s: Step, all: Task[], live: LiveActivity | null = null, asked: string | null = null): StepTile & { toolName: string } {
  const state = stepStateOf(t, s, all);
  const m = tileMeta(t, s, state);
  // krok zrobiony przez Claude bez śladu na zewnątrz (wysyłka, zmiany w kodzie) jest przygaszony: kroki Piotra widać od razu
  const dim = state === "done" && whoDid(s) === "Claude" && !(s.blocks ?? []).some((b) => (b.type === "draft" && b.status === "sent") || b.type === "changes");
  // praca na żywo (paczka 7, punkt 3): krok „teraz” biegu ma biegnące światełko, kroki dotknięte w tym biegu stałą obwódkę z tym, co Claude zrobił;
  // po biegu kropka, póki Piotr nie otworzy zmienionego kroku (nigdy razem z obwódką)
  const run = live?.steps?.[s.id] ?? null;
  const now = liveStepId(t, all, live) === s.id;
  const glow: StepTile["glow"] = now ? "live" : run ? "touched" : null;
  const touched = glow === "touched" && run ? `Claude ${run.what} · ${fmtTime(run.at)}` : null;
  const fresh = !glow && !!s.agentAt && (!s.openedAt || s.agentAt > s.openedAt);
  const activity = live && now ? { text: onTileText(live.text), detail: live.detail, since: live.since } : null;
  return { id: s.id, idx: t.steps.indexOf(s) + 1, title: s.title, tool: s.tool, toolName: toolLabel(s.tool), state, ...m, dim, glow, touched, fresh, pos: s.pos, dependsOn: s.dependsOn, activity, look: stepLook(s, state, glow === "live", asked) };
}

// jedna dolna linia kafelka i wiersza listy: praca w toku → dokąd poszło albo pójdzie → kto zrobił, o której, ile to zajęło → plan
// (po czym; krok Piotra: szacunek i jego czas, krok Claude'a: „Claude” i jego czas)
export function tileMeta(t: Task, s: Step, state: StepStateKey): { meta: string; dest: string | null; destHref: string | null } {
  // zatwierdzony szkic czeka na bieg wysyłki: nikt jeszcze nie pracuje, dolna linia mówi, dokąd pójdzie (paczka 22)
  if (state === "handoff" && s.handoffAt && !(s.approvedAt && !s.agentStartedAt)) return { meta: `Pracuje od ${fmtTime(s.handoffAt)}`, dest: null, destHref: null };
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
