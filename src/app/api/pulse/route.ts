// Puls dla przeglądarki: czy coś się zmieniło (stempel z bazy + bieg mostka) i co mostek robi teraz. Tanie zapytania, bez modelu;
// strona odświeża się sama, gdy klucz się zmieni (LivePoll). Tylko dla zalogowanego właściciela.
import { isSignedIn } from "@/lib/auth";
import * as repo from "@/lib/repo";
import { BRIDGE_ALIVE_MS } from "@/lib/bridge";
import { liveActivity, liveKey } from "@/lib/live";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await isSignedIn())) return Response.json({ error: "Zaloguj się" }, { status: 401 });
  const o = await repo.ensureOwner();
  const taskId = new URL(req.url).searchParams.get("task");
  const [stamp, st, pending] = await Promise.all([repo.changeStamp(o.id, taskId || null), repo.bridgeStatus(o.id, BRIDGE_ALIVE_MS), repo.countPendingChat(o.id, taskId || null)]);
  const run = liveActivity(st.run);
  // active: mostek pracuje albo wiadomości Piotra czekają na odpowiedź (stan pod dymkiem i na karcie ma się zmieniać na bieżąco)
  return Response.json({ key: liveKey(stamp, st.run, st.alive), active: !!run || pending.size > 0, run, bridge: st.alive }, { headers: { "cache-control": "no-store" } });
}
