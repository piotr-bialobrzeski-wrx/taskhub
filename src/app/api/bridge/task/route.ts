// Szybkie zadanie z aplikacji na Macu (okienko „Nowe zadanie”): tworzy zadanie tak jak dok na kanwie i mówi, kto się nim zajmie.
import * as repo from "@/lib/repo";
import { bridgeHold, busyWith, newTaskText, noStepsWho } from "@/lib/auto";
import { BRIDGE_ALIVE_MS, authBridge } from "@/lib/bridge";
import { liveActivity } from "@/lib/live";
import { appUrl } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const a = await authBridge(req);
  if (a instanceof Response) return a;
  const body = (await req.json().catch(() => ({}))) as { text?: string };
  const text = String(body.text ?? "").trim();
  if (!text) return Response.json({ error: "Pusta treść." }, { status: 400 });
  await repo.addChat(a.ownerId, null, "user", text);
  const t = await repo.createTask(a.ownerId, { title: text.slice(0, 120), source: text });
  const st = await repo.bridgeStatus(a.ownerId, BRIDGE_ALIVE_MS);
  const w = { alive: st.alive, name: st.name, run: liveActivity(st.run), hold: bridgeHold(st.meta, st.pause) };
  const message = newTaskText(t.title, noStepsWho(w, t.id, busyWith(w.run, await repo.listTasks(a.ownerId))));
  await repo.addChat(a.ownerId, null, "agent", message);
  return Response.json({ id: t.id, url: `${appUrl()}/tasks/${t.id}`, message });
}
