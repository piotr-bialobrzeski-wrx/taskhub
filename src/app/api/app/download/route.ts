// Pierwsza instalacja aplikacji na Maca z Ustawień: zalogowany Piotr dostaje najnowszy instalator .pkg (przekierowanie na krótko
// ważny adres GitHuba; repozytorium może być prywatne, token GitHuba zostaje na serwerze).
import { isSignedIn } from "@/lib/auth";
import { assetLocation, latestAppRelease } from "@/lib/bridge";

export const dynamic = "force-dynamic";
const text = (body: string, status: number) => new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

export async function GET() {
  if (!(await isSignedIn())) return new Response(null, { status: 302, headers: { location: "/login", "cache-control": "no-store" } });
  try {
    const rel = await latestAppRelease();
    const pkg = rel?.assets.find((a) => a.name.toLowerCase().endsWith(".pkg"));
    if (!pkg) return text("Nie ma jeszcze instalatora aplikacji na Maca (wydanie app-v… z plikiem .pkg).", 404);
    const loc = await assetLocation(pkg.id);
    if (!loc) return text("GitHub nie dał adresu instalatora, spróbuj za chwilę.", 502);
    return new Response(null, { status: 302, headers: { location: loc, "cache-control": "no-store" } });
  } catch (e) {
    console.error("instalator aplikacji:", e);
    return text("Nie mogę pobrać instalatora z GitHuba, spróbuj za chwilę.", 502);
  }
}
