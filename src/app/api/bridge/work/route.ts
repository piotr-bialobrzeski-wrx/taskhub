// Puls mostka i pytanie „czy czeka praca?”: tani odczyt bez modelu, wołany co kilkanaście sekund z komputera Piotra.
// v2 (aplikacja 0.1.7): osobno work (praca bez wysyłek) i sends (zatwierdzone szkice do wysłania, kroki przed nimi zrobione); pending = jedno i drugie.
import { createHash } from "node:crypto";
import * as repo from "@/lib/repo";
import { listSendable, workSummary } from "@/lib/agent/work";
import { BRIDGE_ALIVE_MS, BRIDGE_VERSION, RUN_STALE_MIN, authBridge, pollMs, protocolOf } from "@/lib/bridge";

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
  if (protocolOf(q.get("v")) < 2) {
    // v1 bez zmian: zatwierdzone szkice liczą się do pracy, wysyła je ten sam bieg
    const [w, st] = await Promise.all([workSummary(a.ownerId, { peek: true }), repo.bridgeStatus(a.ownerId, BRIDGE_ALIVE_MS)]);
    return Response.json({ ok: true, pending: w.total, counts: w.counts, run: st.run, pollMs: pollMs(), version: 1, time: new Date().toISOString() });
  }
  const [w, sends, st] = await Promise.all([workSummary(a.ownerId, { peek: true, audience: "work" }), listSendable(a.ownerId), repo.bridgeStatus(a.ownerId, BRIDGE_ALIVE_MS)]);
  // po „Zatrzymaj” w Task Hub mostek nie bierze pracy do końca przerwy (albo do wiadomości Piotra); zatwierdzone szkice wysyła dalej
  const work = st.pause ? 0 : w.total;
  // key: odcisk listy pracy; ten sam po udanym biegu = bieg niczego nie ruszył (np. krok oddany przez leave_step), aplikacja nie powtarza go od razu
  const key = work ? createHash("sha256").update(w.text).digest("hex").slice(0, 16) : "";
  return Response.json({
    ok: true, pending: work + sends.length, work, sends: sends.length, key, counts: { ...w.counts, approved: sends.length }, ...(st.pause ? { pause: st.pause } : {}),
    run: st.run, pollMs: pollMs(), version: BRIDGE_VERSION, time: new Date().toISOString(),
  });
}
