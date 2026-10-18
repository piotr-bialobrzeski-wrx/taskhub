// Sygnał z biegu: postęp (touch z ostatnim krokiem) albo koniec (outcome: done | error | limit | auth).
import * as repo from "@/lib/repo";
import { authBridge } from "@/lib/bridge";
import { linkOfNote } from "@/lib/live";

export const dynamic = "force-dynamic";
const OUTCOMES = new Set(["done", "error", "limit", "auth"]);

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const a = await authBridge(req);
  if (a instanceof Response) return a;
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { note?: string; outcome?: string };
  const note = typeof body.note === "string" ? body.note : undefined;
  const ok = body.outcome
    ? OUTCOMES.has(body.outcome) && (await repo.endBridgeRun(a.ownerId, id, body.outcome, note))
    : await repo.touchBridgeRun(a.ownerId, id, note, linkOfNote(note) ?? {});   // „start_step: id” wiąże bieg z krokiem, „get_task: id” z zadaniem
  return Response.json({ ok }, { status: ok ? 200 : 404 });
}
