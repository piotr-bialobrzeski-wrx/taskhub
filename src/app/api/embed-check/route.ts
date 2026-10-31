// Paczka 31, krok 13: czy prototyp spoza Task Hub da się pokazać w ramce na kartce decyzji. Serwer czyta nagłówki strony
// (X-Frame-Options, CSP frame-ancestors), bo przeglądarka nie mówi wprost, że ramka jest zablokowana. Tylko dla zalogowanego
// właściciela, tylko https i adresy publiczne (bez sieci prywatnej), najwyżej 3 przekierowania; odpowiedź { ok }.
import { isSignedIn } from "@/lib/auth";
import { appUrl } from "@/lib/session";
import { frameAllowed, publicHttpsUrl } from "@/lib/embed";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "private, max-age=300" } });

export async function GET(req: Request) {
  if (!(await isSignedIn())) return json({ ok: false, why: "auth" }, 401);
  let u = publicHttpsUrl(new URL(req.url).searchParams.get("u") ?? "");
  if (!u) return json({ ok: false, why: "url" });
  const origin = new URL(appUrl()).origin;
  try {
    for (let hop = 0; hop < 4; hop++) {
      const res = await fetch(u, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(4000), headers: { accept: "text/html" } });
      res.body?.cancel().catch(() => {});
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        u = publicHttpsUrl(new URL(res.headers.get("location")!, u).toString());
        if (!u) return json({ ok: false, why: "url" });
        continue;
      }
      if (!res.ok) return json({ ok: false, why: "status" });
      return json({ ok: frameAllowed({ xfo: res.headers.get("x-frame-options"), csp: res.headers.get("content-security-policy") }, origin) });
    }
    return json({ ok: false, why: "redirects" });
  } catch {
    return json({ ok: false, why: "fetch" });
  }
}
