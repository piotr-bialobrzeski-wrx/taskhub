// Strona zgody dla konektorów: pokazuje, kto prosi o dostęp, i wymaga hasła, gdy nie ma sesji.
import Link from "next/link";
import { isSignedIn } from "@/lib/auth";
import { OAuthError, checkAuthRequest } from "@/lib/oauth";

export const dynamic = "force-dynamic";

const KEYS = ["client_id", "redirect_uri", "response_type", "code_challenge", "code_challenge_method", "state", "scope", "resource"] as const;

export default async function Authorize({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const q: Record<string, string | undefined> = {};
  for (const k of KEYS) { const v = sp[k]; if (typeof v === "string") q[k] = v; }
  const wrongPassword = sp.e === "1";
  const signedIn = await isSignedIn();

  let client: { id: string; name: string } | null = null, error: string | null = null;
  try { client = (await checkAuthRequest(q)).client; }
  catch (e) { error = e instanceof OAuthError ? e.message : "Nie udało się sprawdzić prośby o połączenie."; }

  let host = "";
  try { host = new URL(q.redirect_uri ?? "").hostname; } catch { /* pusty host */ }

  return (
    <main className="app">
      <form className="card login stack" method="post" action="/api/oauth/authorize">
        <h1 style={{ margin: 0, fontSize: 18 }}>Task Hub</h1>
        {error || !client ? (
          <>
            <div className="sub" style={{ color: "var(--danger)" }}>{error ?? "Niepełna prośba o połączenie."}</div>
            <Link className="pill" href="/settings">Ustawienia</Link>
          </>
        ) : (
          <>
            <p style={{ margin: 0 }}>Połączyć <b>{client.name}</b>{client.id.startsWith("https://") ? <span className="sub"> ({new URL(client.id).hostname})</span> : null} z Task Hub?</p>
            <div className="sub">Po połączeniu będzie czytać i zmieniać Twoje zadania, kroki, fakty i zasady. Po zgodzie wrócisz na {host || "stronę klienta"}. Połączenie pojawi się w Ustawieniach, gdzie można je unieważnić.</div>
            {KEYS.map((k) => (q[k] ? <input key={k} type="hidden" name={k} value={q[k]} /> : null))}
            {signedIn ? null : <input className="in" type="password" name="password" placeholder="Hasło do Task Hub" autoFocus required />}
            {wrongPassword ? <div className="sub" style={{ color: "var(--danger)" }}>Złe hasło.</div> : null}
            <div className="actions">
              <button className="pill primary" type="submit" name="decision" value="allow">Połącz</button>
              <button className="pill" type="submit" name="decision" value="deny">Odmów</button>
            </div>
          </>
        )}
      </form>
    </main>
  );
}
