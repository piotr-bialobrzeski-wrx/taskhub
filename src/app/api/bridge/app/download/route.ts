// Pobranie pliku wydania aplikacji (asset = id pliku w wydaniu): token mostka albo zalogowany Piotr. Przekierowanie na krótko ważny,
// podpisany adres GitHuba; token GitHuba zostaje na serwerze (nie ma go ani w odpowiedzi, ani w adresie przekierowania).
import { isSignedIn } from "@/lib/auth";
import { assetLocation, authBridge } from "@/lib/bridge";

export const dynamic = "force-dynamic";
const text = (body: string, status: number) => new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

export async function GET(req: Request) {
  if (/^Bearer\s+/i.test(req.headers.get("authorization") ?? "")) {
    const a = await authBridge(req);
    if (a instanceof Response) return a;
  } else if (!(await isSignedIn())) return text("Zaloguj się w Task Hub albo podaj token mostka.", 401);
  const id = new URL(req.url).searchParams.get("asset") ?? "";
  if (!/^\d{1,15}$/.test(id)) return text("Nie ma takiego pliku.", 404);
  try {
    const loc = await assetLocation(id);
    if (!loc) return text("Nie ma takiego pliku w wydaniach aplikacji.", 404);
    return new Response(null, { status: 302, headers: { location: loc, "cache-control": "no-store" } });
  } catch (e) {
    console.error("pobranie pliku wydania:", e);
    return text("GitHub nie odpowiedział, spróbuj za chwilę.", 502);
  }
}
