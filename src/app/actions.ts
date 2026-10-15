"use server";
// Akcje serwera dla widoków. Każda sprawdza zalogowanego właściciela; agent nigdy nie usuwa, człowiek może.
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, checkPassword, sessionValue } from "@/lib/auth";
import { requireOwner } from "@/lib/session";
import * as repo from "@/lib/repo";
import { aiFor, composeFlow, finishStep, prepareStep } from "@/lib/services";
import { runChat } from "@/lib/agent/chat";
import type { Rule } from "@/lib/schema";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const num = (fd: FormData, k: string, def: number) => { const v = Number(str(fd, k)); return Number.isFinite(v) && str(fd, k) !== "" ? v : def; };
const url = (s: string) => (/^https?:\/\//.test(s) ? s : s ? null : null);
const fail = (e: unknown) => (e instanceof Error ? e.message : String(e));

function refresh(taskId?: string | null) {
  revalidatePath("/");
  if (taskId) revalidatePath(`/tasks/${taskId}`);
}

// ---------- logowanie ----------
export async function login(fd: FormData) {
  if (!checkPassword(str(fd, "password"))) redirect("/login?e=1");
  (await cookies()).set(SESSION_COOKIE, sessionValue(), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 90 });
  redirect("/");
}
export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}

// ---------- czat z agentem ----------
export async function chat(fd: FormData) {
  const o = await requireOwner();
  const text = str(fd, "text"); if (!text) return;
  const taskId = str(fd, "taskId") || null;
  const ai = await aiFor(o.id);
  let goTo: string | null = null;
  if (!ai.enabled) {
    // bez klucza modelu: na kanwie tekst staje się zadaniem, w zadaniu zostaje jako notatka rozmowy
    await repo.addChat(o.id, taskId, "user", text);
    if (taskId) await repo.addChat(o.id, taskId, "agent", "Brak klucza modelu (ANTHROPIC_API_KEY albo OPENAI_API_KEY), zapisałem wiadomość bez działań.");
    else { const t = await repo.createTask(o.id, { title: text.slice(0, 120), source: text }); await repo.addChat(o.id, null, "agent", "Brak klucza modelu, założyłem zadanie z Twojego tekstu."); goTo = t.id; }
  } else {
    try {
      const { done } = await runChat(text, { ai, ownerId: o.id, taskId });
      const created = done.find((d) => d.taskId && d.label.startsWith("Nowe zadanie"));
      if (!taskId && created?.taskId) goTo = created.taskId;
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
  await repo.addSteps(taskId, [{ title, detail: str(fd, "detail"), tool: str(fd, "tool") || "manual", estMin: num(fd, "est", 15), needsApproval: fd.get("needsApproval") === "on", link: url(str(fd, "link")) ?? undefined, dependsOn: after ? [after] : [] }]);
  refresh(taskId);
}
export async function updateStepForm(fd: FormData) {
  const o = await requireOwner();
  const taskId = str(fd, "taskId"), stepId = str(fd, "stepId");
  const { step } = await stepOf(o.id, taskId, stepId);
  const spentMinutes = num(fd, "spentMin", -1);
  await repo.updateStep(stepId, {
    title: str(fd, "title") || undefined, detail: str(fd, "detail"), tool: str(fd, "tool") || step.tool,
    estMin: Math.max(15, Math.round(num(fd, "est", step.estMin) / 15) * 15), needsApproval: fd.get("needsApproval") === "on",
    link: str(fd, "link") ? url(str(fd, "link")) : null,
    ...(spentMinutes >= 0 && spentMinutes * 60 !== step.spentSec ? { spentSec: Math.round(spentMinutes * 60), spentManual: true } : {}),
  });
  const after = str(fd, "after");
  if (after !== "-") await repo.setStepDependencies(stepId, after ? [after] : []);
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
export async function handoff(taskId: string, stepId: string) {
  const o = await requireOwner();
  const { step } = await stepOf(o.id, taskId, stepId);
  await repo.updateStep(stepId, { status: "handoff", prevStatus: step.status, handoffAt: new Date().toISOString() });
  refresh(taskId);
}
export async function saveReport(fd: FormData) {
  const o = await requireOwner();
  const taskId = str(fd, "taskId"), stepId = str(fd, "stepId");
  const report = str(fd, "report"); if (!report) return;
  await finishStep(o.id, taskId, stepId, { report, link: url(str(fd, "link")) ?? undefined });
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
  const scope = (str(fd, "scope") || "global") as Rule["scope"];
  const title = str(fd, "title"), body = str(fd, "body"); if (!title || !body) return;
  await repo.upsertRule(o.id, { id: str(fd, "id") || undefined, scope, title, body, projectId: scope === "project" ? str(fd, "projectId") || null : null, tool: scope === "tool" ? str(fd, "tool") || null : null, visibility: (str(fd, "visibility") || "private") as Rule["visibility"] });
  revalidatePath("/rules");
}
export async function removeRule(id: string) {
  const o = await requireOwner();
  await repo.deleteRule(o.id, id);
  revalidatePath("/rules");
}

// ---------- projekty, ustawienia, tokeny ----------
export async function saveProject(fd: FormData) {
  const o = await requireOwner();
  const id = str(fd, "id"), name = str(fd, "name"); if (!name) return;
  const weight = Math.min(5, Math.max(1, num(fd, "weight", 3)));
  const language = str(fd, "language") || "pl";
  if (id) await repo.updateProject(o.id, id, { name, weight, language });
  else {
    const existing = await repo.findProjectByName(o.id, name);   // ta sama nazwa = ten sam projekt, bez duplikatów
    if (existing) await repo.updateProject(o.id, existing.id, { weight, language });
    else { const p = await repo.createProject(o.id, name, weight); await repo.updateProject(o.id, p.id, { language }); }
  }
  revalidatePath("/settings"); refresh();
}
export async function removeProject(id: string) {
  const o = await requireOwner();
  await repo.deleteProject(o.id, id);
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
export async function revokeToken(id: string) {
  const o = await requireOwner();
  await repo.deleteApiToken(o.id, id);
  revalidatePath("/settings");
}
