"use client";
// Kawałki ekranu ustawień, które potrzebują stanu: wybór dostawcy modelu (własna lista, nie systemowa) i instrukcja podłączenia klienta w zakładkach.
import { useState } from "react";
import { Picker } from "@/components/canvas/widgets";
import { CopyButton } from "./CopyButton";

const PROVIDERS: Record<string, string> = { "": "automatycznie", anthropic: "Claude", openai: "GPT" };

export function ProviderPicker({ value, available, action }: { value: string; available: string[]; action: (fd: FormData) => Promise<void> }) {
  const [v, setV] = useState(value);
  const opts = ["", ...available];
  return (
    <form action={action} className="row" style={{ gap: "var(--s-3)" }}>
      <input type="hidden" name="aiProvider" value={v} />
      <Picker cls="boxed" title="Dostawca modelu dla agenta wbudowanego" trigger={<>{PROVIDERS[v] ?? v}</>} onPick={(k) => { setV(k); }}
        options={opts.map((k) => ({ key: k, on: k === v, node: <span>{PROVIDERS[k] ?? k}</span> }))} />
      <button className="pill" type="submit">Zapisz</button>
    </form>
  );
}

const CLIENTS = [
  { key: "claude", name: "Aplikacja Claude" },
  { key: "code", name: "Claude Code" },
  { key: "gpt", name: "ChatGPT" },
] as const;

export function ClientGuide({ mcp }: { mcp: string }) {
  const [tab, setTab] = useState<(typeof CLIENTS)[number]["key"]>("claude");
  const cmd = `claude mcp add --transport http task-hub ${mcp}`;
  return (
    <div className="stack">
      <div className="tabs" role="tablist" aria-label="Klient">
        {CLIENTS.map((c) => <button key={c.key} className={"seg" + (tab === c.key ? " on" : "")} role="tab" aria-selected={tab === c.key} type="button" onClick={() => setTab(c.key)}>{c.name}</button>)}
      </div>
      {tab === "claude" ? (
        <ol className="steps">
          <li>W Claude (przeglądarka, komputer albo telefon) otwórz <b>Ustawienia → Connectors → Add custom connector</b>.</li>
          <li>Nazwa: <b>Task Hub</b>, adres: konektora jak wyżej. Zatwierdź <b>Add</b>, potem <b>Connect</b>.</li>
          <li>Otworzy się strona Task Hub z prośbą o zgodę: potwierdź hasłem aplikacji. Połączenie pojawi się na liście powyżej.</li>
        </ol>
      ) : tab === "code" ? (
        <ol className="steps">
          <li>W terminalu uruchom:<div className="row" style={{ marginTop: 6, gap: "var(--s-3)" }}><pre className="code" style={{ flex: 1 }}>{cmd}</pre><CopyButton text={cmd} /></div></li>
          <li>W Claude Code wpisz <b>/mcp</b>, wybierz <b>task-hub</b> i zaloguj się w przeglądarce.</li>
          <li>Bez logowania: utwórz token powyżej i dopisz do komendy <code>--header &quot;Authorization: Bearer TWÓJ_TOKEN&quot;</code>.</li>
        </ol>
      ) : (
        <ol className="steps">
          <li>W ChatGPT otwórz <b>Settings → Connectors → Create</b>.</li>
          <li>Podaj adres konektora jak wyżej, uwierzytelnianie <b>OAuth</b>.</li>
          <li>Dalej jak w aplikacji Claude: zgoda na stronie Task Hub, potwierdzenie hasłem.</li>
        </ol>
      )}
    </div>
  );
}
