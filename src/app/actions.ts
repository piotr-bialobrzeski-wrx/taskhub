"use server";
// Akcje serwera dla widoków. Każda sprawdza zalogowanego właściciela; agent nigdy nie usuwa, człowiek może.
import { modelConfig, normalizeLevel } from "@/lib/agent/models";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, checkPassword, sessionValue } from "@/lib/auth";
import { requireOwner } from "@/lib/session";
import { client, hhmm, mayTry, record } from "@/lib/guard";
import * as repo from "@/lib/repo";
import { composeFlow, finishStep, prepareStep, taskQueue } from "@/lib/services";
import { Q, roundQ } from "@/lib/time";
import { intake, uploads } from "@/lib/intake";
import { shortTitle, type Queue } from "@/lib/auto";
import { fmtTime } from "@/lib/clock";
import { connectorIssue, isGitDraft } from "@/lib/bridge";
import { approveRefusal, draftOf, draftsOf, isExternalApp, isLocalFile, isPromptDraft, shownSig, type Draft } from "@/lib/agent/approval";
import { decisionText, destOf, isProjectStep, openQuestions, stepKind } from "@/lib/stepcard";
import { isAppCodeStep, isOwnerStep, type Connection, type Rule, type Sphere, type Step } from "@/lib/schema";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const num = (fd: FormData, k: string, def: number) => { const v = Number(str(fd, k)); return Number.isFinite(v) && str(fd, k) !== "" ? v : def; };
const url = (s: string) => (/^https?:\/\//.test(s) ? s : /^[\w.-]+\.[a-z]{2,}(\/\S*)?$/i.test(s) ? "https://" + s : null);
const fail = (e: unknown) => (e instanceof Error ? e.message : String(e));

function refresh(taskId?: string | null) {
  revalidatePath("/");
  if (taskId) revalidatePath(`/tasks/${taskId}`);
}

// ---------- logowanie ----------
export async function login(fd: FormData) {
  const c = await client();
  const v = await mayTry(c.ip, new Date(), c.country);
  if (!v.ok) redirect(`/login?e=${v.reason}&t=${encodeURIComponent(hhmm(v.until))}`);
  const ok = checkPassword(str(fd, "password"));
  await record("web", ok, c);
  if (!ok) redirect("/login?e=1");
  (await cookies()).set(SESSION_COOKIE, sessionValue(), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 90 });
  redirect("/");
}
export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}

// ---------- czat z agentem ----------
// rdzeń w src/lib/intake.ts: tę samą drogę ma szybki pasek w aplikacji na Macu
export async function chat(fd: FormData) {
  const o = await requireOwner();
  const taskId = str(fd, "taskId") || null;
  const stepId = (taskId && str(fd, "stepId")) || null;   // otwarty krok w panelu: domyślny kontekst wiadomości
  const { goTo } = await intake(o.id, { typed: str(fd, "text"), files: uploads(fd), taskId, stepId });
  refresh(taskId);
  if (goTo) redirect(`/tasks/${goTo}`);
}

// ---------- zadania ----------
export async function createTaskForm(fd: FormData) {
  const o = await requireOwner();
  const title = str(fd, "title"); if (!title) return;
  const t = await repo.createTask(o.id, { title, source: str(fd, "source"), level: num(fd, "level", 3) });
  refresh();
  redirect(`/tasks/${t.id}`);
}
export async function updateTaskForm(fd: FormData) {
  const o = await requireOwner();
  const id = str(fd, "id");
  await repo.updateTask(o.id, id, {
    title: str(fd, "title") || undefined, summary: str(fd, "summary"), source: str(fd, "source"),
    level: Math.min(5, Math.max(1, num(fd, "level", 3))), due: str(fd, "due") || null, projectId: str(fd, "projectId") || null,
  });
  refresh(id);
}
export async function trashTask(id: string) {
  const o = await requireOwner();
  await repo.updateTask(o.id, id, { deletedAt: new Date().toISOString() });
  refresh(id);
  redirect("/");
}
// szybkie dodanie z kanwy (bez przeładowania i przekierowania)
export async function createTaskQuick(title: string) {
  const o = await requireOwner();
  const t = title.trim().slice(0, 200); if (!t) return;
  await repo.createTask(o.id, { title: t, source: t });
  refresh();
}
export async function addStepQuick(taskId: string, title: string, after: string | null) {
  const o = await requireOwner();
  const task = await repo.getTask(o.id, taskId); if (!task) throw new Error("Nie ma takiego zadania");
  const t = title.trim().slice(0, 200); if (!t) return;
  await repo.addSteps(taskId, [{ title: t, tool: "manual", dependsOn: after && task.steps.some((s) => s.id === after) ? [after] : [] }]);
  refresh(taskId);
}
// z archiwum: otwiera ponownie ostatni zrobiony krok, zadanie wraca na kanwę
export async function reopenLast(taskId: string) {
  const o = await requireOwner();
  const task = await repo.getTask(o.id, taskId); if (!task) throw new Error("Nie ma takiego zadania");
  const last = [...task.steps].reverse().find((s) => s.status === "done");
  if (last) await repo.reopenStep(o.id, taskId, last);
  else await repo.updateTask(o.id, taskId, { deletedAt: null });
  refresh(taskId);
}
export async function restoreTask(id: string) {
  const o = await requireOwner();
  await repo.updateTask(o.id, id, { deletedAt: null });
  refresh(id);
}
export async function purgeTaskAction(id: string) {
  const o = await requireOwner();
  await repo.purgeTask(o.id, id);
  refresh();
}

// ---------- kroki ----------
async function stepOf(ownerId: string, taskId: string, stepId: string) {
  const task = await repo.getTask(ownerId, taskId); if (!task) throw new Error("Nie ma takiego zadania");
  const step = task.steps.find((s) => s.id === stepId); if (!step) throw new Error("Nie ma takiego kroku");
  return { task, step };
}
export async function addStepForm(fd: FormData) {
  const o = await requireOwner();
  const taskId = str(fd, "taskId"); const title = str(fd, "title"); if (!title) return;
  await stepOf(o.id, taskId, (await repo.getTask(o.id, taskId))?.steps[0]?.id ?? "").catch(() => null); // tylko sprawdzenie własności zadania
  const task = await repo.getTask(o.id, taskId); if (!task) return;
  const after = str(fd, "after");
  await repo.addSteps(taskId, [{ title, detail: str(fd, "detail"), tool: str(fd, "tool") || "manual", estMin: num(fd, "est", Q), needsApproval: fd.get("needsApproval") === "on", link: url(str(fd, "link")) ?? undefined, dependsOn: after ? [after] : [] }]);
  refresh(taskId);
}
// edycja w miejscu: jedno pole naraz, tam gdzie je widać w panelu kroku
export async function patchStep(taskId: string, stepId: string, patch: { title?: string; detail?: string; tool?: string; estMin?: number; spentMin?: number; link?: string; needsApproval?: boolean; connectionId?: string | null; modelPick?: string | null }) {
  const o = await requireOwner();
  const { step } = await stepOf(o.id, taskId, stepId);
  const p: repo.StepPatch = {};
  if (patch.title !== undefined && patch.title.trim()) p.title = patch.title.trim().slice(0, 200);
  if (patch.detail !== undefined) p.detail = patch.detail.trim();
  if (patch.tool) p.tool = patch.tool;
  if (patch.estMin !== undefined && Number.isFinite(patch.estMin)) p.estMin = roundQ(patch.estMin);
  if (patch.spentMin !== undefined && Number.isFinite(patch.spentMin) && patch.spentMin >= 0) { p.spentSec = Math.round(patch.spentMin * 60); p.spentManual = true; }
  if (patch.link !== undefined) p.link = patch.link.trim() ? url(patch.link.trim()) : null;
  if (patch.needsApproval !== undefined) p.needsApproval = patch.needsApproval;
  if (patch.connectionId !== undefined) p.connectionId = patch.connectionId || null;
  if (patch.modelPick !== undefined) p.modelPick = patch.modelPick || null;
  if (Object.keys(p).length) await repo.updateStep(step.id, p);
  refresh(taskId);
}
export async function removeStep(taskId: string, stepId: string) {
  const o = await requireOwner();
  await stepOf(o.id, taskId, stepId);
  await repo.deleteStep(stepId);
  refresh(taskId);
}
export async function markDone(taskId: string, stepId: string) {
  const o = await requireOwner();
  await finishStep(o.id, taskId, stepId);
  refresh(taskId);
}
export async function reopen(taskId: string, stepId: string) {
  const o = await requireOwner();
  const { step } = await stepOf(o.id, taskId, stepId);
  await repo.reopenStep(o.id, taskId, step);
  refresh(taskId);
}
// „Odłóż” i „Zatrzymaj”: krok wraca do zrobienia; zgoda na szkic przepada (repo cofa ją przy każdej zmianie stanu), szkic zostaje do ponownego zatwierdzenia
export async function backToTodo(taskId: string, stepId: string) {
  const o = await requireOwner();
  await stepOf(o.id, taskId, stepId);
  await repo.updateStep(stepId, { status: "todo", handoffAt: null });
  refresh(taskId);
}
export async function prepare(taskId: string, stepId: string) {
  const o = await requireOwner();
  try { await prepareStep(o.id, taskId, stepId); } catch (e) { await repo.addChat(o.id, taskId, "agent", "Nie udało się przygotować kroku: " + fail(e)); }
  refresh(taskId);
}
export async function compose(taskId: string, stepId: string) {
  const o = await requireOwner();
  try { await composeFlow(o.id, taskId, stepId); } catch (e) { await repo.addChat(o.id, taskId, "agent", "Nie udało się złożyć panelu: " + fail(e)); }
  refresh(taskId);
}
// „Uruchom”: krok przechodzi w toku (kafelek pokazuje pracę); Claude z konektora bierze go z list_work i zgłasza wynik przez complete_step
// tylko krok do zrobienia: szkic idzie dalej wyłącznie przez „Zatwierdź”, a stan „w toku” po szkicu nie może wyglądać jak zgoda
// nazwa projektu zadania: krok z kodem w projekcie Task Hub idzie do chmury, nie do mostka (paczka 14, punkt 1)
async function projectNameOf(ownerId: string, task: { projectId: string | null }): Promise<string | null> {
  return task.projectId ? (await repo.listProjects(ownerId)).find((p) => p.id === task.projectId)?.name ?? null : null;
}
const cloudChat = (title: string) => `Zlecone do chmury: „${shortTitle(title, 70)}”. Claude w chmurze weźmie ten krok i zamknie go z wynikiem.`;
export async function handoff(taskId: string, stepId: string) {
  const o = await requireOwner();
  const { task, step } = await stepOf(o.id, taskId, stepId);
  // „Uruchom” na kroku z kodem Task Hub (np. z menu kafelka) zleca go chmurze, bo mostek go nie zrobi
  if (isAppCodeStep(step, await projectNameOf(o.id, task))) { if (await repo.queueCloud(o.id, stepId)) await repo.addChat(o.id, taskId, "agent", cloudChat(step.title), { stepId }); }
  else if (step.status === "todo") await repo.updateStep(stepId, { status: "handoff", prevStatus: "todo", handoffAt: new Date().toISOString() });
  refresh(taskId);
}
// „Uruchom w chmurze” (paczka 13, punkt 3): krok „Zleć w projekcie: …” / „Wdróż na produkcję” idzie do wątku projektu Claude w chmurze.
// Zlecenie zapisuje tylko to kliknięcie (sesja Piotra); mostek na Macu odpala chmurę przy najbliższym pytaniu, chmura bierze krok przez take_cloud_step
export async function runInCloud(taskId: string, stepId: string) {
  const o = await requireOwner();
  const { task, step } = await stepOf(o.id, taskId, stepId);
  if (isProjectStep(step, await projectNameOf(o.id, task)) && (await repo.queueCloud(o.id, stepId))) await repo.addChat(o.id, taskId, "agent", cloudChat(step.title), { stepId });
  refresh(taskId);
}
export async function cancelCloudRun(taskId: string, stepId: string) {
  const o = await requireOwner();
  await stepOf(o.id, taskId, stepId);
  await repo.cancelCloud(o.id, stepId);
  refresh(taskId);
}
// zatwierdzenie szkicu: krok, który coś wysyła, idzie do wysłania (mostek wyśle dokładnie zatwierdzoną treść); inny szkic jest po prostu gotowy
// fd: formularz zatwierdzenia niesie treść z pola z formatowaniem (body), więc zatwierdza się to, co Piotr widzi, także bez wcześniejszego zapisu.
// To jedyna droga do zgody: repo.approveDraft zapisuje podpis tej treści; każda późniejsza zmiana treści zgodę kasuje.
// option: numer opcji z formularza (przy kilku szkicach w kroku każda ma własny przycisk); bez niego szkic kroku = wybrany albo pierwszy
export async function approveStep(taskId: string, stepId: string, fd?: FormData) {
  const o = await requireOwner();
  const { task, step } = await stepOf(o.id, taskId, stepId);
  const body = fd?.get("body");
  const edited = typeof body === "string" ? body : null;
  const opt = fd?.get("option");
  const option = typeof opt === "string" && /^\d+$/.test(opt) ? Number(opt) : undefined;
  const pick = (s: Step): Draft | null => (option != null ? draftsOf(s)[option] ?? null : draftOf(s));
  // podpis szkicu z karty, którą Piotr widział: bez treści, gdy ją poprawił (idzie w formularzu); z treścią, gdy nietknięta (zgoda na bajty agenta)
  const shown = edited !== null ? fd?.get("seen") : fd?.get("seenFull") ?? fd?.get("seen");
  const seen = typeof shown === "string" && shown ? shown : null;
  if (step.status === "done") { refresh(taskId); return; }
  // opcja z karty, której już nie ma (agent przepisał kartkę z mniejszą liczbą opcji, zanim Piotr kliknął): bez zgody i bez zamykania kroku
  if (option != null && draftsOf(step).length && !pick(step)) {
    await repo.addChat(o.id, taskId, "agent", `Nie zatwierdziłem „${shortTitle(step.title, 60)}”: szkic zmienił się, zanim go zatwierdziłeś. Sprawdź go jeszcze raz.`, { stepId });
    refresh(taskId); return;
  }
  // szkic do „pliku” sprzed paczki 7: nic go nie wyśle, plik zapisuje krok „Plik na Macu”
  const d0 = pick(step);
  if (d0 && isLocalFile(d0.target.app)) {
    await repo.addChat(o.id, taskId, "agent", `Nie zatwierdziłem „${shortTitle(step.title, 60)}”: to plik na Macu, nie wysyłka, więc ten szkic nigdzie nie pójdzie. Plik zapisuje krok „Plik na Macu”.`, { stepId });
    refresh(taskId); return;
  }
  // bez zgody: zatwierdzenie kończy krok, a wybrana opcja (przy jednym szkicu on sam) zapisuje się jako wysłana.
  // Te same odmowy co przy zgodzie (opcja obok już wysłanej po przywróceniu kroku, dwie opcje o tej samej treści): krok się nie zamyka, Piotr czyta czemu
  if (!step.needsApproval) {
    const why = approveRefusal(step, { option, body: edited });
    if (why) { await repo.addChat(o.id, taskId, "agent", `Nie zatwierdziłem „${shortTitle(step.title, 60)}”: ${why}.`, { stepId }); refresh(taskId); return; }
    if (edited !== null) await writeDraftBody(stepId, step, edited, option);
    await finishStep(o.id, taskId, stepId, { chosen: option ?? 0 }); refresh(taskId); return;
  }
  // szkic, którego mostek nie wyśle (brak konektora tej aplikacji na Macu, kilka kont, konektor innej firmy): zgoda nic by nie dała, Piotr czyta czemu
  if (d0 && destOf(step)?.kind === "send") {
    const [conns, projects, companies] = await Promise.all([repo.listConnections(o.id), repo.listProjects(o.id), repo.listCompanies(o.id)]);
    const issue = connectorIssue(conns, companies, { app: d0.target.app, connectionId: step.connectionId, companyId: projects.find((p) => p.id === task.projectId)?.companyId ?? null });
    if (issue) {
      await repo.addChat(o.id, taskId, "agent", `Nie zatwierdziłem „${shortTitle(step.title, 60)}”: ${issue}`, { stepId });
      refresh(taskId); return;
    }
  }
  if (await repo.approveDraft(o.id, stepId, { body: edited, seen, option })) {
    // szkic, który nie wychodzi poza Task Hub (krok Piotra, notatka): zgoda go kończy, nie czeka na bieg wysyłki mostka.
    // Commit wysyła aplikacja na Macu, a zatwierdzony prompt dla agenta wykonuje bieg pracy, więc te czekają
    const s = (await repo.getTask(o.id, taskId))?.steps.find((x) => x.id === stepId);
    const d = s ? draftOf(s) : null;
    if (s && d && !isExternalApp(d.target.app) && !isGitDraft(d, s.blocks) && !isPromptDraft(d, s.blocks) && (await repo.markSendStarted(o.id, stepId)))
      await repo.completeSend(o.id, stepId, { summary: "Zatwierdzone; ten szkic nie idzie do żadnej aplikacji zewnętrznej." }, "owner");
  } else {
    // zgody nie ma: agent zmienił szkic, zanim Piotr kliknął (karta pokaże nową wersję), albo inny powód (approveRefusal); jedna notatka, nigdy dwie
    const s = (await repo.getTask(o.id, taskId))?.steps.find((x) => x.id === stepId);
    const d = s ? pick(s) : null;
    if (s && s.status !== "done" && !s.sendStartedAt) {
      const why = seen && d && shownSig(s, d, edited !== null) !== seen ? "szkic zmienił się, zanim go zatwierdziłeś. Sprawdź go jeszcze raz" : approveRefusal(s, { option, body: edited });
      if (why) await repo.addChat(o.id, taskId, "agent", `Nie zatwierdziłem „${shortTitle(s.title, 60)}”: ${why}.`, { stepId });
    }
  }
  refresh(taskId);
}
export async function saveReport(fd: FormData) {
  const o = await requireOwner();
  const taskId = str(fd, "taskId"), stepId = str(fd, "stepId");
  const report = str(fd, "report"); if (!report) return;
  await finishStep(o.id, taskId, stepId, { report, link: url(str(fd, "link")) ?? undefined });
  refresh(taskId);
}
// treść szkicu z pola z formatowaniem (Markdown): poprawia blok draft czekający na decyzję (option = numer opcji; bez niego wybrany albo pierwszy)
// albo, gdy szkicu nie ma, wynik kroku. Poprawka zatwierdzonego szkicu kasuje zgodę (repo), szkic wraca do zatwierdzenia
async function writeDraftBody(stepId: string, step: Step, body: string, option?: number) {
  const ds = draftsOf(step);
  const d = option != null ? ds[option] : draftOf(step);
  if (option != null && ds.length && !d) return;   // nie ma takiej opcji (stary szkic bez bloku ma treść w output: numer z karty go nie blokuje)
  if (d && d.status === "sent") return;
  if (d) { if (d.body !== body) await repo.updateStep(stepId, { blocks: step.blocks!.map((b) => (b === d ? { ...d, body } : b)) }); }
  else if (step.output !== body) await repo.updateStep(stepId, { output: body });
}
// option: numer opcji na karcie (0 przy jednym szkicu); pole z formatowaniem woła z samą treścią
export async function saveDraftBody(taskId: string, stepId: string, option: number, body: string) {
  const o = await requireOwner();
  const { step } = await stepOf(o.id, taskId, stepId);
  if (step.status === "done" || step.status === "handoff") return;   // wysłane albo w wysyłce: treść już nie do zmiany
  await writeDraftBody(stepId, step, body, option);
  refresh(taskId);
}
export async function saveOutput(fd: FormData) {
  const o = await requireOwner();
  const taskId = str(fd, "taskId"), stepId = str(fd, "stepId");
  await stepOf(o.id, taskId, stepId);
  await repo.updateStep(stepId, { output: str(fd, "output") });
  refresh(taskId);
}
// Piotr otworzył krok zmieniony przez agenta: kropka „jeszcze nieotwarte” gaśnie (bez odświeżenia: kanwa chowa ją od razu sama)
// „Zatrzymaj” w dymku pracy: przerywa bieg pracy mostka (token biegu gaśnie, aplikacja na Macu przerywa go przy najbliższym sygnale) i daje mostkowi
// przerwę; bez notatki w rozmowie (rozmowa jest rozmową z agentem). Zwraca tekst toastu
export async function stopWork(taskId: string, runId: string): Promise<string> {
  const o = await requireOwner();
  const until = await repo.stopRun(o.id, runId);
  refresh(taskId);
  return until ? `Zatrzymane. Claude wróci o ${fmtTime(until)} albo od razu, gdy napiszesz.` : "Ta praca już się skończyła.";
}
export async function openedStep(taskId: string, stepId: string) {
  const o = await requireOwner();
  await repo.stepOpened(o.id, taskId, stepId);
}
// zegar karty (useOwnClock): porcja sekund Piotra na jego otwartym kroku; bez odświeżenia widoku, bo porcje idą w tle co kilka minut
export async function addOwnTime(taskId: string, stepId: string, sec: number) {
  const o = await requireOwner();
  const { step } = await stepOf(o.id, taskId, stepId);
  if (!(sec > 0 && sec <= 3600) || !isOwnerStep(step) || step.status === "done") return;
  await repo.addOwnSec(stepId, sec);
}
// „Zrobione” kroku Piotra poza aplikacją: minuty z pytania „Ile to zajęło?” (null = pominięte), potem krok się zamyka;
// result = co wybrał (krok-wybór bez pytania na kartce): idzie do wyniku kroku, a stamtąd do get_task („wynik:”)
export async function doneWithTime(taskId: string, stepId: string, min: number | null, result?: string) {
  const o = await requireOwner();
  await stepOf(o.id, taskId, stepId);
  if (min != null && Number.isFinite(min) && min > 0 && min < 60 * 24) await repo.updateStep(stepId, { spentSec: Math.round(min * 60), spentManual: true });
  const out = typeof result === "string" ? result.trim().slice(0, 2000) : "";
  await finishStep(o.id, taskId, stepId, { by: "owner", ...(out ? { output: out } : {}) });
  refresh(taskId);
}

// ---------- fakty ----------
export async function factPref(taskId: string, factId: string, pref: { pinned?: boolean; hidden?: boolean }) {
  await requireOwner();
  await repo.setFactPreference(factId, pref);
  refresh(taskId);
}

// ---------- zasady ----------
export async function saveRule(fd: FormData) {
  const o = await requireOwner();
  const scope = (["global", "company", "project", "tool"].includes(str(fd, "scope")) ? str(fd, "scope") : "global") as Rule["scope"];
  const kind = (["profile", "rule", "procedure"].includes(str(fd, "kind")) ? str(fd, "kind") : "rule") as Rule["kind"];
  const title = str(fd, "title"), body = str(fd, "body"); if (!title || !body) return;
  const companyId = scope === "company" ? str(fd, "companyId") || null : null; if (scope === "company" && !companyId) return;
  await repo.upsertRule(o.id, { id: str(fd, "id") || undefined, kind, scope, title, body, companyId, projectId: scope === "project" ? str(fd, "projectId") || null : null, tool: scope === "tool" ? str(fd, "tool") || null : null, originCompanyId: str(fd, "originCompanyId") || null, summary: kind === "procedure" ? str(fd, "summary") || null : null, trigger: kind === "procedure" ? str(fd, "trigger") || null : null, visibility: (str(fd, "visibility") || "private") as Rule["visibility"] });
  revalidatePath("/rules");
}
export async function removeRule(id: string) {
  const o = await requireOwner();
  await repo.deleteRule(o.id, id);
  revalidatePath("/rules");
}

// ---------- projekty, ustawienia, tokeny ----------
// projekty: widok „Projekty” w menu (nazwa, kolor, ważność, język); ta sama nazwa = ten sam projekt, bez duplikatów
export async function createProjectAction(name: string): Promise<string> {
  const o = await requireOwner();
  const n = name.trim().slice(0, 60); if (!n) throw new Error("Podaj nazwę projektu");
  const existing = await repo.findProjectByName(o.id, n);
  const p = existing ?? (await repo.createProject(o.id, n, 3));
  refresh();
  return p.id;
}
export async function updateProjectAction(id: string, patch: { name?: string; weight?: number; language?: string; color?: number; companyId?: string | null }) {
  const o = await requireOwner();
  const p: typeof patch = {};
  if (patch.companyId !== undefined) p.companyId = patch.companyId || null;
  if (patch.name !== undefined) { const n = patch.name.trim().slice(0, 60); if (n) p.name = n; }
  if (patch.weight !== undefined) p.weight = Math.min(5, Math.max(1, Math.round(patch.weight)));
  if (patch.language !== undefined) p.language = patch.language.trim().slice(0, 8) || "pl";
  if (patch.color !== undefined) p.color = Math.max(0, Math.round(patch.color)) % 8;
  await repo.updateProject(o.id, id, p);
  refresh();
}
export async function removeProject(id: string) {
  const o = await requireOwner();
  await repo.deleteProject(o.id, id);   // zadania zostają, tracą tylko etykietę
  refresh();
}

// ---------- firmy ----------
// firma stoi nad projektami: jej sfera (zawodowa / prywatna) przechodzi na projekty; projekt bez firmy jest prywatny
export async function createCompanyAction(name: string, sphere: Sphere = "work"): Promise<string> {
  const o = await requireOwner();
  const n = name.trim().slice(0, 60); if (!n) throw new Error("Podaj nazwę firmy");
  const c = (await repo.findCompanyByName(o.id, n)) ?? (await repo.createCompany(o.id, n, sphere));
  refresh(); revalidatePath("/rules");
  return c.id;
}
export async function updateCompanyAction(id: string, patch: { name?: string; sphere?: Sphere; note?: string | null; ended?: boolean }) {
  const o = await requireOwner();
  const p: Parameters<typeof repo.updateCompany>[2] = {};
  if (patch.name !== undefined) { const n = patch.name.trim().slice(0, 60); if (n) p.name = n; }
  if (patch.sphere !== undefined) p.sphere = patch.sphere === "private" ? "private" : "work";
  if (patch.note !== undefined) p.note = patch.note?.trim() || null;
  if (patch.ended !== undefined) p.endedAt = patch.ended ? new Date().toISOString() : null;
  await repo.updateCompany(o.id, id, p);
  refresh(); revalidatePath("/rules");
}
export async function removeCompany(id: string) {
  const o = await requireOwner();
  await repo.deleteCompany(o.id, id);   // projekty zostają (stają się prywatne), zasady firmy znikają
  refresh(); revalidatePath("/rules");
}
// ---------- połączenia ----------
// rejestr mówi, do czego agent ma dostęp i przez co; wpisy mostka odświeża sam mostek, ręczne opisują resztę (Claude w chmurze, kalendarze)
export type ConnectionPatch = Partial<Pick<Connection, "app" | "label" | "account" | "companyId" | "sphere" | "provider" | "kind" | "state" | "url">>;
export async function createConnectionAction(input: ConnectionPatch & { label: string }): Promise<string> {
  const o = await requireOwner();
  const label = input.label.trim().slice(0, 80); if (!label) throw new Error("Podaj nazwę połączenia");
  const c = await repo.createConnection(o.id, { ...input, label, url: input.url ? url(input.url) ?? null : null });
  revalidatePath("/settings"); refresh();
  return c.id;
}
export async function updateConnectionAction(id: string, patch: ConnectionPatch) {
  const o = await requireOwner();
  const p: Partial<repo.ConnectionInput> = { ...patch };
  if (patch.label !== undefined) { const l = patch.label.trim().slice(0, 80); if (l) p.label = l; else delete p.label; }
  if (patch.url !== undefined) p.url = patch.url ? url(patch.url) ?? null : null;
  await repo.updateConnection(o.id, id, p);
  revalidatePath("/settings"); refresh();
}
export async function removeConnection(id: string) {
  const o = await requireOwner();
  await repo.deleteConnection(o.id, id);   // kroki zostają, tracą tylko wskazanie połączenia
  revalidatePath("/settings"); refresh();
}
export async function saveSettings(fd: FormData) {
  const o = await requireOwner();
  const p = str(fd, "aiProvider");
  await repo.setUserSettings(o.id, { aiProvider: p === "anthropic" || p === "openai" ? p : null });
  revalidatePath("/settings");
}
// dobór modelu: jeden poziom (model, wysiłek, zapasowy); całość przechodzi przez modelConfig, więc zły wpis niczego nie psuje
export async function saveModelLevel(level: string, patch: { model?: string; effort?: string; fallback?: string }) {
  const o = await requireOwner();
  const lvl = normalizeLevel(level);
  const cfg = modelConfig(o.settings);
  if (!lvl || !cfg) return;
  const cur = cfg.levels[lvl];
  const next = { ...cur, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) } as typeof cur;
  if (next.fallback === next.model) next.fallback = "";
  const models = { choices: cfg.choices, levels: { ...cfg.levels, [lvl]: next } };
  if (!modelConfig({ models })) return;
  await repo.setUserSettings(o.id, { models });
  revalidatePath("/settings");
}
export type TokenState = { token?: string; error?: string };
export async function createToken(_prev: TokenState, fd: FormData): Promise<TokenState> {
  const o = await requireOwner();
  const name = str(fd, "name") || "klient MCP";
  try { const token = await repo.createApiToken(o.id, name); revalidatePath("/settings"); return { token }; }
  catch (e) { return { error: fail(e) }; }
}
// token mostka: program na komputerze Piotra odpytuje Task Hub i uruchamia Claude Code do pracy
export async function createBridgeToken(_prev: TokenState, fd: FormData): Promise<TokenState> {
  const o = await requireOwner();
  const name = str(fd, "name") || "Mostek";
  try { const token = await repo.createApiToken(o.id, name, "bridge"); revalidatePath("/settings"); return { token }; }
  catch (e) { return { error: fail(e) }; }
}
export async function revokeToken(id: string) {
  const o = await requireOwner();
  await repo.deleteApiToken(o.id, id);
  revalidatePath("/settings");
}

// ---------- kanwa: położenia, grupy, zaznaczenie ----------
export async function saveTaskPositions(items: { id: string; x: number; y: number }[]) {
  const o = await requireOwner();
  await repo.setTaskPositions(o.id, items.slice(0, 500));
  refresh();   // kanwa trzyma upuszczony kafelek w miejscu, aż dostanie zapisane położenie
}
export async function saveStepPositions(taskId: string, items: { id: string; x: number; y: number }[]) {
  const o = await requireOwner();
  await repo.setStepPositions(o.id, taskId, items.slice(0, 200));
  refresh(taskId);
}
export async function autoLayout(taskId: string | null) {
  const o = await requireOwner();
  if (taskId) await repo.clearStepPositions(o.id, taskId); else await repo.clearTaskPositions(o.id);
  for (const g of await repo.listGroups(o.id, taskId)) await repo.updateGroup(o.id, g.id, { auto: true });
  refresh(taskId);
}
// „Cofnij” po „Ułóż”: przywraca zapamiętane położenia kafelków i prostokąty grup (łącznie z tym, czy grupa była automatyczna)
export async function restoreLayout(taskId: string | null, items: { id: string; x: number; y: number }[], groups: { id: string; x: number; y: number; w: number; h: number; auto: boolean }[]) {
  const o = await requireOwner();
  if (taskId) await repo.setStepPositions(o.id, taskId, items.slice(0, 200)); else await repo.setTaskPositions(o.id, items.slice(0, 500));
  for (const g of groups.slice(0, 100)) await repo.updateGroup(o.id, g.id, { x: Math.round(g.x), y: Math.round(g.y), w: Math.round(g.w), h: Math.round(g.h), auto: g.auto });
  refresh(taskId);
}
export async function createGroupAction(taskId: string | null, name: string, members: string[], rect: { x: number; y: number; w: number; h: number }) {
  const o = await requireOwner();
  const g = await repo.createGroup(o.id, taskId, name || "Nowa grupa", members, rect);
  refresh(taskId);
  return g.id;
}
export async function updateGroupAction(taskId: string | null, id: string, patch: { name?: string; color?: number; x?: number; y?: number; w?: number; h?: number; members?: string[]; auto?: boolean }) {
  const o = await requireOwner();
  await repo.updateGroup(o.id, id, patch);
  refresh(taskId);
}
export async function deleteGroupAction(taskId: string | null, id: string) {
  const o = await requireOwner();
  await repo.deleteGroup(o.id, id);
  refresh(taskId);
}
export async function batchTasks(ids: string[], op: { level?: number; projectId?: string | null; done?: boolean; trash?: boolean }) {
  const o = await requireOwner();
  for (const id of ids.slice(0, 200)) {
    const t = await repo.getTask(o.id, id); if (!t) continue;
    if (op.level) await repo.updateTask(o.id, id, { level: Math.min(5, Math.max(1, op.level)) });
    if (op.projectId !== undefined) await repo.updateTask(o.id, id, { projectId: op.projectId });
    if (op.trash) await repo.updateTask(o.id, id, { deletedAt: new Date().toISOString() });
    if (op.done) for (const s of t.steps) if (s.status !== "done") await finishStep(o.id, id, s.id);
    // „Wróć do pracy”: ostatni zrobiony krok wraca do poprzedniego stanu, zadanie przestaje być ukończone
    if (op.done === false) { const last = [...t.steps].reverse().find((s) => s.status === "done"); if (last) await repo.reopenStep(o.id, id, last); }
  }
  refresh();
}
export async function batchSteps(taskId: string, ids: string[], op: { done?: boolean; remove?: boolean }) {
  const o = await requireOwner();
  const t = await repo.getTask(o.id, taskId); if (!t) return;
  for (const id of ids) {
    const s = t.steps.find((x) => x.id === id); if (!s) continue;
    if (op.remove) await repo.deleteStep(id);
    else if (op.done && s.status !== "done") await finishStep(o.id, taskId, id);
    else if (op.done === false && s.status === "done") await repo.reopenStep(o.id, taskId, s);
  }
  refresh(taskId);
}
// historia rozmowy (dok → ikona zegara): strona po 50 wpisów, od najstarszego; before = kursor na starsze.
// Wiadomość Piotra niesie swój stan (wzięta, odpowiedziano), odpowiedź agenta listę wiadomości, które załatwia; queue = stan kolejki zadania (null, gdy nic nie czeka)
const CHAT_PAGE = 50;
export type ChatVM = { id: string; role: "user" | "agent"; text: string; createdAt: string; seenAt: string | null; answeredAt: string | null; answers: string[] | null; stepId: string | null; link: string | null };
export async function loadChat(taskId: string | null, before: string | null): Promise<{ msgs: ChatVM[]; queue: Queue | null }> {
  const o = await requireOwner();
  const [rows, queue] = await Promise.all([repo.listChat(o.id, taskId, CHAT_PAGE, before), taskId ? taskQueue(o.id, taskId) : Promise.resolve(null)]);
  const msgs = rows.map((m) => {
    const a = (m.actions ?? null) as { answers?: string[]; stepId?: string; link?: string } | null;
    return { id: m.id, role: m.role, text: m.text, createdAt: m.createdAt, seenAt: m.seenAt, answeredAt: m.answeredAt, answers: a?.answers ?? null, stepId: a?.stepId ?? null, link: a?.link ?? null };
  });
  return { msgs, queue };
}
export async function setTaskField(taskId: string, patch: { due?: string | null; level?: number; projectId?: string | null }) {
  const o = await requireOwner();
  await repo.updateTask(o.id, taskId, { ...patch, level: patch.level ? Math.min(5, Math.max(1, patch.level)) : undefined });
  refresh(taskId);
}
// pojedyncze pola z panelu zadania (kontrolki wywołują je bez formularza)
export async function setLevel(taskId: string, level: number) { await setTaskField(taskId, { level }); }
export async function setProject(taskId: string, projectId: string | null) { await setTaskField(taskId, { projectId }); }
export async function setDue(taskId: string, due: string | null) { await setTaskField(taskId, { due }); }
export async function setStepLink(taskId: string, stepId: string, link: string) {
  const o = await requireOwner();
  await stepOf(o.id, taskId, stepId);
  await repo.updateStep(stepId, { link: link ? url(link) : null });
  refresh(taskId);
}

// ---------- pytania agenta zadane w aplikacji ----------
export async function answerQuestionAction(taskId: string, questionId: string, answer: string) {
  const o = await requireOwner();
  if (!answer.trim()) return;
  await repo.answerQuestion(o.id, questionId, answer.trim());
  refresh(taskId);
}
export async function answerQuestionForm(fd: FormData) {
  const taskId = str(fd, "taskId"), id = str(fd, "questionId"), answer = str(fd, "answer") || str(fd, "option");
  await answerQuestionAction(taskId, id, answer);
}
export async function dismissQuestion(taskId: string, questionId: string) {
  const o = await requireOwner();
  await repo.deleteQuestion(o.id, questionId);
  refresh(taskId);
}
// odpowiedź na pytanie z kartki. Krok-decyzja Piotra (jego krok z pytaniem) zamyka się ostatnią odpowiedzią; wiadomość w rozmowie idzie przed
// zamknięciem, żeby zadanie nie skończyło się, zanim agent zastosuje decyzję w krokach, które od niej zależą (odpowiada reply_chat)
export async function answerBlockForm(fd: FormData) {
  const o = await requireOwner();
  const taskId = str(fd, "taskId"), stepId = str(fd, "stepId");
  const { task, step } = await stepOf(o.id, taskId, stepId);
  const answer = str(fd, "answer") || str(fd, "option"); if (!answer) return;
  const index = num(fd, "index", 0), qText = str(fd, "q") || undefined;
  // poprzednia odpowiedź (po „Zmień odpowiedź”) do wiadomości o zmianie; to samo pytanie, które dostanie odpowiedź
  const at = step.blocks?.[index];
  const before = at?.type === "question" && (!qText || at.text === qText) ? at : step.blocks?.find((b) => b.type === "question" && b.text === qText);
  const prev = before?.type === "question" ? before.prev : undefined;
  const q = await repo.answerBlockQuestion(stepId, index, answer, qText);
  if (!q) { refresh(taskId); return; }
  const s = (await repo.getTask(o.id, taskId))?.steps.find((x) => x.id === stepId);
  const closes = !!s && s.status !== "done" && stepKind(s) === "decision" && !openQuestions(s).length;
  const title = shortTitle(step.title, 60);
  // kartka żyje, dopóki krok nie jest zrobiony: odpowiedź idzie do agenta jak wiadomość przy kroku, a on poprawia kartkę albo mówi, czemu nie
  const msg = !closes ? `Odpowiedź na pytanie z kartki „${q}”: ${answer}`
    : prev && prev !== answer ? `Zmieniam decyzję w kroku „${title}”: ${answer} (wcześniej: ${prev}). Pytanie z kartki: „${q}”.`
    : `Decyzja w kroku „${title}”: ${answer}. Pytanie z kartki: „${q}”.`;
  await repo.addChat(o.id, taskId, "user", msg, { stepId });
  if (closes && s) {
    await finishStep(o.id, taskId, stepId, { output: decisionText(s), by: "owner" });
    // kroki „Przeczytaj …”, na które decyzja czekała: przeczytane, skoro decyzja zapadła
    for (const d of task.steps) if (s.dependsOn.includes(d.id) && d.status !== "done" && stepKind(d) === "reading") await finishStep(o.id, taskId, d.id, { by: "owner" });
  }
  refresh(taskId);
}
export async function restoreBlocksForm(fd: FormData) {
  const o = await requireOwner();
  const taskId = str(fd, "taskId"), stepId = str(fd, "stepId");
  await stepOf(o.id, taskId, stepId);
  await repo.restorePrevBlocks(stepId);
  refresh(taskId);
}

// ---------- zależności z kanwy (strzałki) ----------
export async function linkTasks(from: string, to: string, add: boolean) {
  const o = await requireOwner();
  const t = await repo.getTask(o.id, to); if (!t || from === to) return;
  const deps = new Set(t.dependsOn); if (add) deps.add(from); else deps.delete(from);
  await repo.setTaskDependencies(to, [...deps]);
  refresh();
}
export async function linkSteps(taskId: string, from: string, to: string, add: boolean) {
  const o = await requireOwner();
  const t = await repo.getTask(o.id, taskId); if (!t || from === to) return;
  const s = t.steps.find((x) => x.id === to); if (!s || !t.steps.find((x) => x.id === from)) return;
  const deps = new Set(s.dependsOn); if (add) deps.add(from); else deps.delete(from);
  await repo.setStepDependencies(to, [...deps]);
  refresh(taskId);
}
