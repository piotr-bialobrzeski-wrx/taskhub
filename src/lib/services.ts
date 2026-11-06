// Operacje złożone używane przez UI i przez serwer MCP: ta sama logika w obu miejscach.
import { Ai } from "./ai";
import * as repo from "./repo";
import { composeStep } from "./agent/compose";
import { closingNote, draftStep, reviewReport } from "./agent/notes";
import { scoreAll, type Scored } from "./agent/context";
import { calibrationFor, remainEst } from "./time";
import { assignLanes, LANES } from "./canvas/lanes";
import { stepAsked, taskTile, taskWaits } from "./canvas/vm";
import { daysBetween, presetGroups, type PresetKey } from "./canvas/presets";
import { dayKey } from "./clock";
import { isComplete } from "./priority";
import { type Step, type Task } from "./schema";
import { bridgeHold, busyWith, queueWho, type Queue, type Worker } from "./auto";
import { BRIDGE_ALIVE_MS } from "./bridge";
import { liveActivity } from "./live";

export async function aiFor(ownerId: string): Promise<Ai> {
  const [u] = await (await import("./db")).sql()`select settings from users where id = ${ownerId}`;
  const pref = (u?.settings as { aiProvider?: string } | undefined)?.aiProvider ?? null;
  return new Ai(pref);
}

// „Ułóż” na głównej kanwie (paczka 31, wariant C „Pilne i szybkie”): każde otwarte zadanie trafia do jednego z czterech pól (grup z lane),
// pola układają się w macierz 2×2 (src/lib/canvas/layout.ts). Grupy, które przez to zostały puste, znikają; „Cofnij” je odtwarza.
export async function layoutLanes(ownerId: string): Promise<void> {
  const b = await bundle(ownerId);
  const today = dayKey(new Date());
  const open = b.scored.filter((s) => !s.task.deletedAt && !isComplete(s.task))
    .map((s) => ({ id: s.task.id, lane: s.task.lane ?? null, eff: s.score.eff, remainMin: remainEst(s.task), hasSteps: s.task.steps.length > 0, due: s.task.due, today, waiting: taskWaits(s.task, b.tasks).length > 0 }));
  const lanes = assignLanes(open);
  await repo.clearTaskPositions(ownerId);
  let groups = await repo.listGroups(ownerId, null);
  for (const l of LANES) {
    const g = groups.find((x) => x.lane === l.key);
    if (g) await repo.updateGroup(ownerId, g.id, { name: l.name, members: lanes[l.key], auto: true });
    else await repo.createGroup(ownerId, null, l.name, lanes[l.key], undefined, { lane: l.key, color: l.color });
  }
  groups = await repo.listGroups(ownerId, null);
  for (const g of groups) if (g.lane) continue; else if (!g.members.length) await repo.deleteGroup(ownerId, g.id); else await repo.updateGroup(ownerId, g.id, { auto: true });
}

// Gotowe układy z menu „Ułóż” (paczka 40): liczone od razu na serwerze, bez agenta. Wszystkie grupy kanwy znikają, powstają nowe
// grupy automatyczne w stałej kolejności, położenia kafelków liczą się od nowa (rozkład w kształcie ekranu robi kanwa).
// „Pilne i szybkie” to dotychczasowe pola (layoutLanes).
export async function layoutPreset(ownerId: string, key: PresetKey): Promise<void> {
  if (key === "lanes") return layoutLanes(ownerId);
  const b = await bundle(ownerId);
  const open = b.scored.filter((s) => !s.task.deletedAt && !isComplete(s.task));
  let look: (s: Scored) => ReturnType<typeof taskTile>["look"] = () => ({ key: "plan-ag", label: "" });
  if (key === "state") {
    const [questions, st, stepChat] = await Promise.all([repo.listQuestions(ownerId, { open: true }), repo.bridgeStatus(ownerId, BRIDGE_ALIVE_MS), repo.listPendingStepChat(ownerId)]);
    const q = new Map<string, number>(); questions.forEach((x) => q.set(x.taskId, (q.get(x.taskId) ?? 0) + 1));
    const run = liveActivity(st.run), asked = stepAsked(stepChat);
    look = (s) => taskTile(s, b.tasks, q.get(s.task.id) ?? 0, run, 0, asked).look;
  }
  const today = dayKey(new Date());
  const tasks = open.map((s) => {
    const l = look(s);
    return { id: s.task.id, eff: s.score.eff, remainMin: remainEst(s.task), due: s.task.due, projectId: s.task.projectId ?? null,
      dueDays: s.task.due ? daysBetween(today, s.task.due.slice(0, 10)) : null, look: l.key, mine: l.key === "mine" || l.key === "help", hasSteps: s.task.steps.length > 0 };
  });
  const groups = presetGroups(key, tasks, b.projects.map((p) => ({ id: p.id, name: p.name, color: p.color, weight: p.weight })));
  await repo.deleteCanvasGroups(ownerId);
  await repo.clearTaskPositions(ownerId);
  for (const g of groups) await repo.createGroup(ownerId, null, g.name, g.ids, undefined, { color: g.color });
}

export type Bundle = { tasks: Task[]; scored: Scored[]; projects: Awaited<ReturnType<typeof repo.listProjects>>; companies: Awaited<ReturnType<typeof repo.listCompanies>>; connections: Awaited<ReturnType<typeof repo.listConnections>>; rules: Awaited<ReturnType<typeof repo.listRules>>; samples: Awaited<ReturnType<typeof repo.listSamples>> };
// full: zadanie otwarte na stronie przychodzi w całości także wtedy, gdy jest zamknięte (lista trzyma zamknięte bez treści kartek)
export async function bundle(ownerId: string, full: string | null = null): Promise<Bundle> {
  const [tasks, projects, companies, connections, rules, samples] = await Promise.all([repo.listTasks(ownerId, { all: true, full }), repo.listProjects(ownerId), repo.listCompanies(ownerId), repo.listConnections(ownerId), repo.listRules(ownerId), repo.listSamples(ownerId)]);
  return { tasks, projects, companies, connections, rules, samples, scored: scoreAll(tasks, projects, samples) };
}

// kolejka wiadomości Piotra w zadaniu: ile czeka bez odpowiedzi i kto się nimi zajmie (historia rozmowy, karta nad dokiem); null, gdy nic nie czeka
// thread (paczka 57): kolejka jednego wątku (krok albo samo zadanie); bez niego całe zadanie
export async function taskQueue(ownerId: string, taskId: string, thread?: repo.ChatThread): Promise<Queue | null> {
  const [pending, st, tasks] = await Promise.all([repo.listPendingChat(ownerId, taskId, thread), repo.bridgeStatus(ownerId, BRIDGE_ALIVE_MS), repo.listTasks(ownerId)]);
  if (!pending.length) return null;
  const w: Worker = { alive: st.alive, name: st.name, run: liveActivity(st.run), hold: bridgeHold(st.meta, st.pause) };
  return queueWho(w, taskId, pending.length, busyWith(w.run, tasks));
}

// krok gotowy: zapis, uczenie z czasu, odbiór raportu, notatka końcowa gdy to był ostatni krok; chosen = opcja wybrana w kroku bez zgody (repo.completeStep)
export async function finishStep(ownerId: string, taskId: string, stepId: string, opts: { report?: string; link?: string; output?: string; addSpentSec?: number; addAgentSec?: number; by?: "owner" | "agent"; chosen?: number } = {}): Promise<{ task: Task; closed: boolean }> {
  const task = await repo.getTask(ownerId, taskId); if (!task) throw new Error("Nie ma takiego zadania");
  const step = task.steps.find((s) => s.id === stepId); if (!step) throw new Error("Nie ma takiego kroku");
  await repo.completeStep(ownerId, task, step, opts);
  const fresh = (await repo.getTask(ownerId, taskId))!;
  const ai = await aiFor(ownerId);
  const closed = !!fresh.doneAt && !task.doneAt;
  if (ai.enabled) {
    const s = fresh.steps.find((x) => x.id === stepId)!;
    const jobs: Promise<unknown>[] = [];
    if (s.report) jobs.push(reviewReport(ai, fresh, s).catch(() => undefined));
    if (closed) jobs.push(closingNote(ai, ownerId, fresh).catch(() => undefined));
    await Promise.all(jobs);
  }
  return { task: (await repo.getTask(ownerId, taskId))!, closed };
}

export async function prepareStep(ownerId: string, taskId: string, stepId: string): Promise<void> {
  const task = await repo.getTask(ownerId, taskId); if (!task) throw new Error("Nie ma takiego zadania");
  const step = task.steps.find((s) => s.id === stepId); if (!step) throw new Error("Nie ma takiego kroku");
  const ai = await aiFor(ownerId);
  if (!ai.enabled) throw new Error("Agent niedostępny: brak klucza modelu");
  const [rules, projects] = await Promise.all([repo.listRules(ownerId), repo.listProjects(ownerId)]);
  const project = projects.find((p) => p.id === task.projectId);
  await draftStep(ai, task, step, rules, project?.name, project?.companyId ?? null);
}

export async function composeFlow(ownerId: string, taskId: string, stepId: string): Promise<void> {
  const task = await repo.getTask(ownerId, taskId); if (!task) throw new Error("Nie ma takiego zadania");
  const step = task.steps.find((s) => s.id === stepId); if (!step) throw new Error("Nie ma takiego kroku");
  const [ai, rules, factPrefs, projects] = await Promise.all([aiFor(ownerId), repo.listRules(ownerId), repo.factPreferencesText(ownerId), repo.listProjects(ownerId)]);
  const project = projects.find((p) => p.id === task.projectId);
  await composeStep(ownerId, task, step, { ai, rules, factPrefs, projectName: project?.name, companyId: project?.companyId ?? null });
}

export async function stepCalibration(ownerId: string, step: Step) {
  return calibrationFor(await repo.listSamples(ownerId), step.tool);
}
