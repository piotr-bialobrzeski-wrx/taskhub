// Sygnał z biegu: postęp (touch z ostatnim krokiem; odpowiedź cancel = Piotr wycofał zgodę na wysyłkę) albo koniec (outcome: done | error | limit | auth | stopped, czyli Piotr zatrzymał bieg).
// Bieg wysyłki zrobiony przez samą aplikację (commit) zgłasza sent {summary, link}: krok zamyka się przed końcem biegu.
// Koniec biegu gasi jego tokeny; bieg wysyłki bez zrobionego kroku cofa zgodę z notatką w rozmowie (repo.endBridgeRun), bez ponawiania.
import * as repo from "@/lib/repo";
import { authBridge } from "@/lib/bridge";
import { toolLabel, normalizeTool } from "@/lib/schema";
import { isHttpUrl } from "@/lib/safeurl";

export const dynamic = "force-dynamic";
const OUTCOMES = new Set(["done", "error", "limit", "auth", "stopped"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v: unknown, n: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const a = await authBridge(req);
  if (a instanceof Response) return a;
  const { id } = await ctx.params;
  if (!UUID.test(id)) return Response.json({ ok: false }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { note?: string; outcome?: string; sent?: { link?: unknown; summary?: unknown } | null };
  const note = typeof body.note === "string" ? body.note : undefined;
  if (!body.outcome) {
    const ok = await repo.touchBridgeRun(a.ownerId, id, note);   // z którym krokiem i zadaniem bieg jest związany, zapisuje serwer MCP przy wywołaniach
    // cancel: Piotr wycofał zgodę na szkic tego biegu wysyłki („Zatrzymaj” na karcie), więc aplikacja przerywa bieg
    const cancel = ok && (await repo.sendWithdrawn(a.ownerId, id));
    return Response.json(cancel ? { ok, cancel } : { ok }, { status: ok ? 200 : 404 });
  }
  if (!OUTCOMES.has(body.outcome)) return Response.json({ ok: false }, { status: 404 });
  let sent: boolean | undefined;
  if (body.outcome === "done" && body.sent && typeof body.sent === "object") {
    const run = await repo.getBridgeRun(a.ownerId, id);
    if (run && !run.endedAt && run.kind === "send" && run.stepId) {
      const report = { summary: str(body.sent.summary, 4000), link: str(body.sent.link, 2000) };
      sent = await repo.completeSend(a.ownerId, run.stepId, report);
      // poszło, ale zgoda zdążyła wygasnąć (Piotr zatrzymał albo zmienił szkic): mówimy mu to wprost, krok zostaje do jego decyzji
      const st = !sent && run.taskId ? (await repo.getTask(a.ownerId, run.taskId))?.steps.find((x) => x.id === run.stepId) : null;
      if (st && st.status !== "done" && run.taskId) {
        const app = repo.draftOf(st)?.target.app;
        await repo.addChat(a.ownerId, run.taskId, "agent", `Mostek zgłosił wysyłkę${report.summary ? ` (${report.summary})` : ""}, ale zgoda na ten szkic była już wycofana. Sprawdź w ${app ? toolLabel(normalizeTool(app)) : "aplikacji docelowej"}, co poszło.`, { stepId: run.stepId, link: isHttpUrl(report.link) ? report.link : undefined });
      }
    }
  }
  const ok = await repo.endBridgeRun(a.ownerId, id, body.outcome, note);
  return Response.json(sent === undefined ? { ok } : { ok, sent }, { status: ok ? 200 : 404 });
}
