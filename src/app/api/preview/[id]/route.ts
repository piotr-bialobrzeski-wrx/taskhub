// Podgląd prototypu HTML (paczka 22, MCP add_preview): tylko dla zalogowanego właściciela i tylko pliki text/html z tej tabeli załączników.
// Strona działa w piaskownicy bez allow-same-origin: ma własny, pusty origin, więc nie widzi ciasteczek ani API Task Hub, a CSP nie
// pozwala jej niczego pobrać ani wysłać (connect-src, form-action 'none'); skrypty prototypu (kliknięcia, przełączniki) działają.
import { isSignedIn } from "@/lib/auth";
import * as repo from "@/lib/repo";
import { PREVIEW_CSP } from "../csp";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (body: string, status: number) => new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isSignedIn())) return text("Zaloguj się w Task Hub, żeby zobaczyć ten podgląd.", 401);
  const { id } = await ctx.params;
  if (!UUID.test(id)) return text("Nie ma takiego podglądu", 404);
  const o = await repo.ensureOwner();
  const f = await repo.getAttachmentFile(o.id, id);
  if (!f || (f.mime ?? "").split(";")[0].trim().toLowerCase() !== "text/html") return text("Nie ma takiego podglądu", 404);
  return new Response(new Uint8Array(f.data), {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": PREVIEW_CSP,
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "cache-control": "private, no-store",
    },
  });
}
