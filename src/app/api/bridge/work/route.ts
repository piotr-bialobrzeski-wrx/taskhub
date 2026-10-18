// Puls mostka i pytanie „czy czeka praca?”: tani odczyt bez modelu, wołany co kilkanaście sekund z komputera Piotra.
import * as repo from "@/lib/repo";
import { workSummary } from "@/lib/agent/work";
import { BRIDGE_ALIVE_MS, BRIDGE_VERSION, RUN_STALE_MIN, authBridge, pollMs } from "@/lib/bridge";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const a = await authBridge(req);
  if (a instanceof Response) return a;
  const q = new URL(req.url).searchParams;
  const meta: Record<string, string> = {};
  for (const k of ["host", "runner", "state", "until", "v"]) { const v = q.get(k); if (v) meta[k] = v.slice(0, 120); }
  if (meta.state && meta.state !== "check" && !meta.until) meta.until = "";   // stary termin po limicie nie zostaje w meta, gdy mostek już go nie zgłasza
  await repo.bridgeSeen(a.tokenId, meta);
  await repo.expireBridgeRuns(a.ownerId, RUN_STALE_MIN);
  const [w, st] = await Promise.all([workSummary(a.ownerId, { peek: true }), repo.bridgeStatus(a.ownerId, BRIDGE_ALIVE_MS)]);
  return Response.json({ ok: true, pending: w.total, counts: w.counts, run: st.run, pollMs: pollMs(), version: BRIDGE_VERSION, time: new Date().toISOString() });
}
