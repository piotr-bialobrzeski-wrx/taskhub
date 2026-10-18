// Serwer MCP Task Hub: Claude, Claude Code, ChatGPT i własne agenty podłączają się tutaj tokenem (OAuth albo nagłówek).
// Dostają zadania z zasadami i kontekstem, zgłaszają wyniki kroków, dopisują fakty i migawki.
import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import * as repo from "@/lib/repo";
import { companyOf, contextText, brief, scoreAll } from "@/lib/agent/context";
import { rulesText } from "@/lib/agent/context";
import { workSummary } from "@/lib/agent/work";
import { BRIDGE_ALIVE_MS, ago } from "@/lib/bridge";
import { finishStep } from "@/lib/services";
import { Blocks, ChangedFile, Fact, SPHERES, sphereOf, type Block } from "@/lib/schema";
import { shortTitle } from "@/lib/auto";
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
  // nazwa albo id połączenia z rejestru → id; pusty napis albo brak = null (agent wybiera sam)
  const connectionIdOf = async (ref: string | undefined): Promise<string | null> => (ref?.trim() ? (await repo.findConnection(ownerId, ref))?.id ?? null : null);
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
      const [tasks, projects, companies, connections, rules, samples, factPrefs] = await Promise.all([repo.listTasks(ownerId, { all: true }), repo.listProjects(ownerId), repo.listCompanies(ownerId), repo.listConnections(ownerId), repo.listRules(ownerId), repo.listSamples(ownerId), repo.factPreferencesText(ownerId)]);
      const t = tasks.find((x) => x.id === taskId); if (!t) return text("Nie ma takiego zadania.");
      const facts = await Promise.all(t.steps.map(async (s) => [s.id, await repo.listFacts({ stepId: s.id })] as const));
      const ctx = contextText({ tasks, projects, companies, connections, rules, samples, factPrefs, currentTaskId: taskId });
      const fx = facts.filter(([, f]) => f.length).map(([id, f]) => `FAKTY KROKU ${id}:\n${f.filter((x) => !x.hidden).map((x) => `- ${x.label}: ${x.value}${x.source ? ` (${x.source.app}${x.source.url ? ", " + x.source.url : ""})` : ""}`).join("\n")}`).join("\n");
      const qs = await repo.listQuestions(ownerId, { taskId });
      const qx = qs.length ? "PYTANIA DO PIOTRA (zadane w aplikacji):\n" + qs.map((q) => `- [${q.id}]${q.stepId ? ` krok ${q.stepId}` : ""} ${q.text} → ${q.answer ? `ODPOWIEDŹ: ${q.answer}` : "(czeka na odpowiedź)"}`).join("\n") : "";
      const att = await repo.listAttachments({ taskId });
      const ax = att.length ? "ZAŁĄCZNIKI ZADANIA (grafikę albo plik tekstowy pokaże get_attachment; opis zapisz przez describe_attachment):\n" + att.map((a) => `- [${a.id}] ${a.kind} „${a.name ?? a.url ?? ""}”${a.mime ? ` (${a.mime})` : ""}${a.caption ? ` · ${a.caption}` : ""}${a.analysis ? `: ${a.analysis.slice(0, 400)}` : ""}`).join("\n") : "";
      // rozmowa w zadaniu: Piotr dopisuje tu wymagania i pytania; NOWE = jeszcze bez odpowiedzi agenta
      const chat = await repo.listChat(ownerId, taskId, 12);
      const cx = chat.length ? "ROZMOWA W ZADANIU (ostatnie wpisy; NOWE = Piotr napisał, nikt nie odpowiedział: odpowiedz przez reply_chat, a gdy prośba zmienia zakres, najpierw add_steps z before):\n" + chat.map((m) => `- ${m.role === "user" ? "Piotr" : "Agent"} (${m.createdAt.slice(0, 16).replace("T", " ")} UTC)${m.role === "user" && !m.seenAt ? " NOWE" : ""}: ${m.text.slice(0, 1200)}`).join("\n") : "";
      return text(ctx + (fx ? "\n" + fx : "") + (qx ? "\n" + qx : "") + (ax ? "\n" + ax : "") + (cx ? "\n" + cx : ""));
    });

    server.registerTool("get_rules", {
      title: "Zasady pracy", description: "Zasady pracy w trzech sekcjach: PROFIL (dane o firmie, projekcie i narzędziach), ZASADY (zawsze) i PROCEDURY (pełna treść tych, które pasują do tools albo topic; reszta w spisie). projectId: projekt zadania (zasady jego firmy dochodzą same); companyId: firma, gdy nie ma projektu; tools: narzędzia kroku (slack, gmail, clickup...); topic: tematy pracy albo nazwa procedury ze spisu, np. [\"rozpisanie\", \"story\", \"bug\", \"przegląd\"]; text: tytuł i szczegóły kroku (dopasowanie po słowach).",
      inputSchema: z.object({ projectId: z.string().optional(), companyId: z.string().optional(), tools: z.array(z.string()).optional(), topic: z.array(z.string()).optional(), text: z.string().optional() }),
    }, async ({ projectId, companyId, tools, topic, text: t }) => {
      const [rules, projects] = await Promise.all([repo.listRules(ownerId), repo.listProjects(ownerId)]);
      return text(rulesText(rules, projectId ?? null, tools ?? [], { topic, text: t, companyId: companyOf(projectId, projects) ?? companyId ?? null }) || "(brak zasad)");
    });

    server.registerTool("create_task", {
      title: "Nowe zadanie", description: "Tworzy zadanie z krokami. due: termin YYYY-MM-DD (ustaw, gdy w treści jest termin). Kroki: tool: klucz narzędzia, zawsze klucz, nie etykieta: code (Claude Code), manual (Piotr sam), slack, gmail, clickup, calendar, claude (dokument pisany przez Claude), claudeapp, browser, github, figma, whatsapp, sheets, docs, est w minutach (wielokrotność 15), needsApproval gdy krok wysyła coś na zewnątrz, dependsOn jako n1, n2 (numery kroków w tej paczce), link tylko do elementu w zewnętrznej aplikacji (ticket, wydarzenie, mail), nigdy adres Task Hub, connection: nazwa połączenia z list_connections, gdy ma znaczenie, którym kontem (firma, prywatne) krok ma być zrobiony.",
      inputSchema: z.object({
        title: z.string(), summary: z.string().optional(), source: z.string().optional(), level: z.number().int().min(1).max(5).optional(), due: z.string().optional(), project: z.string().optional(),
        steps: z.array(z.object({ title: z.string(), tool: z.string().optional(), detail: z.string().optional(), needsApproval: z.boolean().optional(), est: z.number().int().optional(), link: z.string().optional(), dependsOn: z.array(z.string()).optional(), connection: z.string().optional() })).optional(),
      }),
    }, async (a) => {
      let projectId: string | null = null;
      if (a.project) projectId = ((await repo.findProjectByName(ownerId, a.project)) ?? (await repo.createProject(ownerId, a.project))).id;
      const t = await repo.createTask(ownerId, { title: a.title, summary: a.summary, source: a.source, level: a.level, due: a.due ?? null, projectId, steps: await Promise.all((a.steps ?? []).map(async (s) => ({ ...s, link: externalLink(s.link), estMin: s.est, connectionId: await connectionIdOf(s.connection) }))) });
      return json({ taskId: t.id, steps: t.steps.map((s) => ({ id: s.id, title: s.title })) });
    });

    server.registerTool("update_task", {
      title: "Zmień zadanie", description: "Zmienia tytuł, cel, priorytet, termin albo projekt zadania.",
      inputSchema: z.object({ taskId: z.string(), title: z.string().optional(), summary: z.string().optional(), level: z.number().int().min(1).max(5).optional(), due: z.string().nullable().optional(), project: z.string().nullable().optional() }),
    }, async (a) => {
      const t = await repo.getTask(ownerId, a.taskId); if (!t) return text("Nie ma takiego zadania.");
      let projectId: string | null | undefined;
      if (a.project !== undefined) projectId = a.project ? ((await repo.findProjectByName(ownerId, a.project)) ?? (await repo.createProject(ownerId, a.project))).id : null;
      // agent poprawił tytuł: pierwotne brzmienie zostaje w zadaniu („Jak wpadło”), Piotr widzi, że to przeredagowane
      const renamed = !!a.title?.trim() && a.title.trim() !== t.title;
      await repo.updateTask(ownerId, a.taskId, { title: a.title, summary: a.summary, level: a.level, due: a.due, projectId, ...(renamed && !t.titleOriginal ? { titleOriginal: t.title } : {}) });
      return text("Zmieniono.");
    });

    server.registerTool("add_steps", {
      title: "Dodaj kroki", description: "Dodaje kroki do zadania. Pola jak w create_task; link tylko do elementu w zewnętrznej aplikacji (ticket, wydarzenie, mail), nigdy adres Task Hub. before: id kroku, przed którym nowe kroki mają wejść (np. krok publikacji, wysyłki, commitu): dziedziczą jego zależności, on zaczyna zależeć od nich, a jego szkic (gdy czekał na zgodę) staje się nieaktualny i krok wraca do gotowych. Bez before kroki idą na koniec. Termin zadania ustaw osobno przez update_task(due).",
      inputSchema: z.object({ taskId: z.string(), steps: z.array(z.object({ title: z.string(), tool: z.string().optional(), detail: z.string().optional(), needsApproval: z.boolean().optional(), est: z.number().int().optional(), link: z.string().optional(), dependsOn: z.array(z.string()).optional(), connection: z.string().optional() })), before: z.string().optional() }),
    }, async (a) => {
      const t = await repo.getTask(ownerId, a.taskId); if (!t) return text("Nie ma takiego zadania.");
      const bef = a.before ? t.steps.find((s) => s.id === a.before) ?? null : null;
      if (a.before && !bef) return text("Nie ma takiego kroku (before) w tym zadaniu.");
      const fresh = t.steps.length === 0;
      const steps = await repo.addSteps(t.id, await Promise.all(a.steps.map(async (s) => ({ ...s, link: externalLink(s.link), estMin: s.est, connectionId: await connectionIdOf(s.connection) }))), { before: bef?.id ?? null });
      // przed krokiem ze szkicem weszła nowa praca: szkic jest nieaktualny, krok wraca do gotowych i dostanie nowy szkic po nowych krokach
      if (bef && bef.status === "draft") await repo.updateStep(bef.id, { status: "todo", prevStatus: null, handoffAt: null, blocks: (bef.blocks ?? []).map((b): Block => (b.type === "draft" ? { ...b, stale: true } : b)) });
      // w rozmowie tylko fakt: ile kroków i gdzie; tytuły, gdy jest ich mało (szczegóły są na kafelkach)
      const n = steps.length, word = n === 1 ? "krok" : n < 5 ? "kroki" : "kroków";
      const list = n <= 4 ? ": " + steps.map((s) => `„${shortTitle(s.title, 40)}”`).join(", ") : "";
      await repo.addChat(ownerId, t.id, "agent", `${fresh ? "Rozpisałem" : "Dodałem"} ${n} ${word}${bef ? ` przed „${shortTitle(bef.title, 40)}”` : ""}${list}.`, { stepId: steps[0]?.id });
      return json({ steps: steps.map((s) => ({ id: s.id, title: s.title })), ...(bef ? { before: { id: bef.id, title: bef.title, draftReset: bef.status === "draft" } } : {}) });
    });

    server.registerTool("update_step", {
      title: "Zmień krok", description: "Zmienia tytuł, opis, narzędzie, szacunek, link albo połączenie kroku (tool = klucz jak w create_task; link = element w zewnętrznej aplikacji, np. utworzone wydarzenie albo ticket; connection = nazwa z list_connections, pusty napis zdejmuje).",
      inputSchema: z.object({ stepId: z.string(), title: z.string().optional(), detail: z.string().optional(), tool: z.string().optional(), est: z.number().int().optional(), link: z.string().optional(), connection: z.string().optional() }),
    }, async (a) => {
      if (!(await ownedStep(ownerId, a.stepId))) return text("Nie ma takiego kroku.");
      const connectionId = a.connection === undefined ? undefined : await connectionIdOf(a.connection);
      if (a.connection?.trim() && !connectionId) return text("Nie ma takiego połączenia (list_connections).");
      await repo.updateStep(a.stepId, { title: a.title, detail: a.detail, tool: a.tool, estMin: a.est, link: a.link === undefined ? undefined : externalLink(a.link) ?? null, connectionId }); return text("Zmieniono.");
    });

    server.registerTool("set_blocks", {
      title: "Ułóż panel kroku", description: "Zapisuje kartkę kroku z klocków: najpierw kontekst (thread = wątek jako dymki, mail = wątek maili z from/to/subject, comment = jeden komentarz z miejscem, facts, table = wiersze, list, media = zrzuty i pliki z opisem, link, free = markdown gdy nic nie pasuje, text = krótka notatka), potem jeden draft (to, co powstaje: target.app, target.where, action, subject, body; dla wierszy arkusza columns + rows; dla promptu dla agenta target.app code). Każdy klocek kontekstu ma source {app, ref = miejsce, url}. Pokaż tylko to, co ważne dla tego kroku; długi wątek daj cały, aplikacja pokaże ostatnie 3. rememberFor: nazwa aplikacji źródłowej, jeśli ten układ ma być wzorem dla podobnych kroków.",
      inputSchema: z.object({ stepId: z.string(), blocks: Blocks, rememberFor: z.string().optional() }),
    }, async (a) => {
      const taskId = await ownedStep(ownerId, a.stepId); if (!taskId) return text("Nie ma takiego kroku.");
      await repo.updateStep(a.stepId, { blocks: a.blocks });
      if (a.rememberFor) await repo.setLayoutMemory(ownerId, a.rememberFor, a.blocks);
      // szkic czekający na zgodę: krok przechodzi do zatwierdzenia, Piotr widzi to na kafelku i w rozmowie zadania
      const st = (await repo.getTask(ownerId, taskId))?.steps.find((x) => x.id === a.stepId);
      if (st && st.status !== "done" && st.status !== "draft" && a.blocks.some((b) => b.type === "draft" && b.status === "proposed")) {
        await repo.updateStep(st.id, { status: "draft", prevStatus: st.status === "handoff" ? st.prevStatus : st.status, handoffAt: null });
        await repo.addChat(ownerId, taskId, "agent", `Szkic do zatwierdzenia: „${shortTitle(st.title, 70)}”.`, { stepId: st.id });
        return text("Panel zapisany, krok czeka na zatwierdzenie Piotra.");
      }
      return text("Panel zapisany.");
    });

    server.registerTool("complete_step", {
      title: "Krok gotowy", description: "Zgłasza wynik kroku: summary = 1–2 zdania o efekcie (Piotr czyta je w raporcie kroku; w rozmowie zobaczy tylko „Gotowe: tytuł kroku”), link do wyniku, opcjonalnie czas w minutach. Krok z kodem: changes = zmienione pliki (path, status, diff, note), repo, branch, preview = adres podglądu (http albo file://); trafiają na kartkę kroku jako blok zmian. Gdy to ostatni krok, zadanie się kończy i agent pisze notatkę końcową.",
      inputSchema: z.object({ stepId: z.string(), summary: z.string().max(4000), link: z.string().optional(), spentMin: z.number().int().optional(), repo: z.string().max(200).optional(), branch: z.string().max(200).optional(), preview: z.string().max(1000).optional(), changes: z.array(ChangedFile).max(60).optional() }),
    }, async (a) => {
      const taskId = await ownedStep(ownerId, a.stepId);
      if (!taskId) return text("Nie ma takiego kroku.");
      const r = await finishStep(ownerId, taskId, a.stepId, { report: a.summary, link: a.link, addSpentSec: a.spentMin ? a.spentMin * 60 : 0 });
      const st = r.task.steps.find((x) => x.id === a.stepId);
      // zmiany w kodzie na kartce kroku: jeden blok changes (zastępuje poprzedni), reszta klocków zostaje
      if (st && (a.changes?.length || a.preview)) {
        const rest = (st.blocks ?? []).filter((b) => b.type !== "changes").slice(0, 11);
        await repo.updateStep(st.id, { blocks: [...rest, { type: "changes", repo: a.repo, branch: a.branch, preview: a.preview, summary: a.summary.slice(0, 2000), files: a.changes ?? [] }] });
      }
      // w rozmowie tylko fakt; opis, pliki i adresy są na kartce kroku („Otwórz krok”)
      await repo.addChat(ownerId, taskId, "agent", `Gotowe: „${shortTitle(st?.title ?? "", 70)}”.${r.closed ? " Zadanie ukończone." : ""}`, { stepId: a.stepId, link: externalLink(a.link) ?? undefined });
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
      await repo.addChat(ownerId, taskId, "agent", `Nie zrobiłem kroku „${shortTitle(st.title, 70)}”: ${a.reason}`, { stepId: st.id });
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

    server.registerTool("reply_chat", {
      title: "Odpowiedz w rozmowie zadania", description: "Odpowiada Piotrowi w rozmowie zadania (1–3 zdania: co dopisałeś, numery i tytuły kroków, albo odpowiedź na pytanie; bez raportu z postępu). Oznacza jego wiadomości w tym zadaniu jako przeczytane. stepId: krok, którego odpowiedź dotyczy (karta w rozmowie dostanie „Otwórz krok”); link: adres wyniku w zewnętrznej aplikacji.",
      inputSchema: z.object({ taskId: z.string(), text: z.string().min(1).max(1200), stepId: z.string().optional(), link: z.string().optional() }),
    }, async (a) => {
      const t = await repo.getTask(ownerId, a.taskId); if (!t) return text("Nie ma takiego zadania.");
      const stepId = a.stepId && t.steps.some((s) => s.id === a.stepId) ? a.stepId : undefined;
      await repo.addChat(ownerId, t.id, "agent", a.text.trim(), { stepId, link: externalLink(a.link) ?? undefined });
      await repo.markChatSeen(ownerId, { taskId: t.id });
      return text("Odpowiedź zapisana.");
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

    // firma: nazwa albo id; brak = null (moja / prywatne)
    const companyByRef = async (ref: string | undefined | null) => {
      if (!ref?.trim()) return null;
      const list = await repo.listCompanies(ownerId);
      return list.find((c) => c.id === ref) ?? list.find((c) => c.name.toLowerCase() === ref.trim().toLowerCase()) ?? null;
    };

    server.registerTool("list_companies", {
      title: "Firmy", description: "Firmy, dla których Piotr pracuje (i jego własne marki): id, nazwa, sfera (work = zawodowa, private = prywatna), notatka, data zakończenia współpracy, projekty. Projekt bez firmy jest prywatny.",
      inputSchema: z.object({}),
    }, async () => {
      const [companies, projects] = await Promise.all([repo.listCompanies(ownerId), repo.listProjects(ownerId)]);
      return json(companies.map((c) => ({ id: c.id, name: c.name, sphere: c.sphere, note: c.note, endedAt: c.endedAt, projects: projects.filter((p) => p.companyId === c.id).map((p) => p.name) })));
    });

    server.registerTool("list_connections", {
      title: "Połączenia", description: "Rejestr połączeń: do jakich aplikacji agent ma dostęp, przez co (claude = konektor w Claude, claude-code = Claude Code na komputerze Piotra przez mostek, taskhub = sam Task Hub), na jakim koncie, dla której firmy albo sfery (work | private) i czy działa (active | expired | off). Krok może wskazać połączenie przez pole connection (nazwa); bez wskazania wybierz połączenie pasujące do firmy zadania. Żadnych sekretów: połączenie to rura, nie klucz.",
      inputSchema: z.object({}),
    }, async () => {
      const [connections, companies] = await Promise.all([repo.listConnections(ownerId), repo.listCompanies(ownerId)]);
      return json(connections.map((c) => ({ id: c.id, label: c.label, app: c.app, account: c.account, company: companies.find((x) => x.id === c.companyId)?.name ?? null, sphere: c.sphere, provider: c.provider, kind: c.kind, state: c.state, host: c.host, seenAt: c.seenAt })));
    });

    server.registerTool("create_company", {
      title: "Nowa firma", description: "Tworzy firmę albo, gdy firma o tej nazwie już jest, uzupełnia sferę i notatkę. sphere: work (zawodowa, domyślnie) | private. Projekty przypina się do firmy przez create_project (pole company).",
      inputSchema: z.object({ name: z.string().min(1).max(60), sphere: z.enum(SPHERES).optional(), note: z.string().max(2000).optional() }),
    }, async (a) => {
      const found = await repo.findCompanyByName(ownerId, a.name);
      const c = found ?? (await repo.createCompany(ownerId, a.name, a.sphere ?? "work", a.note ?? null));
      const patch = { ...(found && a.sphere && a.sphere !== c.sphere ? { sphere: a.sphere } : {}), ...(found && a.note !== undefined && a.note !== c.note ? { note: a.note } : {}) };
      if (Object.keys(patch).length) await repo.updateCompany(ownerId, c.id, patch);
      return json({ companyId: c.id, created: !found, name: c.name, sphere: patch.sphere ?? c.sphere });
    });

    server.registerTool("list_projects", {
      title: "Projekty", description: "Lista projektów: id, nazwa, ważność 1–5, język, w którym agent pisze (pl, en, de, uk, fr, es), firma (null = prywatny) i sfera (work | private).",
      inputSchema: z.object({}),
    }, async () => {
      const [projects, companies] = await Promise.all([repo.listProjects(ownerId), repo.listCompanies(ownerId)]);
      return json(projects.map((p) => ({ id: p.id, name: p.name, weight: p.weight, language: p.language, company: companies.find((c) => c.id === p.companyId)?.name ?? null, sphere: sphereOf(p, companies) })));
    });

    server.registerTool("create_project", {
      title: "Nowy projekt", description: "Tworzy projekt albo, gdy projekt o tej nazwie już jest, uzupełnia jego ważność, język i firmę. weight: 1–5, language: pl | en | de | uk | fr | es, company: nazwa firmy z list_companies (nowa nazwa tworzy firmę zawodową; pusty napis odpina: projekt prywatny).",
      inputSchema: z.object({ name: z.string().min(1).max(60), weight: z.number().int().min(1).max(5).optional(), language: z.enum(["pl", "en", "de", "uk", "fr", "es"]).optional(), company: z.string().max(60).optional() }),
    }, async (a) => {
      const found = await repo.findProjectByName(ownerId, a.name);
      const p = found ?? (await repo.createProject(ownerId, a.name, a.weight));
      let companyId: string | null | undefined;
      if (a.company !== undefined) companyId = a.company.trim() ? ((await companyByRef(a.company)) ?? (await repo.createCompany(ownerId, a.company))).id : null;
      const patch = { ...(a.weight !== undefined && a.weight !== p.weight ? { weight: a.weight } : {}), ...(a.language && a.language !== p.language ? { language: a.language } : {}), ...(companyId !== undefined && companyId !== p.companyId ? { companyId } : {}) };
      if (Object.keys(patch).length) await repo.updateProject(ownerId, p.id, patch);
      return json({ projectId: p.id, created: !found, name: p.name, weight: patch.weight ?? p.weight, language: patch.language ?? p.language, companyId: companyId !== undefined ? companyId : p.companyId });
    });

    server.registerTool("list_rules", {
      title: "Spis zasad", description: "Wszystkie zasady właściciela z id (do update_rule): kind, scope, firma, projekt, narzędzie, pochodzenie (origin: firma, w której wypracowana; null = moja), tytuł, skrót, wyzwalacz.",
      inputSchema: z.object({}),
    }, async () => {
      const [rules, projects, companies] = await Promise.all([repo.listRules(ownerId), repo.listProjects(ownerId), repo.listCompanies(ownerId)]);
      const pname = (id: string | null) => projects.find((p) => p.id === id)?.name ?? null;
      const cname = (id: string | null) => companies.find((c) => c.id === id)?.name ?? null;
      return json(rules.map((r) => ({ id: r.id, kind: r.kind, scope: r.scope, company: cname(r.companyId), project: pname(r.projectId), tool: r.tool, origin: cname(r.originCompanyId), title: r.title, summary: r.summary, trigger: r.trigger, chars: r.body.length })));
    });

    const RuleKind = z.enum(["profile", "rule", "procedure"]);
    server.registerTool("add_rule", {
      title: "Dodaj zasadę", description: "Dodaje zasadę pracy. kind: profile (dane o firmie, projekcie albo narzędziu: język, klient, kanały), rule (krótka reguła zawsze w prompcie; domyślnie), procedure (dłuższa instrukcja; wymaga summary = jedno zdanie do spisu i zwykle trigger = słowa wyzwalające po przecinku: narzędzia, tematy, słowa z tytułu kroku, np. \"slack, story, bug\"). scope global | company | project | tool: dla company podaj company (nazwa albo id firmy); dla project podaj projectId albo project (nazwa); dla tool podaj tool (slack, gmail, clickup, calendar, figma...). origin: firma, w której zasada została wypracowana (nazwa albo id; pomiń dla własnych). Ta sama nazwa w tym samym zakresie = aktualizacja istniejącej zasady, bez duplikatu.",
      inputSchema: z.object({ kind: RuleKind.optional(), scope: z.enum(["global", "company", "project", "tool"]), title: z.string().min(1), body: z.string().min(1), summary: z.string().optional(), trigger: z.string().optional(), company: z.string().optional(), projectId: z.string().optional(), project: z.string().optional(), tool: z.string().optional(), origin: z.string().optional() }),
    }, async ({ project, company, origin, ...a }) => {
      let projectId = a.projectId;
      if (a.scope === "project" && !projectId && project) projectId = (await repo.findProjectByName(ownerId, project))?.id;
      if (a.scope === "project" && !projectId) throw new Error("Zasada projektu wymaga projectId albo nazwy istniejącego projektu (project).");
      const companyId = a.scope === "company" ? (await companyByRef(company))?.id : null;
      if (a.scope === "company" && !companyId) throw new Error("Zasada firmy wymaga company: nazwy albo id istniejącej firmy (list_companies).");
      if (a.scope === "tool" && !a.tool) throw new Error("Zasada narzędzia wymaga pola tool.");
      if (a.kind === "procedure" && !a.summary?.trim()) throw new Error("Procedura wymaga summary: jedno zdanie do spisu.");
      const originCompanyId = origin ? (await companyByRef(origin))?.id ?? null : null;
      if (origin && !originCompanyId) throw new Error("origin: nie ma takiej firmy (list_companies).");
      const found = await repo.findRule(ownerId, { scope: a.scope, companyId, projectId: a.scope === "project" ? projectId : null, tool: a.scope === "tool" ? a.tool : null, title: a.title });
      const r = await repo.upsertRule(ownerId, { ...a, id: found?.id, companyId, projectId: a.scope === "project" ? projectId : null, tool: a.scope === "tool" ? a.tool : null, originCompanyId: origin !== undefined ? originCompanyId : found?.originCompanyId ?? null, visibility: found?.visibility });
      return json({ ruleId: r.id, created: !found });
    });

    server.registerTool("update_rule", {
      title: "Zmień zasadę", description: "Zmienia pola istniejącej zasady (id z list_rules): kind, title, body, summary, trigger, origin (firma, w której wypracowana; pusty napis = moja). Pola pominięte zostają; każda zmiana zapisuje się w historii wersji.",
      inputSchema: z.object({ ruleId: z.string(), kind: RuleKind.optional(), title: z.string().min(1).optional(), body: z.string().min(1).optional(), summary: z.string().optional(), trigger: z.string().optional(), origin: z.string().optional() }),
    }, async (a) => {
      const cur = (await repo.listRules(ownerId)).find((r) => r.id === a.ruleId);
      if (!cur) throw new Error("Nie ma takiej zasady.");
      const originCompanyId = a.origin === undefined ? cur.originCompanyId : a.origin.trim() ? (await companyByRef(a.origin))?.id ?? null : null;
      if (a.origin?.trim() && !originCompanyId) throw new Error("origin: nie ma takiej firmy (list_companies).");
      const next = { ...cur, kind: a.kind ?? cur.kind, title: a.title ?? cur.title, body: a.body ?? cur.body, summary: a.summary ?? cur.summary, trigger: a.trigger ?? cur.trigger, originCompanyId };
      if (next.kind === "procedure" && !next.summary?.trim()) throw new Error("Procedura wymaga summary: jedno zdanie do spisu.");
      const r = await repo.upsertRule(ownerId, next);
      return json({ ruleId: r.id, kind: r.kind });
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
