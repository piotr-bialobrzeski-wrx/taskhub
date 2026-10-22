// Szybki pasek z aplikacji na Macu (i starsze okienko „Nowe zadanie”): ta sama droga co główne pole na kanwie (src/lib/intake.ts).
// Pasek wysyła multipart (tekst + pliki, jak dok), starsze wersje aplikacji JSON { text }. Odpowiedź: nowe zadanie i jego adres.
import { revalidatePath } from "next/cache";
import { authBridge } from "@/lib/bridge";
import { intake, uploads } from "@/lib/intake";
import { appUrl } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const a = await authBridge(req);
  if (a instanceof Response) return a;
  let typed = "", files: File[] = [];
  if ((req.headers.get("content-type") ?? "").toLowerCase().includes("multipart/form-data")) {
    const fd = await req.formData().catch(() => null);
    if (!fd) return Response.json({ error: "Nie umiem odczytać wiadomości." }, { status: 400 });
    typed = String(fd.get("text") ?? "").trim();
    files = uploads(fd);
  } else {
    const body = (await req.json().catch(() => ({}))) as { text?: string };
    typed = String(body.text ?? "").trim();
  }
  if (!typed && !files.length) return Response.json({ error: "Pusta treść." }, { status: 400 });
  const { goTo, note } = await intake(a.ownerId, { typed, files, taskId: null, stepId: null });
  try { revalidatePath("/"); } catch { /* poza żądaniem Next (testy) */ }
  return Response.json({ id: goTo, url: goTo ? `${appUrl()}/tasks/${goTo}` : `${appUrl()}/`, message: note ?? "Mam to." });
}
