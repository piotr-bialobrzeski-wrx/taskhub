"use server";
// Akcje serwera dla widoków. Każda sprawdza zalogowanego właściciela; agent nigdy nie usuwa, człowiek może.
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, checkPassword, sessionValue } from "@/lib/auth";
import { requireOwner } from "@/lib/session";
import { client, hhmm, mayTry, record } from "@/lib/guard";
import * as repo from "@/lib/repo";
import { aiFor, composeFlow, finishStep, prepareStep, taskQueue } from "@/lib/services";
import { Q, roundQ } from "@/lib/time";
import { runChat } from "@/lib/agent/chat";
import { bridgeHold, busyWith, newTaskText, noStepsWho, shortTitle, type Queue, type Worker } from "@/lib/auto";
import { liveActivity } from "@/lib/live";
import { BRIDGE_ALIVE_MS, isGitDraft } from "@/lib/bridge";
import { draftOf, isExternalApp, isLocalFile, isPromptDraft, shownSig } from "@/lib/agent/approval";
import type { Connection, Rule, Sphere, Step } from "@/lib/schema";

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
const MAX_UPLOAD = 4 * 1024 * 1024;   // limit treści żądania na Vercelu
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
// pliki z doku (z dysku, Ctrl+V, przeciągnięte): do 8 sztuk, każdy do 4 MB
function uploads(fd: FormData): File[] {
  return fd.getAll("files").filter((f): f is File => typeof f === "object" && f !== null && "arrayBuffer" in f && (f as File).size > 0 && (f as File).size <= MAX_UPLOAD).slice(0, 8);
}
async function attachFiles(taskId: string, files: File[], notes: { caption: string; analysis: string }[] = []) {
  for (const [i, f] of files.entries()) {
    const data = Buffer.from(await f.arrayBuffer());
    // obrazkiem jest tylko to, co /api/files pokazuje w przeglądarce (SVG i reszta idą jako plik do pobrania)
    await repo.addAttachment({ taskId }, { kind: IMAGE_TYPES.has(f.type) && !/\.svg$/i.test(f.name) ? "image" : "file", name: f.name, mime: f.type || undefined, bytes: f.size, keep: true, data, caption: notes[i]?.caption, analysis: notes[i]?.analysis });
  }
}

export async function chat(fd: FormData) {
  const o = await requireOwner();
  const files = uploads(fd);
  const typed = str(fd, "text");
  if (!typed && !files.length) return;
  const text = typed || (files.length === 1 ? `Załącznik: ${files[0].name}` : `Załączniki: ${files.map((f) => f.name).join(", ")}`);
  const taskId = str(fd, "taskId") || null;
  const stepId = (taskId && str(fd, "stepId")) || null;   // otwarty krok w panelu: domyślny kontekst wiadomości
  const ai = await aiFor(o.id);
  let goTo: string | null = null;
  if (!ai.enabled) {
    // bez klucza modelu: na kanwie tekst staje się zadaniem, w zadaniu zostaje jako notatka rozmowy; pliki trafiają do zadania
    await repo.addChat(o.id, taskId, "user", text + (typed && files.length ? ` (załączniki: ${files.map((f) => f.name).join(", ")})` : ""), stepId ? { stepId } : undefined);
    // komunikaty mówią, co z tego ma Piotr, nie jak działa mechanizm
    // w zadaniu wiadomość czeka w kolejce: jej stan (kto ją weźmie i kiedy, w pracy, odpowiedziano) liczy się na bieżąco pod dymkiem i na karcie nad dokiem,
    // bez dopisywania do rozmowy zapowiedzi „przeczyta za chwilę” przy każdej wiadomości
    if (taskId) { await attachFiles(taskId, files); }
    else {
      // nowe zadanie z kanwy: kto je rozpisze i kiedy (mostek teraz / po bieżącej pracy / w ciągu minuty, albo automat o pełnej godzinie)
      const t = await repo.createTask(o.id, { title: text.slice(0, 120), source: typed }); await attachFiles(t.id, files);
      const [st, tasks] = await Promise.all([repo.bridgeStatus(o.id, BRIDGE_ALIVE_MS), repo.listTasks(o.id)]);
      const w: Worker = { alive: st.alive, name: st.name, run: liveActivity(st.run), hold: bridgeHold(st.meta) };
      await repo.addChat(o.id, null, "agent", newTaskText(t.title, noStepsWho(w, t.id, busyWith(w.run, tasks)))); goTo = t.id;
    }
  } else {
    try {
      const images = await Promise.all(files.filter((f) => IMAGE_TYPES.has(f.type)).map(async (f) => ({ mediaType: f.type as "image/png", base64: Buffer.from(await f.arrayBuffer()).toString("base64") })));
      const { done, result } = await runChat(text, { ai, ownerId: o.id, taskId, stepId, images });
      const created = done.find((d) => d.taskId && d.label.startsWith("Nowe zadanie"));
      if (!taskId && created?.taskId) goTo = created.taskId;
      const target = taskId ?? created?.taskId ?? null;
      if (target) await attachFiles(target, files, result.attachments ?? []);
    } catch (e) {
      await repo.addChat(o.id, taskId, "user", text);
      await repo.addChat(o.id, taskId, "agent", "Agent nie odpowiedział: " + fail(e));
    }
  }
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
export async function patchStep(taskId: string, stepId: string, patch: { title?: string; detail?: string; tool?: string; estMin?: number; spentMin?: number; link?: string; needsApproval?: boolean; connectionId?: string | null }) {
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
export async function handoff(taskId: string, stepId: string) {
  const o = await requireOwner();
  const { step } = await stepOf(o.id, taskId, stepId);
  if (step.status === "todo") await repo.updateStep(stepId, { status: "handoff", prevStatus: "todo", handoffAt: new Date().toISOString() });
  refresh(taskId);
}
// zatwierdzenie szkicu: krok, który coś wysyła, idzie do wysłania (mostek wyśle dokładnie zatwierdzoną treść); inny szkic jest po prostu gotowy
// fd: formularz zatwierdzenia niesie treść z pola z formatowaniem (body), więc zatwierdza się to, co Piotr widzi, także bez wcześniejszego zapisu.
// To jedyna droga do zgody: repo.approveDraft zapisuje podpis tej treści; każda późniejsza zmiana treści zgodę kasuje.
export async function approveStep(taskId: string, stepId: string, fd?: FormData) {
  const o = await requireOwner();
  const { step } = await stepOf(o.id, taskId, stepId);
  const body = fd?.get("body");
  const edited = typeof body === "string" ? body : null;
  // podpis szkicu z karty, którą Piotr widział: bez treści, gdy ją poprawił (idzie w formularzu); z treścią, gdy nietknięta (zgoda na bajty agenta)
  const shown = edited !== null ? fd?.get("seen") : fd?.get("seenFull") ?? fd?.get("seen");
  const seen = typeof shown === "string" && shown ? shown : null;
  if (step.status === "done") { refresh(taskId); return; }
  // szkic do „pliku” sprzed paczki 7: nic go nie wyśle, plik zapisuje krok „Plik na Macu”
  const d0 = draftOf(step);
  if (d0 && isLocalFile(d0.target.app)) {
    await repo.addChat(o.id, taskId, "agent", `Nie zatwierdziłem „${shortTitle(step.title, 60)}”: to plik na Macu, nie wysyłka, więc ten szkic nigdzie nie pójdzie. Plik zapisuje krok „Plik na Macu”.`, { stepId });
    refresh(taskId); return;
  }
  if (!step.needsApproval) {
    if (edited !== null) await writeDraftBody(stepId, step, edited);
    await finishStep(o.id, taskId, stepId); refresh(taskId); return;
  }
  if (await repo.approveDraft(o.id, stepId, { body: edited, seen })) {
    // szkic, który nie wychodzi poza Task Hub (krok Piotra, notatka): zgoda go kończy, nie czeka na bieg wysyłki mostka.
    // Commit wysyła aplikacja na Macu, a zatwierdzony prompt dla agenta wykonuje bieg pracy, więc te czekają
    const s = (await repo.getTask(o.id, taskId))?.steps.find((x) => x.id === stepId);
    const d = s ? draftOf(s) : null;
    if (s && d && !isExternalApp(d.target.app) && !isGitDraft(d, s.blocks) && !isPromptDraft(d, s.blocks) && (await repo.markSendStarted(o.id, stepId)))
      await repo.completeSend(o.id, stepId, { summary: "Zatwierdzone; ten szkic nie idzie do żadnej aplikacji zewnętrznej." });
  } else if (seen) {
    // agent zmienił szkic, zanim Piotr kliknął: zgody nie ma, karta pokaże nową wersję
    const s = (await repo.getTask(o.id, taskId))?.steps.find((x) => x.id === stepId);
    const d = s ? draftOf(s) : null;
    if (s && d && s.status !== "done" && !s.sendStartedAt && shownSig(s, d, edited !== null) !== seen)
      await repo.addChat(o.id, taskId, "agent", `Nie zatwierdziłem „${shortTitle(s.title, 60)}”: szkic zmienił się, zanim go zatwierdziłeś. Sprawdź go jeszcze raz.`, { stepId });
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
// treść szkicu z pola z formatowaniem (Markdown): poprawia blok draft czekający na decyzję albo, gdy szkicu nie ma, wynik kroku.
// Poprawka zatwierdzonego szkicu kasuje zgodę (repo), szkic wraca do zatwierdzenia
async function writeDraftBody(stepId: string, step: Step, body: string) {
  const d = step.blocks?.find((b) => b.type === "draft");
  if (d && d.status === "sent") return;
  if (d) { if (d.body !== body) await repo.updateStep(stepId, { blocks: step.blocks!.map((b) => (b === d ? { ...d, body } : b)) }); }
  else if (step.output !== body) await repo.updateStep(stepId, { output: body });
}
export async function saveDraftBody(taskId: string, stepId: string, body: string) {
  const o = await requireOwner();
  const { step } = await stepOf(o.id, taskId, stepId);
  if (step.status === "done" || step.status === "handoff") return;   // wysłane albo w wysyłce: treść już nie do zmiany
  await writeDraftBody(stepId, step, body);
  refresh(taskId);
}
export async function saveOutput(fd: FormData) {
  const o = await requireOwner();
  const taskId = str(fd, "taskId"), stepId = str(fd, "stepId");
  await stepOf(o.id, taskId, stepId);
  await repo.updateStep(stepId, { output: str(fd, "output") });
  refresh(taskId);
}
export async function addSpent(taskId: string, stepId: string, sec: number) {
  const o = await requireOwner();
  const { step } = await stepOf(o.id, taskId, stepId);
  if (sec > 0 && sec < 60 * 60 * 24) await repo.updateStep(stepId, { spentSec: step.spentSec + Math.round(sec) });
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
export async function answerBlockForm(fd: FormData) {
  const o = await requireOwner();
  const taskId = str(fd, "taskId"), stepId = str(fd, "stepId");
  await stepOf(o.id, taskId, stepId);
  const answer = str(fd, "answer") || str(fd, "option"); if (!answer) return;
  const q = await repo.answerBlockQuestion(stepId, num(fd, "index", 0), answer);
  // kartka żyje, dopóki krok nie jest zrobiony: odpowiedź idzie do agenta jak wiadomość przy kroku, a on poprawia kartkę albo mówi, czemu nie
  if (q) await repo.addChat(o.id, taskId, "user", `Odpowiedź na pytanie z kartki „${q}”: ${answer}`, { stepId });
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
