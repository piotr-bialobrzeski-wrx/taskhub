// Początek biegu: mostek bierze pracę na wyłączność (jeden otwarty bieg na właściciela) i dostaje prompt oraz adres konektora.
// v1 (bez v): jak dotąd, Claude Code pracuje tokenem mostka i sam wysyła zatwierdzone szkice.
// v2: kind "work" = bieg pracy z krótkim tokenem biegu (bez wysyłek); kind "send" = jeden zatwierdzony szkic: commit robi aplikacja
// na Macu (git), a wiadomość wysyła Claude Code tylko konektorem docelowej aplikacji (servers) z tokenem, który zna ten jeden krok.
import * as repo from "@/lib/repo";
import { listSendable, type Sendable } from "@/lib/agent/work";
import type { RunModel } from "@/lib/repo";
import { isExternalApp, isLocalFile } from "@/lib/agent/approval";
import { RUN_MAX_MIN, RUN_STALE_MIN, SEND_MAX_MIN, authBridge, bridgePrompt, bridgeWorkPrompt, connectorProblem, gitSend, isGitDraft, mcpUrl, protocolOf, sendPrompt, sendServers, type BridgeAuth } from "@/lib/bridge";
import { normalizeTool, toolLabel } from "@/lib/schema";
import { shortTitle } from "@/lib/auto";
import { workSummary } from "@/lib/agent/work";
import { activeLimits, choiceOf, modelConfig, modelLabel, pickRun, runLabel, type RunPick } from "@/lib/agent/models";
import { fmtTime } from "@/lib/clock";

export const dynamic = "force-dynamic";
const NO_STORE = { "cache-control": "no-store" };

async function busy(ownerId: string, run?: repo.BridgeRun | null) {
  return Response.json({ busy: true, run: run ?? (await repo.bridgeStatus(ownerId, 0)).run }, { status: 409 });
}

export async function POST(req: Request) {
  const a = await authBridge(req);
  if (a instanceof Response) return a;
  const body = (await req.json().catch(() => ({}))) as { bridge?: string; v?: number | string; kind?: string };
  const bridge = String(body.bridge || a.name || "mostek");
  await repo.expireBridgeRuns(a.ownerId, RUN_STALE_MIN);
  if (protocolOf(body.v) < 2) {
    const run = await repo.startBridgeRun(a.ownerId, a.tokenId, bridge);
    if (!run) return busy(a.ownerId);
    return Response.json({ run, prompt: bridgePrompt(), mcp: mcpUrl(), maxMinutes: RUN_MAX_MIN, staleMinutes: RUN_STALE_MIN });
  }
  const kind = body.kind ?? "work";
  if (kind === "send") return sendRun(a, bridge);
  if (kind !== "work") return Response.json({ error: "kind: work albo send" }, { status: 400 });
  // dobór modelu: grupa pierwszej pozycji listy pracy, której model (albo zapasowy) nie jest w limicie; wszystkie w limicie = 429 z godziną powrotu
  const settings = await repo.userSettings(a.ownerId);
  const w = await workSummary(a.ownerId, { peek: true, audience: "work" });
  const pick = pickRun(w.choices ?? [], activeLimits(settings.modelLimits));
  if (pick && "blockedUntil" in pick) {
    const names = [...new Set((w.choices ?? []).map((c) => modelLabel(c.model)))].join(", ");
    return Response.json({ error: `limit modeli (${names}) do ${fmtTime(pick.blockedUntil)}`, until: pick.blockedUntil, limit: true }, { status: 429, headers: NO_STORE });
  }
  const m = pick ? runModel(pick) : null;
  const run = await repo.startBridgeRun(a.ownerId, a.tokenId, bridge, "work", null, m);
  if (!run) return busy(a.ownerId);
  // Claude Code dostaje token tego biegu (bez wysyłek, gaśnie z końcem biegu), nigdy token mostka
  const token = await repo.createRunToken(a.ownerId, { kind: "work", runId: run.id }, RUN_MAX_MIN + 10);
  return Response.json({ run, kind: "work", prompt: bridgeWorkPrompt(), mcp: mcpUrl(), token, maxMinutes: RUN_MAX_MIN, staleMinutes: RUN_STALE_MIN, ...modelFields(pick) }, { headers: NO_STORE });
}

// model biegu: zapisany w biegu (list_work, „ostatnio: model · wysiłek” na krokach) i podany aplikacji na Macu (--model, --effort, --fallback-model)
function runModel(p: RunPick): RunModel {
  // na zapasowym z powodu limitu: w trakcie biegu nie ma już na co przełączać (główny i tak jest w limicie)
  return { model: p.model, effort: p.choice.effort, focus: p.choice.key, fallback: p.limited ? "" : p.choice.fallback };
}
function modelFields(p: RunPick | null): Record<string, string> {
  if (!p) return {};
  const m = runModel(p);
  const label = runLabel(m.model, m.effort);
  return {
    model: m.model, effort: m.effort, fallbackModel: m.fallback, level: p.choice.level,
    modelLabel: p.limited ? `limit ${modelLabel(p.limited.model)} do ${fmtTime(p.limited.until)}, pracuję na ${modelLabel(p.model)}` : label,
  };
}

// szkic, którego nie da się wysłać z tego Maca: zgoda wraca do Piotra z notatką w rozmowie zadania, bieg nie rusza
async function refuse(ownerId: string, s: Sendable, why: string) {
  const note = `Nie wysłałem „${shortTitle(s.step.title, 60)}”: ${why}. Szkic wrócił do zatwierdzenia; popraw to i zatwierdź go jeszcze raz.`;
  await repo.clearApproval(ownerId, s.step.id, { note });
  return Response.json({ error: note, step: { id: s.step.id, taskId: s.taskId } }, { status: 422 });
}

async function sendRun(a: BridgeAuth, bridge: string): Promise<Response> {
  const open = (await repo.bridgeStatus(a.ownerId, 0)).run;
  if (open) return busy(a.ownerId, open);
  // najdawniej zatwierdzony szkic, którego żaden bieg jeszcze nie wziął, z krokami przed nim zrobionymi; szkic, który nie wychodzi
  // poza Task Hub (dokument, krok Piotra), nie ma czego wysyłać: zgoda go kończy, jak w starym mostku, i bierzemy następny.
  // Zatwierdzonego promptu dla agenta tu nie ma (listSendable go pomija): wykonuje go bieg pracy
  let s: Sendable | undefined;
  for (const x of await listSendable(a.ownerId)) {
    // szkic do „pliku” sprzed paczki 7: nic go nie wyśle; zgoda wraca z notatką, plik zapisuje krok „Plik na Macu”
    if (isLocalFile(x.draft.target.app)) { await repo.clearApproval(a.ownerId, x.step.id, { note: `Nie wysłałem „${shortTitle(x.step.title, 60)}”: to plik na Macu, nie wysyłka. Plik zapisuje krok „Plik na Macu”.` }); continue; }
    if (isGitDraft(x.draft, x.step.blocks) || isExternalApp(x.draft.target.app)) { s = x; break; }
    if (await repo.markSendStarted(a.ownerId, x.step.id)) await repo.completeSend(a.ownerId, x.step.id, { summary: "Zatwierdzone; ten szkic nie idzie do żadnej aplikacji zewnętrznej." }, "owner");
  }
  if (!s) return new Response(null, { status: 204 });
  const d = s.draft, t = d.target;
  const git = isGitDraft(d, s.step.blocks) ? gitSend(s.step.blocks, d) : null;
  if (typeof git === "string") return refuse(a.ownerId, s, git);
  let servers: string[] = [];
  if (!git) {
    const [conns, task, projects] = await Promise.all([repo.listConnections(a.ownerId), repo.getTask(a.ownerId, s.taskId), repo.listProjects(a.ownerId)]);
    const companyId = projects.find((p) => p.id === task?.projectId)?.companyId ?? null;
    const where = { app: t.app, connectionId: s.step.connectionId, host: bridge, companyId };
    servers = sendServers(conns, where);
    // ten sam sprawdzian co na karcie i przy zgodzie (konto Google do wyboru liczy się tu jak brak: bieg nie zgaduje konta)
    const p = connectorProblem(conns, where);
    // konektor jest, ale przypisany do innej firmy niż zadanie: mówimy to wprost (claude mcp list pokazałby go jako działający)
    if (p?.kind === "elsewhere") {
      const firms = await repo.listCompanies(a.ownerId);
      const firm = [...new Set(p.companyIds.map((id) => firms.find((f) => f.id === id)?.name ?? "innej firmy"))].join(", ");
      return refuse(a.ownerId, s, `konektor ${p.labels.map((l) => `„${l}”`).join(", ")} na komputerze ${bridge} jest przypisany do firmy ${firm}, a to zadanie ${companyId ? "jest innej firmy" : "nie ma firmy"} (wybierz połączenie na karcie szkicu albo przypisz zadanie do projektu tej firmy)`);
    }
    if (p?.kind === "none") return refuse(a.ownerId, s, `na komputerze ${bridge} nie ma działającego konektora ${p.named ? `„${p.named}”` : toolLabel(normalizeTool(t.app))} w Claude Code (sprawdź w Terminalu: claude mcp list)`);
    // kilka kont tej samej aplikacji, a krok nie wskazuje żadnego: model nie może zgadywać, z którego wysłać
    if (p?.kind === "many") return refuse(a.ownerId, s, `na komputerze ${bridge} jest kilka kont ${toolLabel(normalizeTool(t.app))} (${p.servers.map((x) => `„${x}”`).join(", ")}), a krok nie wskazuje, którym wysłać (wybierz połączenie na karcie szkicu)`);
  }
  // zatwierdzony szkic do wysłania to Mechanika (zasada „Dobór modelu i wysiłku”), chyba że Piotr wybrał model na karcie kroku
  // (paczka 20: wybór „Sonnet” na karcie szkicu był pomijany i wysyłka szła na modelu Mechaniki); commit robi aplikacja bez modelu
  const settings = git ? {} : await repo.userSettings(a.ownerId), cfg = modelConfig(settings);
  const sp = cfg ? pickRun([choiceOf(cfg, "mechanics", s.step.modelPick)], activeLimits(settings.modelLimits)) : null;
  const pick = sp && !("blockedUntil" in sp) ? sp : null;
  const run = await repo.startBridgeRun(a.ownerId, a.tokenId, bridge, "send", s.step.id, pick ? runModel(pick) : null);
  if (!run) return busy(a.ownerId);
  // najwyżej raz: znacznik wysyłki ustawia się atomowo; gdy szkic zdążył się zmienić, bieg znika i nic nie leci
  if (!(await repo.markSendStarted(a.ownerId, s.step.id))) {
    await repo.discardBridgeRun(a.ownerId, run.id);
    return new Response(null, { status: 204 });
  }
  const base = {
    run, kind: "send" as const, step: { id: s.step.id, taskId: s.taskId, title: s.step.title, taskTitle: s.taskTitle },
    target: { app: t.app, action: t.action, where: t.where ?? null, url: t.url ?? null }, maxMinutes: SEND_MAX_MIN, staleMinutes: RUN_STALE_MIN,
  };
  if (git) return Response.json({ ...base, git }, { headers: NO_STORE });
  const token = await repo.createRunToken(a.ownerId, { kind: "send", runId: run.id, stepId: s.step.id, taskId: s.taskId }, SEND_MAX_MIN + 5);
  const prompt = sendPrompt({ stepId: s.step.id, taskId: s.taskId, app: t.app, action: t.action, servers });
  return Response.json({ ...base, prompt, mcp: mcpUrl(), token, servers, ...modelFields(pick) }, { headers: NO_STORE });
}
