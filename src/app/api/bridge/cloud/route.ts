// Mostek zgłasza odpalenie chmury (paczka 13, punkt 3): ok = zaplanowane zadanie „Task Hub: kod w chmurze” ruszyło, więc czekające zlecenia
// są „odpalone” (następne odpalenie dopiero, gdy chmura ich nie weźmie przez RING_AGAIN_MIN); błąd idzie do rozmowy zadania, zlecenie czeka dalej.
import * as repo from "@/lib/repo";
import { RING_AGAIN_MIN, authBridge } from "@/lib/bridge";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const a = await authBridge(req);
  if (a instanceof Response) return a;
  const body = (await req.json().catch(() => ({}))) as { ok?: unknown; note?: unknown };
  if (body.ok === true) return Response.json({ ok: true, rung: await repo.markCloudRung(a.ownerId, RING_AGAIN_MIN) });
  const note = typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 300) : "nieznany błąd";
  // jedna notatka na zlecenie: przy kolejnym błędzie (aplikacja ponawia co kilka minut) rozmowa zadania się nie zapełnia
  for (const it of await repo.listCloud(a.ownerId)) {
    if (it.step.cloud?.state !== "queued" || it.step.cloud.failAt) continue;
    await repo.addChat(a.ownerId, it.taskId, "agent", `Mac nie odpalił chmury dla „${it.step.title.slice(0, 70)}”: ${note}. Ponowię za kilka minut; awaryjnie „Kopiuj polecenie” na kartce kroku.`, { stepId: it.step.id });
    await repo.noteCloudFail(a.ownerId, it.step.id);
  }
  return Response.json({ ok: true });
}
