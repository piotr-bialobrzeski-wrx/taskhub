// Aktualizacja aplikacji na Maca (0.1.7+): najnowsze wydanie app-v… z adresami pobrania w Task Hub i sumami SHA-256.
// Wydania czyta serwer (repozytorium może być prywatne), więc aplikacja nie zależy od publicznego GitHuba. 404 znaczy dla aplikacji
// „starszy serwer” (wtedy pyta GitHub sama), więc tu nigdy go nie zwracamy: brak wydania to 503, kłopot z GitHubem 502.
import { appUpdate, authBridge } from "@/lib/bridge";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const a = await authBridge(req);
  if (a instanceof Response) return a;
  try {
    const u = await appUpdate();
    if (!u) return Response.json({ error: "Nie ma jeszcze wydania aplikacji (app-v…)." }, { status: 503, headers: { "cache-control": "no-store" } });
    return Response.json(u, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    console.error("wydania aplikacji:", e);
    return Response.json({ error: `Nie mogę odczytać wydań aplikacji z GitHuba: ${(e as Error).message}` }, { status: 502, headers: { "cache-control": "no-store" } });
  }
}
