// Odpowiedź na stronę zgody: logowanie hasłem (gdy trzeba), zgoda albo odmowa, przekierowanie z kodem do klienta.
import { cookies } from "next/headers";
import { SESSION_COOKIE, checkPassword, isSignedIn, sessionValue } from "@/lib/auth";
import { ensureOwner } from "@/lib/repo";
import { checkAuthRequest, issueCode, redirectWith } from "@/lib/oauth";
import { client, hhmm, mayTry, record } from "@/lib/guard";

const back = (status: number, location: string) => new Response(null, { status, headers: { location, "cache-control": "no-store" } });

export async function POST(req: Request) {
  const fd = await req.formData();
  const q: Record<string, string | undefined> = {};
  for (const k of ["client_id", "redirect_uri", "response_type", "code_challenge", "code_challenge_method", "state", "scope", "resource"]) { const v = fd.get(k); if (typeof v === "string" && v !== "") q[k] = v; }
  const query = new URLSearchParams(q as Record<string, string>);
  let checked;
  try { checked = await checkAuthRequest(q); }
  catch { return back(303, `/oauth/authorize?${query}`); }
  const { req: r } = checked;

  if (fd.get("decision") === "deny") return back(303, redirectWith(r.redirect_uri, { error: "access_denied", state: r.state }));
  if (!(await isSignedIn())) {
    const c = await client();
    const v = await mayTry(c.ip, new Date(), c.country);
    if (!v.ok) { query.set("e", v.reason); query.set("t", hhmm(v.until)); return back(303, `/oauth/authorize?${query}`); }
    const ok = checkPassword(String(fd.get("password") ?? ""));
    await record("oauth", ok, c);
    if (!ok) { query.set("e", "1"); return back(303, `/oauth/authorize?${query}`); }
    (await cookies()).set(SESSION_COOKIE, sessionValue(), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 90 });
  }
  const owner = await ensureOwner();
  const code = await issueCode(owner.id, r);
  return back(303, redirectWith(r.redirect_uri, { code, state: r.state }));
}
