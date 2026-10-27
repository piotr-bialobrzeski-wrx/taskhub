// Co czeka na agenta: jedna funkcja dla list_work (tekst dla Claude) i dla mostka na komputerze (same liczby, bez skutków ubocznych).
import * as repo from "@/lib/repo";
import { isAppCodeStep, type Step } from "@/lib/schema";
import { brief, scoreAll } from "./context";
import { approvalValid, draftOf, isPromptDraft, isSendable, type Draft } from "./approval";
import { choiceOf, modelConfig, runLabel, stepChoice, type Choice } from "./models";
// list_work pokazuje początek wiadomości; całość (do 50 tys. znaków) jest w get_task
const preview = (x: string, n = 600) => (x.length > n ? x.slice(0, n) + "… (całość w get_task)" : x);

export type WorkCounts = { chat: number; going: number; approved: number; noSteps: number; answered: number; ready: number; approval: number; titles: number };
export const TITLE_RULE = "tytuł zadania: 2–6 słów, samo sedno w słowach Piotra (np. „Zmiany w kroku Employees w onboardingu”), bez „Zmieniłem/Proszę/Chciałbym”, bez zdań i kropek";
export const STEP_TITLE_RULE = "title kroku: od czasownika, 2–6 słów, sedno (np. „Zaktualizuj story Employees”), bez identyfikatorów i nazw plików (te idą do detail); krok, który coś publikuje, ma w tytule miejsce (np. „Utwórz story podglądu ról w ClickUpie”)";
// praca zrobiona przy rozpisaniu wchodzi jako krok Claude'a od razu zrobiony (add_steps.done); Piotr nie dostaje kroków „Przeczytaj …”: to, co ma wiedzieć, leży na kartce decyzji
export const DONE_RULE = "Pracę, którą już zrobiłeś przy rozpisaniu (przeczytane aplikacje, zebrane dane, raport, analiza), dodaj jako swój krok od razu zrobiony: w add_steps pole done = 1–2 zdania wyniku (tool = aplikacja, z której czytałeś, albo claude; bez needsApproval), a pełny wynik połóż przez set_blocks tam, gdzie mówi zasada „Jak wygląda zadanie i jego kroki” (materiał do kroku Piotra na jego kartce). Nie twórz Piotrowi kroków „Przeczytaj …” ani „Przejrzyj …”: to, co ma wiedzieć do decyzji, jest na kartce kroku „Zdecyduj …”.";
// szacunek tylko dla kroków Piotra: czas Claude'a liczy się sam od start_step
export const EST_RULE = "est w minutach jako wielokrotność 5 tylko dla kroków Piotra (tool manual; czas kroków Claude'a mierzy się sam)";
// odpowiedź Piotra na kartce jego kroku-decyzji zamyka ten krok sama; agent stosuje decyzję w krokach, które od niego zależą
export const DECISION_MSG = "Wyjątek: wiadomość „Decyzja w kroku …” albo „Zmieniam decyzję w kroku …” to odpowiedź Piotra na kartce jego kroku, który już się przez nią zamknął: jego kartki nie poprawiaj; zastosuj decyzję w krokach, które od niego zależą (kartki i szkice przez set_blocks, nowe kroki przez add_steps, zbędne przez skip_step; przy zmianie decyzji popraw to, co przygotowałeś po poprzedniej odpowiedzi) i odpowiedz reply_chat z messageIds tej wiadomości jednym zdaniem, co zmieniłeś.";
// dokąd ma trafić wynik: jedna rzecz w miejscu docelowym na krok, a gdy miejsce nie wynika z treści i profilu, jedno pytanie na całe zadanie
export const DEST_RULE = "Krok, którego wynik ma trafić do aplikacji (ticket, wiadomość, mail, wydarzenie), ma tool = ta aplikacja (clickup, slack, gmail, calendar…), needsApproval true i miejsce w tytule (np. „Utwórz story podglądu ról w ClickUpie”); szykuje od razu gotową rzecz w miejscu docelowym: jeden ticket, jedna wiadomość albo jedno wydarzenie na krok (kilka story = kilka kroków; warianty tej samej rzeczy (opcja A i B) to kilka bloków draft w jednym kroku, każdy z title), bez osobnego kroku „Przygotuj” z tą samą treścią. Gdy z treści, profilu projektu i zasad nie wynika, dokąd ma trafić wynik, zanim dodasz kroki, zadaj jedno ask_question z opcjami (np. „ClickUp (PirxeyOS / Full Backlog)”, „Tylko w Task Hub”) i w tym samym pytaniu zapytaj o wspólne pola (osoba, priorytet, status), raz na całe zadanie.";
// projekt z treści: zadanie bez projektu, którego treść wskazuje projekt z listy, dostaje go przy rozpisaniu; agent nie zakłada nowych projektów
export const PROJECT_RULE = "Projekt: zadanie „bez projektu”, którego treść wskazuje projekt z list_projects (nazwa, także odmieniona, np. „z projektu Shiftwow”, „w Task Hubie”, albo nazwa firmy projektu), dostaje go przy rozpisaniu przez update_task(project = dokładna nazwa z listy); nie twórz nowych projektów i nie zgaduj, gdy treść żadnego nie wskazuje (zostaw bez projektu).";
// lista elementów, o którą prosi Piotr (tickety, wątki, maile jako kroki), to jego otwarte kroki z treścią na kartce, nie zrobione odczyty Claude'a
export const DECISION_RULE = "Decyzja Piotra: krok Piotra, w którym ma coś wybrać, zdecydować albo zatwierdzić wariant (Wybierz…, Zdecyduj…, Ustal…), ma na kartce przez set_blocks to, z czego wybiera (table, free), i klocek question z opcjami (options z label i note, recommended = indeks zalecanej); jego odpowiedź zamyka krok, wraca do Ciebie w rozmowie, a kartka zrobionego kroku zostaje w get_task (KARTKA ZROBIONEGO KROKU). Bez pytania na kartce Piotr musi wpisać wybór ręcznie przy „Zrobione” (pole „Co wybrałeś?”): trafia tylko do pola wynik, bez opcji i tabeli, więc zawsze daj pytanie na kartce.";
export const ITEMS_RULE = "Lista elementów: gdy Piotr prosi o elementy jako kroki (tickety, wątki, maile, dokumenty: „każdy X jako osobny krok”, „pokaż ich treść w krokach”), każdy element to jego otwarty krok (tool manual, est 5), title = tytuł elementu w jego języku (bez przerabiania na czasownik), a na kartce przez set_blocks klocek free z treścią elementu 1:1 (Markdown) i klocek link do źródła; takich kroków nie oznaczaj jako zrobione. Jako zrobiony odczyt (add_steps.done) wchodzi tylko praca przygotowawcza (wybór, filtr, analiza), jednym krokiem.";
export const isLongTitle = (t: string) => t.trim().split(/\s+/).length > 6 || /[.!?]\s+\S/.test(t.trim());
// choices: grupy pracy (model i wysiłek) w kolejności listy, bez powtórzeń; puste, gdy w ustawieniach nie ma doboru modeli
// sig: grupy wszystkich pozycji po kolei (krok oddany i podniesiony poziom zmienia sig, choć tekst listy jest ten sam)
// oddanie kroku, który tylko czeka (na inny krok, bieg albo wątek w chmurze), to nie nieudana próba: nie podnosi poziomu (paczka 14, punkt 1)
export const WAIT_RE = /^[\s„"'(]*(czeka(m|my|ją)?(?=[\s,:;.]|$)|do zrobienia w projekcie w chmurze)/i;
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
type StepRef = { id: string; taskId: string; title: string };
// na jaki krok czeka oddany krok: id kroku w powodzie, a bez niego tytuł w cudzysłowie („…” albo "…"), który pasuje do jednego kroku
// (najpierw w tym samym zadaniu); siebie samego nie liczy. Szuka tylko w powodzie czekania (WAIT_RE)
export function waitTarget(reason: string, self: StepRef, steps: StepRef[]): string | null {
  if (!WAIT_RE.test(reason)) return null;
  const others = steps.filter((x) => x.id !== self.id);
  for (const m of reason.match(UUID_RE) ?? []) { const hit = others.find((x) => x.id === m.toLowerCase()); if (hit) return hit.id; }
  const norm = (x: string) => x.trim().replace(/\s+/g, " ").toLowerCase();
  for (const m of reason.matchAll(/[„"]([^”"]{3,200})[”"]/g)) {
    const hits = others.filter((x) => norm(x.title) === norm(m[1]));
    const same = hits.filter((x) => x.taskId === self.taskId);
    if (same.length === 1) return same[0].id;
    if (hits.length === 1) return hits[0].id;
  }
  return null;
}
// ostatnia zmiana folderów i narzędzi w aplikacji na Macu (którykolwiek komputer); ustawienie bridgeAccess = { komputer: { key, at } }
export function bridgeAccessAt(settings: Record<string, unknown>): string | null {
  const m = settings.bridgeAccess;
  if (!m || typeof m !== "object") return null;
  let last: string | null = null;
  for (const v of Object.values(m as Record<string, unknown>)) {
    const at = v && typeof v === "object" ? (v as { at?: unknown }).at : null;
    if (typeof at === "string" && (!last || at > last)) last = at;
  }
  return last;
}
// krok oddany o leftAt wraca do pracy, gdy po oddaniu przyszło coś nowego (sygnał Piotra w zadaniu albo zmiana w aplikacji na Macu)
export function retryAfterLeft(leftAt: string, signalAt: string | null | undefined, accessAt: string | null): boolean {
  const left = Date.parse(leftAt);
  return [signalAt, accessAt].some((x) => !!x && Date.parse(x) > left);
}
// kolejka agenta (paczka 18): każda pozycja listy pracy z kluczem; Piotr ustawia kolejność w panelu w lewym dolnym rogu (ustawienie queueOrder),
// a lista pracy daje te pozycje na początek, w jego kolejności (sekcja NAJPIERW), i od nich bieg bierze model
export type QueueKind = "chat" | "going" | "breakdown" | "answer" | "step" | "file" | "draft" | "title";
export type QueueItem = { key: string; kind: QueueKind; taskId: string; taskTitle: string; stepId: string | null; label: string; rank: number; line: string; taken: boolean; choice: Choice | null };
export const QUEUE_KINDS: Record<QueueKind, string> = { chat: "odpowiedź na Twoją wiadomość", going: "krok w toku", breakdown: "rozpisanie na kroki", answer: "Twoja odpowiedź na pytanie", step: "krok do zrobienia", file: "plik na Macu", draft: "szkic do zatwierdzenia", title: "skrócenie tytułu" };
export const queueOrderOf = (settings: Record<string, unknown>): string[] => (Array.isArray(settings.queueOrder) ? settings.queueOrder.filter((x): x is string => typeof x === "string") : []);
// kolejność kolejki: najpierw pozycje ustawione przez Piotra (w jego kolejności), potem reszta tak, jak bierze ją agent (sekcje listy po kolei)
export function orderQueue<T extends Pick<QueueItem, "key" | "rank">>(items: T[], order: string[]): T[] {
  const at = new Map(order.map((k, i) => [k, i]));
  return items.map((x, i) => ({ x, i })).sort((a, b) => {
    const pa = at.get(a.x.key), pb = at.get(b.x.key);
    if (pa != null || pb != null) return pa == null ? 1 : pb == null ? -1 : pa - pb;
    return a.x.rank - b.x.rank || a.i - b.i;
  }).map((y) => y.x);
}
export type WorkSummary = { text: string; counts: WorkCounts; total: number; choices?: Choice[]; sig?: string; items?: QueueItem[] };
// kto pyta: bridge-v1 = stara aplikacja mostka (0.1.6, skrypt Node) wysyła zatwierdzone szkice jak dotąd; client = konektor OAuth i automat co godzinę,
// work = bieg pracy mostka v2: oba bez zatwierdzonych szkiców (wysyła je osobny bieg wysyłki); send = bieg wysyłki: tylko jego jeden krok (stepId)
export type WorkAudience = "bridge-v1" | "client" | "work" | "send";
// kto pyta, ten widzi (albo nie) zatwierdzone szkice: stary mostek wysyła z list_work, konektor i bieg pracy nigdy, bieg wysyłki tylko swój krok
export function audienceOf(auth: Pick<repo.TokenAuth, "kind" | "scope">): WorkAudience {
  if (auth.kind === "bridge") return "bridge-v1";
  if (auth.kind === "run") return auth.scope?.kind === "send" ? "send" : "work";
  return "client";
}
export type Sendable = { taskId: string; taskTitle: string; step: Step; draft: Draft; connectionId: string | null };

// szkice do wysłania: ważna zgoda, nikt ich jeszcze nie wziął, kroki przed nimi zrobione; najdawniej zatwierdzony pierwszy.
// Zatwierdzony prompt (Claude Code, Claude) to nie wysyłka: wykonuje go bieg pracy (KROKI W TOKU)
export async function listSendable(ownerId: string): Promise<Sendable[]> {
  const [tasks, openQ] = await Promise.all([repo.listTasks(ownerId), repo.listQuestions(ownerId, { open: true })]);
  const unfinished = new Set(tasks.filter((t) => !t.doneAt && !t.deletedAt).map((t) => t.id));
  const waiting = new Set(openQ.map((q) => q.taskId));
  const out: Sendable[] = [];
  for (const t of tasks) {
    if (t.doneAt || t.deletedAt || waiting.has(t.id) || t.dependsOn.some((d) => unfinished.has(d))) continue;
    for (const st of t.steps) {
      const d = draftOf(st);
      if (d && isSendable(st) && !isPromptDraft(d, st.blocks) && st.dependsOn.every((x) => t.steps.find((y) => y.id === x)?.status === "done")) out.push({ taskId: t.id, taskTitle: t.title, step: st, draft: d, connectionId: st.connectionId });
    }
  }
  return out.sort((a, b) => (a.step.approvedAt ?? "").localeCompare(b.step.approvedAt ?? ""));
}

// lista pracy dla biegu wysyłki: tylko ten jeden szkic, i tylko gdy bieg go wziął (send_started_at), a zgoda wciąż jest ważna
async function sendSummary(ownerId: string, stepId: string | undefined): Promise<WorkSummary> {
  const tasks = stepId ? await repo.listTasks(ownerId) : [];
  const t = tasks.find((x) => x.steps.some((s) => s.id === stepId));
  const st = t?.steps.find((s) => s.id === stepId);
  const counts: WorkCounts = { chat: 0, going: 0, approved: 0, noSteps: 0, answered: 0, ready: 0, approval: 0, titles: 0 };
  if (!t || !st || !approvalValid(st) || !st.sendStartedAt) return { text: "Nic nie czeka na agenta.", counts, total: 0 };
  counts.approved = 1;
  return { text: `SZKIC DO WYSŁANIA W TYM BIEGU (get_task tego zadania, wyślij dokładnie treść z sekcji „SZKIC KROKU ${st.id}”, bez zmian, tam, gdzie wskazuje „dokąd”, w formacie z linii „formatowanie”, raz; potem complete_step z linkiem; przy jakiejkolwiek wątpliwości leave_step z powodem i nic nie wysyłaj):\n- krok [${st.id}] „${st.title}” (${st.tool}) w zadaniu [${t.id}] „${t.title}”`, counts, total: 1 };
}

// peek: tylko policz, nie oznaczaj odpowiedzi Piotra jako odczytanych (mostek zagląda tu co kilkanaście sekund)
// focus: bieg pracy mostka z doborem modelu widzi tylko swoją grupę („model|wysiłek”); resztę zrobi osobny bieg na modelu dobranym do niej
export async function workSummary(ownerId: string, opts: { peek?: boolean; audience?: WorkAudience; stepId?: string; focus?: string | null } = {}): Promise<WorkSummary> {
  const audience = opts.audience ?? "bridge-v1";
  if (audience === "send") return sendSummary(ownerId, opts.stepId);
  const sends = audience === "bridge-v1";   // tylko stary mostek wysyła z listy pracy; reszta nie widzi zatwierdzonych szkiców
  const [tasks, projects, samples, allAnswered, allChat, settings] = await Promise.all([repo.listTasks(ownerId), repo.listProjects(ownerId), repo.listSamples(ownerId), repo.listQuestions(ownerId, { answeredUnseen: true }), repo.listUnseenChat(ownerId), repo.userSettings(ownerId)]);
  // dobór modelu: każda pozycja listy dostaje grupę (model i wysiłek z poziomu kroku); bez konfiguracji wszystko w jednej, pustej grupie
  const cfg = modelConfig(settings);
  const weightOf = new Map(tasks.map((t) => [t.id, projects.find((p) => p.id === t.projectId)?.weight ?? null]));
  const stepOf = new Map(tasks.flatMap((t) => t.steps.map((st) => [st.id, st] as const)));
  const projectOf = new Map(tasks.map((t) => [t.id, projects.find((p) => p.id === t.projectId)?.name ?? null]));
  // grupy z miejscem sekcji na liście (wiadomości, w toku, rozpisanie, odpowiedzi, gotowe, pliki, szkice, tytuły): bieg bierze grupę pierwszej pozycji
  const seen: { rank: number; c: Choice; key: string | null }[] = [];
  let skipped = 0;
  const items: QueueItem[] = [];
  // pozycja w grupie biegu (albo bez focus: zawsze); q: pozycja kolejki (bez q tylko liczy się do grup)
  const take = (c: Choice | null, rank: number, q?: Omit<QueueItem, "rank" | "taken" | "choice">): boolean => {
    if (c) seen.push({ rank, c, key: q?.key ?? null });
    const ok = !opts.focus || (c?.key ?? "") === opts.focus;
    if (!ok) skipped++;
    if (q && !items.some((x) => x.key === q.key)) items.push({ ...q, rank, taken: ok, choice: c });
    return ok;
  };
  const forStep = (st: Step, taskId: string) => (cfg ? stepChoice(cfg, st, { weight: weightOf.get(taskId) }) : null);
  // wiadomość albo odpowiedź przy kroku idzie na poziomie tego kroku (kartka Piotra co najmniej Analiza), bez kroku na Analizie
  const forTaskMsg = (taskId: string, stepId?: string | null) => { const st = stepId ? stepOf.get(stepId) : undefined; return cfg ? (st ? forStep(st, taskId) : choiceOf(cfg, "analysis")) : null; };
  const chatStep = (m: (typeof allChat)[number]) => (m.actions as { stepId?: string } | null)?.stepId ?? null;
  const chat = allChat.filter((m) => take(forTaskMsg(m.taskId, chatStep(m)), 0, { key: `chat:${m.taskId}`, kind: "chat", taskId: m.taskId, taskTitle: m.taskTitle, stepId: chatStep(m), label: `Twoja wiadomość: „${m.text.replace(/\s+/g, " ").slice(0, 80)}”`, line: `wiadomość w zadaniu [${m.taskId}] „${m.taskTitle}” (sekcja WIADOMOŚCI PIOTRA)` }));
  const open = scoreAll(tasks, projects, samples).filter((s) => !s.task.doneAt && !s.task.deletedAt);
  const unfinished = new Set(tasks.filter((t) => !t.doneAt && !t.deletedAt).map((t) => t.id));
  const free = open.filter((s) => !s.task.dependsOn.some((d) => unfinished.has(d)));   // zadania, które nie czekają na inne zadania
  const [openQ, signals] = await Promise.all([repo.listQuestions(ownerId, { open: true }), repo.lastOwnerSignals(ownerId)]);
  const accessAt = bridgeAccessAt(settings);
  const waitingTask = new Set(openQ.map((q) => q.taskId));
  // rozpisanie zadania zawsze na Strategii
  const noSteps = free.filter((s) => !s.task.steps.length && !waitingTask.has(s.task.id) && take(cfg ? choiceOf(cfg, "strategy") : null, 3,
    { key: `task:${s.task.id}`, kind: "breakdown", taskId: s.task.id, taskTitle: s.task.title, stepId: null, label: "Rozpisanie na kroki", line: `rozpisanie zadania [${s.task.id}] „${s.task.title}” (sekcja ZADANIA BEZ KROKÓW)` }));
  const attN = await repo.countAttachments(noSteps.map((s) => s.task.id));
  // tytuły zadań wpisane jako cała wiadomość Piotra (dłuższe niż 6 słów albo zdanie z kropką), których agent jeszcze nie skrócił
  // samo skrócenie tytułu to Mechanika
  const longTitles = open.filter((s) => !s.task.titleOriginal && isLongTitle(s.task.title) && take(cfg ? choiceOf(cfg, "mechanics") : null, 8,
    { key: `title:${s.task.id}`, kind: "title", taskId: s.task.id, taskTitle: s.task.title, stepId: null, label: "Skrócenie tytułu", line: `tytuł zadania [${s.task.id}] (sekcja TYTUŁY DO SKRÓCENIA)` }));
  const titleOf = new Map(tasks.map((t) => [t.id, t.title]));
  const answered = allAnswered.filter((q) => take(forTaskMsg(q.taskId, q.stepId), 4,
    { key: `answer:${q.id}`, kind: "answer", taskId: q.taskId, taskTitle: titleOf.get(q.taskId) ?? "", stepId: q.stepId ?? null, label: `Twoja odpowiedź: „${String(q.answer ?? "").slice(0, 80)}”`, line: `odpowiedź na pytanie w zadaniu [${q.taskId}] (sekcja ODPOWIEDZI PIOTRA)` }));
  const going: string[] = [], approved: string[] = [], ready: string[] = [], approval: string[] = [], held: string[] = [], files: string[] = [];
  const RANK = new Map<string[], number>([[going, 1], [approved, 2], [held, 2], [ready, 5], [files, 6], [approval, 7]]);
  const KIND = new Map<string[], QueueKind>([[going, "going"], [ready, "step"], [files, "file"], [approval, "draft"]]);
  const SECTION = new Map<string[], string>([[going, "KROKI W TOKU"], [ready, "KROKI DO ZROBIENIA BEZ ZGODY"], [files, "PLIKI NA MACU"], [approval, "KROKI WYMAGAJĄCE ZGODY PIOTRA"]]);
  for (const s of free) {
    if (waitingTask.has(s.task.id)) continue;
    for (const st of s.task.steps) {
      const c = forStep(st, s.task.id);
      const line = `- krok [${st.id}] „${st.title}” (${st.tool}) w zadaniu [${s.task.id}] „${s.task.title}”${st.detail ? ": " + st.detail.slice(0, 200) : ""}`;
      const n = s.task.steps.indexOf(st) + 1;
      // zatwierdzone szkice do wysłania nie są pracą agenta (wysyła je osobny bieg), więc nie wchodzą do kolejki
      const add = (list: string[], l: string) => {
        const kind = KIND.get(list);
        const q = kind ? { key: `step:${st.id}`, kind, taskId: s.task.id, taskTitle: s.task.title, stepId: st.id, label: `Krok ${String(n).padStart(2, "0")}: ${st.title}`, line: `krok [${st.id}] „${st.title}” w zadaniu [${s.task.id}] (sekcja ${SECTION.get(list)})` } : undefined;
        if (take(c, RANK.get(list) ?? 5, q)) list.push(l);
      };
      const depsDone = st.dependsOn.every((d) => s.task.steps.find((x) => x.id === d)?.status === "done");
      // szkic ze zgodą Piotra (podpis treści): wysyła go stary mostek z tej listy albo osobny bieg wysyłki; zgoda nieważna albo wysyłka w toku = nic dla agenta
      if (st.status === "handoff" && (st.approvedAt || st.sendStartedAt || draftOf(st)?.status === "approved")) {
        // zatwierdzony prompt dla agenta: bieg pracy (i klient) wykonuje go jak krok w toku; stary mostek ma go w szkicach do wysłania
        if (!sends && depsDone && isSendable(st) && isPromptDraft(draftOf(st), st.blocks)) { add(going, line + " (zatwierdzony prompt: wykonaj polecenie z sekcji „SZKIC KROKU” w get_task, potem complete_step)"); continue; }
        if (!sends || !isSendable(st)) continue;
        // zatwierdzony szkic czeka z wysyłką, aż skończą się kroki przed nim (Piotr może zatwierdzić wcześniej, ale kolejność wysyłki zostaje)
        add(depsDone ? approved : held, line + (depsDone && st.handoffAt ? ` (od ${st.handoffAt})` : ""));
        continue;
      }
      // krok zlecony do chmury („Uruchom w chmurze”, paczka 13): robi go tylko sesja w chmurze przez cloud_work, nie mostek ani automat
      if (st.cloud) continue;
      // plik na Macu zapisuje tylko bieg pracy mostka (aplikacja 0.1.7): inni go nie widzą
      if (st.tool === "file" && audience !== "work") continue;
      if (st.status === "handoff") { add(going, line + (st.handoffAt ? ` (od ${st.handoffAt})` : "") + (st.tool === "file" ? " (plik na Macu: dokończ jak w sekcji PLIKI NA MACU)" : "")); continue; }
      if (st.status !== "todo") continue;
      if (!depsDone) continue;
      // oddany, bo czeka na inny krok (także z innego zadania): wraca na listę dopiero, gdy tamten jest zrobiony (paczka 14, punkt 1)
      if (st.waitFor && stepOf.has(st.waitFor) && stepOf.get(st.waitFor)!.status !== "done") continue;
      // oddany, bo czeka na Piotra (brak folderu, dostępu, narzędzia albo już na najwyższym poziomie): nie wraca co kilka minut z tym samym
      // powodem (paczka 22), tylko po czymś nowym: wiadomość albo odpowiedź w tym zadaniu, zmiana folderów i narzędzi w aplikacji na Macu,
      // zmiana kroku (czyści left_at). Inny oddany krok wraca od razu na mocniejszym modelu (eskalacja)
      if (st.leftAt && st.need && !retryAfterLeft(st.leftAt, signals[s.task.id], accessAt)) continue;
      // krok z kodem w projekcie Task Hub robi wątek w chmurze na zlecenie Piotra, nie bieg mostka ani automat (paczka 14, punkt 1)
      if (isAppCodeStep(st, projectOf.get(s.task.id))) continue;
      if (st.tool === "manual") continue;
      if (st.tool === "file") { add(files, line); continue; }
      // szkic nieaktualny (nowe kroki weszły przed nim) agent przygotowuje od nowa, gdy kroki przed nim są zrobione
      if (st.needsApproval) { if (!st.blocks?.some((b) => b.type === "draft" && !b.stale)) add(approval, line); } else add(ready, line);
    }
  }
  if (!opts.peek) await Promise.all([repo.markQuestionsSeen(ownerId, answered.map((q) => q.id)), repo.markChatSeen(ownerId, { ids: chat.map((m) => m.id) })]);
  const counts: WorkCounts = { chat: chat.length, going: going.length, approved: approved.length, noSteps: noSteps.length, answered: answered.length, ready: ready.length + files.length, approval: approval.length, titles: longTitles.length };
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const out = [
    chat.length ? "WIADOMOŚCI PIOTRA W ZADANIACH (najpierw to: get_task, potem zrób, o co prosi: gdy zmienia zakres pracy, dodaj kroki przez add_steps z polem before = id kroku publikacji albo wysyłki, przed którym mają wejść; gdy prosi o poprawkę szkicu, popraw go przez set_blocks; gdy pyta, odpowiedz. Wiadomość przy kroku (także odpowiedź na pytanie z kartki) dotyczy kartki tego kroku, dopóki nie jest zrobiony, także kroku Piotra (Ty): gdy zmienia jej treść, zapisz kartkę od nowa przez set_blocks pełnym zestawem klocków (KARTKA KROKU w get_task; pytania z odpowiedziami zostają; bez klocków-notek o zmianie, kartka pokazuje tylko stan) i reply_chat z stepId tego kroku: co zmieniłeś na kartce; gdy nic nie zmienia, reply_chat, czemu. " + DECISION_MSG + " Odpowiedź pokazuje się Piotrowi jako dymek czatu nad polem wpisywania. Po każdej załatwionej prośbie reply_chat w tym zadaniu z messageIds = id tej wiadomości: co dopisałeś (numery i tytuły kroków) albo odpowiedź; Piotr widzi wtedy, która prośba jest załatwiona, a która jeszcze w pracy. Nigdy „wezmę pod uwagę” bez kroku):\n" + chat.map((m) => `- zadanie [${m.taskId}] „${m.taskTitle}”${(m.actions as { stepId?: string } | null)?.stepId ? `, przy kroku [${(m.actions as { stepId: string }).stepId}]` : ""}, wiadomość [${m.id}] (${m.createdAt.slice(0, 16).replace("T", " ")} UTC): ${preview(m.text.replace(/\s+/g, " "))}`).join("\n") : "",
    going.length ? "KROKI W TOKU (zaczęte przez Piotra albo poprzedni przebieg; zrób je teraz i zgłoś complete_step, a gdy nie możesz: leave_step z powodem):\n" + going.join("\n") : "",
    approved.length ? "ZATWIERDZONE SZKICE DO WYSŁANIA (wyślij dokładnie treść z sekcji „SZKIC KROKU <id>” w get_task, bez zmian, w formacie z linii „formatowanie” tej sekcji, potem complete_step z linkiem):\n" + approved.join("\n") : "",
    held.length ? "ZATWIERDZONE, ALE CZEKAJĄ NA KROKI PRZED NIMI (nie wysyłaj ich teraz; wyślesz, gdy tamte kroki będą zrobione albo zamknięte jako zbędne):\n" + held.join("\n") : "",
    noSteps.length ? "ZADANIA BEZ KROKÓW (get_task, get_rules z topic „rozpisanie”, gdy tytuł jest długi albo jest całą wiadomością Piotra: update_task z krótkim title (" + TITLE_RULE + "), potem add_steps (" + STEP_TITLE_RULE + ") bez pytań, gdy da się przyjąć rozsądne założenia; w razie potrzeby ask_question. " + PROJECT_RULE + " " + ITEMS_RULE + " " + DECISION_RULE + " " + DEST_RULE + " " + DONE_RULE + " " + EST_RULE + "):\n" + noSteps.map((s) => brief(s) + (attN[s.task.id] ? ` | załączniki: ${attN[s.task.id]} (get_task, potem get_attachment)` : "")).join("\n") : "",
    answered.length ? "ODPOWIEDZI PIOTRA (kontynuuj pracę w tych zadaniach):\n" + answered.map((q) => `- zadanie [${q.taskId}]${q.stepId ? ` krok [${q.stepId}]` : ""}: pytanie „${q.text}” → odpowiedź: ${q.answer}`).join("\n") : "",
    // bez starego mostka: konektor i bieg pracy tylko czytają; zmiana w aplikacji zewnętrznej to zawsze szkic (krok bez zgody mógł dodać agent)
    ready.length ? (sends ? "KROKI DO ZROBIENIA BEZ ZGODY (start_step, zrób swoimi konektorami, complete_step z linkiem; fakty przez add_facts):\n"
      : "KROKI DO ZROBIENIA BEZ ZGODY (tylko czytanie i analiza: start_step, czytaj swoimi konektorami, complete_step z linkiem; fakty przez add_facts. Gdy krok ma coś wysłać albo zmienić w aplikacji zewnętrznej (wiadomość, komentarz, ticket, wydarzenie, plik w Dysku Google), nie rób tego, nawet jeśli krok nie wymaga zgody: przygotuj szkic przez set_blocks jako blok draft ze status proposed; po zatwierdzeniu przez Piotra wyśle go mostek Task Hub):\n") + ready.join("\n") : "",
    files.length ? "PLIKI NA MACU (start_step → zapisz nowy plik narzędziem Write w folderze z linii „Foldery na pliki” na końcu polecenia → tę samą treść pokaż na kartce przez set_blocks jako klocek free → complete_step z polem file = pełna ścieżka; gdy folderu nie ma na liście: leave_step z powodem „Dodaj folder <ścieżka> w Ustawieniach aplikacji Task Hub na Macu (Foldery na pliki)” i polem needFolder (kind files, ta ścieżka)):\n" + files.join("\n") : "",
    approval.length ? "KROKI WYMAGAJĄCE ZGODY PIOTRA (przygotuj gotowy szkic przez set_blocks jako blok draft ze status proposed; niczego nie wysyłaj, krok sam przejdzie do zatwierdzenia):\n" + approval.join("\n") : "",
    longTitles.length ? `TYTUŁY DO SKRÓCENIA (update_task z nowym title, nic więcej; ${TITLE_RULE}; pierwotny tytuł zostaje zapisany sam):\n` + longTitles.map((s) => `- zadanie [${s.task.id}] „${s.task.title}”`).join("\n") : "",
    openQ.length ? `ZADANIA CZEKAJĄCE NA ODPOWIEDŹ PIOTRA (pomiń): ${[...waitingTask].map((id) => `[${id}]`).join(", ")}` : "",
  ].filter(Boolean).join("\n\n");
  // kolejność ustawiona przez Piotra: te pozycje na początku listy, a bieg bierze model pierwszej z nich
  const ordered = orderQueue(items, queueOrderOf(settings));
  const pinAt = new Map(queueOrderOf(settings).map((k, i) => [k, i]));
  const pinned = new Set(pinAt.keys());
  const first = ordered.filter((x) => x.taken && pinned.has(x.key));
  const firstText = first.length ? "NAJPIERW, W TEJ KOLEJNOŚCI (Piotr ustawił kolejność pracy w Task Hub: zrób te pozycje przed resztą listy, jedna po drugiej, każdą tak, jak mówi jej sekcja niżej):\n" + first.map((x, i) => `${i + 1}. ${x.line}`).join("\n") + "\n\n" : "";
  const choices: Choice[] = [];
  const eff = seen.map((x) => ({ ...x, rank: x.key && pinAt.has(x.key) ? -1000 + pinAt.get(x.key)! : x.rank })).sort((a, b) => a.rank - b.rank);
  for (const { c } of eff) if (!choices.some((x) => x.key === c.key)) choices.push(c);
  // bieg z doborem modelu: na początku listy, na czym pracuje i że reszta idzie osobnym biegiem
  const focus = opts.focus ? choices.find((c) => c.key === opts.focus) ?? null : null;
  const head = opts.focus && total ? `TEN BIEG: ${focus ? runLabel(focus.model, focus.effort) : opts.focus.replace("|", " · ")}. Rób tylko pozycje z tej listy.${skipped ? ` Pozostałe (${skipped}) zrobi osobny bieg na modelu dobranym do ich poziomu, więc ich nie szukaj i nie bierz się za nie (także za kroki, które dodasz przy rozpisaniu).` : ""}\n\n` : "";
  return { text: out ? head + firstText + out + "\n\n" + PLAIN_LANG : "Nic nie czeka na agenta.", counts, total, choices, sig: eff.map((x) => x.c.key).join(","), items: ordered };
}

// jak pisać do Piotra (długość, słownictwo, język) mówią wyłącznie jego zasady w bazie, które sam edytuje (zasada „Rozmowa z Piotrem
// i treści na zewnątrz”); kod tylko odsyła do nich, żeby styl był w jednym miejscu (Piotr, 2026-10-24)
export const PLAIN_LANG = "JAK PISAĆ DO PIOTRA (kartka kroku, summary, powód oddania, reply_chat): długość, słownictwo i język mówią zasady z get_rules; trzymaj się ich, tu nie ma osobnych reguł stylu.";

// ---------- kolejka agenta w lewym dolnym rogu (paczka 18) ----------
// now: to, nad czym Claude pracuje teraz (bieg mostka); items: reszta kolejki w kolejności, w jakiej ją weźmie (bez pozycji bieżącego kroku)
export type QueueEntry = { key: string; kind: string; taskId: string; taskTitle: string; stepId: string | null; label: string };
export type QueueNow = { taskId: string | null; taskTitle: string; label: string | null; since: string };
export type AgentQueue = { now: QueueNow | null; items: QueueEntry[] };
export async function agentQueue(ownerId: string, run: { taskId: string | null; stepId: string | null; since: string; kind?: string } | null): Promise<AgentQueue> {
  const [w, tasks] = await Promise.all([workSummary(ownerId, { peek: true, audience: "work" }), run?.taskId ? repo.listTasks(ownerId) : Promise.resolve([])]);
  const t = run?.taskId ? tasks.find((x) => x.id === run.taskId) : null;
  const sIdx = t && run?.stepId ? t.steps.findIndex((s) => s.id === run.stepId) : -1;
  const now: QueueNow | null = run ? { taskId: run.taskId, taskTitle: t?.title ?? (run.kind === "send" ? "Wysyłka" : "Praca w tle"), label: sIdx >= 0 ? `Krok ${String(sIdx + 1).padStart(2, "0")}: ${t!.steps[sIdx].title}` : null, since: run.since } : null;
  const items = (w.items ?? []).filter((x) => !(run?.stepId && x.stepId === run.stepId && x.key === `step:${run.stepId}`))
    .map((x) => ({ key: x.key, kind: QUEUE_KINDS[x.kind], taskId: x.taskId, taskTitle: x.taskTitle, stepId: x.stepId, label: x.label }));
  return { now, items };
}
