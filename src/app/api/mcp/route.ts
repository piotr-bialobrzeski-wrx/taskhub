// Serwer MCP Task Hub: Claude, Claude Code, ChatGPT i własne agenty podłączają się tutaj tokenem (OAuth albo nagłówek).
// Dostają zadania z zasadami i kontekstem, zgłaszają wyniki kroków, dopisują fakty i migawki.
import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import * as repo from "@/lib/repo";
import { contextText, brief, scoreAll } from "@/lib/agent/context";
import { rulesText } from "@/lib/agent/context";
import { finishStep } from "@/lib/services";
import { Blocks, Fact } from "@/lib/schema";
import { sql } from "@/lib/db";
import { originOf, wwwAuthenticate } from "@/lib/oauth";
import { externalLink as externalLinkOf } from "@/lib/links";
import { appUrl } from "@/lib/session";

// link kroku to adres elementu w zewnętrznej aplikacji; adres samego Task Hub nie jest linkiem kroku
const externalLink = (link: string | undefined | null) => externalLinkOf(link, appUrl());

export const maxDuration = 60;

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
const json = (v: unknown) => text(JSON.stringify(v, null, 1));
// krok należy do właściciela tokenu? zwraca id zadania
async function ownedStep(ownerId: string, stepId: string): Promise<string | null> {
  const [r] = await sql()`select s.task_id from steps s join tasks t on t.id = s.task_id where s.id = ${stepId} and t.owner_id = ${ownerId}`;
  return r ? (r.taskId as string) : null;
}

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
      const qs = await repo.listQuestions(ownerId, { taskId });
      const qx = qs.length ? "PYTANIA DO PIOTRA (zadane w aplikacji):\n" + qs.map((q) => `- [${q.id}]${q.stepId ? ` krok ${q.stepId}` : ""} ${q.text} → ${q.answer ? `ODPOWIEDŹ: ${q.answer}` : "(czeka na odpowiedź)"}`).join("\n") : "";
      return text(ctx + (fx ? "\n" + fx : "") + (qx ? "\n" + qx : ""));
    });

    server.registerTool("get_rules", {
      title: "Zasady pracy", description: "Zasady: ogólne, projektu i narzędzi (styl pisania, język, gdzie szukać).",
      inputSchema: z.object({ projectId: z.string().optional(), tools: z.array(z.string()).optional() }),
    }, async ({ projectId, tools }) => text(rulesText(await repo.listRules(ownerId), projectId ?? null, tools ?? []) || "(brak zasad)"));

    server.registerTool("create_task", {
      title: "Nowe zadanie", description: "Tworzy zadanie z krokami. due: termin YYYY-MM-DD (ustaw, gdy w treści jest termin). Kroki: tool (slack, gmail, clickup, calendar, claude, claudeapp, code, manual...), est w minutach (wielokrotność 15), needsApproval gdy krok wysyła coś na zewnątrz, dependsOn jako n1, n2 (numery kroków w tej paczce), link tylko do elementu w zewnętrznej aplikacji (ticket, wydarzenie, mail), nigdy adres Task Hub.",
      inputSchema: z.object({
        title: z.string(), summary: z.string().optional(), source: z.string().optional(), level: z.number().int().min(1).max(5).optional(), due: z.string().optional(), project: z.string().optional(),
        steps: z.array(z.object({ title: z.string(), tool: z.string().optional(), detail: z.string().optional(), needsApproval: z.boolean().optional(), est: z.number().int().optional(), link: z.string().optional(), dependsOn: z.array(z.string()).optional() })).optional(),
      }),
    }, async (a) => {
      let projectId: string | null = null;
      if (a.project) projectId = ((await repo.findProjectByName(ownerId, a.project)) ?? (await repo.createProject(ownerId, a.project))).id;
      const t = await repo.createTask(ownerId, { title: a.title, summary: a.summary, source: a.source, level: a.level, due: a.due ?? null, projectId, steps: (a.steps ?? []).map((s) => ({ ...s, link: externalLink(s.link), estMin: s.est })) });
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
      title: "Dodaj kroki", description: "Dodaje kroki do zadania. Pola jak w create_task; link tylko do elementu w zewnętrznej aplikacji (ticket, wydarzenie, mail), nigdy adres Task Hub. Termin zadania ustaw osobno przez update_task(due).",
      inputSchema: z.object({ taskId: z.string(), steps: z.array(z.object({ title: z.string(), tool: z.string().optional(), detail: z.string().optional(), needsApproval: z.boolean().optional(), est: z.number().int().optional(), link: z.string().optional(), dependsOn: z.array(z.string()).optional() })) }),
    }, async (a) => {
      const t = await repo.getTask(ownerId, a.taskId); if (!t) return text("Nie ma takiego zadania.");
      const steps = await repo.addSteps(t.id, a.steps.map((s) => ({ ...s, link: externalLink(s.link), estMin: s.est })));
      return json(steps.map((s) => ({ id: s.id, title: s.title })));
    });

    server.registerTool("update_step", {
      title: "Zmień krok", description: "Zmienia tytuł, opis, szacunek albo link kroku (link = element w zewnętrznej aplikacji, np. utworzone wydarzenie albo ticket).",
      inputSchema: z.object({ stepId: z.string(), title: z.string().optional(), detail: z.string().optional(), est: z.number().int().optional(), link: z.string().optional() }),
    }, async (a) => {
      if (!(await ownedStep(ownerId, a.stepId))) return text("Nie ma takiego kroku.");
      await repo.updateStep(a.stepId, { title: a.title, detail: a.detail, estMin: a.est, link: a.link === undefined ? undefined : externalLink(a.link) ?? null }); return text("Zmieniono.");
    });

    server.registerTool("set_blocks", {
      title: "Ułóż panel kroku", description: "Zapisuje panel kroku z uniwersalnych bloków, tak jak robi to agent wbudowany: text, facts (fakty z pochodzeniem), thread (wątek wiadomości), draft (szkic do zatwierdzenia z target.app i target.where), list, media, link, question (pytanie z opcjami). Pokaż tylko to, co ważne dla tego kroku. rememberFor: nazwa aplikacji źródłowej, jeśli ten układ ma być wzorem dla podobnych kroków.",
      inputSchema: z.object({ stepId: z.string(), blocks: Blocks, rememberFor: z.string().optional() }),
    }, async (a) => {
      if (!(await ownedStep(ownerId, a.stepId))) return text("Nie ma takiego kroku.");
      await repo.updateStep(a.stepId, { blocks: a.blocks });
      if (a.rememberFor) await repo.setLayoutMemory(ownerId, a.rememberFor, a.blocks);
      return text("Panel zapisany.");
    });

    server.registerTool("complete_step", {
      title: "Krok gotowy", description: "Zgłasza wynik kroku: krótkie podsumowanie, link do wyniku, opcjonalnie czas w minutach. Gdy to ostatni krok, zadanie się kończy i agent pisze notatkę końcową.",
      inputSchema: z.object({ stepId: z.string(), summary: z.string(), link: z.string().optional(), spentMin: z.number().int().optional() }),
    }, async (a) => {
      const taskId = await ownedStep(ownerId, a.stepId);
      if (!taskId) return text("Nie ma takiego kroku.");
      const r = await finishStep(ownerId, taskId, a.stepId, { report: a.summary, link: a.link, addSpentSec: a.spentMin ? a.spentMin * 60 : 0 });
      return text(r.closed ? "Krok zapisany, zadanie ukończone." : "Krok zapisany.");
    });

    server.registerTool("add_facts", {
      title: "Dopisz fakty", description: "Zapisuje istotne informacje do kroku z pochodzeniem (np. z ClickUp: lista, sprint, estymata).",
      inputSchema: z.object({ stepId: z.string(), facts: z.array(Fact).max(12), replace: z.boolean().optional() }),
    }, async (a) => {
      if (!(await ownedStep(ownerId, a.stepId))) return text("Nie ma takiego kroku.");
      const old = a.replace ? [] : await repo.listFacts({ stepId: a.stepId });
      await repo.replaceFacts({ stepId: a.stepId }, [...old, ...a.facts]);
      return text("Zapisano fakty.");
    });

    server.registerTool("add_snapshot", {
      title: "Zapisz migawkę", description: "Zapisuje surowe dane z zewnętrznej aplikacji (np. cały ticket z ClickUp) przy kroku; agent w Task Hub wybierze z nich istotne pola.",
      inputSchema: z.object({ stepId: z.string(), app: z.string(), raw: z.unknown(), url: z.string().optional(), sourceId: z.string().optional() }),
    }, async (a) => {
      if (!(await ownedStep(ownerId, a.stepId))) return text("Nie ma takiego kroku.");
      await repo.addSnapshot({ stepId: a.stepId }, a.app, a.raw, { url: a.url, sourceId: a.sourceId }); return text("Zapisano migawkę.");
    });

    server.registerTool("list_work", {
      title: "Co czeka na agenta", description: "Lista pracy dla agenta: zadania bez kroków (rozłożyć przez add_steps), kroki gotowe do zrobienia bez zatwierdzania (zrobić i zgłosić complete_step), kroki wymagające zatwierdzenia (przygotować szkic przez set_blocks i zostawić), odpowiedzi Piotra na pytania (przeczytać i kontynuować; oznaczane jako przeczytane). Kroki wykonuj tylko narzędziami, które masz; resztę zostaw.",
      inputSchema: z.object({}),
    }, async () => {
      const [tasks, projects, samples, answered] = await Promise.all([repo.listTasks(ownerId), repo.listProjects(ownerId), repo.listSamples(ownerId), repo.listQuestions(ownerId, { answeredUnseen: true })]);
      const open = scoreAll(tasks, projects, samples).filter((s) => !s.task.doneAt && !s.task.deletedAt);
      const noSteps = open.filter((s) => !s.task.steps.length);
      const openQ = await repo.listQuestions(ownerId, { open: true });
      const waitingTask = new Set(openQ.map((q) => q.taskId));
      const ready: string[] = [], approval: string[] = [];
      for (const s of open) {
        if (waitingTask.has(s.task.id)) continue;
        for (const st of s.task.steps) {
          if (st.status !== "todo") continue;
          if (!st.dependsOn.every((d) => s.task.steps.find((x) => x.id === d)?.status === "done")) continue;
          if (st.tool === "manual") continue;
          const line = `- krok [${st.id}] „${st.title}” (${st.tool}) w zadaniu [${s.task.id}] „${s.task.title}”${st.detail ? ": " + st.detail.slice(0, 200) : ""}`;
          (st.needsApproval ? approval : ready).push(line);
        }
      }
      await repo.markQuestionsSeen(ownerId, answered.map((q) => q.id));
      const out = [
        noSteps.length ? "ZADANIA BEZ KROKÓW (rozłóż przez add_steps, bez pytań, gdy da się przyjąć rozsądne założenia; w razie potrzeby ask_question):\n" + noSteps.filter((s) => !waitingTask.has(s.task.id)).map(brief).join("\n") : "",
        answered.length ? "ODPOWIEDZI PIOTRA (kontynuuj pracę w tych zadaniach):\n" + answered.map((q) => `- zadanie [${q.taskId}]${q.stepId ? ` krok [${q.stepId}]` : ""}: pytanie „${q.text}” → odpowiedź: ${q.answer}`).join("\n") : "",
        ready.length ? "KROKI DO ZROBIENIA BEZ ZATWIERDZANIA (zrób je swoimi konektorami i zgłoś complete_step z linkiem; fakty przez add_facts):\n" + ready.join("\n") : "",
        approval.length ? "KROKI WYMAGAJĄCE ZATWIERDZENIA (przygotuj szkic przez set_blocks jako draft, niczego nie wysyłaj):\n" + approval.join("\n") : "",
        openQ.length ? `ZADANIA CZEKAJĄCE NA ODPOWIEDŹ PIOTRA (pomiń): ${[...waitingTask].map((id) => `[${id}]`).join(", ")}` : "",
      ].filter(Boolean).join("\n\n");
      return text(out || "Nic nie czeka na agenta.");
    });

    server.registerTool("ask_question", {
      title: "Zapytaj Piotra w aplikacji", description: "Zadaje Piotrowi pytanie w Task Hub (nie w czacie): tekst, opcjonalne opcje z zaleceniem. Pytaj tylko, gdy bez odpowiedzi nie da się sensownie kontynuować; odpowiedź przyjdzie w list_work i get_task. Zadanie z otwartym pytaniem czeka.",
      inputSchema: z.object({ taskId: z.string(), stepId: z.string().optional(), text: z.string().max(2000), options: z.array(z.object({ label: z.string().max(80), note: z.string().max(200).optional() })).max(6).optional(), recommended: z.number().int().min(0).optional() }),
    }, async (a) => {
      const t = await repo.getTask(ownerId, a.taskId); if (!t) return text("Nie ma takiego zadania.");
      const q = await repo.askQuestion(ownerId, { taskId: a.taskId, stepId: a.stepId ?? null, text: a.text, options: a.options, recommended: a.recommended ?? null });
      return json({ questionId: q.id });
    });

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
  if (!ownerId) return new Response(JSON.stringify({ error: "Brak albo zły token. Połącz konektor przez OAuth (aplikacja Claude: Connectors) albo podaj nagłówek Authorization: Bearer th_..." }), { status: 401, headers: { "content-type": "application/json", "www-authenticate": wwwAuthenticate(originOf(req)) } });
  return buildHandler(ownerId)(req);
}

export { handle as GET, handle as POST, handle as DELETE };
