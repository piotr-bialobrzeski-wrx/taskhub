// Serwer MCP Task Hub: Claude, Claude Code, ChatGPT i własne agenty podłączają się tutaj tokenem (OAuth albo nagłówek).
// Dostają zadania z zasadami i kontekstem, zgłaszają wyniki kroków, dopisują fakty i migawki.
import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import * as repo from "@/lib/repo";
import { companyOf, contextText, brief, scoreAll, capText, draftsText, cardText } from "@/lib/agent/context";
import { rulesText } from "@/lib/agent/context";
import { audienceOf, workSummary } from "@/lib/agent/work";
import { BRIDGE_ALIVE_MS, ago, connectorProblem, knownApp } from "@/lib/bridge";
import { finishStep } from "@/lib/services";
import { appName, Blocks, ChangedFile, Fact, SPHERES, sphereOf, type Block, type Step } from "@/lib/schema";
import { destOf, doneChat, sameTarget } from "@/lib/stepcard";
import { shortTitle } from "@/lib/auto";
import { sql } from "@/lib/db";
import { originOf, wwwAuthenticate } from "@/lib/oauth";
import { externalLink as externalLinkOf } from "@/lib/links";
import { appUrl } from "@/lib/session";
import { securityReport } from "@/lib/security";
import { isFilePath, isHttpUrl } from "@/lib/safeurl";
import { approvalValid, coerceAgentDrafts, draftOf, isExternalApp, isGitDraft, isLocalFile, isPromptDraft, isSendable, type Draft } from "@/lib/agent/approval";

// link kroku to adres elementu w zewnętrznej aplikacji (tylko http/https); adres samego Task Hub nie jest linkiem kroku
const externalLink = (link: string | undefined | null) => (isHttpUrl(link) ? externalLinkOf(link, appUrl()) : undefined);

export const maxDuration = 60;

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
const json = (v: unknown) => text(JSON.stringify(v, null, 1));
// krok należy do właściciela tokenu? zwraca id zadania
async function ownedStep(ownerId: string, stepId: string): Promise<string | null> {
  const [r] = await sql()`select s.task_id from steps s join tasks t on t.id = s.task_id where s.id = ${stepId} and t.owner_id = ${ownerId}`;
  return r ? (r.taskId as string) : null;
}

// bieg wysyłki: tylko te narzędzia i tylko dla jego zadania i kroku
const SEND_TOOLS = new Set(["get_task", "get_rules", "list_connections", "add_facts", "complete_step", "leave_step", "list_work"]);
const SEND_ONLY = "Ten bieg tylko wysyła jeden zatwierdzony szkic";
async function sendGuard(ownerId: string, scope: repo.RunScope, name: string, a: Record<string, unknown>): Promise<string | null> {
  if (!SEND_TOOLS.has(name)) return `${SEND_ONLY}: ${name} nie jest tu dostępne.`;
  if (name === "get_task" && a.taskId !== scope.taskId) return `${SEND_ONLY}: get_task tylko dla zadania [${scope.taskId}].`;
  if ((name === "complete_step" || name === "leave_step") && a.stepId !== scope.stepId) return `${SEND_ONLY}: ${name} tylko dla kroku [${scope.stepId}].`;
  if (name === "add_facts" && (!scope.taskId || (await ownedStep(ownerId, String(a.stepId ?? ""))) !== scope.taskId)) return `${SEND_ONLY}: add_facts tylko w zadaniu [${scope.taskId}].`;
  if (name === "list_connections" && (a.audit === true || a.audit === "true")) return `${SEND_ONLY}: bez raportu bezpieczeństwa.`;
  return null;
}

function buildHandler(auth: repo.TokenAuth) {
  const { ownerId, kind } = auth;
  const scope = kind === "run" ? auth.scope : null;
  const audience = audienceOf(auth);
  // czy ten, kto pyta, wysyła szkic tego kroku (get_task: „ZATWIERDZONY: wyślij…” tylko wtedy); zatwierdzony prompt dla agenta wykonuje bieg pracy i klient
  const sends = (s: Step) => audience === "bridge-v1" ? isSendable(s) : audience === "send" ? s.id === scope?.stepId && approvalValid(s) && !!s.sendStartedAt : isSendable(s) && isPromptDraft(draftOf(s), s.blocks);
  // krok wymagający zgody, który zmienia coś w aplikacji zewnętrznej: konektor i bieg pracy tylko szykują szkic, nie robią go same
  const needsDraft = (s: Step) => audience !== "bridge-v1" && audience !== "send" && s.needsApproval && isExternalApp(s.tool) && !sends(s);
  // nazwa albo id połączenia z rejestru → id; pusty napis albo brak = null (agent wybiera sam)
  const connectionIdOf = async (ref: string | undefined): Promise<string | null> => (ref?.trim() ? (await repo.findConnection(ownerId, ref))?.id ?? null : null);
  // szkic, którego nic nie wyśle (plik na Macu to nie wysyłka): odmowa z instrukcją dla tego, kto pyta; nil = szkic może się zapisać
  const agentBlocker = async (nd: Draft | null, was: Step, blocks: Block[], taskId: string): Promise<string | null> => {
    if (!nd || nd.status !== "proposed" || nd.stale || was.status === "done") return null;
    if (isLocalFile(nd.target.app)) return audience === "work"
      ? "Nie zapisałem: „Plik na Macu” to nie szkic do zatwierdzenia. Zmień narzędzie kroku na file (update_step z tool \"file\"), zapisz plik narzędziem Write w folderze z linii „Foldery na pliki”, potem complete_step z polem file."
      : "Nie zapisałem: „Plik na Macu” to nie szkic do zatwierdzenia. Zmień narzędzie kroku na file (update_step z tool \"file\") i zostaw krok; plik zapisze aplikacja Task Hub 0.1.7 na Macu.";
    // szkic do aplikacji zewnętrznej, której mostek nie wyśle: nieznane miejsce albo brak konektora na Macu (commit, prompt i notatka nie idą konektorem;
    // kilka kont albo konto Google do wyboru nie zatrzymuje szkicu: Piotr wskaże konto w nagłówku karty)
    if (destOf({ tool: was.tool, blocks })?.kind !== "send") return null;
    const app = nd.target.app, App = appName(app);
    const conns = await repo.listConnections(ownerId);
    if (!knownApp(conns, app)) return `Nie zapisałem: nie znam miejsca „${app.trim()}”, więc mostek nie miałby czym tego wysłać. target.app to klucz aplikacji (clickup, slack, gmail, calendar, github, figma, whatsapp, sheets, docs) albo nazwa połączenia z list_connections.`;
    const [task, projects] = await Promise.all([repo.getTask(ownerId, taskId), repo.listProjects(ownerId)]);
    const companyId = projects.find((p) => p.id === task?.projectId)?.companyId ?? null;
    const p = connectorProblem(conns, { app, connectionId: was.connectionId, host: null, companyId });
    if (p?.kind === "none" && !p.google.length) return `Nie zapisałem: na Macu nie ma działającego konektora ${App} w Claude Code, więc mostek nie wyśle tego szkicu. Nie przygotowuj go: oddaj krok przez leave_step z powodem „Na Macu nie ma konektora ${App}. Dodaj go w Claude Code na Macu.”`;
    return null;
  };
  // krok właściciela świeżo z bazy (z danymi o zgodzie); null = nie jego albo nie ma
  const stepById = async (stepId: string): Promise<Step | null> => { const taskId = await ownedStep(ownerId, stepId); return taskId ? (await repo.getTask(ownerId, taskId))?.steps.find((x) => x.id === stepId) ?? null : null; };
  return createMcpHandler((server) => {
    if (scope?.kind === "send") {
      // bieg wysyłki: każde narzędzie przechodzi przez sendGuard (lista dozwolonych, jego zadanie i krok)
      const reg = server.registerTool.bind(server) as (name: string, config: unknown, cb: (args: Record<string, unknown>, extra: unknown) => unknown) => unknown;
      server.registerTool = ((name: string, config: unknown, cb: (args: Record<string, unknown>, extra: unknown) => unknown) => reg(name, config, async (args, extra) => {
        const why = await sendGuard(ownerId, scope, name, args ?? {});
        return why ? { content: [{ type: "text" as const, text: why }], isError: true } : cb(args, extra);
      })) as unknown as typeof server.registerTool;
    }
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
      // bieg wysyłki widzi tylko podpisany szkic swojego kroku: kontekst zadania (wątki, czat, fakty) pisze też agent i treść z zewnątrz
      if (scope?.kind === "send") {
        const st = t.steps.find((x) => x.id === scope.stepId);
        if (!st || !sends(st)) return text("Nie ma szkicu do wysłania w tym biegu (zgodę wycofano albo krok jest zrobiony). Niczego nie wysyłaj.");
        const conn = st.connectionId ? connections.find((c) => c.id === st.connectionId) : null;
        return text([`ZADANIE [${t.id}] „${t.title}”, KROK [${st.id}] „${st.title}” (${st.tool})${conn ? ` | połączenie: ${conn.label}${conn.account ? ` (${conn.account})` : ""}` : ""}`, draftsText([st], { send: (s) => sends(s as Step) })].join("\n"));
      }
      const facts = await Promise.all(t.steps.map(async (s) => [s.id, await repo.listFacts({ stepId: s.id })] as const));
      const ctx = contextText({ tasks, projects, companies, connections, rules, samples, factPrefs, currentTaskId: taskId });
      const fx = facts.filter(([, f]) => f.length).map(([id, f]) => `FAKTY KROKU ${id}:\n${f.filter((x) => !x.hidden).map((x) => `- ${x.label}: ${x.value}${x.source ? ` (${x.source.app}${x.source.url ? ", " + x.source.url : ""})` : ""}`).join("\n")}`).join("\n");
      // szkice kroków w pełnej treści: zatwierdzony szkic agent wysyła dokładnie w tym brzmieniu (bez tego mógł go tylko zgadywać)
      const dx = draftsText(t.steps, { send: (s) => sends(s as Step) });
      // kartki niezrobionych kroków: po odpowiedzi Piotra agent je poprawia (set_blocks pełnym zestawem) albo mówi, czemu nie
      const kx = cardText(t.steps);
      const stepRef = (m: { actions: unknown }) => { const id = (m.actions as { stepId?: string } | null)?.stepId; const s = id ? t.steps.find((x) => x.id === id) : null; return s ? ` przy kroku [${s.id}] „${s.title}”` : ""; };
      const qs = await repo.listQuestions(ownerId, { taskId });
      const qx = qs.length ? "PYTANIA DO PIOTRA (zadane w aplikacji):\n" + qs.map((q) => `- [${q.id}]${q.stepId ? ` krok ${q.stepId}` : ""} ${q.text} → ${q.answer ? `ODPOWIEDŹ: ${q.answer}` : "(czeka na odpowiedź)"}`).join("\n") : "";
      const att = await repo.listAttachments({ taskId });
      const ax = att.length ? "ZAŁĄCZNIKI ZADANIA (grafikę albo plik tekstowy pokaże get_attachment; opis zapisz przez describe_attachment):\n" + att.map((a) => `- [${a.id}] ${a.kind} „${a.name ?? a.url ?? ""}”${a.mime ? ` (${a.mime})` : ""}${a.caption ? ` · ${a.caption}` : ""}${a.analysis ? `: ${a.analysis.slice(0, 400)}` : ""}`).join("\n") : "";
      // rozmowa w zadaniu: Piotr dopisuje tu wymagania i pytania; NOWE = jeszcze bez odpowiedzi agenta
      const chat = await repo.listChat(ownerId, taskId, 12);
      const cx = chat.length ? "ROZMOWA W ZADANIU (ostatnie wpisy; NOWE [id] = Piotr napisał, nikt nie odpowiedział: zrób, o co prosi, i odpowiedz przez reply_chat z messageIds = [id] tej wiadomości, osobno po każdej załatwionej prośbie; gdy prośba zmienia zakres, najpierw add_steps z before):\n" + chat.map((m) => `- ${m.role === "user" ? "Piotr" : "Agent"} (${m.createdAt.slice(0, 16).replace("T", " ")} UTC)${m.role === "user" ? stepRef(m) : ""}${m.role === "user" && !m.answeredAt ? ` NOWE [${m.id}]` : ""}: ${capText(m.text)}`).join("\n") : "";
      return text(ctx + (fx ? "\n" + fx : "") + (kx ? "\n" + kx : "") + (dx ? "\n" + dx : "") + (qx ? "\n" + qx : "") + (ax ? "\n" + ax : "") + (cx ? "\n" + cx : ""));
    });

    server.registerTool("get_rules", {
      title: "Zasady pracy", description: "Zasady pracy w trzech sekcjach: PROFIL (dane o firmie, projekcie i narzędziach), ZASADY (zawsze) i PROCEDURY (pełna treść tych, które pasują do tools albo topic; reszta w spisie). projectId: projekt zadania (zasady jego firmy dochodzą same); companyId: firma, gdy nie ma projektu; tools: narzędzia kroku (slack, gmail, clickup...); topic: tematy pracy albo nazwa procedury ze spisu, np. [\"rozpisanie\", \"story\", \"bug\", \"przegląd\"]; text: tytuł i szczegóły kroku (dopasowanie po słowach).",
      inputSchema: z.object({ projectId: z.string().optional(), companyId: z.string().optional(), tools: z.array(z.string()).optional(), topic: z.array(z.string()).optional(), text: z.string().optional() }),
    }, async ({ projectId, companyId, tools, topic, text: t }) => {
      const [rules, projects] = await Promise.all([repo.listRules(ownerId), repo.listProjects(ownerId)]);
      return text(rulesText(rules, projectId ?? null, tools ?? [], { topic, text: t, companyId: companyOf(projectId, projects) ?? companyId ?? null }) || "(brak zasad)");
    });

    server.registerTool("create_task", {
      title: "Nowe zadanie", description: "Tworzy zadanie z krokami. title: 2–6 słów, samo sedno (nie cała wiadomość); title kroku od czasownika, 2–6 słów, bez identyfikatorów. due: termin YYYY-MM-DD (ustaw, gdy w treści jest termin). Kroki: tool: klucz narzędzia, zawsze klucz, nie etykieta: code (Claude Code), manual (Piotr sam), slack, gmail, clickup, calendar, claude (dokument pisany przez Claude), claudeapp, browser, github, figma, whatsapp, sheets, docs, file (Plik na Macu: zapis pliku na Macu Piotra, bez zgody, robi go tylko mostek), est w minutach (wielokrotność 5), needsApproval gdy krok wysyła coś na zewnątrz, dependsOn jako n1, n2 (numery kroków w tej paczce), link tylko do elementu w zewnętrznej aplikacji (ticket, wydarzenie, mail), nigdy adres Task Hub, connection: nazwa połączenia z list_connections, gdy ma znaczenie, którym kontem (firma, prywatne) krok ma być zrobiony.",
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
      title: "Zmień zadanie", description: "Zmienia tytuł, cel, priorytet, termin albo projekt zadania. Tytuł: 2–6 słów, samo sedno; pierwotny tytuł zostaje zapisany sam.",
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
      title: "Dodaj kroki", description: "Dodaje kroki do zadania. Pola jak w create_task; link tylko do elementu w zewnętrznej aplikacji (ticket, wydarzenie, mail), nigdy adres Task Hub. before: id kroku, przed którym nowe kroki mają wejść (np. krok publikacji, wysyłki, commitu): dziedziczą jego zależności, on zaczyna zależeć od nich, a jego szkic (gdy czekał na zgodę) staje się nieaktualny i krok wraca do zrobienia. Bez before kroki idą na koniec. Termin zadania ustaw osobno przez update_task(due).",
      inputSchema: z.object({ taskId: z.string(), steps: z.array(z.object({ title: z.string(), tool: z.string().optional(), detail: z.string().optional(), needsApproval: z.boolean().optional(), est: z.number().int().optional(), link: z.string().optional(), dependsOn: z.array(z.string()).optional(), connection: z.string().optional() })), before: z.string().optional() }),
    }, async (a) => {
      const t = await repo.getTask(ownerId, a.taskId); if (!t) return text("Nie ma takiego zadania.");
      const bef = a.before ? t.steps.find((s) => s.id === a.before) ?? null : null;
      if (a.before && !bef) return text("Nie ma takiego kroku (before) w tym zadaniu.");
      const fresh = t.steps.length === 0;
      const steps = await repo.addSteps(t.id, await Promise.all(a.steps.map(async (s) => ({ ...s, link: externalLink(s.link), estMin: s.est, connectionId: await connectionIdOf(s.connection) }))), { before: bef?.id ?? null });
      // przed krokiem ze szkicem (czekającym na zgodę albo już zatwierdzonym) weszła nowa praca: szkic jest nieaktualny, zgoda przepada,
      // krok wraca do zrobienia i dostanie nowy szkic po nowych krokach
      const reset = !!bef && bef.status !== "done" && !bef.sendStartedAt && (bef.status === "draft" || !!bef.approvedAt);
      if (bef && reset) await repo.updateStep(bef.id, { status: "todo", prevStatus: null, handoffAt: null, blocks: (bef.blocks ?? []).map((b): Block => (b.type === "draft" ? { ...b, status: "proposed", stale: true } : b)) });
      // w rozmowie tylko fakt: ile kroków i gdzie; tytuły, gdy jest ich mało (szczegóły są na kafelkach)
      const n = steps.length, word = n === 1 ? "krok" : n < 5 ? "kroki" : "kroków";
      const list = n <= 4 ? ": " + steps.map((s) => `„${shortTitle(s.title, 40)}”`).join(", ") : "";
      await repo.addChat(ownerId, t.id, "agent", `${fresh ? "Rozpisałem" : "Dodałem"} ${n} ${word}${bef ? ` przed „${shortTitle(bef.title, 40)}”` : ""}${list}.`, { stepId: steps[0]?.id });
      return json({ steps: steps.map((s) => ({ id: s.id, title: s.title })), ...(bef ? { before: { id: bef.id, title: bef.title, draftReset: reset } } : {}) });
    });

    server.registerTool("update_step", {
      title: "Zmień krok", description: "Zmienia tytuł, opis, narzędzie, szacunek, link albo połączenie kroku (tool = klucz jak w create_task; link = element w zewnętrznej aplikacji, np. utworzone wydarzenie albo ticket; connection = nazwa z list_connections, pusty napis zdejmuje).",
      inputSchema: z.object({ stepId: z.string(), title: z.string().optional(), detail: z.string().optional(), tool: z.string().optional(), est: z.number().int().optional(), link: z.string().optional(), connection: z.string().optional() }),
    }, async (a) => {
      if (!(await ownedStep(ownerId, a.stepId))) return text("Nie ma takiego kroku.");
      const connectionId = a.connection === undefined ? undefined : await connectionIdOf(a.connection);
      if (a.connection?.trim() && !connectionId) return text("Nie ma takiego połączenia (list_connections).");
      const was = await stepById(a.stepId);
      await repo.updateStep(a.stepId, { title: a.title, detail: a.detail, tool: a.tool, estMin: a.est, link: a.link === undefined ? undefined : externalLink(a.link) ?? null, connectionId });
      // zmiana narzędzia albo połączenia kroku z zatwierdzonym szkicem kasuje zgodę (inne konto, inna aplikacja niż te, które Piotr widział)
      if (was?.approvedAt && !(await stepById(a.stepId))?.approvedAt) return text("Zmieniono. Zgoda Piotra na szkic tego kroku wygasła (zmienione narzędzie albo połączenie): szkic wrócił do zatwierdzenia.");
      return text("Zmieniono.");
    });

    server.registerTool("set_blocks", {
      title: "Ułóż panel kroku", description: "Zapisuje kartkę kroku z klocków: najpierw kontekst (thread = wątek jako dymki, mail = wątek maili z from/to/subject, comment = jeden komentarz z miejscem, facts, table = wiersze, list, media = zrzuty i pliki z opisem, link, free = markdown gdy nic nie pasuje, text = krótka notatka), potem jeden draft (to, co powstaje: target.app, target.where, target.url = adres miejsca, gdzie treść trafi lub co zmieni: ticket, wątek, kanał, dokument; Piotr otwiera go przyciskiem przed wysyłką, action, subject, body w Markdown: nagłówki #, **pogrubienie**, *kursywa*, listy - i 1., linki [tekst](url); Piotr widzi i edytuje je sformatowane, przy wysyłce get_task poda wersję w formacie aplikacji docelowej; dla wierszy arkusza columns + rows; dla promptu dla agenta target.app code). Każdy klocek kontekstu ma source {app, ref = miejsce, url}. Pokaż tylko to, co ważne dla tego kroku; długi wątek daj cały, aplikacja pokaże ostatnie 3. rememberFor: nazwa aplikacji źródłowej, jeśli ten układ ma być wzorem dla podobnych kroków. target.app = klucz aplikacji albo nazwa połączenia z list_connections. Jeden szkic = jedna rzecz w miejscu docelowym (jeden ticket: tytuł w subject, opis w body, typ, priorytet, osoba i status w fields); columns + rows tylko dla wierszy arkusza. Szkicu do miejsca, którego mostek nie wyśle (nieznana aplikacja, brak konektora tej aplikacji na Macu, plik na Macu), set_blocks nie zapisze.",
      inputSchema: z.object({ stepId: z.string(), blocks: Blocks, rememberFor: z.string().optional(), sameTargetOk: z.string().max(300).optional().describe("tylko gdy celowo drugi raz to samo miejsce i czynność (np. kolejny komentarz w tym samym tickecie): jednym zdaniem czemu") }),
    }, async (a) => {
      const taskId = await ownedStep(ownerId, a.stepId); if (!taskId) return text("Nie ma takiego kroku.");
      const was = await stepById(a.stepId); if (!was) return text("Nie ma takiego kroku.");
      if (a.blocks.filter((b) => b.type === "draft").length > 1) return text("Nie zapisałem: krok ma jeden szkic (jeden blok draft). Drugą wysyłkę zapisz jako osobny krok (add_steps) z własnym szkicem.");
      // szkic od agenta sam nie jest zatwierdzony ani wysłany; ta sama treść co zapisany szkic zachowuje jego stan
      const blocks = coerceAgentDrafts(was, a.blocks);
      // zatwierdzony szkic (czeka na wysyłkę albo właśnie się wysyła) zostaje taki, jaki Piotr zatwierdził
      const nd = draftOf({ blocks }), od = draftOf(was);
      if (was.status !== "done" && (was.approvedAt || was.sendStartedAt) && (!nd || nd.status !== od?.status))
        return text("Nie zapisałem: Piotr zatwierdził już szkic tego kroku i czeka on na wysyłkę, więc jego treść, adresat i miejsce zostają bez zmian. Zapisz kartkę z tym samym blokiem draft (SZKIC KROKU w get_task) albo, gdy szkic jest nieaktualny, napisz to Piotrowi przez reply_chat ze stepId tego kroku; on zdecyduje.");
      const blocker = await agentBlocker(nd, was, blocks, taskId);
      if (blocker) return text(blocker);
      // dwa kroki z tym samym szkicem (ten sam ticket i czynność) wysłałyby to samo dwa razy: zatrzymaj, zanim powstanie drugi
      if (!a.sameTargetOk) {
        const all = (await repo.getTask(ownerId, taskId))?.steps ?? [];
        const dup = sameTarget(all, a.stepId, blocks);
        const name = (x: Step) => `[${x.id}] „${x.title}”`;
        if (dup.open.length || dup.sent.length) return text(`Nie zapisałem: ${[
          dup.sent.length ? `to samo miejsce i ta sama czynność już wysłane w ${dup.sent.map(name).join(", ")}` : "",
          dup.open.length ? `inny otwarty krok ma szkic do tego samego miejsca: ${dup.open.map(name).join(", ")}` : "",
        ].filter(Boolean).join("; ")}. Popraw szkic w jednym kroku zamiast dublować, a zbędny krok zamknij przez skip_step z powodem. Jeśli to celowo drugi raz (np. kolejny komentarz), podaj sameTargetOk z powodem.`);
      }
      await repo.updateStep(a.stepId, { blocks });
      if (a.rememberFor) await repo.setLayoutMemory(ownerId, a.rememberFor, blocks);
      // szkic czekający na zgodę: krok przechodzi do zatwierdzenia, Piotr widzi to na kafelku i w rozmowie zadania
      const st = await stepById(a.stepId);
      const fresh = st ? draftOf(st) : null;
      if (st && st.status !== "done" && st.status !== "draft" && fresh?.status === "proposed" && !fresh.stale) {
        // szkic do aplikacji zewnętrznej zawsze czeka na zgodę i po niej leci przez mostek; agent może podnieść „wymaga zgody”, nigdy zdjąć
        const raise = !st.needsApproval && st.tool !== "manual" && isExternalApp(fresh.target.app);
        await repo.updateStep(st.id, { status: "draft", prevStatus: st.status === "handoff" ? st.prevStatus : st.status, handoffAt: null, ...(raise ? { needsApproval: true } : {}) });
        await repo.addChat(ownerId, taskId, "agent", `Szkic do zatwierdzenia: „${shortTitle(st.title, 70)}”.`, { stepId: st.id });
        return text("Panel zapisany, krok czeka na zatwierdzenie Piotra. Nie wywołuj complete_step dla tego kroku, dopóki Piotr nie zatwierdzi i nie wyślesz treści.");
      }
      return text("Panel zapisany.");
    });

    server.registerTool("complete_step", {
      title: "Krok gotowy", description: "Zgłasza wynik kroku: summary = 1–2 zdania o efekcie (Piotr czyta je w raporcie kroku; w rozmowie zobaczy tylko „Zrobione: tytuł kroku”), link do wyniku, opcjonalnie czas w minutach. Krok z kodem: changes = zmienione pliki (path, status, diff, note), repo, branch, preview = adres podglądu (http albo file://); trafiają na kartkę kroku jako blok zmian. Gdy to ostatni krok, zadanie się kończy i agent pisze notatkę końcową. Krok „Plik na Macu” (tool file): file = pełna ścieżka zapisanego pliku (np. ~/Documents/…/2026-10-20-us-podglad-rol.md), nie w link.",
      inputSchema: z.object({ stepId: z.string(), summary: z.string().max(4000), link: z.string().optional(), spentMin: z.number().int().optional(), repo: z.string().max(200).optional(), branch: z.string().max(200).optional(), preview: z.string().max(1000).optional(), changes: z.array(ChangedFile).max(60).optional(), file: z.string().max(500).optional() }),
    }, async (a) => {
      const taskId = await ownedStep(ownerId, a.stepId);
      if (!taskId) return text("Nie ma takiego kroku.");
      // plik na Macu zapisuje tylko bieg pracy mostka (w folderze na pliki); ścieżka to tekst, nie link
      if (a.file !== undefined && audience !== "work") return text("Nie zamknąłem kroku: plik na Macu zapisuje tylko bieg mostka na Macu (aplikacja Task Hub 0.1.7).");
      if (a.file !== undefined && !isFilePath(a.file)) return text("Nie zamknąłem kroku: file to pełna ścieżka pliku na Macu (zaczyna się od / albo ~/).");
      // szkic czekający na zgodę Piotra nie może się zamknąć: kartka pokazałaby „Wysłano”, a kroki po nim ruszyłyby, choć nic nie poleciało
      const cur = await stepById(a.stepId);
      // bieg wysyłki zamyka tylko szkic, który wziął, i tylko póki zgoda jest ważna (Piotr mógł zatrzymać wysyłkę)
      if (cur && scope?.kind === "send" && !(approvalValid(cur) && cur.sendStartedAt))
        return text("Nie zamknąłem kroku: wysyłkę tego szkicu zatrzymano albo zgoda Piotra wygasła. Jeśli treść już poszła, oddaj krok przez leave_step z linkiem w powodzie; Piotr sprawdzi.");
      if (cur && (cur.status === "draft" || cur.blocks?.some((b) => b.type === "draft" && b.status === "proposed")))
        return text("Nie zamknąłem kroku: jego szkic czeka na zatwierdzenie Piotra. Zostaw krok jako szkic; po zatwierdzeniu wyśle go mostek Task Hub. Jeśli krok stał się zbędny (to samo już wysłane, zakres się zmienił), zamknij go przez skip_step z powodem.");
      // zatwierdzony szkic zamyka jako wysłany tylko ten, kto go wysyła: stary mostek przy ważnej zgodzie albo bieg wysyłki tego kroku
      if (cur && draftOf(cur)?.status === "approved" && !sends(cur))
        return text(audience === "bridge-v1" ? "Nie zamknąłem kroku: zgoda Piotra na ten szkic nie jest już ważna albo szkic wysyła teraz inny bieg. Niczego nie wysyłaj." : "Nie zamknąłem kroku: jego zatwierdzony szkic wysyła mostek Task Hub w osobnym biegu wysyłki. Nie wysyłaj go sam i nie zamykaj tego kroku.");
      if (cur && cur.status !== "done" && needsDraft(cur))
        return text("Nie zamknąłem kroku: wymaga zgody Piotra, bo zmienia coś w aplikacji zewnętrznej. Przygotuj szkic przez set_blocks (blok draft, status proposed); po zatwierdzeniu wyśle go mostek Task Hub. Jeśli krok stał się zbędny, zamknij go przez skip_step z powodem.");
      const r = await finishStep(ownerId, taskId, a.stepId, { report: a.summary, link: externalLink(a.link), addSpentSec: a.spentMin ? a.spentMin * 60 : 0 });
      const st = r.task.steps.find((x) => x.id === a.stepId);
      if (st && a.file) await repo.updateStep(st.id, { filePath: a.file });
      // zmiany w kodzie na kartce kroku: jeden blok changes (zastępuje poprzedni), reszta klocków zostaje
      if (st && (a.changes?.length || a.preview)) {
        const d0 = draftOf(st), old = (st.blocks ?? []).find((b) => b.type === "changes");
        // wysłany commit: pliki na kartce zostają te zatwierdzone (są w podpisie); dochodzi tylko podgląd i opis, inaczej szkic wróciłby do „niewysłany”
        if (d0?.status === "sent" && old && isGitDraft(d0, st.blocks)) await repo.updateStep(st.id, { blocks: (st.blocks ?? []).map((b): Block => (b === old ? { ...old, preview: a.preview ?? old.preview, summary: a.summary.slice(0, 2000) } : b)) });
        else {
          const rest = (st.blocks ?? []).filter((b) => b.type !== "changes").slice(0, 11);
          await repo.updateStep(st.id, { blocks: [...rest, { type: "changes", repo: a.repo, branch: a.branch, preview: a.preview, summary: a.summary.slice(0, 2000), files: a.changes ?? [] }] });
        }
      }
      // w rozmowie tylko fakt; opis, pliki i adresy są na kartce kroku („Otwórz krok”)
      await repo.addChat(ownerId, taskId, "agent", st ? doneChat({ ...st, filePath: a.file ?? st.filePath }, r.closed) : `Zrobione.${r.closed ? " Zadanie ukończone." : ""}`, { stepId: a.stepId, link: externalLink(a.link) ?? undefined });
      // po wysyłce: inne otwarte kroki ze szkicem do tego samego miejsca są pewnie zbędne; agent sprawdza je teraz, a nie zostawia Piotrowi do zatwierdzenia
      const twins = st ? sameTarget(r.task.steps, st.id, st.blocks).open : [];
      const hint = twins.length ? ` Inne otwarte kroki ze szkicem do tego samego miejsca: ${twins.map((x) => `[${x.id}] „${x.title}”`).join(", ")}. Sprawdź, czy po tej wysyłce nie są zbędne; zbędne zamknij przez skip_step z powodem.` : "";
      return text((r.closed ? "Krok zapisany, zadanie ukończone." : "Krok zapisany.") + hint);
    });

    server.registerTool("start_step", {
      title: "Zaczynam krok", description: "Oznacza krok jako w toku: Piotr widzi na kafelku, że Claude nad nim pracuje. Wywołaj tuż przed robieniem kroku. Po zrobieniu zgłoś complete_step; gdy nie da się go zrobić (brak narzędzia, brak dostępu), oddaj go przez leave_step z powodem.",
      inputSchema: z.object({ stepId: z.string() }),
    }, async (a) => {
      const taskId = await ownedStep(ownerId, a.stepId); if (!taskId) return text("Nie ma takiego kroku.");
      const st = (await repo.getTask(ownerId, taskId))?.steps.find((x) => x.id === a.stepId); if (!st) return text("Nie ma takiego kroku.");
      if (st.status === "done") return text("Ten krok jest już zrobiony.");
      if (st.tool === "file" && audience !== "work") return text("Nie zacząłem: krok „Plik na Macu” robi tylko aplikacja Task Hub 0.1.7 na Macu. Zostaw go.");
      // szkic czeka na decyzję Piotra: start_step nie może go przepchnąć dalej (stan „w toku” po szkicu wyglądał kiedyś jak zgoda)
      if (st.status === "draft") return text("Nie zacząłem: szkic tego kroku czeka na zatwierdzenie Piotra. Niczego nie wysyłaj; poprawki szkicu zapisuj przez set_blocks, a po zatwierdzeniu wyśle go mostek Task Hub.");
      if (st.approvedAt || st.sendStartedAt || draftOf(st)?.status === "approved") return text(sends(st) ? "Krok w toku." : "Nie zacząłem: zatwierdzony szkic tego kroku wysyła mostek Task Hub w osobnym biegu wysyłki. Niczego tu nie wysyłaj.");
      if (needsDraft(st)) return text("Nie zacząłem: krok wymaga zgody Piotra, bo zmienia coś w aplikacji zewnętrznej. Przeczytaj, co trzeba, i przygotuj szkic przez set_blocks (blok draft, status proposed); niczego nie wysyłaj, po zatwierdzeniu wyśle go mostek Task Hub.");
      if (st.status !== "handoff") await repo.updateStep(st.id, { status: "handoff", prevStatus: st.status, handoffAt: new Date().toISOString() });
      return text("Krok w toku.");
    });

    server.registerTool("skip_step", {
      title: "Zamykam zbędny krok", description: "Zamyka krok, który stał się zbędny (to samo już wysłane w innym kroku, zakres się zmienił, ticket już ma tę zmianę), także krok ze szkicem czekającym na zgodę. Nic nie wysyła; Piotr widzi „Zamknięty bez wysyłki” i powód, a „Przywróć do zrobienia” przywraca krok. reason: jedno zdanie, czemu zbędny.",
      inputSchema: z.object({ stepId: z.string(), reason: z.string().min(3).max(400) }),
    }, async (a) => {
      const taskId = await ownedStep(ownerId, a.stepId); if (!taskId) return text("Nie ma takiego kroku.");
      const st = (await repo.getTask(ownerId, taskId))?.steps.find((x) => x.id === a.stepId); if (!st) return text("Nie ma takiego kroku.");
      if (st.status === "done") return text("Ten krok jest już zamknięty.");
      if (st.sendStartedAt) return text("Nie zamknąłem: zatwierdzony szkic tego kroku właśnie wysyła mostek. Gdy wysyłka się skończy, sprawdź krok ponownie.");
      // zatwierdzony, ale niewysłany szkic wraca do stanu propozycji: kartka nie może potem udawać, że coś poszło
      await repo.clearApproval(ownerId, st.id);
      const r = await finishStep(ownerId, taskId, st.id, { report: `Zbędny: ${a.reason}` });
      await repo.addChat(ownerId, taskId, "agent", `Zamknąłem jako zbędny: „${shortTitle(st.title, 60)}”. ${a.reason}`, { stepId: st.id });
      return text(r.closed ? "Krok zamknięty jako zbędny, zadanie ukończone." : "Krok zamknięty jako zbędny.");
    });

    server.registerTool("leave_step", {
      title: "Oddaję krok", description: "Gdy kroku nie da się zrobić (brak narzędzia, dostępu albo danych): krok wraca do zrobienia, a Piotr widzi powód w zadaniu. Nie używaj do pytań, od tego jest ask_question, ani do kroków zbędnych, od tego jest skip_step.",
      inputSchema: z.object({ stepId: z.string(), reason: z.string().max(600) }),
    }, async (a) => {
      const taskId = await ownedStep(ownerId, a.stepId); if (!taskId) return text("Nie ma takiego kroku.");
      const st = (await repo.getTask(ownerId, taskId))?.steps.find((x) => x.id === a.stepId); if (!st) return text("Nie ma takiego kroku.");
      if (st.status === "done") return text("Ten krok jest już zrobiony.");
      // oddany krok z zatwierdzonym szkicem (np. bieg wysyłki nie znalazł kanału) wraca do zatwierdzenia: bez ponawiania, Piotr decyduje.
      // Bieg wysyłki bez send_started_at to stary bieg (Piotr zatrzymał i zatwierdził od nowa): nowej zgody nie rusza, zostaje tylko notka
      const stale = scope?.kind === "send" && !st.sendStartedAt;
      if (stale) { /* zgoda nie należy do tego biegu */ }
      else if (st.approvedAt || st.sendStartedAt || draftOf(st)?.status === "approved") await repo.clearApproval(ownerId, st.id);
      else if (st.status === "handoff") await repo.updateStep(st.id, { status: st.prevStatus === "draft" ? "draft" : "todo", prevStatus: null, handoffAt: null });
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
      title: "Co czeka na agenta", description: "Lista pracy dla agenta, w kolejności robienia: kroki w toku (zaczęte, dokończ), zatwierdzone szkice do wysłania, zadania bez kroków (rozłóż przez add_steps), odpowiedzi Piotra, kroki do zrobienia bez zgody (start_step → zrób swoimi konektorami → complete_step), kroki wymagające zgody (przygotuj szkic przez set_blocks jako draft, niczego nie wysyłaj). Rób tylko to, do czego masz narzędzia; krok, którego nie możesz zrobić, oddaj przez leave_step. Nigdy niczego nie usuwaj. Gdy mostek na komputerze Piotra jest aktywny, inni agenci dostają „MOSTEK AKTYWNY” i nie robią nic (force: true pokaże pracę mimo to).",
      inputSchema: z.object({ force: z.boolean().optional() }),
    }, async ({ force }) => {
      // mostek pracuje na bieżąco: automat co godzinę i inni agenci ustępują, żeby nie robić tego samego dwa razy (biegi mostka to sam mostek)
      if (kind === "client" && !force) {
        const st = await repo.bridgeStatus(ownerId, BRIDGE_ALIVE_MS);
        if (st.alive) return text(`MOSTEK AKTYWNY: Claude Code na komputerze Piotra (${st.name ?? "mostek"}) wykonuje pracę na bieżąco (ostatni sygnał ${ago(st.seenAt)}). Nic nie rób i zakończ. list_work z force: true pokaże pracę mimo to.`);
      }
      return text((await workSummary(ownerId, { audience, stepId: scope?.stepId ?? undefined, peek: audience === "send" })).text);
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
      title: "Odpowiedz w rozmowie zadania", description: "Odpowiada Piotrowi w rozmowie zadania (1–3 zdania: co dopisałeś, numery i tytuły kroków, albo odpowiedź na pytanie; bez raportu z postępu). messageIds: id wiadomości Piotra, które ta odpowiedź załatwia (z get_task, przy NOWE); bez nich załatwia wszystkie dotychczasowe w zadaniu. Odpowiadaj osobno po każdej załatwionej prośbie, żeby Piotr widział, co już jest zrobione. stepId: krok, którego odpowiedź dotyczy (karta w rozmowie dostanie „Otwórz krok”); link: adres wyniku w zewnętrznej aplikacji. Gdy wszystkie kroki są zrobione i nic już nie czeka na odpowiedź, zadanie kończy się samo.",
      inputSchema: z.object({ taskId: z.string(), text: z.string().min(1).max(1200), messageIds: z.array(z.string()).max(50).optional(), stepId: z.string().optional(), link: z.string().optional() }),
    }, async (a) => {
      const t = await repo.getTask(ownerId, a.taskId); if (!t) return text("Nie ma takiego zadania.");
      const stepId = a.stepId && t.steps.some((s) => s.id === a.stepId) ? a.stepId : undefined;
      const answers = await repo.markChatAnswered(ownerId, t.id, a.messageIds);
      await repo.addChat(ownerId, t.id, "agent", a.text.trim(), { stepId, link: externalLink(a.link) ?? undefined, answers });
      // ostatni krok gotowy czekał tylko na tę odpowiedź: zadanie kończy się teraz
      const closed = await repo.closeIfDone(ownerId, t.id);
      if (closed) await repo.addChat(ownerId, t.id, "agent", "Wszystkie kroki zrobione, zadanie ukończone.");
      const left = (await repo.listPendingChat(ownerId, t.id)).length;
      return text(`Odpowiedź zapisana${answers.length ? ` (załatwione wiadomości: ${answers.length})` : ""}.${left ? ` Bez odpowiedzi zostało: ${left}.` : ""}${closed ? " Zadanie ukończone." : ""}`);
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
      title: "Połączenia", description: "Rejestr połączeń: do jakich aplikacji agent ma dostęp, przez co (claude = konektor w Claude, claude-code = Claude Code na komputerze Piotra przez mostek, taskhub = sam Task Hub), na jakim koncie, dla której firmy albo sfery (work | private) i czy działa (active | expired | off). Krok może wskazać połączenie przez pole connection (nazwa); bez wskazania wybierz połączenie pasujące do firmy zadania. Żadnych sekretów: połączenie to rura, nie klucz. audit: true zwraca zamiast tego raport bezpieczeństwa (tokeny, klienci OAuth, mostki, próby logowania, nocne zmiany), tylko na prośbę Piotra o sprawdzenie dostępu.",
      inputSchema: z.object({ audit: z.union([z.boolean(), z.enum(["true", "false"])]).optional() }),   // klient z zapamiętanym starszym schematem przysyła tekst
    }, async (a) => {
      if (a.audit === true || a.audit === "true") return kind === "run" ? text("Raport bezpieczeństwa tylko na prośbę Piotra, nie w biegu mostka.") : json(await securityReport(ownerId));
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
  return buildHandler(auth)(req);
}

export { handle as GET, handle as POST, handle as DELETE };
