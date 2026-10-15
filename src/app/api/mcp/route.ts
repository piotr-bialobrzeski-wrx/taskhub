// Serwer MCP Task Hub: Claude, Claude Code, ChatGPT i własne agenty podłączają się tutaj tokenem.
// Dostają zadania z zasadami i kontekstem, zgłaszają wyniki kroków, dopisują fakty i migawki.
import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import * as repo from "@/lib/repo";
import { contextText, brief, scoreAll } from "@/lib/agent/context";
import { rulesText } from "@/lib/agent/context";
import { finishStep } from "@/lib/services";
import { Fact } from "@/lib/schema";

export const maxDuration = 60;

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
const json = (v: unknown) => text(JSON.stringify(v, null, 1));

function buildHandler(ownerId: string) {
  return createMcpHandler((server) => {
    server.registerTool("list_tasks", {
      title: "Lista zadań", description: "Otwarte zadania z priorytetem efektywnym, stanem, szacunkami i terminami. Opcjonalnie szukaj po tekście.",
      inputSchema: z.object({ query: z.string().optional(), includeDone: z.boolean().optional() }),
    }, async ({ query, includeDone }) => {
      const [tasks, projects, samples] = await Promise.all([query ? repo.searchTasks(ownerId, query) : repo.listTasks(ownerId), repo.listProjects(ownerId), repo.listSamples(ownerId)]);
      const scored = scoreAll(tasks, projects, samples).filter((s) => includeDone || !s.task.doneAt);
      return text(scored.map(brief).join("\n") || "(brak zadań)");
    });

    server.registerTool("get_task", {
      title: "Zadanie z kontekstem", description: "Pełny kontekst jednego zadania: cel, jak wpadło, kroki z faktami i linkami, zasady pracy dla projektu i narzędzi, notatki.",
      inputSchema: z.object({ taskId: z.string() }),
    }, async ({ taskId }) => {
      const [tasks, projects, rules, samples, factPrefs] = await Promise.all([repo.listTasks(ownerId, { all: true }), repo.listProjects(ownerId), repo.listRules(ownerId), repo.listSamples(ownerId), repo.factPreferencesText(ownerId)]);
      const t = tasks.find((x) => x.id === taskId); if (!t) return text("Nie ma takiego zadania.");
      const facts = await Promise.all(t.steps.map(async (s) => [s.id, await repo.listFacts({ stepId: s.id })] as const));
      const ctx = contextText({ tasks, projects, rules, samples, factPrefs, currentTaskId: taskId });
      const fx = facts.filter(([, f]) => f.length).map(([id, f]) => `FAKTY KROKU ${id}:\n${f.filter((x) => !x.hidden).map((x) => `- ${x.label}: ${x.value}${x.source ? ` (${x.source.app}${x.source.url ? ", " + x.source.url : ""})` : ""}`).join("\n")}`).join("\n");
      return text(ctx + (fx ? "\n" + fx : ""));
    });

    server.registerTool("get_rules", {
      title: "Zasady pracy", description: "Zasady: ogólne, projektu i narzędzi (styl pisania, język, gdzie szukać).",
      inputSchema: z.object({ projectId: z.string().optional(), tools: z.array(z.string()).optional() }),
    }, async ({ projectId, tools }) => text(rulesText(await repo.listRules(ownerId), projectId ?? null, tools ?? []) || "(brak zasad)"));

    server.registerTool("create_task", {
      title: "Nowe zadanie", description: "Tworzy zadanie z krokami. Kroki: tool (slack, gmail, clickup, calendar, claude, claudeapp, code, manual...), est w minutach (wielokrotność 15), dependsOn jako n1, n2 (numery kroków w tej paczce).",
      inputSchema: z.object({
        title: z.string(), summary: z.string().optional(), source: z.string().optional(), level: z.number().int().min(1).max(5).optional(), due: z.string().optional(), project: z.string().optional(),
        steps: z.array(z.object({ title: z.string(), tool: z.string().optional(), detail: z.string().optional(), needsApproval: z.boolean().optional(), est: z.number().int().optional(), link: z.string().optional(), dependsOn: z.array(z.string()).optional() })).optional(),
      }),
    }, async (a) => {
      let projectId: string | null = null;
      if (a.project) projectId = ((await repo.findProjectByName(ownerId, a.project)) ?? (await repo.createProject(ownerId, a.project))).id;
      const t = await repo.createTask(ownerId, { title: a.title, summary: a.summary, source: a.source, level: a.level, due: a.due ?? null, projectId, steps: (a.steps ?? []).map((s) => ({ ...s, estMin: s.est })) });
      return json({ taskId: t.id, steps: t.steps.map((s) => ({ id: s.id, title: s.title })) });
    });

    server.registerTool("update_task", {
      title: "Zmień zadanie", description: "Zmienia tytuł, cel, priorytet, termin albo projekt zadania.",
      inputSchema: z.object({ taskId: z.string(), title: z.string().optional(), summary: z.string().optional(), level: z.number().int().min(1).max(5).optional(), due: z.string().nullable().optional(), project: z.string().nullable().optional() }),
    }, async (a) => {
      let projectId: string | null | undefined;
      if (a.project !== undefined) projectId = a.project ? ((await repo.findProjectByName(ownerId, a.project)) ?? (await repo.createProject(ownerId, a.project))).id : null;
      await repo.updateTask(ownerId, a.taskId, { title: a.title, summary: a.summary, level: a.level, due: a.due, projectId });
      return text("Zmieniono.");
    });

    server.registerTool("add_steps", {
      title: "Dodaj kroki", description: "Dodaje kroki do zadania.",
      inputSchema: z.object({ taskId: z.string(), steps: z.array(z.object({ title: z.string(), tool: z.string().optional(), detail: z.string().optional(), needsApproval: z.boolean().optional(), est: z.number().int().optional(), link: z.string().optional(), dependsOn: z.array(z.string()).optional() })) }),
    }, async (a) => {
      const t = await repo.getTask(ownerId, a.taskId); if (!t) return text("Nie ma takiego zadania.");
      const steps = await repo.addSteps(t.id, a.steps.map((s) => ({ ...s, estMin: s.est })));
      return json(steps.map((s) => ({ id: s.id, title: s.title })));
    });

    server.registerTool("update_step", {
      title: "Zmień krok", description: "Zmienia tytuł, opis, szacunek albo link kroku.",
      inputSchema: z.object({ stepId: z.string(), title: z.string().optional(), detail: z.string().optional(), est: z.number().int().optional(), link: z.string().optional() }),
    }, async (a) => { await repo.updateStep(a.stepId, { title: a.title, detail: a.detail, estMin: a.est, link: a.link }); return text("Zmieniono."); });

    server.registerTool("complete_step", {
      title: "Krok gotowy", description: "Zgłasza wynik kroku: krótkie podsumowanie, link do wyniku, opcjonalnie czas w minutach. Gdy to ostatni krok, zadanie się kończy i agent pisze notatkę końcową.",
      inputSchema: z.object({ stepId: z.string(), summary: z.string(), link: z.string().optional(), spentMin: z.number().int().optional() }),
    }, async (a) => {
      const [row] = await (await import("@/lib/db")).sql()`select task_id from steps where id = ${a.stepId}`;
      if (!row) return text("Nie ma takiego kroku.");
      const r = await finishStep(ownerId, row.taskId as string, a.stepId, { report: a.summary, link: a.link, addSpentSec: a.spentMin ? a.spentMin * 60 : 0 });
      return text(r.closed ? "Krok zapisany, zadanie ukończone." : "Krok zapisany.");
    });

    server.registerTool("add_facts", {
      title: "Dopisz fakty", description: "Zapisuje istotne informacje do kroku z pochodzeniem (np. z ClickUp: lista, sprint, estymata).",
      inputSchema: z.object({ stepId: z.string(), facts: z.array(Fact).max(12), replace: z.boolean().optional() }),
    }, async (a) => {
      const old = a.replace ? [] : await repo.listFacts({ stepId: a.stepId });
      await repo.replaceFacts({ stepId: a.stepId }, [...old, ...a.facts]);
      return text("Zapisano fakty.");
    });

    server.registerTool("add_snapshot", {
      title: "Zapisz migawkę", description: "Zapisuje surowe dane z zewnętrznej aplikacji (np. cały ticket z ClickUp) przy kroku; agent w Task Hub wybierze z nich istotne pola.",
      inputSchema: z.object({ stepId: z.string(), app: z.string(), raw: z.unknown(), url: z.string().optional(), sourceId: z.string().optional() }),
    }, async (a) => { await repo.addSnapshot({ stepId: a.stepId }, a.app, a.raw, { url: a.url, sourceId: a.sourceId }); return text("Zapisano migawkę."); });

    server.registerTool("add_rule", {
      title: "Dodaj zasadę", description: "Dodaje zasadę pracy: scope global | project | tool.",
      inputSchema: z.object({ scope: z.enum(["global", "project", "tool"]), title: z.string(), body: z.string(), projectId: z.string().optional(), tool: z.string().optional() }),
    }, async (a) => { const r = await repo.upsertRule(ownerId, a); return json({ ruleId: r.id }); });
  }, { serverInfo: { name: "task-hub", version: "0.1.0" } });
}

async function authorize(req: Request): Promise<string | null> {
  const h = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  if (!m) return null;
  return repo.ownerForToken(m[1].trim());
}

async function handle(req: Request): Promise<Response> {
  const ownerId = await authorize(req);
  if (!ownerId) return new Response(JSON.stringify({ error: "Brak albo zły token. Nagłówek: Authorization: Bearer th_..." }), { status: 401, headers: { "content-type": "application/json", "www-authenticate": 'Bearer realm="task-hub"' } });
  return buildHandler(ownerId)(req);
}

export { handle as GET, handle as POST, handle as DELETE };
