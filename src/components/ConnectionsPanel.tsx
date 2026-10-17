"use client";
// Rejestr połączeń w ustawieniach: do jakich aplikacji agent ma dostęp, przez co, na jakim koncie i dla której firmy.
// Wpisy z mostka (Claude Code na komputerze) odświeża sam mostek; ręczne opisują resztę (konektory w Claude, kalendarze).
// Każda komórka zmienia się w miejscu: nazwa i konto klikiem, firma, sfera i stan własnym wyborem; usunięcie pyta w dymku.
import { useState, useTransition } from "react";
import { createConnectionAction, removeConnection, updateConnectionAction, type ConnectionPatch } from "@/app/actions";
import { Picker, RemovePop } from "@/components/canvas/widgets";
import { Icon, ToolIcon, toolColor } from "@/components/canvas/ui";
import { CopyButton } from "./CopyButton";
import { CONNECTION_KIND_LABELS, CONNECTION_PROVIDER_LABELS, CONNECTION_STATE_LABELS, TOOL_LABELS, type Company, type Connection, appOfLabel } from "@/lib/schema";

const SPHERE: Record<Connection["sphere"], string> = { work: "zawodowe", private: "prywatne" };
const APPS: [string, string][] = [...Object.entries(TOOL_LABELS).filter(([k]) => !["claude", "claudeapp", "code", "manual", "browser"].includes(k)), ["notion", "Notion"], ["hubspot", "HubSpot"], ["clockify", "Clockify"], ["fireflies", "Fireflies"], ["drive", "Dysk Google"], ["linkedin", "LinkedIn"], ["jira", "Jira"]];
const appLabel = (app: string) => TOOL_LABELS[app] ?? APPS.find(([k]) => k === app)?.[1] ?? app;
const ago = (iso: string | null) => {
  if (!iso) return "nigdy";
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  return s < 60 ? "przed chwilą" : s < 3600 ? `${Math.round(s / 60)} min temu` : s < 86400 ? `${Math.round(s / 3600)} godz. temu` : `${Math.round(s / 86400)} dni temu`;
};

// tekst, który zmienia się w miejscu: klik otwiera pole, Enter albo zejście z pola zapisuje, Esc cofa
function Cell({ value, placeholder, label, onSave }: { value: string; placeholder: string; label: string; onSave: (v: string) => void }) {
  const [edit, setEdit] = useState(false);
  const done = (v: string) => { setEdit(false); const n = v.trim(); if (n !== value.trim()) onSave(n); };
  if (edit) return <input className="in" defaultValue={value} placeholder={placeholder} aria-label={label} autoFocus onFocus={(e) => e.currentTarget.select()} onBlur={(e) => done(e.currentTarget.value)}
    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); done(e.currentTarget.value); } else if (e.key === "Escape") { e.preventDefault(); setEdit(false); } }} />;
  return <button type="button" className={"il cell" + (value ? "" : " blank")} title={label + ": kliknij, aby zmienić"} onClick={() => setEdit(true)}><span className="il-t">{value || placeholder}</span><Icon k="pen" size={11} sw={1.8} /></button>;
}

export function ConnectionsPanel({ connections, companies, mcp }: { connections: Connection[]; companies: Company[]; mcp: string }) {
  const [, start] = useTransition();
  const [adding, setAdding] = useState(false);
  const patch = (id: string, p: ConnectionPatch) => start(() => updateConnectionAction(id, p));
  const cname = (id: string | null) => (id ? companies.find((c) => c.id === id)?.name ?? "firma" : null);
  // wybór firmy ustawia też sferę: firma prywatna → połączenie prywatne; „bez firmy” zostawia sferę do wyboru
  const companyOpts = (c: Connection) => [{ key: "", on: !c.companyId, node: <span>bez firmy</span> }, ...companies.filter((x) => !x.endedAt || x.id === c.companyId).map((x) => ({ key: x.id, on: x.id === c.companyId, node: <span>{x.name}</span> }))];
  const onCompany = (c: Connection, key: string) => { const co = companies.find((x) => x.id === key); patch(c.id, { companyId: key || null, ...(co ? { sphere: co.sphere } : {}) }); };
  const active = connections.filter((c) => c.state === "active");
  return (
    <div className="stack" id="registry">
      <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: "var(--s-3)" }}>
        <p className="sub" style={{ margin: 0, flex: 1, minWidth: 240 }}>
          {connections.length ? `Agent ma dostęp do ${active.length} z ${connections.length} ${connections.length === 1 ? "połączenia" : "połączeń"}. ` : "Jeszcze pusto. "}
          Mostek na komputerze zgłasza swoje konektory sam; resztę (konektory w aplikacji Claude, kalendarze) dopisz tutaj, żeby agent wiedział, czym dysponuje i z którego konta pisać.
        </p>
        {!adding ? <button type="button" className="pill" onClick={() => setAdding(true)}>Nowe połączenie</button> : null}
      </div>
      {adding ? <NewConnection companies={companies} onDone={() => setAdding(false)} /> : null}
      {connections.length ? (
        <table className="t conn">
          <thead><tr><th>Aplikacja</th><th>Konto</th><th>Firma</th><th>Sfera</th><th>Przez</th><th>Stan</th><th>Sprawdzone</th><th /></tr></thead>
          <tbody>{connections.map((c) => (
            <tr key={c.id} className={c.state === "active" ? "" : "dim"}>
              <td><span className="conn-app"><span className="sr-ic" style={{ ["--c" as string]: toolColor(c.app) }}><ToolIcon tool={c.app} size={14} /></span>
                <span className="conn-l"><Cell value={c.label} placeholder="nazwa" label="Nazwa połączenia" onSave={(v) => patch(c.id, { label: v, ...(c.source === "manual" ? { app: appOfLabel(v) } : {}) })} />
                  {appLabel(c.app) !== c.label ? <span className="sub">{appLabel(c.app)}{c.host ? ` · ${c.host}` : ""}</span> : c.host ? <span className="sub">{c.host}</span> : null}</span></span></td>
              <td><Cell value={c.account ?? ""} placeholder="konto / adres" label="Konto po stronie aplikacji" onSave={(v) => patch(c.id, { account: v || null })} /></td>
              <td><Picker cls="boxed" title="Firma, do której należy to konto" trigger={<span className="pp-t">{cname(c.companyId) ?? "bez firmy"}</span>} onPick={(k) => onCompany(c, k)} options={companyOpts(c)} /></td>
              <td><Picker cls="boxed" title="Sfera: zawodowe albo prywatne" trigger={<span className="pp-t">{SPHERE[c.sphere]}</span>} onPick={(k) => patch(c.id, { sphere: k as Connection["sphere"] })}
                options={(["work", "private"] as const).map((k) => ({ key: k, on: k === c.sphere, node: <span>{SPHERE[k]}</span> }))} /></td>
              <td><span className="sub" title={CONNECTION_KIND_LABELS[c.kind]}>{CONNECTION_PROVIDER_LABELS[c.provider]}</span></td>
              <td><Picker cls="boxed" title="Czy połączenie działa" trigger={<span className={"st" + (c.state === "active" ? " active" : "")}>{CONNECTION_STATE_LABELS[c.state]}</span>} onPick={(k) => patch(c.id, { state: k as Connection["state"] })}
                options={(["active", "expired", "off"] as const).map((k) => ({ key: k, on: k === c.state, node: <span>{CONNECTION_STATE_LABELS[k]}</span> }))} /></td>
              <td><span className="sub" title={c.seenAt ?? ""}>{c.source === "bridge" ? ago(c.seenAt) : "ręcznie"}</span></td>
              <td style={{ textAlign: "right" }}><RemovePop label="Usuń połączenie" question={`Usunąć „${c.label}” z rejestru? Kroki, które je wskazują, zostaną bez wskazania.${c.source === "bridge" ? " Mostek dopisze je znowu, jeśli nadal je widzi." : ""}`} onYes={() => start(() => removeConnection(c.id))} /></td>
            </tr>
          ))}</tbody>
        </table>
      ) : null}
      <EngineConfig connections={connections} mcp={mcp} />
    </div>
  );
}

function NewConnection({ companies, onDone }: { companies: Company[]; onDone: () => void }) {
  const [pending, start] = useTransition();
  const [label, setLabel] = useState("");
  const [app, setApp] = useState<string | null>(null);
  const [account, setAccount] = useState("");
  const [companyId, setCompanyId] = useState<string>("");
  const [provider, setProvider] = useState<Connection["provider"]>("claude");
  const [kind, setKind] = useState<Connection["kind"]>("mcp");
  const [url, setUrl] = useState("");
  const guessed = app ?? appOfLabel(label || "x");
  const company = companies.find((c) => c.id === companyId) ?? null;
  const submit = () => { if (!label.trim()) return; start(async () => { await createConnectionAction({ label, app: guessed, account: account || null, companyId: companyId || null, sphere: company ? company.sphere : companyId ? "work" : "private", provider, kind, url: url || null }); onDone(); }); };
  return (
    <div className="conn-new">
      <div className="field"><div className="lbl">Nazwa (jak w konektorze)</div><input className="in" value={label} placeholder="np. Slack Pirxey, Gmail prywatny" aria-label="Nazwa połączenia" autoFocus onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") submit(); if (e.key === "Escape") onDone(); }} /></div>
      <div className="field"><div className="lbl">Aplikacja</div>
        <Picker cls="boxed" title="Aplikacja" trigger={<span className="pp-t">{label ? appLabel(guessed) : "z nazwy"}</span>} onPick={(k) => setApp(k)}
          options={APPS.map(([k, v]) => ({ key: k, on: k === guessed, node: <span>{v}</span> }))} /></div>
      <div className="field"><div className="lbl">Konto</div><input className="in" value={account} placeholder="adres e-mail albo nazwa workspace" aria-label="Konto" onChange={(e) => setAccount(e.target.value)} /></div>
      <div className="field"><div className="lbl">Firma</div>
        <Picker cls="boxed" title="Firma" trigger={<span className="pp-t">{company?.name ?? "bez firmy (prywatne)"}</span>} onPick={setCompanyId}
          options={[{ key: "", on: !companyId, node: <span>bez firmy (prywatne)</span> }, ...companies.filter((c) => !c.endedAt).map((c) => ({ key: c.id, on: c.id === companyId, node: <span>{c.name}</span> }))]} /></div>
      <div className="field"><div className="lbl">Przez</div>
        <Picker cls="boxed" title="Gdzie to połączenie jest podpięte" trigger={<span className="pp-t">{CONNECTION_PROVIDER_LABELS[provider]}</span>} onPick={(k) => setProvider(k as Connection["provider"])}
          options={(["claude", "claude-code", "taskhub"] as const).map((k) => ({ key: k, on: k === provider, node: <span>{CONNECTION_PROVIDER_LABELS[k]}</span> }))} /></div>
      <div className="field"><div className="lbl">Rodzaj</div>
        <Picker cls="boxed" title="Rodzaj połączenia" trigger={<span className="pp-t">{CONNECTION_KIND_LABELS[kind]}</span>} onPick={(k) => setKind(k as Connection["kind"])}
          options={(["mcp", "app", "ical", "imap"] as const).map((k) => ({ key: k, on: k === kind, node: <span>{CONNECTION_KIND_LABELS[k]}</span> }))} /></div>
      {kind === "mcp" || kind === "ical" ? <div className="field wide"><div className="lbl">{kind === "ical" ? "Adres kalendarza (iCal)" : "Adres serwera MCP"}</div><input className="in" value={url} placeholder="https://… (bez kluczy w adresie)" aria-label="Adres" onChange={(e) => setUrl(e.target.value)} /></div> : null}
      <div className="actions wide">
        <button type="button" className="pill" disabled={pending || !label.trim()} onClick={submit}>{pending ? "Zapisuję…" : "Dodaj"}</button>
        <button type="button" className="btn" onClick={onDone}>Anuluj</button>
      </div>
    </div>
  );
}

// gotowa konfiguracja dla nowego silnika (np. Claude Code na nowym komputerze albo po zmianie konta): Task Hub plus każdy konektor MCP z adresem
function EngineConfig({ connections, mcp }: { connections: Connection[]; mcp: string }) {
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "mcp";
  const lines = [`claude mcp add --transport http task-hub ${mcp}`, ...connections.filter((c) => c.kind === "mcp" && c.url && /^https?:\/\//.test(c.url) && c.state !== "off").map((c) => `claude mcp add --transport ${(c.meta.transport as string) === "sse" ? "sse" : "http"} ${slug(c.label)} ${c.url}`)];
  const text = lines.join("\n");
  return (
    <div className="stack" style={{ gap: "var(--s-2)" }}>
      <div className="lbl">Konfiguracja dla nowego silnika</div>
      <p className="sub" style={{ margin: 0 }}>Komendy odtwarzają podłączenia w Claude Code na innym komputerze albo koncie; każdy konektor wymaga potem logowania (/mcp). Połączenia bez adresu (konektory w aplikacji Claude, aplikacje) trzeba dodać ręcznie w tamtym kliencie.</p>
      <div className="row" style={{ gap: "var(--s-3)", alignItems: "flex-start" }}><pre className="code" style={{ flex: 1 }}>{text}</pre><CopyButton text={text} /></div>
    </div>
  );
}
