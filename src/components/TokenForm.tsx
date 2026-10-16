"use client";
// Tworzenie tokenu MCP: pokazujemy go tylko raz, w bazie jest sam skrót. Wariant „install” pokazuje od razu komendę instalującą mostek z tym tokenem.
import { useActionState } from "react";
import type { TokenState } from "@/app/actions";
import { CopyButton } from "./CopyButton";

export const installCommand = (url: string, token: string) => `curl -fsSL ${url}/bridge/taskhub-bridge.mjs -o ~/taskhub-bridge.mjs && node ~/taskhub-bridge.mjs --install --url ${url} --token ${token}`;
// link do aplikacji Task Hub na Macu: przekazuje adres i token bez przepisywania (aplikacja rejestruje schemat taskhub://)
export const connectLink = (url: string, token: string) => `taskhub://connect?url=${encodeURIComponent(url)}&token=${encodeURIComponent(token)}`;

export function TokenForm({ action, placeholder = "Nazwa klienta, np. Claude Code na laptopie", button = "Nowy token", install }: { action: (prev: TokenState, fd: FormData) => Promise<TokenState>; placeholder?: string; button?: string; install?: { url: string } }) {
  const [state, formAction, pending] = useActionState(action, {} as TokenState);
  return (
    <div className="stack">
      <form className="row" action={formAction}>
        <input className="in" name="name" placeholder={placeholder} style={{ maxWidth: 360 }} />
        <button className="pill primary" type="submit" disabled={pending}>{pending ? "Tworzę…" : button}</button>
      </form>
      {state.token ? (
        <div className="note" style={{ color: "var(--text)" }}>
          {install ? (
            <>
              <div className="lbl">Token gotowy (pokażę go tylko raz)</div>
              <div className="row" style={{ gap: "var(--s-3)", flexWrap: "wrap" }}>
                <a className="pill primary" href={connectLink(install.url, state.token)}>Połącz aplikację Task Hub na tym Macu</a>
                <CopyButton text={state.token} label="Kopiuj token" />
              </div>
              <p className="sub" style={{ margin: "8px 0 0" }}>Przycisk otwiera zainstalowaną aplikację i wpisuje jej adres oraz token. Gdy nic się nie dzieje, wklej token w oknie Ustawień aplikacji.</p>
              <details className="edit" style={{ marginTop: 8 }}>
                <summary>Bez aplikacji: mostek jako usługa z Terminala</summary>
                <pre className="code" style={{ marginTop: 6 }}>{installCommand(install.url, state.token)}</pre>
                <div style={{ marginTop: 8 }}><CopyButton text={installCommand(install.url, state.token)} label="Kopiuj komendę" /></div>
              </details>
            </>
          ) : (
            <>
              <div className="lbl">Token (zapisz teraz, nie pokażę go drugi raz)</div>
              <code style={{ wordBreak: "break-all" }}>{state.token}</code>
              <div style={{ marginTop: 8 }}><CopyButton text={state.token} /></div>
            </>
          )}
        </div>
      ) : null}
      {state.error ? <div className="sub" style={{ color: "var(--danger)" }}>{state.error}</div> : null}
    </div>
  );
}
