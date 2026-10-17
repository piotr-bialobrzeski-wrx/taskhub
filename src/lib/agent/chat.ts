// Czat z agentem: jedna odpowiedź JSON z akcjami. Agent nigdy nie usuwa.
import { z } from "zod";
import { Ai, type ImageInput } from "../ai";
import * as repo from "../repo";
import { contextText } from "./context";
import { Fact, type Task } from "../schema";

const Krok = z.object({
  id: z.string().optional(),
  title: z.string(),
  tool: z.string().default("manual"),
  detail: z.string().default(""),
  dependsOn: z.array(z.string()).default([]),
  needsApproval: z.boolean().default(false),
  est: z.number().int().optional(),
  link: z.string().optional(),
});
const Action = z.discriminatedUnion("type", [
  z.object({ type: z.literal("create_task"), title: z.string(), level: z.number().int().min(1).max(5).optional(), summary: z.string().optional(), due: z.string().nullable().optional(), project: z.string().nullable().optional(), steps: z.array(Krok).optional(), link: z.enum(["after_current", "before_current", "none"]).optional() }),
  z.object({ type: z.literal("add_steps"), steps: z.array(Krok) }),
  z.object({ type: z.literal("update_task"), id: z.string(), title: z.string().optional(), summary: z.string().optional(), level: z.number().int().min(1).max(5).optional(), due: z.string().nullable().optional(), project: z.string().nullable().optional() }),
  z.object({ type: z.literal("update_step"), id: z.string(), title: z.string().optional(), detail: z.string().optional(), status: z.enum(["done", "todo"]).optional(), link: z.string().optional(), est: z.number().int().optional() }),
  z.object({ type: z.literal("set_facts"), stepId: z.string(), facts: z.array(Fact).max(12) }),
  z.object({ type: z.literal("create_group"), name: z.string(), taskIds: z.array(z.string()) }),
]);
export type ChatAction = z.infer<typeof Action>;
export const ChatResult = z.object({
  reply: z.string(),
  actions: z.array(Action).max(12).default([]),
  attachments: z.array(z.object({ caption: z.string(), analysis: z.string() })).optional(),
});
export type ChatResult = z.infer<typeof ChatResult>;

const SYSTEM = `Jesteś agentem w aplikacji Task Hub (zarządzanie zadaniami jednej osoby, Piotra). Piotr pisze do Ciebie z pola czatu.
Najpierw rozumiesz wiadomość w kontekście MIEJSCA, w którym jest Piotr, ale nie jesteś do niego ograniczony: możesz tworzyć nowe zadania na głównej kanwie, zmieniać inne zadania i łączyć je kolejnością.
Narzędzia kroków (pole "tool"): "slack", "gmail", "clickup", "calendar", "github", "figma", "claude" (krótka analiza lub tekst pisany tutaj, w aplikacji), "manual" (Piotr osobiście), "browser" (agent w przeglądarce), "claudeapp" (praca w Claude: prototypy, artefakty, dokumenty, dłuższa praca twórcza), "code" (kod w Claude Code). Prototyp, aplikacja, strona lub dłuższy dokument to zawsze "claudeapp" albo "code", nigdy "claude".
Akcje (tylko gdy wiadomość o to prosi; na pytanie po prostu odpowiedz):
- create_task {title, level 1-5, summary, due "YYYY-MM-DD"|null, project nazwa|null, steps [KROK], link "after_current"|"before_current"|"none"} - nowe zadanie; "link" ma sens tylko wewnątrz zadania.
- add_steps {steps [KROK]} - nowe kroki w obecnym zadaniu; dependsOn może wskazywać id istniejących kroków.
- update_task {id, title?, summary?, level?, due?, project?}
- update_step {id, title?, detail?, status? "done"|"todo", link?, est?}
- set_facts {stepId, facts [{label, value, source {app, ref, url}}]} - gdy Piotr podaje informacje do kroku (adresat, termin, lista).
- create_group {name, taskIds} - tylko na głównej kanwie, gdy Piotr mówi, ile ma czasu (np. „mam 1,5 h”): wybierz otwarte zadania mieszczące się w czasie, najpierw bliski termin i wysoki priorytet, nazwij np. „Na 1,5 h” i wypisz je w reply z czasami.
KROK = {id "n1", title, tool, detail jedno zdanie, dependsOn [], needsApproval true dla wszystkiego, co wysyła coś na zewnątrz, est minuty (wielokrotność 15, min 15, wg kalibracji), link gdy znany}
Zasady: nic nie usuwaj. Tytuły zadań maks. 7 słów od czasownika; tytuły kroków maks. 6 słów. Nowe zadanie ma 3-8 kroków. Priorytet nowych zadań oceń z treści; gdy Piotr poda priorytet, użyj go. Gdy Piotr opisuje nową sprawę na głównej kanwie, utwórz z niej zadanie. Stosuj ZASADY PRACY z kontekstu (język projektu, styl).
Gdy dołączono grafiki, dodaj "attachments": [{caption maks. 6 słów, analysis: co przedstawia, cały istotny tekst i liczby dosłownie, wnioski}] w tej samej kolejności.
Odpowiedz wyłącznie JSON: {"reply": "1-4 zdania po polsku", "actions": [...], "attachments"?: [...]}`;

export type ChatDeps = { ai: Ai; ownerId: string; taskId: string | null; images?: ImageInput[] };
export type Done = { label: string; taskId?: string };

export async function runChat(text: string, deps: ChatDeps): Promise<{ reply: string; done: Done[]; result: ChatResult }> {
  const [tasks, projects, companies, rules, samples, factPrefs, hist] = await Promise.all([
    repo.listTasks(deps.ownerId, { all: true }), repo.listProjects(deps.ownerId), repo.listCompanies(deps.ownerId), repo.listRules(deps.ownerId), repo.listSamples(deps.ownerId), repo.factPreferencesText(deps.ownerId), repo.listChat(deps.ownerId, deps.taskId, 6),
  ]);
  const ctx = contextText({ tasks, projects, companies, rules, samples, factPrefs, currentTaskId: deps.taskId });
  const prompt = `${ctx}

${hist.length ? "OSTATNIA ROZMOWA W TYM MIEJSCU:\n" + hist.map((m) => `${m.role === "user" ? "Piotr" : "Agent"}: ${m.text.slice(0, 600)}`).join("\n") + "\n\n" : ""}${deps.images?.length ? `Dołączono ${deps.images.length} grafik(i).\n` : ""}WIADOMOŚĆ PIOTRA:
${text}`;
  const result = await deps.ai.json({ system: SYSTEM, prompt, schema: ChatResult, images: deps.images, effort: "medium" });
  const done = await applyActions(result, { ...deps, tasks });
  await repo.addChat(deps.ownerId, deps.taskId, "user", text);
  await repo.addChat(deps.ownerId, deps.taskId, "agent", result.reply, result.actions);
  return { reply: result.reply, done, result };
}

async function projectIdFor(ownerId: string, name: string | null | undefined): Promise<string | null | undefined> {
  if (name === undefined) return undefined;
  if (!name) return null;
  const found = await repo.findProjectByName(ownerId, name);
  return (found ?? (await repo.createProject(ownerId, name))).id;
}

export async function applyActions(r: ChatResult, deps: ChatDeps & { tasks: Task[] }): Promise<Done[]> {
  const done: Done[] = [];
  const cur = deps.taskId ? deps.tasks.find((t) => t.id === deps.taskId) ?? null : null;
  for (const a of r.actions) {
    if (a.type === "create_task") {
      const projectId = await projectIdFor(deps.ownerId, a.project);
      const t = await repo.createTask(deps.ownerId, {
        title: a.title, summary: a.summary, level: a.level ?? 3, due: a.due ?? null, projectId: projectId ?? cur?.projectId ?? null,
        steps: (a.steps ?? []).map((s) => ({ title: s.title, tool: s.tool, detail: s.detail, needsApproval: s.needsApproval, estMin: s.est, link: s.link, dependsOn: s.dependsOn })),
        dependsOn: cur && a.link === "after_current" ? [cur.id] : [],
      });
      if (cur && a.link === "before_current") await repo.setTaskDependencies(cur.id, [...cur.dependsOn, t.id]);
      done.push({ label: "Nowe zadanie: " + t.title, taskId: t.id });
    } else if (a.type === "add_steps" && cur) {
      const steps = await repo.addSteps(cur.id, a.steps.map((s) => ({ title: s.title, tool: s.tool, detail: s.detail, needsApproval: s.needsApproval, estMin: s.est, link: s.link, dependsOn: s.dependsOn })));
      done.push({ label: `Dodano ${steps.length} krok(i)`, taskId: cur.id });
    } else if (a.type === "update_task") {
      const t = deps.tasks.find((x) => x.id === a.id); if (!t) continue;
      const projectId = await projectIdFor(deps.ownerId, a.project);
      await repo.updateTask(deps.ownerId, t.id, { title: a.title, summary: a.summary, level: a.level, due: a.due, projectId });
      done.push({ label: "Zmieniono: " + (a.title ?? t.title), taskId: t.id });
    } else if (a.type === "update_step" && cur) {
      const s = cur.steps.find((x) => x.id === a.id); if (!s) continue;
      await repo.updateStep(s.id, { title: a.title, detail: a.detail, link: a.link && /^https?:\/\//.test(a.link) ? a.link : undefined, estMin: a.est });
      if (a.status === "done" && s.status !== "done") await repo.completeStep(deps.ownerId, cur, s);
      if (a.status === "todo" && s.status === "done") await repo.reopenStep(deps.ownerId, cur.id, s);
      done.push({ label: "Zmieniono krok: " + (a.title ?? s.title), taskId: cur.id });
    } else if (a.type === "set_facts" && cur) {
      const s = cur.steps.find((x) => x.id === a.stepId); if (!s) continue;
      await repo.replaceFacts({ stepId: s.id }, a.facts.map((f) => ({ ...f, source: f.source ?? { app: "manual" } })));
      done.push({ label: "Fakty: " + s.title, taskId: cur.id });
    } else if (a.type === "create_group" && !deps.taskId) {
      const ids = a.taskIds.filter((id) => deps.tasks.some((t) => t.id === id && !t.deletedAt));
      if (ids.length) { await repo.createGroup(deps.ownerId, null, a.name, ids); done.push({ label: "Grupa: " + a.name }); }
    }
  }
  return done;
}
