// Operacje złożone używane przez UI i przez serwer MCP: ta sama logika w obu miejscach.
import { Ai } from "./ai";
import * as repo from "./repo";
import { composeStep } from "./agent/compose";
import { closingNote, draftStep, reviewReport } from "./agent/notes";
import { scoreAll, type Scored } from "./agent/context";
import { calibrationFor } from "./time";
import { type Step, type Task } from "./schema";
import { busyWith, queueWho, type Queue, type Worker } from "./auto";
import { BRIDGE_ALIVE_MS } from "./bridge";
import { liveActivity } from "./live";

export async function aiFor(ownerId: string): Promise<Ai> {
  const [u] = await (await import("./db")).sql()`select settings from users where id = ${ownerId}`;
  const pref = (u?.settings as { aiProvider?: string } | undefined)?.aiProvider ?? null;
  return new Ai(pref);
}

export type Bundle = { tasks: Task[]; scored: Scored[]; projects: Awaited<ReturnType<typeof repo.listProjects>>; companies: Awaited<ReturnType<typeof repo.listCompanies>>; connections: Awaited<ReturnType<typeof repo.listConnections>>; rules: Awaited<ReturnType<typeof repo.listRules>>; samples: Awaited<ReturnType<typeof repo.listSamples>> };
export async function bundle(ownerId: string): Promise<Bundle> {
  const [tasks, projects, companies, connections, rules, samples] = await Promise.all([repo.listTasks(ownerId, { all: true }), repo.listProjects(ownerId), repo.listCompanies(ownerId), repo.listConnections(ownerId), repo.listRules(ownerId), repo.listSamples(ownerId)]);
  return { tasks, projects, companies, connections, rules, samples, scored: scoreAll(tasks, projects, samples) };
}

// kolejka wiadomości Piotra w zadaniu: ile czeka bez odpowiedzi i kto się nimi zajmie (historia rozmowy, karta nad dokiem); null, gdy nic nie czeka
export async function taskQueue(ownerId: string, taskId: string): Promise<Queue | null> {
  const [pending, st, tasks] = await Promise.all([repo.listPendingChat(ownerId, taskId), repo.bridgeStatus(ownerId, BRIDGE_ALIVE_MS), repo.listTasks(ownerId)]);
  if (!pending.length) return null;
  const w: Worker = { alive: st.alive, name: st.name, run: liveActivity(st.run) };
  return queueWho(w, taskId, pending.length, busyWith(w.run, tasks));
}

// krok gotowy: zapis, uczenie z czasu, odbiór raportu, notatka końcowa gdy to był ostatni krok
export async function finishStep(ownerId: string, taskId: string, stepId: string, opts: { report?: string; link?: string; output?: string; addSpentSec?: number } = {}): Promise<{ task: Task; closed: boolean }> {
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
