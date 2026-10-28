// Serwer MCP Task Hub: Claude, Claude Code, ChatGPT i własne agenty podłączają się tutaj tokenem (OAuth albo nagłówek).
// Dostają zadania z zasadami i kontekstem, zgłaszają wyniki kroków, dopisują fakty i migawki.
import { randomUUID } from "node:crypto";
import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import * as repo from "@/lib/repo";
import { companyOf, contextText, brief, scoreAll, capText, draftsText, cardText } from "@/lib/agent/context";
import { rulesText } from "@/lib/agent/context";
import { audienceOf, WAIT_RE, waitTarget, workSummary } from "@/lib/agent/work";
import { BRIDGE_ALIVE_MS, ago, connectorProblem, knownApp } from "@/lib/bridge";
import { finishStep } from "@/lib/services";
import { composeStatic } from "@/lib/agent/compose";
import { appName, Blocks, ChangedFile, Fact, isOwnerStep, normalizeTool, SPHERES, sphereOf, type Block, type Step } from "@/lib/schema";
import { destOf, doneChat, isDeployStep, isProjectStep, stepKind, keepOwnerAnswers, leaveChat, whyOf, projectPrompt, READ_RE, sameTarget } from "@/lib/stepcard";
import { shortTitle } from "@/lib/auto";
import { sql } from "@/lib/db";
import { originOf, wwwAuthenticate } from "@/lib/oauth";
import { externalLink as externalLinkOf } from "@/lib/links";
import { appUrl } from "@/lib/session";
import { securityReport } from "@/lib/security";
import { isFilePath, isHttpUrl, sanitizeBlocks } from "@/lib/safeurl";
import { unlazy } from "@/lib/format";
import { AGENT_MAX_SEC, elapsedSec } from "@/lib/time";
import { appKey, approvalSig, approvalValid, coerceAgentDrafts, draftOf, draftsOf, forgedDraftStatus, isExternalApp, isGitDraft, isLocalFile, isPromptDraft, isSendable } from "@/lib/agent/approval";
import { matchProjectName } from "@/lib/project-guess";
import { MAX_ESCALATION, normalizeLevel } from "@/lib/agent/models";

// poziom pracy kroku według zasady „Dobór modelu i wysiłku”: od niego mostek dobiera model i wysiłek biegu
const WORK_LEVEL_DOC = "workLevel: poziom pracy kroku dla agenta według zasady „Dobór modelu i wysiłku”: strategy (Strategia: wymyślić, zaplanować, rozstrzygnąć), analysis (Analiza: zebrać i zrozumieć materiał, szkic do klienta), execution (Wykonanie: krok dokładnie opisany, kod według planu), mechanics (Mechanika: tylko przenieść albo wysłać); nadaj go przy rozpisaniu każdemu krokowi agenta, bez niego poziom bierze się z narzędzia.";

// link kroku to adres elementu w zewnętrznej aplikacji (tylko http/https); adres samego Task Hub nie jest linkiem kroku
const externalLink = (link: string | undefined | null) => (isHttpUrl(link) ? externalLinkOf(link, appUrl()) : undefined);

export const maxDuration = 60;

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
const PREVIEW_MAX = 1_500_000;   // znaki pliku HTML podglądu (paczka 22); limit ciała żądania funkcji Vercel to 4,5 MB
const json = (v: unknown) => text(JSON.stringify(v, null, 1));
// krok należy do właściciela tokenu? zwraca id zadania
// lista id kroków; klient z nieodświeżonym opisem narzędzia przysyła ją jako napis ("[]", JSON albo id po przecinku)
const idList = z.preprocess((v) => {
  if (typeof v !== "string") return v;
  const t = v.trim();
  if (t.startsWith("[")) { try { return JSON.parse(t); } catch { return v; } }
  return t ? t.split(",").map((x) => x.trim()).filter(Boolean) : [];
}, z.array(z.string()));

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
  // projekt po nazwie z listy (także odmienionej, np. „Shiftwowa”, ale w całości: „Shiftwow Mobile” to nie Shiftwow); nieznana nazwa = błąd z listą,
  // bez cichego tworzenia projektu (od tego jest create_project)
  const projectByName = async (name: string): Promise<string> => {
    const found = await repo.findProjectByName(ownerId, name);
    if (found) return found.id;
    const projects = await repo.listProjects(ownerId);
    const g = matchProjectName(name, projects);
    if (g) return g.id;
    throw new Error(`Nie ma projektu „${name}”. Projekty: ${projects.map((p) => p.name).join(", ") || "(brak)"}. Podaj dokładną nazwę z list_projects albo utwórz projekt przez create_project.`);
  };
  // szkic, którego nic nie wyśle (plik na Macu to nie wysyłka): odmowa z instrukcją dla tego, kto pyta; nil = szkice mogą się zapisać.
  // Przy opcjach każdy nowy szkic z osobna (pierwsza odmowa wygrywa); zatwierdzony, wysłany i nieaktualny nie podlegają sprawdzeniu
  const agentBlocker = async (was: Step, blocks: Block[], taskId: string): Promise<string | null> => {
    if (was.status === "done") return null;
    let conns: Awaited<ReturnType<typeof repo.listConnections>> | null = null;
    for (const nd of draftsOf({ blocks })) {
      if (nd.status !== "proposed" || nd.stale) continue;
      if (isLocalFile(nd.target.app)) return audience === "work"
        ? "Nie zapisałem: „Plik na Macu” to nie szkic do zatwierdzenia. Zmień narzędzie kroku na file (update_step z tool \"file\"), zapisz plik narzędziem Write w folderze z linii „Foldery na pliki”, potem complete_step z polem file."
        : "Nie zapisałem: „Plik na Macu” to nie szkic do zatwierdzenia. Zmień narzędzie kroku na file (update_step z tool \"file\") i zostaw krok; plik zapisze aplikacja Task Hub 0.1.7 na Macu.";
      // szkic do aplikacji zewnętrznej, której mostek nie wyśle: nieznane miejsce albo brak konektora na Macu (commit, prompt i notatka nie idą konektorem;
      // kilka kont albo konto Google do wyboru nie zatrzymuje szkicu: Piotr wskaże konto w nagłówku karty)
      if (destOf({ tool: was.tool, blocks })?.kind !== "send") continue;
      const app = nd.target.app, App = appName(app);
      conns ??= await repo.listConnections(ownerId);
      if (!knownApp(conns, app)) return `Nie zapisałem: nie znam miejsca „${app.trim()}”, więc mostek nie miałby czym tego wysłać. target.app to klucz aplikacji (clickup, slack, gmail, calendar, github, figma, mural, whatsapp, sheets, docs) albo nazwa połączenia z list_connections.`;
      const [task, projects] = await Promise.all([repo.getTask(ownerId, taskId), repo.listProjects(ownerId)]);
      const companyId = projects.find((p) => p.id === task?.projectId)?.companyId ?? null;
      const p = connectorProblem(conns, { app, connectionId: was.connectionId, host: null, companyId });
      if (p?.kind === "none" && !p.google.length) return `Nie zapisałem: na Macu nie ma działającego konektora ${App} w Claude Code, więc mostek nie wyśle tego szkicu. Nie przygotowuj go: oddaj krok przez leave_step z powodem „Na Macu nie ma konektora ${App}. Dodaj go w Claude Code na Macu.”`;
    }
    return null;
  };
  // krok właściciela świeżo z bazy (z danymi o zgodzie); null = nie jego albo nie ma
  const stepById = async (stepId: string): Promise<Step | null> => { const taskId = await ownedStep(ownerId, stepId); return taskId ? (await repo.getTask(ownerId, taskId))?.steps.find((x) => x.id === stepId) ?? null : null; };
  // ---------- czas Claude'a ----------
  // bieg tego wywołania (v2: token biegu pracy); znacznik biegu = ostatnie wywołanie, które kończy jakiś etap (get_task, complete_step…)
  const runIdOf = async (): Promise<string | null> => (scope?.kind === "work" ? scope.runId : kind === "bridge" ? repo.openRunId(ownerId) : null);
  const runOf = async () => { const id = await runIdOf(); return id ? repo.getBridgeRun(ownerId, id) : null; };
  const markRun = async () => { const id = await runIdOf(); if (id) await repo.markBridgeRun(ownerId, id); };
  const clampSec = (ms: number) => Math.max(0, Math.min(AGENT_MAX_SEC, Math.round(ms / 1000)));
  // sekundy Claude'a na krok: bieg wysyłki od wzięcia szkicu; inaczej od start_step (nigdy sprzed startu tego biegu); bez start_step w biegu
  // od ostatniego znacznika biegu (albo jego startu); bez biegu i bez startu czas podany przez agenta (spentMin) albo 0
  const agentSecFor = async (s: Step, o: { fallbackMin?: number; runClock?: boolean } = {}): Promise<number> => {
    if (scope?.kind === "send") return elapsedSec(s.sendStartedAt);
    const run = await runOf(), now = Date.now();
    const floor = run ? new Date(run.startedAt).getTime() : 0;
    if (s.agentStartedAt) return clampSec(now - Math.max(new Date(s.agentStartedAt).getTime(), floor));
    if (run && o.runClock !== false) return clampSec(now - new Date(run.markAt ?? run.startedAt).getTime());
    return o.fallbackMin ? Math.max(0, Math.round(o.fallbackMin * 60)) : 0;
  };
  // ---------- ślad biegu (paczka 7, punkt 3): krok „teraz”, kroki, których bieg dotknął, kropka na zmienionym kroku ----------
  const NOW_STEP = new Set(["start_step", "set_blocks", "update_step", "add_facts", "add_snapshot"]);
  const NOW_END = new Set(["complete_step", "skip_step", "leave_step"]);
  const NOW_TASK = new Set(["get_task", "add_steps", "update_task", "reply_chat", "ask_question"]);
  // po każdym wywołaniu (także odmowie): nad którym krokiem i zadaniem bieg pracuje (kafelek ze światełkiem, dymek „Claude pracuje”)
  const live = async (name: string, a: Record<string, unknown>) => {
    const runId = await runIdOf(); if (!runId) return;
    const stepId = typeof a.stepId === "string" ? a.stepId : null, taskId = typeof a.taskId === "string" ? a.taskId : null;
    if (NOW_STEP.has(name) && stepId) { const tid = await ownedStep(ownerId, stepId); if (tid) await repo.runTouch(ownerId, runId, { stepId, taskId: tid }); }
    else if (NOW_END.has(name) && stepId) await repo.runTouch(ownerId, runId, { end: stepId });
    else if (NOW_TASK.has(name) && taskId) { const [t] = await sql()`select 1 from tasks where id = ${taskId} and owner_id = ${ownerId}`; if (t) await repo.runTouch(ownerId, runId, { taskId }); }
  };
  // udana zmiana kroku: ślad w biegu (stała obwódka i „Claude poprawił szkic · 19:43” na kafelku) i kropka do pierwszego otwarcia, także bez biegu (automat z chmury)
  const mark = async (stepId: string, what: string) => {
    if (scope?.kind === "send") return;
    await repo.markAgentSteps([stepId]);
    const runId = await runIdOf(); if (runId) await repo.runTouch(ownerId, runId, { touched: [{ id: stepId, what }] });
  };
  return createMcpHandler((server) => {
    const reg = server.registerTool.bind(server) as (name: string, config: unknown, cb: (args: Record<string, unknown>, extra: unknown) => unknown) => unknown;
    if (scope?.kind === "send") {
      // bieg wysyłki: każde narzędzie przechodzi przez sendGuard (lista dozwolonych, jego zadanie i krok)
      server.registerTool = ((name: string, config: unknown, cb: (args: Record<string, unknown>, extra: unknown) => unknown) => reg(name, config, async (args, extra) => {
        const why = await sendGuard(ownerId, scope, name, args ?? {});
        return why ? { content: [{ type: "text" as const, text: why }], isError: true } : cb(args, extra);
      })) as unknown as typeof server.registerTool;
    } else {
      // ślad biegu po każdym wywołaniu; błąd śladu nigdy nie psuje narzędzia
      server.registerTool = ((name: string, config: unknown, cb: (args: Record<string, unknown>, extra: unknown) => unknown) => reg(name, config, async (args, extra) => {
        const out = await cb(args, extra);
        await live(name, args ?? {}).catch(() => undefined);
        return out;
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
      // paczka 27: przy każdym załączniku numery kroków, które go potrzebują; przy pracy nad krokiem oglądasz tylko jego grafiki
      const usedBy = (id: string) => t.steps.map((st, i) => (repo.stepAttachments(st, att)?.some((x) => x.id === id) ? String(i + 1).padStart(2, "0") : "")).filter(Boolean);
      const ax = att.length ? "ZAŁĄCZNIKI ZADANIA (grafikę albo plik tekstowy pokaże get_attachment; opis zapisz przez describe_attachment; „kroki” = kroki, którym są przypisane: przy pracy nad krokiem oglądaj tylko jego załączniki, a krok bez przypisanych (stary) wszystkie potrzebne):\n" + att.map((a) => { const u = usedBy(a.id); return `- [${a.id}] ${a.kind} „${a.name ?? a.url ?? ""}”${a.mime ? ` (${a.mime})` : ""}${a.caption ? ` · ${a.caption}` : ""}${u.length ? ` · kroki: ${u.join(", ")}` : ""}${a.analysis ? `: ${a.analysis.slice(0, 400)}` : ""}`; }).join("\n") : "";
      // rozmowa w zadaniu: Piotr dopisuje tu wymagania i pytania; NOWE = jeszcze bez odpowiedzi agenta
      const chat = await repo.listChat(ownerId, taskId, 12);
      const cx = chat.length ? "ROZMOWA W ZADANIU (ostatnie wpisy; NOWE [id] = Piotr napisał, nikt nie odpowiedział: zrób, o co prosi, i odpowiedz przez reply_chat z messageIds = [id] tej wiadomości, osobno po każdej załatwionej prośbie; gdy prośba zmienia zakres, najpierw add_steps z before; gdy Piotr wprost zleca zmianę kodu albo prototypu Task Hub, add_steps z cloudFrom = [id] tej wiadomości):\n" + chat.map((m) => `- ${m.role === "user" ? "Piotr" : "Agent"} (${m.createdAt.slice(0, 16).replace("T", " ")} UTC)${m.role === "user" ? stepRef(m) : ""}${m.role === "user" && !m.answeredAt ? ` NOWE [${m.id}]` : ""}: ${capText(m.text)}${whyOf(m) ? ` (powód: ${capText(whyOf(m)!)})` : ""}`).join("\n") : "";
      await markRun();
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
      title: "Nowe zadanie", description: "Tworzy zadanie z krokami. title: 2–6 słów, samo sedno (nie cała wiadomość); title kroku od czasownika, 2–6 słów, bez identyfikatorów. due: termin YYYY-MM-DD, czyli najpóźniejsza data wykonania; ustaw tylko, gdy w treści jest termin, inaczej pomiń (zadanie bez terminu, nigdy dzisiejsza data z automatu). project: dokładna nazwa istniejącego projektu z list_projects (nowy tylko przez create_project); bez project projekt bierze się z treści, gdy ją wymienia. Kroki: tool: klucz narzędzia, zawsze klucz, nie etykieta: code (Claude Code), manual (Piotr sam), slack, gmail, clickup, calendar, claude (dokument pisany przez Claude), claudeapp, browser, github, figma, mural, whatsapp, sheets, docs, file (Plik na Macu: zapis pliku na Macu Piotra, bez zgody, robi go tylko mostek), est: ile minut zajmie Piotrowi (wielokrotność 5), tylko dla kroków manual; czas kroków Claude'a mierzy się sam, needsApproval gdy krok wysyła coś na zewnątrz, dependsOn jako n1, n2 (numery kroków w tej paczce), tylko gdy krok potrzebuje wyniku wskazanego kroku; kroki niezależne bez dependsOn, żeby agent brał je od razu, link tylko do elementu w zewnętrznej aplikacji (ticket, wydarzenie, mail), nigdy adres Task Hub, connection: nazwa połączenia z list_connections, gdy ma znaczenie, którym kontem (firma, prywatne) krok ma być zrobiony. " + WORK_LEVEL_DOC,
      inputSchema: z.object({
        title: z.string(), summary: z.string().optional(), source: z.string().optional(), level: z.number().int().min(1).max(5).optional(), due: z.string().optional(), project: z.string().optional(),
        steps: z.array(z.object({ title: z.string(), tool: z.string().optional(), detail: z.string().optional(), needsApproval: z.boolean().optional(), est: z.number().int().optional(), link: z.string().optional(), dependsOn: z.array(z.string()).optional(), connection: z.string().optional(), workLevel: z.string().optional() })).optional(),
      }),
    }, async (a) => {
      const projectId = a.project ? await projectByName(a.project) : null;   // bez project: projekt z treści, gdy ją wymienia (repo.createTask)
      const t = await repo.createTask(ownerId, { title: a.title, summary: a.summary, source: a.source, level: a.level, due: a.due ?? null, projectId, steps: await Promise.all((a.steps ?? []).map(async (s) => ({ ...s, link: externalLink(s.link), estMin: s.est, connectionId: await connectionIdOf(s.connection) }))) });
      return json({ taskId: t.id, steps: t.steps.map((s) => ({ id: s.id, title: s.title })) });
    });

    server.registerTool("update_task", {
      title: "Zmień zadanie", description: "Zmienia tytuł, cel, priorytet, termin albo projekt zadania. Tytuł: 2–6 słów, samo sedno; pierwotny tytuł zostaje zapisany sam. project: dokładna nazwa istniejącego projektu z list_projects (null = bez projektu); nowy projekt tylko przez create_project.",
      inputSchema: z.object({ taskId: z.string(), title: z.string().optional(), summary: z.string().optional(), level: z.number().int().min(1).max(5).optional(), due: z.string().nullable().optional(), project: z.string().nullable().optional() }),
    }, async (a) => {
      const t = await repo.getTask(ownerId, a.taskId); if (!t) return text("Nie ma takiego zadania.");
      const projectId = a.project === undefined ? undefined : a.project ? await projectByName(a.project) : null;
      // agent poprawił tytuł: pierwotne brzmienie zostaje w zadaniu („Jak wpadło”), Piotr widzi, że to przeredagowane
      const renamed = !!a.title?.trim() && a.title.trim() !== t.title;
      await repo.updateTask(ownerId, a.taskId, { title: a.title, summary: a.summary, level: a.level, due: a.due, projectId, ...(renamed && !t.titleOriginal ? { titleOriginal: t.title } : {}) });
      return text("Zmieniono.");
    });

    server.registerTool("add_steps", {
      title: "Dodaj kroki", description: "Dodaje kroki do zadania. Pola jak w create_task; link tylko do elementu w zewnętrznej aplikacji (ticket, wydarzenie, mail), nigdy adres Task Hub. before: id kroku, przed którym nowe kroki mają wejść (np. krok publikacji, wysyłki, commitu): dostają jego miejsce, on zaczyna zależeć od nich, a jego szkic (gdy czekał na zgodę) staje się nieaktualny i krok wraca do zrobienia. dependsOn: tylko prawdziwe zależności, czyli kroki, których wyniku ten krok potrzebuje (ich numery w tej paczce n1, n2 albo id istniejących kroków); kroki niezależne od siebie nie czekają na siebie nawzajem, więc agent bierze je od razu. Przy before podaj dependsOn każdemu krokowi: pusta lista [] = krok niezależny; bez dependsOn krok dziedziczy pierwotne zależności kroku before (bez kroków dopisanych przed nim wcześniej). Bez before kroki idą na koniec. attachments: id załączników zadania (z get_task), których ten krok naprawdę potrzebuje; tylko te agent ogląda przy tym kroku i tylko te Piotr widzi na kartce kroku ([] = żadnych). Gdy zadanie ma załączniki, podaj attachments każdemu krokowi. Termin zadania ustaw osobno przez update_task(due). done: dla pracy, którą już zrobiłeś przy rozpisaniu (przeczytane aplikacje, zebrane dane, raport, analiza): 1–2 zdania wyniku; krok wchodzi od razu jako zrobiony przez Claude (tool = aplikacja, z której czytałeś, albo claude; nie manual, nie file, bez needsApproval), a pełny wynik połóż potem przez set_blocks tam, gdzie mówi zasada „Jak wygląda zadanie i jego kroki” (materiał do kroku Piotra na jego kartce). Elementy listy, o którą prosi Piotr (każdy ticket, wątek albo mail jako osobny krok), to jego otwarte kroki (tool manual, tytuł elementu, treść 1:1 na kartce), nie done. Nie twórz Piotrowi kroków „Przeczytaj …”: to, co ma wiedzieć do decyzji, leży na kartce kroku „Zdecyduj …”. cloudFrom: id wiadomości Piotra z rozmowy tego zadania (NOWE [id] w get_task), w której sam wprost zleca zmianę kodu albo prototypu Task Hub (np. „Wprowadź te zmiany do prototypu”); dodane kroki „Zleć w projekcie: …” ruszą wtedy w chmurze same, gdy skończą się kroki, na które czekają, bez kliknięcia „Uruchom w chmurze”. Bez cloudFrom, gdy dodajesz kroki z własnej inicjatywy; „Wdróż na produkcję” zawsze czeka na kliknięcie Piotra. Zgoda z decyzji: krok „Zleć w projekcie: …”, który tylko wykonuje opcję wybraną przez Piotra na kartce jego kroku decyzji (wiadomość „Decyzja w kroku …” z ostatniej doby), dodaj z dependsOn = ten krok decyzji: odpowiedź na kartce jest zgodą, więc krok ruszy w chmurze sam, bez cloudFrom i bez drugiego kliknięcia. Jego kartka nie powtarza treści decyzji: jedno zdanie, co robi i z którego kroku (numer i tytuł), a pełny opis dla chmury w detail. Krok spoza wybranej opcji (praca, o której decyzja nie mówiła) dodaj z needsClick: true; czeka wtedy na „Uruchom w chmurze”. " + WORK_LEVEL_DOC,
      inputSchema: z.object({ taskId: z.string(), steps: z.array(z.object({ title: z.string(), tool: z.string().optional(), detail: z.string().optional(), needsApproval: z.boolean().optional(), est: z.number().int().optional(), link: z.string().optional(), dependsOn: idList.optional(), connection: z.string().optional(), done: z.string().min(3).max(4000).optional(), workLevel: z.string().optional(), needsClick: z.boolean().optional(), attachments: idList.optional() })), before: z.string().optional(), cloudFrom: z.string().optional() }),
    }, async (a) => {
      const t = await repo.getTask(ownerId, a.taskId); if (!t) return text("Nie ma takiego zadania.");
      const bef = a.before ? t.steps.find((s) => s.id === a.before) ?? null : null;
      if (a.before && !bef) return text("Nie ma takiego kroku (before) w tym zadaniu.");
      // done tylko dla pracy Claude'a, która nic nie zmienia na zewnątrz: krok Piotra zostaje do zrobienia, plik zapisuje osobny krok, wysyłka czeka na zgodę
      for (const s of a.steps) {
        if (s.done === undefined) continue;
        const tool = normalizeTool(s.tool), q = `„${shortTitle(s.title, 60)}”`;
        if (tool === "manual") return text(`Nie dodałem kroków: krok ${q} ma done, a tool manual. Pole done jest tylko dla pracy, którą już zrobiłeś; kroki Piotra zostają do zrobienia.`);
        if (tool === "file") return text(`Nie dodałem kroków: krok ${q} ma done, a tool file. Plik zapisuje osobny krok, potem complete_step z file.`);
        if (s.needsApproval) return text(`Nie dodałem kroków: krok ${q} ma done i needsApproval. Krok, który zmienia coś na zewnątrz, kończy się dopiero po zgodzie Piotra i wysyłce: dodaj go bez done i przygotuj szkic przez set_blocks.`);
      }
      // zlecenie z rozmowy (paczka 19, punkt 2): tylko prawdziwa wiadomość Piotra w tym zadaniu z ostatniej doby; agent nie zleca chmury sam z siebie
      if (a.cloudFrom && !(await repo.ownerChatIn(ownerId, t.id, a.cloudFrom.trim()))) return text("Nie dodałem kroków: cloudFrom to nie wiadomość Piotra z rozmowy tego zadania z ostatniej doby. Podaj id jego wiadomości (NOWE [id] w get_task) albo dodaj kroki bez cloudFrom.");
      // grafiki kroku (paczka 27): tylko załączniki tego zadania; krok bez attachments zostaje nieprzypisany (agent widzi wszystkie)
      const att = await repo.listAttachments({ taskId: t.id });
      const attIds = new Set(att.map((x) => x.id));
      const badAtt = [...new Set(a.steps.flatMap((s) => s.attachments ?? []).filter((id) => !attIds.has(id)))];
      if (badAtt.length) return text(`Nie dodałem kroków: attachments to nie załączniki tego zadania: ${badAtt.join(", ")}. Id są w get_task (sekcja ZAŁĄCZNIKI ZADANIA).`);
      const fresh = t.steps.length === 0;
      const steps = await repo.addSteps(t.id, await Promise.all(a.steps.map(async ({ done: _d, needsClick: _c, attachments, ...s }) => ({ ...s, link: externalLink(s.link), estMin: s.est, connectionId: await connectionIdOf(s.connection), attachmentIds: attachments ? [...new Set(attachments)] : null }))), { before: bef?.id ?? null });
      // praca zrobiona przy rozpisaniu: kroki od razu zamknięte przez Claude, z czasem biegu od ostatniego znacznika podzielonym po równo
      const doneSteps = steps.filter((_, i) => a.steps[i]?.done !== undefined);
      const each = doneSteps.length ? Math.round((await agentSecFor(doneSteps[0])) / doneSteps.length) : 0;
      for (const [i, s] of steps.entries()) if (a.steps[i]?.done !== undefined) await finishStep(ownerId, t.id, s.id, { report: a.steps[i].done, by: "agent", addAgentSec: each });
      // przed krokiem ze szkicem (czekającym na zgodę albo już zatwierdzonym) weszła nowa praca: szkic jest nieaktualny, zgoda przepada,
      // krok wraca do zrobienia i dostanie nowy szkic po nowych krokach (same kroki już zrobione niczego nie zmieniają: szkic zostaje)
      const reset = !!bef && doneSteps.length < steps.length && bef.status !== "done" && !bef.sendStartedAt && (bef.status === "draft" || !!bef.approvedAt);
      if (bef && reset) { await repo.updateStep(bef.id, { status: "todo", prevStatus: null, handoffAt: null, blocks: (bef.blocks ?? []).map((b): Block => (b.type === "draft" ? { ...b, status: "proposed", stale: true } : b)) }); await mark(bef.id, "cofnął szkic do poprawy"); }
      // w rozmowie tylko fakt: ile kroków i gdzie; tytuły, gdy jest ich mało (szczegóły są na kafelkach)
      const n = steps.length, word = n === 1 ? "krok" : n < 5 ? "kroki" : "kroków";
      const q = (s: Step) => `„${shortTitle(s.title, 40)}”`;
      const list = n <= 4 ? ": " + steps.map(q).join(", ") : "";
      const didNow = doneSteps.length ? (n > 4 ? ` Od razu zrobiłem ${doneSteps.length}.` : ` Od razu zrobiłem: ${doneSteps.map(q).join(", ")}.`) : "";
      await repo.addChat(ownerId, t.id, "agent", `${fresh ? "Rozpisałem" : "Dodałem"} ${n} ${word}${bef ? ` przed „${shortTitle(bef.title, 40)}”` : ""}${list}.${didNow}`, { stepId: steps[0]?.id });
      // kroki z kodem Task Hub zlecone w rozmowie: od razu do chmury, gdy nie czekają na nic, inaczej ruszą same po swoich krokach
      // paczka 22: zgoda przechodzi z decyzji Piotra na kroki, które od niej zależą (odpowiedź na kartce kroku decyzji z ostatniej doby);
      // needsClick = krok spoza wybranej opcji, czeka na kliknięcie
      const armed: Step[] = [];
      const project = t.projectId ? (await repo.listProjects(ownerId)).find((p) => p.id === t.projectId)?.name ?? null : null;
      const decided = t.steps.filter((x) => x.status === "done" && x.doneBy === "owner" && stepKind(x) === "decision").map((x) => x.id);
      for (const [i, s] of steps.entries()) {
        if (a.steps[i]?.done !== undefined || a.steps[i]?.needsClick || !isProjectStep(s, project) || isDeployStep(s)) continue;
        const dec = await repo.decisionMsgIn(ownerId, t.id, s.dependsOn.filter((d) => decided.includes(d)));
        const msg = a.cloudFrom?.trim() || dec?.id;
        if (msg && (await repo.armCloud(ownerId, s.id, msg, dec?.stepId))) armed.push(s);
      }
      if (armed.length) await repo.startAutoCloud(t.id);
      await markRun();
      const out = json({ steps: steps.map((s, i) => ({ id: s.id, title: s.title, ...(a.steps[i]?.done !== undefined ? { done: true } : {}), ...(armed.includes(s) ? { cloud: true } : {}) })), ...(bef ? { before: { id: bef.id, title: bef.title, draftReset: reset } } : {}) });
      // paczka 21: bez start_step kafelek kroku nie wie, że agent już nad nim pracuje (pokazywał „Zaplanowane” i „Uruchom”)
      if (steps.some((s, i) => a.steps[i]?.done === undefined && !isOwnerStep(s)))
        out.content.push({ type: "text", text: "Gdy od razu bierzesz się za któryś z tych kroków (zbierasz fakty, piszesz szkic), najpierw wywołaj start_step z jego id, żeby Piotr widział na kafelku, że nad nim pracujesz." });
      // krok „Przeczytaj …” dla Piotra: łagodna uwaga, kroki zostają (Piotr może je zamknąć jednym „Przeczytane”)
      if (a.steps.some((s) => s.done === undefined && normalizeTool(s.tool) === "manual" && READ_RE.test(s.title.trim())))
        out.content.push({ type: "text", text: "Uwaga: nie twórz Piotrowi kroków „Przeczytaj …”: wynik zapisz jako swój krok zrobiony (done), a fakty potrzebne do decyzji połóż na kartce kroku „Zdecyduj …”." });
      const noAtt = att.length ? steps.filter((s, i) => a.steps[i]?.done === undefined && !a.steps[i]?.attachments) : [];
      if (noAtt.length)
        out.content.push({ type: "text", text: `Zadanie ma ${att.length} załączników, a kroki ${noAtt.map(q).join(", ")} nie mają attachments: przypisz im przez update_step tylko potrzebne (albo [] = żadnych), żeby przy tych krokach nie oglądać wszystkich.` });
      return out;
    });

    server.registerTool("update_step", {
      title: "Zmień krok", description: "Zmienia tytuł, opis, narzędzie, szacunek, link, połączenie albo poziom pracy kroku (tool = klucz jak w create_task; link = element w zewnętrznej aplikacji, np. utworzone wydarzenie albo ticket; connection = nazwa z list_connections, pusty napis zdejmuje; workLevel jak w add_steps, pusty napis = z narzędzia; dependsOn = pełna nowa lista id kroków tego zadania, na których wynik krok naprawdę czeka, zastępuje dotychczasowe strzałki, [] = krok niezależny; attachments = pełna nowa lista id załączników zadania potrzebnych w tym kroku, [] = żadnych).",
      inputSchema: z.object({ stepId: z.string(), title: z.string().optional(), detail: z.string().optional(), tool: z.string().optional(), est: z.number().int().optional(), link: z.string().optional(), connection: z.string().optional(), workLevel: z.string().optional(), dependsOn: idList.optional(), attachments: idList.optional() }),
    }, async (a) => {
      const taskId = await ownedStep(ownerId, a.stepId);
      if (!taskId) return text("Nie ma takiego kroku.");
      const deps = a.dependsOn === undefined ? undefined : [...new Set(a.dependsOn)];
      if (deps) {
        const t = await repo.getTask(ownerId, taskId);
        const steps = new Map((t?.steps ?? []).map((x) => [x.id, x.dependsOn]));
        const bad = deps.filter((d) => d === a.stepId || !steps.has(d));
        if (bad.length) return text(`Zależności tylko od innych kroków tego samego zadania; nie pasują: ${bad.join(", ")}.`);
        // pętla: któryś z nowych poprzedników (pośrednio) czeka na ten krok
        steps.set(a.stepId, deps);
        const seen = new Set<string>();
        const reaches = (from: string): boolean => (steps.get(from) ?? []).some((d) => d === a.stepId || (!seen.has(d) && (seen.add(d), reaches(d))));
        if (reaches(a.stepId)) return text("Zależności tworzyłyby pętlę: któryś z podanych kroków czeka (pośrednio) na ten krok. Nic nie zmieniono.");
      }
      const attachmentIds = a.attachments === undefined ? undefined : [...new Set(a.attachments)];
      if (attachmentIds?.length) {
        const ids = new Set((await repo.listAttachments({ taskId })).map((x) => x.id));
        const bad = attachmentIds.filter((id) => !ids.has(id));
        if (bad.length) return text(`To nie załączniki tego zadania: ${bad.join(", ")}. Id są w get_task (sekcja ZAŁĄCZNIKI ZADANIA). Nic nie zmieniono.`);
      }
      const connectionId = a.connection === undefined ? undefined : await connectionIdOf(a.connection);
      if (a.connection?.trim() && !connectionId) return text("Nie ma takiego połączenia (list_connections).");
      const was = await stepById(a.stepId);
      if (a.workLevel?.trim() && !normalizeLevel(a.workLevel)) return text("Nieznany poziom pracy: strategy, analysis, execution albo mechanics (Strategia, Analiza, Wykonanie, Mechanika).");
      await repo.updateStep(a.stepId, { title: a.title, detail: a.detail, tool: a.tool, estMin: a.est, link: a.link === undefined ? undefined : externalLink(a.link) ?? null, connectionId, workLevel: a.workLevel === undefined ? undefined : a.workLevel.trim() || null, attachmentIds });
      if (deps) await repo.setStepDependencies(a.stepId, deps);
      await mark(a.stepId, "zmienił krok");
      // zmiana narzędzia albo połączenia kroku z zatwierdzonym szkicem kasuje zgodę (inne konto, inna aplikacja niż te, które Piotr widział)
      if (was?.approvedAt && !(await stepById(a.stepId))?.approvedAt) return text("Zmieniono. Zgoda Piotra na szkic tego kroku wygasła (zmienione narzędzie albo połączenie): szkic wrócił do zatwierdzenia.");
      return text("Zmieniono.");
    });

    server.registerTool("set_blocks", {
      title: "Ułóż panel kroku", description: "Zapisuje kartkę kroku z klocków: najpierw kontekst (thread = wątek jako dymki, mail = wątek maili z from/to/subject, comment = jeden komentarz z miejscem, facts, table = wiersze, list, media = zrzuty i pliki z opisem, link, free = markdown gdy nic nie pasuje, text = krótka notatka), potem jeden draft (albo kilka jako opcje, p. niżej; to, co powstaje: target.app, target.where, target.url = adres miejsca, gdzie treść trafi lub co zmieni: ticket, wątek, kanał, dokument; Piotr otwiera go przyciskiem przed wysyłką, action, subject, body w Markdown: nagłówki #, **pogrubienie**, *kursywa*, listy - i 1., linki [tekst](url); Piotr widzi i edytuje je sformatowane, przy wysyłce get_task poda wersję w formacie aplikacji docelowej; dla wierszy arkusza columns + rows; dla promptu dla agenta target.app code). Każdy klocek kontekstu ma source {app, ref = miejsce, url}. Pokaż tylko to, co ważne dla tego kroku; długi wątek daj cały, aplikacja pokaże ostatnie 3. rememberFor: nazwa aplikacji źródłowej, jeśli ten układ ma być wzorem dla podobnych kroków. target.app = klucz aplikacji albo nazwa połączenia z list_connections. Jeden szkic = jedna rzecz w miejscu docelowym (jeden ticket: tytuł w subject, opis w body, typ, priorytet, osoba i status w fields); columns + rows tylko dla wierszy arkusza. Szkicu do miejsca, którego mostek nie wyśle (nieznana aplikacja, brak konektora tej aplikacji na Macu, plik na Macu), set_blocks nie zapisze. Klocek question = pytanie do Piotra na kartce jego kroku-decyzji (text, options 2-6 z label i opcjonalnym note, recommended = indeks zalecanej opcji); jego odpowiedź zamyka krok i wraca w rozmowie. Kartki zrobionego kroku Piotra z jego odpowiedzią set_blocks nie zmienia: zastosuj decyzję w krokach po nim. Porównanie elementów (dwa tickety, wątki albo maile obok siebie): każdy element to osobny klocek free, thread, mail albo comment z source.url, klocek question stoi przed nimi, różnica to jeden klocek text; pełny sposób w procedurze „Kartka porównania” (get_rules z topic kartka porównania). Treść ticketu albo dokumentu do odczytu to klocek free z source.url, title = tytuł elementu, meta = status, lista, osoba i daty w jednej linii, markdown = sama treść 1:1 bez tych metadanych. Warianty tej samej rzeczy do wysłania (opcja A, B) to kilka bloków draft w jednym kroku, każdy z title = nazwa opcji i własnym target.url; Piotr zatwierdza jedną, pozostałe nie lecą (get_task oznaczy je „nie wysyłaj”); wybór, który niczego nie wysyła, to klocek question, nie opcje.",
      inputSchema: z.object({ stepId: z.string(), blocks: Blocks, rememberFor: z.string().optional(), sameTargetOk: z.string().max(300).optional().describe("tylko gdy celowo drugi raz to samo miejsce i czynność (np. kolejny komentarz w tym samym tickecie): jednym zdaniem czemu") }),
    }, async (a) => {
      const taskId = await ownedStep(ownerId, a.stepId); if (!taskId) return text("Nie ma takiego kroku.");
      const was = await stepById(a.stepId); if (!was) return text("Nie ma takiego kroku.");
      // kilka bloków draft = opcje tej samej rzeczy: różnią się treścią (inaczej wybór byłby niejednoznaczny) i idą do tej samej aplikacji;
      // podpis po sanitizeBlocks, jak przy zapisie i zgodzie: adres spoza http(s) wypada, więc nie może odróżniać dwóch opcji
      // szkic z podtytułem tuż pod listą: pusta linia przed nim (paczka 15, punkt 15), zanim powstanie podpis zgody
      a.blocks = a.blocks.map((b) => (b.type === "draft" && b.body ? { ...b, body: unlazy(b.body) } : b));
      const clean = sanitizeBlocks(a.blocks);
      const drafts = draftsOf({ blocks: clean });
      if (new Set(drafts.map((d) => approvalSig({ id: a.stepId, blocks: clean }, d))).size < drafts.length) return text("Nie zapisałem: dwa bloki draft o tej samej treści to jeden szkic; opcje różnią się treścią (title = nazwa opcji).");
      if (new Set(drafts.map((d) => appKey(d.target.app))).size > 1) return text("Nie zapisałem: opcje w jednym kroku to warianty tej samej rzeczy (ten sam target.app). Wysyłkę do innego miejsca zapisz jako osobny krok (add_steps).");
      // zrobiony krok Piotra z jego odpowiedzią na kartce to jego decyzja (KARTKA ZROBIONEGO KROKU w get_task): agent jej nie nadpisze
      if (was.status === "done" && isOwnerStep(was) && was.blocks?.some((b) => b.type === "question" && !!b.answer))
        return text("Nie zapisałem: to zrobiony krok Piotra z jego decyzją na kartce, więc kartki nie zmieniam. Zastosuj decyzję w krokach, które od niego zależą; gdy coś jest niejasne, zapytaj przez reply_chat ze stepId tego kroku.");
      // paczka 22: szkic od agenta zawsze czeka na zgodę Piotra; stan „zatwierdzony” albo „wysłany” bez jego kliknięcia to błąd, nie cicha poprawka
      const forged = forgedDraftStatus(was, a.blocks);
      if (forged) return { content: [{ type: "text" as const, text: `Nie zapisałem: szkic od agenta zapisuje się tylko jako propozycja (status proposed). Stan „${forged === "approved" ? "zatwierdzony" : "wysłany"}” nadaje wyłącznie kliknięcie Piotra „Zatwierdź” i wysyłka po nim. Zapisz szkic ze statusem proposed albo bez statusu.` }], isError: true };
      // szkic od agenta sam nie jest zatwierdzony ani wysłany; ta sama treść co zapisany szkic zachowuje jego stan; odpowiedzi na pytania tylko od Piotra
      const blocks = keepOwnerAnswers(was.blocks, coerceAgentDrafts(was, a.blocks));
      // szkic tego kroku już poszedł (krok zrobiony albo przywrócony do zrobienia): wysłanego nie da się cofnąć, a propozycja obok niego nigdy nie
      // dostanie zgody (approveDraft odmawia, karta nie ma przycisku), więc odmowa jak w reopen_step; sam kontekst przy tym samym wysłanym szkicu się zapisuje
      // propozycja, która już leżała obok wysłanej (odrzucona opcja), nie jest nowa: jej podpis był na kartce, więc kartka z nią się zapisuje
      const known = new Set(draftsOf(was).filter((d) => d.status === "proposed").map((d) => approvalSig(was, d)));
      if (was.blocks?.some((b) => b.type === "draft" && b.status === "sent") && blocks.some((b) => b.type === "draft" && b.status === "proposed" && !known.has(approvalSig({ id: a.stepId, blocks }, b))))
        return text("Nie zapisałem: szkic tego kroku już poszedł i wysłanego nie da się cofnąć, więc drugi szkic obok niego nigdy nie dostanie zgody. Nową wysyłkę zapisz jako osobny krok (add_steps); kartkę tego kroku możesz uzupełnić tylko o klocki kontekstu.");
      // zatwierdzony szkic (czeka na wysyłkę albo właśnie się wysyła) zostaje taki, jaki Piotr zatwierdził
      const nd = draftOf({ blocks }), od = draftOf(was);
      if (was.status !== "done" && (was.approvedAt || was.sendStartedAt) && (!nd || nd.status !== od?.status))
        return text("Nie zapisałem: Piotr zatwierdził już szkic tego kroku i czeka on na wysyłkę, więc jego treść, adresat i miejsce zostają bez zmian (przy opcjach: wybrana opcja bez zmian, pozostałe możesz poprawić). Zapisz kartkę z tym samym blokiem draft (SZKIC KROKU w get_task) albo, gdy szkic jest nieaktualny, napisz to Piotrowi przez reply_chat ze stepId tego kroku; on zdecyduje.");
      const blocker = await agentBlocker(was, blocks, taskId);
      if (blocker) return text(blocker);
      // dwa kroki z tym samym szkicem (ten sam ticket i czynność) wysłałyby to samo dwa razy: zatrzymaj, zanim powstanie drugi;
      // przy opcjach każda z osobna (ma własny target.url), pierwsza kolizja wygrywa
      if (!a.sameTargetOk) {
        const all = (await repo.getTask(ownerId, taskId))?.steps ?? [];
        const rest = blocks.filter((b) => b.type !== "draft");
        const dup = draftsOf({ blocks }).map((d) => sameTarget(all, a.stepId, [d, ...rest])).find((x) => x.open.length || x.sent.length);
        const name = (x: Step) => `[${x.id}] „${x.title}”`;
        if (dup) return text(`Nie zapisałem: ${[
          dup.sent.length ? `to samo miejsce i ta sama czynność już wysłane w ${dup.sent.map(name).join(", ")}` : "",
          dup.open.length ? `inny otwarty krok ma szkic do tego samego miejsca: ${dup.open.map(name).join(", ")}` : "",
        ].filter(Boolean).join("; ")}. Popraw szkic w jednym kroku zamiast dublować, a zbędny krok zamknij przez skip_step z powodem. Jeśli to celowo drugi raz (np. kolejny komentarz), podaj sameTargetOk z powodem.`);
      }
      await repo.updateStep(a.stepId, { blocks });
      await mark(a.stepId, nd ? (od ? "poprawił szkic" : "napisał szkic") : was.blocks?.length ? "poprawił kartkę" : "ułożył kartkę");
      if (a.rememberFor) await repo.setLayoutMemory(ownerId, a.rememberFor, blocks);
      // szkic czekający na zgodę: krok przechodzi do zatwierdzenia, Piotr widzi to na kafelku i w rozmowie zadania
      const st = await stepById(a.stepId);
      const fresh = st ? draftOf(st) : null;
      if (st && st.status !== "done" && st.status !== "draft" && fresh?.status === "proposed" && !fresh.stale) {
        // szkic do aplikacji zewnętrznej zawsze czeka na zgodę i po niej leci przez mostek; agent może podnieść „wymaga zgody”, nigdy zdjąć
        const raise = !st.needsApproval && st.tool !== "manual" && isExternalApp(fresh.target.app);
        await repo.updateStep(st.id, { status: "draft", prevStatus: st.status === "handoff" ? st.prevStatus : st.status, handoffAt: null, ...(raise ? { needsApproval: true } : {}) });
        // przygotowanie szkicu to praca Claude'a: liczy się do czasu kroku, choć krok czeka jeszcze na zgodę
        await repo.addAgentTime(st.id, await agentSecFor(st));
        await repo.addChat(ownerId, taskId, "agent", `Szkic do zatwierdzenia: „${shortTitle(st.title, 70)}”.`, { stepId: st.id });
        await markRun();
        return text("Panel zapisany, krok czeka na zatwierdzenie Piotra. Nie wywołuj complete_step dla tego kroku, dopóki Piotr nie zatwierdzi i nie wyślesz treści.");
      }
      return text("Panel zapisany.");
    });

    server.registerTool("complete_step", {
      title: "Krok gotowy", description: "Zgłasza wynik kroku: summary = efekt kroku według zasad pisania do Piotra (Piotr czyta je w raporcie kroku; w rozmowie zobaczy tylko „Zrobione: tytuł kroku”), link do wyniku; spentMin tylko, gdy zamykasz krok Piotra (manual) z jego słów; czas Claude'a liczy się sam od start_step. Krok z kodem: changes = zmienione pliki (path, status, diff, note), repo, branch, preview = adres podglądu (http albo file://); trafiają na kartkę kroku jako blok zmian. Gdy to ostatni krok, zadanie się kończy i agent pisze notatkę końcową. Krok „Plik na Macu” (tool file): file = pełna ścieżka zapisanego pliku (np. ~/Documents/…/2026-10-20-us-podglad-rol.md), nie w link.",
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
      // (przy opcjach: odrzucona propozycja obok zatwierdzonej albo wysłanej nie blokuje zamknięcia; blokuje brak wyboru)
      if (cur && (cur.status === "draft" || draftOf(cur)?.status === "proposed"))
        return text("Nie zamknąłem kroku: jego szkic czeka na zatwierdzenie Piotra. Zostaw krok jako szkic; po zatwierdzeniu wyśle go mostek Task Hub. Jeśli krok stał się zbędny (to samo już wysłane, zakres się zmienił), zamknij go przez skip_step z powodem.");
      // zatwierdzony szkic zamyka jako wysłany tylko ten, kto go wysyła: stary mostek przy ważnej zgodzie albo bieg wysyłki tego kroku
      if (cur && draftOf(cur)?.status === "approved" && !sends(cur))
        return text(audience === "bridge-v1" ? "Nie zamknąłem kroku: zgoda Piotra na ten szkic nie jest już ważna albo szkic wysyła teraz inny bieg. Niczego nie wysyłaj." : "Nie zamknąłem kroku: jego zatwierdzony szkic wysyła mostek Task Hub w osobnym biegu wysyłki. Nie wysyłaj go sam i nie zamykaj tego kroku.");
      if (cur && cur.status !== "done" && needsDraft(cur))
        return text("Nie zamknąłem kroku: wymaga zgody Piotra, bo zmienia coś w aplikacji zewnętrznej. Przygotuj szkic przez set_blocks (blok draft, status proposed); po zatwierdzeniu wyśle go mostek Task Hub. Jeśli krok stał się zbędny, zamknij go przez skip_step z powodem.");
      // krok Piotra: jego czas (spentMin) i on jako wykonawca; krok Claude'a: czas liczony sam (spentMin tylko, gdy nie ma z czego liczyć)
      const own = !!cur && isOwnerStep(cur);
      const addAgentSec = cur && !own ? await agentSecFor(cur, { fallbackMin: a.spentMin }) : 0;
      const r = await finishStep(ownerId, taskId, a.stepId, { report: a.summary, link: externalLink(a.link), by: own ? "owner" : "agent", addSpentSec: own && a.spentMin ? a.spentMin * 60 : 0, addAgentSec });
      const st = r.task.steps.find((x) => x.id === a.stepId);
      if (st && a.file) await repo.updateStep(st.id, { filePath: a.file });
      // zmiany w kodzie na kartce kroku: jeden blok changes (zastępuje poprzedni), reszta klocków zostaje
      if (st && (a.changes?.length || a.preview)) {
        const d0 = draftOf(st), old = (st.blocks ?? []).find((b) => b.type === "changes");
        // wysłany commit: pliki na kartce zostają te zatwierdzone (są w podpisie); dochodzi tylko podgląd i opis, inaczej szkic wróciłby do „niewysłany”
        if (d0?.status === "sent" && old && isGitDraft(d0, st.blocks)) await repo.updateStep(st.id, { blocks: (st.blocks ?? []).map((b): Block => (b === old ? { ...old, preview: a.preview ?? old.preview, summary: a.summary.slice(0, 2000) } : b)) });
        else {
          // krok bez zapisanej kartki (w czasie pracy składana z opisu, faktów i załączników): ten układ zostaje jako zlecenie pod wynikiem (paczka 19)
          const was = st.blocks?.length ? st.blocks : composeStatic({ ...st, output: "" }, await repo.listFacts({ stepId: st.id }), await repo.listAttachments({ taskId }));
          const rest = was.filter((b) => b.type !== "changes").slice(0, 11);
          await repo.updateStep(st.id, { blocks: [...rest, { type: "changes", repo: a.repo, branch: a.branch, preview: a.preview, summary: a.summary.slice(0, 2000), files: a.changes ?? [] }] });
        }
      }
      // w rozmowie tylko fakt; opis, pliki i adresy są na kartce kroku („Otwórz krok”)
      // paczka 15, punkt 1: gdy ten krok odblokował krok Piotra, dymek mówi to wprost i „Otwórz krok” prowadzi do jego kroku
      const byId = new Map(r.task.steps.map((x) => [x.id, x]));
      const mine = st && !r.closed ? r.task.steps.find((x) => x.status === "todo" && isOwnerStep(x) && x.dependsOn.includes(st.id) && x.dependsOn.every((d) => byId.get(d)?.status === "done")) : undefined;
      const said = st ? doneChat({ ...st, filePath: a.file ?? st.filePath }, r.closed) : `Zrobione.${r.closed ? " Zadanie ukończone." : ""}`;
      await repo.addChat(ownerId, taskId, "agent", mine ? `${said} Kolejny krok wymaga Twojego udziału.` : said, mine ? { stepId: mine.id, steps: [a.stepId], link: externalLink(a.link) ?? undefined } : { stepId: a.stepId, link: externalLink(a.link) ?? undefined });
      // po wysyłce: inne otwarte kroki ze szkicem do tego samego miejsca są pewnie zbędne; agent sprawdza je teraz, a nie zostawia Piotrowi do zatwierdzenia
      const twins = st ? sameTarget(r.task.steps, st.id, st.blocks).open : [];
      const hint = twins.length ? ` Inne otwarte kroki ze szkicem do tego samego miejsca: ${twins.map((x) => `[${x.id}] „${x.title}”`).join(", ")}. Sprawdź, czy po tej wysyłce nie są zbędne; zbędne zamknij przez skip_step z powodem.` : "";
      await mark(a.stepId, "zrobił krok");
      await markRun();
      return text((r.closed ? "Krok zapisany, zadanie ukończone." : "Krok zapisany.") + hint);
    });

    server.registerTool("start_step", {
      title: "Zaczynam krok", description: "Oznacza krok jako w toku i zaczyna liczyć czas Claude'a na nim (do complete_step albo leave_step): Piotr widzi na kafelku, że Claude nad nim pracuje. Wywołaj tuż przed robieniem kroku. Po zrobieniu zgłoś complete_step; gdy nie da się go zrobić (brak narzędzia, brak dostępu), oddaj go przez leave_step z powodem.",
      inputSchema: z.object({ stepId: z.string() }),
    }, async (a) => {
      const taskId = await ownedStep(ownerId, a.stepId); if (!taskId) return text("Nie ma takiego kroku.");
      const st = (await repo.getTask(ownerId, taskId))?.steps.find((x) => x.id === a.stepId); if (!st) return text("Nie ma takiego kroku.");
      if (st.status === "done") return text("Ten krok jest już zrobiony.");
      if (st.tool === "file" && audience !== "work") return text("Nie zacząłem: krok „Plik na Macu” robi tylko aplikacja Task Hub 0.1.7 na Macu. Zostaw go.");
      // szkic czeka na decyzję Piotra: start_step nie może go przepchnąć dalej (stan „w toku” po szkicu wyglądał kiedyś jak zgoda)
      if (st.status === "draft") return text("Nie zacząłem: szkic tego kroku czeka na zatwierdzenie Piotra. Niczego nie wysyłaj; poprawki szkicu zapisuj przez set_blocks, a po zatwierdzeniu wyśle go mostek Task Hub.");
      if (st.approvedAt || st.sendStartedAt || draftOf(st)?.status === "approved") {
        if (!sends(st)) return text("Nie zacząłem: zatwierdzony szkic tego kroku wysyła mostek Task Hub w osobnym biegu wysyłki. Niczego tu nie wysyłaj.");
        // zatwierdzony prompt wykonuje bieg pracy: od teraz liczy się czas Claude'a
        if (!st.agentStartedAt) await repo.markAgentStart(st.id);
        await mark(st.id, "zaczął krok");
        await markRun();
        return text("Krok w toku.");
      }
      if (needsDraft(st)) return text("Nie zacząłem: krok wymaga zgody Piotra, bo zmienia coś w aplikacji zewnętrznej. Przeczytaj, co trzeba, i przygotuj szkic przez set_blocks (blok draft, status proposed); niczego nie wysyłaj, po zatwierdzeniu wyśle go mostek Task Hub.");
      if (st.status !== "handoff") await repo.updateStep(st.id, { status: "handoff", prevStatus: st.status, handoffAt: new Date().toISOString() });
      if (st.status !== "handoff" || !st.agentStartedAt) await repo.markAgentStart(st.id);
      await mark(st.id, "zaczął krok");
      await markRun();
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
      const r = await finishStep(ownerId, taskId, st.id, { report: `Zbędny: ${a.reason}`, by: "agent", addAgentSec: elapsedSec(st.agentStartedAt) });
      await repo.addChat(ownerId, taskId, "agent", `Zamknąłem jako zbędny: „${shortTitle(st.title, 60)}”. ${a.reason}`, { stepId: st.id });
      await mark(st.id, "zamknął jako zbędny");
      await markRun();
      return text(r.closed ? "Krok zamknięty jako zbędny, zadanie ukończone." : "Krok zamknięty jako zbędny.");
    });

    server.registerTool("reopen_step", {
      title: "Otwieram krok ponownie", description: "Przywraca zrobiony albo zamknięty krok do zrobienia (to samo, co „Przywróć do zrobienia” w Task Hub), np. gdy krok wszedł jako zrobiony odczyt, a miał być krokiem Piotra. tool, title, est: od razu nowe narzędzie (manual = krok Piotra), tytuł i szacunek. Nie dla kroku, którego szkic już został wysłany: wtedy add_steps.",
      inputSchema: z.object({ stepId: z.string(), tool: z.string().optional(), title: z.string().optional(), est: z.number().int().optional() }),
    }, async (a) => {
      const taskId = await ownedStep(ownerId, a.stepId); if (!taskId) return text("Nie ma takiego kroku.");
      const st = (await repo.getTask(ownerId, taskId))?.steps.find((x) => x.id === a.stepId); if (!st) return text("Nie ma takiego kroku.");
      if (st.status !== "done") return text("Ten krok nie jest zrobiony.");
      if (st.sendStartedAt || draftOf(st)?.status === "sent") return text("Nie otworzyłem: szkic tego kroku już poszedł i wysłanego nie da się cofnąć. Dodaj nowy krok przez add_steps.");
      await repo.reopenStep(ownerId, taskId, st);
      if (a.tool !== undefined || a.title?.trim() || a.est !== undefined) {
        await repo.updateStep(st.id, { ...(a.tool !== undefined ? { tool: a.tool } : {}), ...(a.title?.trim() ? { title: a.title.trim() } : {}), ...(a.est !== undefined ? { estMin: a.est } : {}) });
      }
      await mark(st.id, "otworzył krok ponownie");
      await markRun();
      return text("Krok wrócił do zrobienia.");
    });

    server.registerTool("leave_step", {
      title: "Oddaję krok", description: "Gdy kroku nie da się zrobić (brak narzędzia, dostępu albo danych): krok wraca do zrobienia, a Piotr widzi powód w zadaniu. Gdy krok tylko czeka (na inny krok, bieg albo projekt w chmurze), zacznij powód od „czeka na …” i podaj waitFor = id kroku, na który czeka: wtedy poziom kroku nie rośnie, a krok wraca na listę dopiero, gdy tamten jest zrobiony. Nie używaj do pytań, od tego jest ask_question, ani do kroków zbędnych, od tego jest skip_step. Gdy brakuje folderu na Macu (kod, pliki, narzędzia), podaj needFolder = rodzaj z Ustawień aplikacji (code: Foldery z kodem, files: Foldery na pliki, tools: Foldery z narzędziami) i pełną ścieżkę folderu (z zasad projektu): karta kroku dostanie przycisk „Dodaj folder”. Gdy krok blokuje coś, czego mocniejszy model nie zmieni (brak dostępu, narzędzia albo danych, które musi dać Piotr), podaj blocked: true. Taki krok (i z needFolder) nie wraca do agentów, dopóki Piotr czegoś nie zmieni (wiadomość, odpowiedź na pytanie, foldery w aplikacji na Macu); inny oddany krok spróbuje jeszcze mocniejszy model.",
      inputSchema: z.object({ stepId: z.string(), reason: z.string().max(600), waitFor: z.string().optional(), needFolder: z.object({ kind: z.enum(["code", "files", "tools"]), path: z.string().min(2).max(400) }).optional(), blocked: z.boolean().optional() }),
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
      // czas od start_step liczy się mimo oddania (Claude próbował); bez start_step nic, bo oddany krok mógł nie być nawet zaczęty
      await repo.addAgentTime(st.id, await agentSecFor(st, { runClock: false }));
      // na jaki krok czeka (paczka 14, punkt 1): waitFor albo krok wskazany w powodzie czekania; każde oddanie zapisuje to od nowa
      const all = (await repo.listTasks(ownerId)).flatMap((t) => t.steps.map((x) => ({ id: x.id, taskId: t.id, title: x.title })));
      const waitFor = a.waitFor && a.waitFor !== st.id && all.some((x) => x.id === a.waitFor) ? a.waitFor : waitTarget(a.reason, { id: st.id, taskId, title: st.title }, all);
      // dymek krótko: stan i czego trzeba od Piotra (paczka 15, punkt 1); pełny powód zostaje w historii rozmowy i w kontekście agenta (why)
      await repo.addChat(ownerId, taskId, "agent", leaveChat(st.title, a.reason, !!waitFor), { stepId: st.id, why: a.reason });
      await repo.setWaitFor(st.id, waitFor);
      // oddany w biegu mostka: następna próba idzie poziom wyżej (zasada „Dobór modelu i wysiłku”); wysyłka nie ma poziomu.
      // Oddanie z czekania („czeka na …”, „do zrobienia w projekcie w chmurze”, wskazany krok) to nie nieudana próba: poziom zostaje
      const waits = !!waitFor || WAIT_RE.test(a.reason);
      // brakujący folder (paczka 22): przycisk „Dodaj folder” na karcie; tylko ścieżka bezwzględna albo od ~/
      const path = a.needFolder?.path.trim() ?? "";
      const folder = a.needFolder && /^(\/|~\/)/.test(path) && !/[\n\r]/.test(path) ? { kind: "folder" as const, folder: a.needFolder.kind, path } : null;
      // czeka na Piotra: folder, blokada, której mocniejszy model nie zmieni, albo oddany już na najwyższym poziomie (paczka 22: bez prób co kilka minut)
      const need = folder ?? (a.blocked || (st.escalation ?? 0) >= MAX_ESCALATION ? { kind: "piotr" as const } : null);
      if ((scope?.kind === "work" || kind === "bridge") && !waits && !need) await repo.bumpEscalation(st.id);
      // kafelek „Potrzebna pomoc” (paczka 18): tylko prawdziwe oddanie; czekanie to „Zaplanowane”
      if (!waits) await repo.markLeft(st.id, need);
      await mark(st.id, "oddał krok");
      await markRun();
      return text("Krok oddany.");
    });

    server.registerTool("add_facts", {
      title: "Dopisz fakty", description: "Zapisuje istotne informacje do kroku z pochodzeniem (np. z ClickUp: lista, sprint, estymata).",
      inputSchema: z.object({ stepId: z.string(), facts: z.array(Fact).max(12), replace: z.boolean().optional() }),
    }, async (a) => {
      if (!(await ownedStep(ownerId, a.stepId))) return text("Nie ma takiego kroku.");
      const old = a.replace ? [] : await repo.listFacts({ stepId: a.stepId });
      await repo.replaceFacts({ stepId: a.stepId }, [...old, ...a.facts]);
      await mark(a.stepId, "dopisał fakty");
      return text("Zapisano fakty.");
    });

    server.registerTool("add_snapshot", {
      title: "Zapisz migawkę", description: "Zapisuje surowe dane z zewnętrznej aplikacji (np. cały ticket z ClickUp) przy kroku; agent w Task Hub wybierze z nich istotne pola.",
      inputSchema: z.object({ stepId: z.string(), app: z.string(), raw: z.unknown(), url: z.string().optional(), sourceId: z.string().optional() }),
    }, async (a) => {
      if (!(await ownedStep(ownerId, a.stepId))) return text("Nie ma takiego kroku.");
      await repo.addSnapshot({ stepId: a.stepId }, a.app, a.raw, { url: a.url, sourceId: a.sourceId });
      await mark(a.stepId, "zapisał migawkę");
      return text("Zapisano migawkę.");
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
      // bieg pracy z doborem modelu widzi tylko swoją grupę pracy (model i wysiłek)
      const focus = scope?.kind === "work" && scope.runId ? (await repo.getBridgeRun(ownerId, scope.runId))?.focus ?? null : null;
      return text((await workSummary(ownerId, { audience, stepId: scope?.stepId ?? undefined, peek: audience === "send", focus })).text);
    });

    // „Uruchom w chmurze” (paczka 13, punkt 3): kroki, które Piotr kliknął w Task Hub, robi wątek projektu Claude w chmurze (zaplanowane zadanie
    // „Task Hub: kod w chmurze”). Tylko konektor (klient); bieg mostka na Macu tych kroków nie widzi ani nie bierze, bo nie zmienia kodu Task Hub
    server.registerTool("cloud_work", {
      title: "Kroki do zrobienia w chmurze", description: "Kroki, które Piotr kliknął „Uruchom w chmurze” w Task Hub (zmiany w kodzie Task Hub, wdrożenie paczki). Dla każdego: take_cloud_step(stepId), zrób polecenie, complete_step z wynikiem albo leave_step z powodem. Pusta lista = nic do zrobienia.",
      inputSchema: z.object({}),
    }, async () => {
      if (audience !== "client") return text("Kroki do chmury robi tylko wątek projektu Claude w chmurze (konektor Task Hub), nie bieg mostka.");
      const items = await repo.listCloud(ownerId);
      if (!items.length) return text("Nic nie czeka na chmurę.");
      return text(items.map((it, i) => `${i + 1}. [${it.step.id}] „${it.step.title}” (zadanie „${it.taskTitle}” [${it.taskId}], zlecone ${it.step.cloud?.at ?? ""})\nPolecenie:\n${projectPrompt({ id: it.taskId, title: it.taskTitle, steps: it.steps }, it.step, appUrl())}`).join("\n\n"));
    });

    server.registerTool("take_cloud_step", {
      title: "Biorę krok do chmury", description: "Bierze krok z cloud_work na wyłączność (najwyżej jedna sesja): krok przechodzi w toku, kafelek pokazuje pracę. Potem zrób polecenie i zamknij krok przez complete_step (albo leave_step z powodem).",
      inputSchema: z.object({ stepId: z.string() }),
    }, async (a) => {
      if (audience !== "client") return text("Kroki do chmury robi tylko wątek projektu Claude w chmurze, nie bieg mostka.");
      const taskId = await ownedStep(ownerId, a.stepId); if (!taskId) return text("Nie ma takiego kroku.");
      if (!(await repo.takeCloudStep(ownerId, a.stepId))) return text("Nie wziąłem: ten krok nie czeka na chmurę (wzięła go już inna sesja, Piotr go wycofał albo nie kliknął „Uruchom w chmurze”). Pomiń go.");
      await repo.addChat(ownerId, taskId, "agent", `Claude w chmurze wziął krok „${shortTitle((await stepById(a.stepId))?.title ?? "", 70)}”.`, { stepId: a.stepId });
      await mark(a.stepId, "wziął krok do chmury");
      return text("Krok w toku. Zrób polecenie z cloud_work i zamknij krok przez complete_step.");
    });

    server.registerTool("ask_question", {
      title: "Zapytaj Piotra w aplikacji", description: "Zadaje Piotrowi pytanie w Task Hub (nie w czacie): tekst, opcjonalne opcje z zaleceniem. Pytaj tylko, gdy bez odpowiedzi nie da się sensownie kontynuować; odpowiedź przyjdzie w list_work i get_task. Zadanie z otwartym pytaniem czeka. Nie dla wyboru, który należy do Piotra w jego kroku „Wybierz …” / „Zdecyduj …”: tam klocek question na kartce przez set_blocks.",
      inputSchema: z.object({ taskId: z.string(), stepId: z.string().optional(), text: z.string().max(2000), options: z.array(z.object({ label: z.string().max(80), note: z.string().max(200).optional() })).max(6).optional(), recommended: z.number().int().min(0).optional() }),
    }, async (a) => {
      const t = await repo.getTask(ownerId, a.taskId); if (!t) return text("Nie ma takiego zadania.");
      const q = await repo.askQuestion(ownerId, { taskId: a.taskId, stepId: a.stepId ?? null, text: a.text, options: a.options, recommended: a.recommended ?? null });
      return json({ questionId: q.id });
    });

    server.registerTool("reply_chat", {
      title: "Odpowiedz w rozmowie zadania", description: "Odpowiada Piotrowi w rozmowie zadania (pokazuje się jako dymek; długość i język według zasad z get_rules; bez raportu z postępu, szczegóły na kartce kroku). messageIds: id wiadomości Piotra, które ta odpowiedź załatwia (z get_task, przy NOWE); bez nich załatwia wszystkie dotychczasowe w zadaniu. Odpowiadaj osobno po każdej załatwionej prośbie, żeby Piotr widział, co już jest zrobione. stepId: krok, którego odpowiedź dotyczy (karta w rozmowie dostanie „Otwórz krok”); link: adres wyniku w zewnętrznej aplikacji. Gdy wszystkie kroki są zrobione i nic już nie czeka na odpowiedź, zadanie kończy się samo. Kroki, których dotknąłeś w tym biegu w tym zadaniu, dostaną w dymku przyciski „Otwórz krok” same; stepId wskazuje główny.",
      inputSchema: z.object({ taskId: z.string(), text: z.string().min(1).max(1200), messageIds: z.array(z.string()).max(50).optional(), stepId: z.string().optional(), link: z.string().optional() }),
    }, async (a) => {
      const t = await repo.getTask(ownerId, a.taskId); if (!t) return text("Nie ma takiego zadania.");
      const stepId = a.stepId && t.steps.some((s) => s.id === a.stepId) ? a.stepId : undefined;
      const answers = await repo.markChatAnswered(ownerId, t.id, a.messageIds);
      // inne kroki tego zadania, których bieg dotknął: dymek dostaje do nich małe przyciski (najwyżej dwa, w kolejności kroków)
      const runId = await runIdOf();
      const touched = runId ? await repo.runSteps(ownerId, runId) : {};
      const steps = t.steps.filter((s) => s.id !== stepId && touched[s.id]).map((s) => s.id).slice(0, 2);
      await repo.addChat(ownerId, t.id, "agent", a.text.trim(), { stepId, link: externalLink(a.link) ?? undefined, answers, ...(steps.length ? { steps } : {}) });
      // ostatni krok gotowy czekał tylko na tę odpowiedź: zadanie kończy się teraz
      const closed = await repo.closeIfDone(ownerId, t.id);
      if (closed) await repo.addChat(ownerId, t.id, "agent", "Wszystkie kroki zrobione, zadanie ukończone.");
      const left = (await repo.listPendingChat(ownerId, t.id)).length;
      await markRun();
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

    // paczka 22: prototyp HTML z biegu na Macu (albo z chmury) dostaje adres w Task Hub zamiast artefaktu Claude; strona otwiera się
    // tylko po zalogowaniu i w piaskownicy (/api/preview/<id>), a link kroku daje przycisk „Otwórz prototyp” na kartce decyzji po nim
    server.registerTool("add_preview", {
      title: "Podgląd prototypu", description: "Zapisuje jeden samowystarczalny plik HTML (prototyp, makieta) przy kroku i zwraca jego adres w Task Hub (otwiera go tylko zalogowany Piotr). Użyj zamiast publikacji artefaktu, gdy nie masz narzędzia Artifact: najpierw zapisz plik tam, gdzie każą zasady projektu, potem przekaż tu jego pełną treść. Adres trafia do linku kroku, a krok decyzji po prototypie dostaje przycisk „Otwórz prototyp”. Strona działa bez sieci: style, skrypty, grafiki i dane wbudowane w plik (grafiki jako data: albo SVG). Kolejna wersja tego samego prototypu = ponowne wywołanie z tym samym krokiem.",
      inputSchema: z.object({ stepId: z.string(), title: z.string().min(1).max(120), html: z.string().min(20).max(PREVIEW_MAX) }),
    }, async (a) => {
      const taskId = await ownedStep(ownerId, a.stepId); if (!taskId) return text("Nie ma takiego kroku.");
      const st = await stepById(a.stepId); if (!st) return text("Nie ma takiego kroku.");
      if (!/<(html|body|div|main|section|svg)[\s>]/i.test(a.html)) return text("To nie wygląda na stronę HTML. Przekaż pełną treść pliku .html.");
      const name = a.title.trim().replace(/[\\/:*?"<>|\n\r]+/g, " ").slice(0, 100) + ".html";
      const id = randomUUID();   // adres podglądu w załącznikach zadania (otwiera, a nie pobiera)
      const att = await repo.addAttachment({ stepId: st.id, taskId }, { id, url: `/api/preview/${id}`, kind: "file", name, mime: "text/html", keep: true, caption: a.title.trim().slice(0, 120), data: Buffer.from(a.html, "utf8") });
      const url = `${appUrl()}/api/preview/${att.id}`;
      // link kroku: pusty albo wcześniejszy podgląd → nowy podgląd; inny link (ticket, repozytorium) zostaje, adres jest wtedy w odpowiedzi i w załącznikach
      if (!st.link || /\/api\/preview\/[0-9a-f-]{36}$/i.test(st.link)) await repo.updateStep(st.id, { link: url });
      await mark(st.id, "dodał podgląd prototypu");
      return text(`Podgląd zapisany: ${url}\nNa kartce kroku podaj ten adres (np. w bloku changes jako preview albo w podsumowaniu). Piotr otwiera go po zalogowaniu.`);
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
