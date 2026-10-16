// Serwer MCP Task Hub: Claude, Claude Code, ChatGPT i własne agenty podłączają się tutaj tokenem (OAuth albo nagłówek).
// Dostają zadania z zasadami i kontekstem, zgłaszają wyniki kroków, dopisują fakty i migawki.
import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import * as repo from "@/lib/repo";
import { contextText, brief, scoreAll } from "@/lib/agent/context";
import { rulesText } from "@/lib/agent/context";
import { workSummary } from "@/lib/agent/work";
import { BRIDGE_ALIVE_MS, ago } from "@/lib/bridge";
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

function buildHandler(ownerId: string, kind: repo.TokenKind) {
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
      const att = await repo.listAttachments({ taskId });
      const ax = att.length ? "ZAŁĄCZNIKI ZADANIA (grafikę albo plik tekstowy pokaże get_attachment; opis zapisz przez describe_attachment):\n" + att.map((a) => `- [${a.id}] ${a.kind} „${a.name ?? a.url ?? ""}”${a.mime ? ` (${a.mime})` : ""}${a.caption ? ` · ${a.caption}` : ""}${a.analysis ? `: ${a.analysis.slice(0, 400)}` : ""}`).join("\n") : "";
      return text(ctx + (fx ? "\n" + fx : "") + (qx ? "\n" + qx : "") + (ax ? "\n" + ax : ""));
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
      await repo.addChat(ownerId, t.id, "agent", `Rozpisałem ${steps.length} ${steps.length === 1 ? "krok" : steps.length < 5 ? "kroki" : "kroków"}: ${steps.map((s) => s.title).join(", ")}.`);
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
      const taskId = await ownedStep(ownerId, a.stepId); if (!taskId) return text("Nie ma takiego kroku.");
      await repo.updateStep(a.stepId, { blocks: a.blocks });
      if (a.rememberFor) await repo.setLayoutMemory(ownerId, a.rememberFor, a.blocks);
      // szkic czekający na zgodę: krok przechodzi do zatwierdzenia, Piotr widzi to na kafelku i w rozmowie zadania
      const st = (await repo.getTask(ownerId, taskId))?.steps.find((x) => x.id === a.stepId);
      if (st && st.status !== "done" && st.status !== "draft" && a.blocks.some((b) => b.type === "draft" && b.status === "proposed")) {
        await repo.updateStep(st.id, { status: "draft", prevStatus: st.status === "handoff" ? st.prevStatus : st.status, handoffAt: null });
        await repo.addChat(ownerId, taskId, "agent", `Szkic do zatwierdzenia: „${st.title}”. Zatwierdź w panelu kroku, a wyślę dokładnie tę treść.`);
        return text("Panel zapisany, krok czeka na zatwierdzenie Piotra.");
      }
      return text("Panel zapisany.");
    });

    server.registerTool("complete_step", {
      title: "Krok gotowy", description: "Zgłasza wynik kroku: krótkie podsumowanie, link do wyniku, opcjonalnie czas w minutach. Gdy to ostatni krok, zadanie się kończy i agent pisze notatkę końcową.",
      inputSchema: z.object({ stepId: z.string(), summary: z.string(), link: z.string().optional(), spentMin: z.number().int().optional() }),
    }, async (a) => {
      const taskId = await ownedStep(ownerId, a.stepId);
      if (!taskId) return text("Nie ma takiego kroku.");
      const r = await finishStep(ownerId, taskId, a.stepId, { report: a.summary, link: a.link, addSpentSec: a.spentMin ? a.spentMin * 60 : 0 });
      const title = r.task.steps.find((x) => x.id === a.stepId)?.title ?? "";
      await repo.addChat(ownerId, taskId, "agent", `Gotowe: „${title}”. ${a.summary}${a.link ? ` ${a.link}` : ""}${r.closed ? " To był ostatni krok, zadanie ukończone." : ""}`);
      return text(r.closed ? "Krok zapisany, zadanie ukończone." : "Krok zapisany.");
    });

    server.registerTool("start_step", {
      title: "Zaczynam krok", description: "Oznacza krok jako w toku: Piotr widzi na kafelku, że Claude nad nim pracuje. Wywołaj tuż przed robieniem kroku. Po zrobieniu zgłoś complete_step; gdy nie da się go zrobić (brak narzędzia, brak dostępu), oddaj go przez leave_step z powodem.",
      inputSchema: z.object({ stepId: z.string() }),
    }, async (a) => {
      const taskId = await ownedStep(ownerId, a.stepId); if (!taskId) return text("Nie ma takiego kroku.");
      const st = (await repo.getTask(ownerId, taskId))?.steps.find((x) => x.id === a.stepId); if (!st) return text("Nie ma takiego kroku.");
      if (st.status === "done") return text("Ten krok jest już zrobiony.");
      if (st.status !== "handoff") await repo.updateStep(st.id, { status: "handoff", prevStatus: st.status, handoffAt: new Date().toISOString() });
      return text("Krok w toku.");
    });

    server.registerTool("leave_step", {
      title: "Oddaję krok", description: "Gdy kroku nie da się zrobić (brak narzędzia, dostępu albo danych): krok wraca do gotowych, a Piotr widzi powód w zadaniu. Nie używaj do pytań, od tego jest ask_question.",
      inputSchema: z.object({ stepId: z.string(), reason: z.string().max(600) }),
    }, async (a) => {
      const taskId = await ownedStep(ownerId, a.stepId); if (!taskId) return text("Nie ma takiego kroku.");
      const st = (await repo.getTask(ownerId, taskId))?.steps.find((x) => x.id === a.stepId); if (!st) return text("Nie ma takiego kroku.");
      if (st.status === "done") return text("Ten krok jest już zrobiony.");
      if (st.status === "handoff") await repo.updateStep(st.id, { status: st.prevStatus === "draft" ? "draft" : "todo", prevStatus: null, handoffAt: null });
      await repo.addChat(ownerId, taskId, "agent", `Nie zrobiłem kroku „${st.title}”: ${a.reason}`);
      return text("Krok oddany.");
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
      title: "Co czeka na agenta", description: "Lista pracy dla agenta, w kolejności robienia: kroki w toku (zaczęte, dokończ), zatwierdzone szkice do wysłania, zadania bez kroków (rozłóż przez add_steps), odpowiedzi Piotra, kroki gotowe bez zgody (start_step → zrób swoimi konektorami → complete_step), kroki wymagające zgody (przygotuj szkic przez set_blocks jako draft, niczego nie wysyłaj). Rób tylko to, do czego masz narzędzia; krok, którego nie możesz zrobić, oddaj przez leave_step. Nigdy niczego nie usuwaj. Gdy mostek na komputerze Piotra jest aktywny, inni agenci dostają „MOSTEK AKTYWNY” i nie robią nic (force: true pokaże pracę mimo to).",
      inputSchema: z.object({ force: z.boolean().optional() }),
    }, async ({ force }) => {
      // mostek pracuje na bieżąco: automat co godzinę i inni agenci ustępują, żeby nie robić tego samego dwa razy
      if (kind !== "bridge" && !force) {
        const st = await repo.bridgeStatus(ownerId, BRIDGE_ALIVE_MS);
        if (st.alive) return text(`MOSTEK AKTYWNY: Claude Code na komputerze Piotra (${st.name ?? "mostek"}) wykonuje pracę na bieżąco (ostatni sygnał ${ago(st.seenAt)}). Nic nie rób i zakończ. list_work z force: true pokaże pracę mimo to.`);
      }
      return text((await workSummary(ownerId)).text);
    });

    server.registerTool("ask_question", {
      title: "Zapytaj Piotra w aplikacji", description: "Zadaje Piotrowi pytanie w Task Hub (nie w czacie): tekst, opcjonalne opcje z zaleceniem. Pytaj tylko, gdy bez odpowiedzi nie da się sensownie kontynuować; odpowiedź przyjdzie w list_work i get_task. Zadanie z otwartym pytaniem czeka.",
      inputSchema: z.object({ taskId: z.string(), stepId: z.string().optional(), text: z.string().max(2000), options: z.array(z.object({ label: z.string().max(80), note: z.string().max(200).optional() })).max(6).optional(), recommended: z.number().int().min(0).optional() }),
    }, async (a) => {
      const t = await repo.getTask(ownerId, a.taskId); if (!t) return text("Nie ma takiego zadania.");
      const q = await repo.askQuestion(ownerId, { taskId: a.taskId, stepId: a.stepId ?? null, text: a.text, options: a.options, recommended: a.recommended ?? null });
      return json({ questionId: q.id });
    });

    server.registerTool("get_attachment", {
      title: "Pokaż załącznik", description: "Zwraca załącznik zadania z Task Hub: grafikę jako obraz (zrzut ekranu, zdjęcie), plik tekstowy jako tekst. Identyfikatory są w get_task. Po obejrzeniu zapisz krótki opis przez describe_attachment, żeby nie oglądać go ponownie.",
      inputSchema: z.object({ attachmentId: z.string() }),
    }, async ({ attachmentId }) => {
      const f = await repo.getAttachmentFile(ownerId, attachmentId);
      if (!f) return text("Nie ma takiego załącznika albo nie ma pliku (link zewnętrzny).");
      const mime = f.mime ?? "application/octet-stream";
      if (/^image\/(png|jpeg|webp|gif)$/.test(mime)) {
        if (f.data.length > 3_500_000) return text(`Grafika „${f.name}” jest za duża do pokazania (${Math.round(f.data.length / 1024)} KB).`);
        return { content: [{ type: "image" as const, data: f.data.toString("base64"), mimeType: mime }, { type: "text" as const, text: `Grafika „${f.name ?? ""}” (${mime}, ${Math.round(f.data.length / 1024)} KB).` }] };
      }
      if (/^text\/|json|xml|csv|markdown|javascript/.test(mime) && f.data.length <= 400_000) return text(`PLIK „${f.name ?? ""}” (${mime}):\n` + f.data.toString("utf8"));
      return text(`Plik „${f.name ?? ""}” (${mime}, ${Math.round(f.data.length / 1024)} KB) nie da się pokazać jako obraz ani tekst. Piotr może go otworzyć w Task Hub: ${appUrl()}/api/files/${f.id}`);
    });

    server.registerTool("describe_attachment", {
      title: "Opisz załącznik", description: "Zapisuje przy załączniku krótki podpis (caption, do 6 słów) i analizę (co przedstawia, istotny tekst i liczby dosłownie, wnioski). Opis widać w zadaniu i trafia do kontekstu kolejnych kroków.",
      inputSchema: z.object({ attachmentId: z.string(), caption: z.string().max(120).optional(), analysis: z.string().max(4000).optional() }),
    }, async (a) => text((await repo.updateAttachment(ownerId, a.attachmentId, { caption: a.caption, analysis: a.analysis })) ? "Zapisano opis." : "Nie ma takiego załącznika."));

    server.registerTool("list_projects", {
      title: "Projekty", description: "Lista projektów: id, nazwa, ważność 1–5, język, w którym agent pisze (pl, en, de, uk, fr, es).",
      inputSchema: z.object({}),
    }, async () => json((await repo.listProjects(ownerId)).map((p) => ({ id: p.id, name: p.name, weight: p.weight, language: p.language }))));

    server.registerTool("create_project", {
      title: "Nowy projekt", description: "Tworzy projekt albo, gdy projekt o tej nazwie już jest, uzupełnia jego ważność i język. weight: 1–5, language: pl | en | de | uk | fr | es.",
      inputSchema: z.object({ name: z.string().min(1).max(60), weight: z.number().int().min(1).max(5).optional(), language: z.enum(["pl", "en", "de", "uk", "fr", "es"]).optional() }),
    }, async (a) => {
      const found = await repo.findProjectByName(ownerId, a.name);
      const p = found ?? (await repo.createProject(ownerId, a.name, a.weight));
      const patch = { ...(a.weight !== undefined && a.weight !== p.weight ? { weight: a.weight } : {}), ...(a.language && a.language !== p.language ? { language: a.language } : {}) };
      if (Object.keys(patch).length) await repo.updateProject(ownerId, p.id, patch);
      return json({ projectId: p.id, created: !found, name: p.name, weight: patch.weight ?? p.weight, language: patch.language ?? p.language });
    });

    server.registerTool("add_rule", {
      title: "Dodaj zasadę", description: "Dodaje zasadę pracy: scope global | project | tool. Dla scope project podaj projectId albo project (nazwa); dla scope tool podaj tool (slack, gmail, clickup, calendar, figma...).",
      inputSchema: z.object({ scope: z.enum(["global", "project", "tool"]), title: z.string(), body: z.string(), projectId: z.string().optional(), project: z.string().optional(), tool: z.string().optional() }),
    }, async ({ project, ...a }) => {
      let projectId = a.projectId;
      if (a.scope === "project" && !projectId && project) projectId = (await repo.findProjectByName(ownerId, project))?.id;
      if (a.scope === "project" && !projectId) throw new Error("Zasada projektu wymaga projectId albo nazwy istniejącego projektu (project).");
      if (a.scope === "tool" && !a.tool) throw new Error("Zasada narzędzia wymaga pola tool.");
      const r = await repo.upsertRule(ownerId, { ...a, projectId });
      return json({ ruleId: r.id });
    });
  }, { serverInfo: { name: "task-hub", version: "0.1.0" } });
}

async function authorize(req: Request): Promise<repo.TokenAuth | null> {
  const h = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  if (!m) return null;
  return repo.tokenForSecret(m[1].trim());
}

async function handle(req: Request): Promise<Response> {
  const auth = await authorize(req);
  if (!auth) return new Response(JSON.stringify({ error: "Brak albo zły token. Połącz konektor przez OAuth (aplikacja Claude: Connectors) albo podaj nagłówek Authorization: Bearer th_..." }), { status: 401, headers: { "content-type": "application/json", "www-authenticate": wwwAuthenticate(originOf(req)) } });
  return buildHandler(auth.ownerId, auth.kind)(req);
}

export { handle as GET, handle as POST, handle as DELETE };
