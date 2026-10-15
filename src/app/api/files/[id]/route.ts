// Plik załącznika z bazy: tylko dla zalogowanego właściciela (ciasteczko sesji). Agent przez konektor używa get_attachment.
import { isSignedIn } from "@/lib/auth";
import * as repo from "@/lib/repo";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isSignedIn())) return new Response("Zaloguj się", { status: 401 });
  const { id } = await ctx.params;
  const o = await repo.ensureOwner();
  const f = await repo.getAttachmentFile(o.id, id);
  if (!f) return new Response("Nie ma takiego pliku", { status: 404 });
  return new Response(new Uint8Array(f.data), {
    headers: {
      "content-type": f.mime ?? "application/octet-stream",
      "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(f.name ?? "plik")}`,
      "cache-control": "private, max-age=86400",
      "x-content-type-options": "nosniff",
    },
  });
}
