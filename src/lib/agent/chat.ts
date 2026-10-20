// Czat z agentem: jedna odpowiedź JSON z akcjami. Agent nigdy nie usuwa.
import { z } from "zod";
import { Ai, type ImageInput } from "../ai";
import * as repo from "../repo";
import { contextText } from "./context";
import { Fact, type Task } from "../schema";
import { draftOf } from "./approval";

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
  z.object({ type: z.literal("update_step"), id: z.string(), title: z.string().optional(), detail: z.string().optional(), output: z.string().optional(), status: z.enum(["done", "todo"]).optional(), link: z.string().optional(), est: z.number().int().optional() }),
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
Narzędzia kroków (pole "tool"): "slack", "gmail", "clickup", "calendar", "github", "figma", "claude" (krótka analiza lub tekst pisany tutaj, w aplikacji), "manual" (Piotr osobiście), "browser" (agent w przeglądarce), "claudeapp" (praca w Claude: prototypy, artefakty, dokumenty, dłuższa praca twórcza), "code" (kod w Claude Code), "file" (plik na Macu Piotra: zapisuje go mostek, bez zgody). Prototyp, aplikacja, strona lub dłuższy dokument to zawsze "claudeapp" albo "code", nigdy "claude".
Akcje (tylko gdy wiadomość o to prosi; na pytanie po prostu odpowiedz):
- create_task {title (2–6 słów, samo sedno, nie cała wiadomość Piotra), level 1-5, summary, due "YYYY-MM-DD"|null, project nazwa|null, steps [KROK], link "after_current"|"before_current"|"none"} - nowe zadanie; "link" ma sens tylko wewnątrz zadania.
- add_steps {steps [KROK]} - nowe kroki w obecnym zadaniu; dependsOn może wskazywać id istniejących kroków.
- update_task {id, title?, summary?, level?, due?, project?}
- update_step {id, title?, detail?, output?, status? "done"|"todo", link?, est?} - output = poprawiona treść szkicu otwartego kroku (gdy Piotr prosi o zmianę w szkicu); zmienia też treść bloku draft.
- set_facts {stepId, facts [{label, value, source {app, ref, url}}]} - gdy Piotr podaje informacje do kroku (adresat, termin, lista).
- create_group {name, taskIds} - tylko na głównej kanwie, gdy Piotr mówi, ile ma czasu (np. „mam 1,5 h”): wybierz otwarte zadania mieszczące się w czasie, najpierw bliski termin i wysoki priorytet, nazwij np. „Na 1,5 h” i wypisz je w reply z czasami.
KROK = {id "n1", title (od czasownika, 2–6 słów, sedno), tool, detail jedno zdanie, dependsOn [], needsApproval true dla wszystkiego, co wysyła coś na zewnątrz, est minuty (wielokrotność 5, min 5, wg kalibracji), link gdy znany}
Zasady: nic nie usuwaj. Tytuły zadań maks. 7 słów od czasownika; tytuły kroków maks. 6 słów. Nowe zadanie ma 3-8 kroków. Priorytet nowych zadań oceń z treści; gdy Piotr poda priorytet, użyj go. Gdy Piotr opisuje nową sprawę na głównej kanwie, utwórz z niej zadanie. Stosuj ZASADY PRACY z kontekstu (język projektu, styl).
Gdy dołączono grafiki, dodaj "attachments": [{caption maks. 6 słów, analysis: co przedstawia, cały istotny tekst i liczby dosłownie, wnioski}] w tej samej kolejności.
Odpowiedz wyłącznie JSON: {"reply": "1-4 zdania po polsku", "actions": [...], "attachments"?: [...]}`;

export type ChatDeps = { ai: Ai; ownerId: string; taskId: string | null; stepId?: string | null; images?: ImageInput[] };
export type Done = { label: string; taskId?: string; note?: string };   // note: wyjaśnienie w rozmowie, gdy akcji nie dało się zrobić

export async function runChat(text: string, deps: ChatDeps): Promise<{ reply: string; done: Done[]; result: ChatResult }> {
  const [tasks, projects, companies, connections, rules, samples, factPrefs, hist] = await Promise.all([
    repo.listTasks(deps.ownerId, { all: true }), repo.listProjects(deps.ownerId), repo.listCompanies(deps.ownerId), repo.listConnections(deps.ownerId), repo.listRules(deps.ownerId), repo.listSamples(deps.ownerId), repo.factPreferencesText(deps.ownerId), repo.listChat(deps.ownerId, deps.taskId, 6),
  ]);
  const ctx = contextText({ tasks, projects, companies, connections, rules, samples, factPrefs, currentTaskId: deps.taskId });
  const step = deps.stepId ? tasks.find((t) => t.id === deps.taskId)?.steps.find((s) => s.id === deps.stepId) ?? null : null;
  const prompt = `${ctx}
${step ? stepContextText(step) + "\n" : ""}
${hist.length ? "OSTATNIA ROZMOWA W TYM MIEJSCU:\n" + hist.map((m) => `${m.role === "user" ? "Piotr" : "Agent"}: ${m.text.slice(0, 600)}`).join("\n") + "\n\n" : ""}${deps.images?.length ? `Dołączono ${deps.images.length} grafik(i).\n` : ""}WIADOMOŚĆ PIOTRA:
${text}`;
  const result = await deps.ai.json({ system: SYSTEM, prompt, schema: ChatResult, images: deps.images, effort: "medium" });
  const done = await applyActions(result, { ...deps, tasks });
  await repo.addChat(deps.ownerId, deps.taskId, "user", text, undefined, { seen: true });
  await repo.addChat(deps.ownerId, deps.taskId, "agent", result.reply, result.actions);
  for (const d of done) if (d.note) await repo.addChat(deps.ownerId, d.taskId ?? deps.taskId, "agent", d.note);
  return { reply: result.reply, done, result };
}

// otwarty krok w panelu: to jego dotyczy wiadomość, chyba że Piotr wskaże inaczej; agent widzi treść klocków i szkic
export function stepContextText(s: Task["steps"][number]): string {
  const blocks = (s.blocks ?? []).map((b) => {
    switch (b.type) {
      case "text": return `- notatka${b.title ? ` „${b.title}”` : ""}: ${b.body.slice(0, 600)}`;
      case "facts": return `- fakty: ${b.facts.map((f) => `${f.label}: ${f.value}`).join("; ").slice(0, 600)}`;
      case "thread": return `- wątek${b.source ? ` (${b.source.app}${b.source.ref ? " " + b.source.ref : ""})` : ""}: ${b.messages.slice(-5).map((m) => `${m.author}: ${m.text.slice(0, 200)}`).join(" | ")}`;
      case "mail": return `- mail${b.source?.ref ? ` (${b.source.ref})` : ""}: ${b.messages.slice(-2).map((m) => `od ${m.from}${m.subject ? ` „${m.subject}”` : ""}: ${m.text.slice(0, 300)}`).join(" | ")}`;
      case "comment": return `- komentarz ${b.author}${b.source?.ref ? ` w ${b.source.ref}` : ""}: ${b.text.slice(0, 300)}`;
      case "table": return `- tabela ${b.title ?? ""} (${b.columns.join(", ")}): ${b.rows.length} wierszy`;
      case "list": return `- lista${b.title ? ` „${b.title}”` : ""}: ${b.items.map((i) => i.title).join("; ").slice(0, 400)}`;
      case "draft": return `- SZKIC (${b.status}) do ${b.target.app}${b.target.where ? " " + b.target.where : ""}: ${b.subject ? `temat „${b.subject}”, ` : ""}${b.body.slice(0, 1200)}`;
      case "free": return `- treść: ${b.markdown.slice(0, 600)}`;
      case "question": return `- pytanie: ${b.text}${b.answer ? ` → ${b.answer}` : ""}`;
      default: return null;
    }
  }).filter(Boolean);
  return `OTWARTY KROK: [${s.id}] "${s.title}" (stan: ${s.status}). Piotr ma go otwarty w panelu, więc jego wiadomość dotyczy TEGO KROKU, chyba że wyraźnie wskaże inne miejsce. Prośba o poprawkę szkicu = update_step z nowym output albo odpowiedź z poprawioną treścią; pytanie o kontekst = odpowiedz z tego, co niżej.
Szczegóły: ${s.detail || "-"}${s.output ? `
Wynik/szkic: ${s.output.slice(0, 1200)}` : ""}${blocks.length ? `
Klocki panelu:
${blocks.join("\n")}` : ""}`;
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
      // poprawiony szkic trafia też do bloku draft, żeby karta publikacji pokazała nową treść
      const blocks = a.output !== undefined && s.blocks?.some((b) => b.type === "draft") ? s.blocks.map((b) => (b.type === "draft" && b.status !== "sent" ? { ...b, body: a.output!, status: "proposed" as const } : b)) : undefined;
      await repo.updateStep(s.id, { title: a.title, detail: a.detail, output: a.output, link: a.link && /^https?:\/\//.test(a.link) ? a.link : undefined, estMin: a.est, ...(blocks ? { blocks } : {}) });
      // stan po zmianie (poprawka treści kasuje zgodę na szkic)
      const fresh = blocks ? (await repo.getTask(deps.ownerId, cur.id))?.steps.find((x) => x.id === s.id) ?? s : s;
      if (a.status === "done" && fresh.status !== "done") {
        // zatwierdzony szkic wysyła mostek w osobnym biegu; czat nie może zamknąć kroku, jakby szkic poszedł
        if (draftOf(fresh)?.status === "approved" || fresh.approvedAt) { done.push({ label: "Nie zamknięto: " + s.title, taskId: cur.id, note: `Nie zamknąłem kroku „${s.title}”: jego zatwierdzony szkic wysyła mostek po zatwierdzeniu. Gdy wysyłka przejdzie, krok zamknie się sam; żeby go zatrzymać, użyj „Zatrzymaj” na karcie kroku.` }); continue; }
        await repo.completeStep(deps.ownerId, cur, fresh);
      }
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
