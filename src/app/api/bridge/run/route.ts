// Początek biegu: mostek bierze pracę na wyłączność (jeden otwarty bieg na właściciela) i dostaje prompt oraz adres konektora.
// v1 (bez v): jak dotąd, Claude Code pracuje tokenem mostka i sam wysyła zatwierdzone szkice.
// v2: kind "work" = bieg pracy z krótkim tokenem biegu (bez wysyłek); kind "send" = jeden zatwierdzony szkic: commit robi aplikacja
// na Macu (git), a wiadomość wysyła Claude Code tylko konektorem docelowej aplikacji (servers) z tokenem, który zna ten jeden krok.
import * as repo from "@/lib/repo";
import { listSendable, type Sendable } from "@/lib/agent/work";
import { isExternalApp, isLocalFile } from "@/lib/agent/approval";
import { RUN_MAX_MIN, RUN_STALE_MIN, SEND_MAX_MIN, appKey, authBridge, bridgePrompt, bridgeWorkPrompt, gitSend, isGitDraft, mcpUrl, protocolOf, sendPrompt, sendServers, type BridgeAuth } from "@/lib/bridge";
import { normalizeTool, toolLabel } from "@/lib/schema";
import { shortTitle } from "@/lib/auto";

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
  const run = await repo.startBridgeRun(a.ownerId, a.tokenId, bridge, "work");
  if (!run) return busy(a.ownerId);
  // Claude Code dostaje token tego biegu (bez wysyłek, gaśnie z końcem biegu), nigdy token mostka
  const token = await repo.createRunToken(a.ownerId, { kind: "work", runId: run.id }, RUN_MAX_MIN + 10);
  return Response.json({ run, kind: "work", prompt: bridgeWorkPrompt(), mcp: mcpUrl(), token, maxMinutes: RUN_MAX_MIN, staleMinutes: RUN_STALE_MIN }, { headers: NO_STORE });
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
    if (await repo.markSendStarted(a.ownerId, x.step.id)) await repo.completeSend(a.ownerId, x.step.id, { summary: "Zatwierdzone; ten szkic nie idzie do żadnej aplikacji zewnętrznej." });
  }
  if (!s) return new Response(null, { status: 204 });
  const d = s.draft, t = d.target;
  const git = isGitDraft(d, s.step.blocks) ? gitSend(s.step.blocks, d) : null;
  if (typeof git === "string") return refuse(a.ownerId, s, git);
  let servers: string[] = [];
  if (!git) {
    const [conns, task, projects] = await Promise.all([repo.listConnections(a.ownerId), repo.getTask(a.ownerId, s.taskId), repo.listProjects(a.ownerId)]);
    const companyId = projects.find((p) => p.id === task?.projectId)?.companyId ?? null;
    servers = sendServers(conns, { app: t.app, connectionId: s.step.connectionId, host: bridge, companyId });
    if (!servers.length) {
      const named = s.step.connectionId ? conns.find((c) => c.id === s.step.connectionId)?.label : null;
      // konektor jest, ale przypisany do innej firmy niż zadanie: mówimy to wprost (claude mcp list pokazałby go jako działający)
      const live = conns.filter((c) => c.source === "bridge" && c.state === "active");
      const here = live.some((c) => c.host === bridge);
      const elsewhere = named ? [] : live.filter((c) => appKey(c.app) === appKey(t.app) && (!here || c.host === bridge) && !!c.companyId && c.companyId !== companyId);
      if (elsewhere.length) {
        const firms = await repo.listCompanies(a.ownerId);
        const firm = [...new Set(elsewhere.map((c) => firms.find((f) => f.id === c.companyId)?.name ?? "innej firmy"))].join(", ");
        return refuse(a.ownerId, s, `konektor ${elsewhere.map((c) => `„${c.label}”`).join(", ")} na komputerze ${bridge} jest przypisany do firmy ${firm}, a to zadanie ${companyId ? "jest innej firmy" : "nie ma firmy"} (wybierz połączenie na karcie szkicu albo przypisz zadanie do projektu tej firmy)`);
      }
      return refuse(a.ownerId, s, `na komputerze ${bridge} nie ma działającego konektora ${named ? `„${named}”` : toolLabel(normalizeTool(t.app))} w Claude Code (sprawdź w Terminalu: claude mcp list)`);
    }
    // kilka kont tej samej aplikacji, a krok nie wskazuje żadnego: model nie może zgadywać, z którego wysłać
    if (servers.length > 1 && !s.step.connectionId) {
      return refuse(a.ownerId, s, `na komputerze ${bridge} jest kilka kont ${toolLabel(normalizeTool(t.app))} (${servers.map((x) => `„${x}”`).join(", ")}), a krok nie wskazuje, którym wysłać (wybierz połączenie na karcie szkicu)`);
    }
  }
  const run = await repo.startBridgeRun(a.ownerId, a.tokenId, bridge, "send", s.step.id);
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
  return Response.json({ ...base, prompt, mcp: mcpUrl(), token, servers }, { headers: NO_STORE });
}
