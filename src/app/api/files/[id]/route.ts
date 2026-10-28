// Plik załącznika z bazy: tylko dla zalogowanego właściciela (ciasteczko sesji). Agent przez konektor używa get_attachment.
// Typ, sposób otwarcia i CSP ustala fileHeaders (../headers.ts): HTML i SVG nigdy nie otwierają się na adresie Task Hub.
import { isSignedIn } from "@/lib/auth";
import * as repo from "@/lib/repo";
import { makeThumb } from "@/lib/thumb";
import { fileHeaders } from "../headers";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (body: string, status: number) => new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isSignedIn())) return text("Zaloguj się", 401);
  const { id } = await ctx.params;
  if (!UUID.test(id)) return text("Nie ma takiego pliku", 404);
  const o = await repo.ensureOwner();
  // ?w=s: miniatura do kartki kroku i galerii (paczka 27); z bazy idzie tylko ona, pełny plik dopiero po kliknięciu
  if (new URL(req.url).searchParams.get("w") === "s") {
    const t = await repo.getAttachmentThumb(o.id, id, makeThumb);
    if (t) return new Response(new Uint8Array(t), { headers: fileHeaders("image/jpeg", "miniatura.jpg") });
  }
  const f = await repo.getAttachmentFile(o.id, id);
  if (!f) return text("Nie ma takiego pliku", 404);
  return new Response(new Uint8Array(f.data), { headers: fileHeaders(f.mime, f.name) });
}
