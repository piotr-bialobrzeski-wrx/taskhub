"use client";
// Tworzenie tokenu MCP: pokazujemy go tylko raz, w bazie jest sam skrót.
import { useActionState } from "react";
import type { TokenState } from "@/app/actions";
import { CopyButton } from "./CopyButton";

export function TokenForm({ action }: { action: (prev: TokenState, fd: FormData) => Promise<TokenState> }) {
  const [state, formAction, pending] = useActionState(action, {} as TokenState);
  return (
    <div className="stack">
      <form className="row" action={formAction}>
        <input className="in" name="name" placeholder="Nazwa klienta, np. Claude Code na laptopie" style={{ maxWidth: 360 }} />
        <button className="pill primary" type="submit" disabled={pending}>{pending ? "Tworzę…" : "Nowy token"}</button>
      </form>
      {state.token ? (
        <div className="note" style={{ color: "var(--text)" }}>
          <div className="lbl">Token (zapisz teraz, nie pokażę go drugi raz)</div>
          <code style={{ wordBreak: "break-all" }}>{state.token}</code>
          <div style={{ marginTop: 8 }}><CopyButton text={state.token} /></div>
        </div>
      ) : null}
      {state.error ? <div className="sub" style={{ color: "var(--danger)" }}>{state.error}</div> : null}
    </div>
  );
}
