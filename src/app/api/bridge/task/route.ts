// Szybkie zadanie z aplikacji na Macu (okienko „Nowe zadanie”): tworzy zadanie tak jak dok na kanwie i mówi, kto się nim zajmie.
import * as repo from "@/lib/repo";
import { newTaskText } from "@/lib/auto";
import { BRIDGE_ALIVE_MS, authBridge } from "@/lib/bridge";
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
  const alive = (await repo.bridgeStatus(a.ownerId, BRIDGE_ALIVE_MS)).alive;
  const message = newTaskText(alive);
  await repo.addChat(a.ownerId, null, "agent", message);
  return Response.json({ id: t.id, url: `${appUrl()}/tasks/${t.id}`, message });
}
