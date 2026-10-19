"use client";
// Rejestr połączeń w ustawieniach: do jakich aplikacji agent ma dostęp, na jakim koncie, dla której firmy i przez co.
// Układ jak w widoku Projekty: firmy nad połączeniami (odpowiada wprost na pytanie „co zniknie, gdy odejdę z firmy X”),
// osobno „zawodowe bez firmy” (to, co zgłosił mostek, a Piotr jeszcze nie przypisał) i „prywatne”.
// Wiersz: ikona aplikacji, nazwa i konto do edycji klikiem, wybór firmy, stan (wybór dla wpisów ręcznych; wpisy mostka mają stan
// z mostka, więc tylko wyszarzony opis), usunięcie z pytaniem w dymku. Nowe połączenie dopisuje się w linii tytułu, jak nowy projekt.
import { useState, useTransition } from "react";
import { createConnectionAction, removeConnection, updateConnectionAction, type ConnectionPatch } from "@/app/actions";
import { InlineName, Picker, RemovePop } from "@/components/canvas/widgets";
import { Icon, ToolIcon, toolColor } from "@/components/canvas/ui";
import { CopyButton } from "./CopyButton";
import { CONNECTION_STATE_LABELS, TOOL_LABELS, type Company, type Connection, appOfLabel } from "@/lib/schema";

const APP_NAMES: Record<string, string> = { ...TOOL_LABELS, notion: "Notion", hubspot: "HubSpot", clockify: "Clockify", fireflies: "Fireflies", drive: "Dysk Google", linkedin: "LinkedIn", jira: "Jira", taskhub: "Task Hub" };
const appName = (app: string) => APP_NAMES[app] ?? app;
// „gdzie to połączenie jest podpięte”: jedna lista zamiast dwóch pól (przez co + rodzaj)
const WHERE: { key: string; label: string; provider: Connection["provider"]; kind: Connection["kind"] }[] = [
  { key: "claude", label: "konektor w aplikacji Claude", provider: "claude", kind: "mcp" },
  { key: "code", label: "Claude Code na komputerze", provider: "claude-code", kind: "mcp" },
  { key: "ical", label: "kalendarz iCal (adres)", provider: "taskhub", kind: "ical" },
  { key: "imap", label: "skrzynka e-mail IMAP", provider: "taskhub", kind: "imap" },
];
const whereOf = (c: Pick<Connection, "provider" | "kind">) => WHERE.find((w) => w.provider === c.provider && w.kind === c.kind) ?? WHERE.find((w) => w.provider === c.provider) ?? WHERE[0];
const ago = (iso: string | null) => {
  if (!iso) return "jeszcze nie sprawdzone";
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  return "sprawdzone " + (s < 60 ? "przed chwilą" : s < 3600 ? `${Math.round(s / 60)} min temu` : s < 86400 ? `${Math.round(s / 3600)} godz. temu` : `${Math.round(s / 86400)} dni temu`);
};
const plural = (n: number, a: string, b: string, c: string) => `${n} ${n === 1 ? a : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? b : c}`;

// konto albo adres: tekst w wierszu, klik → pole; pusty = kursywą podpowiedź
function Cell({ value, placeholder, label, onSave }: { value: string; placeholder: string; label: string; onSave: (v: string) => void }) {
  const [edit, setEdit] = useState(false);
  const done = (v: string) => { setEdit(false); const n = v.trim(); if (n !== value.trim()) onSave(n); };
  if (edit) return <input className="in cell" defaultValue={value} placeholder={placeholder} aria-label={label} autoFocus onFocus={(e) => e.currentTarget.select()} onBlur={(e) => done(e.currentTarget.value)}
    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); done(e.currentTarget.value); } else if (e.key === "Escape") { e.preventDefault(); setEdit(false); } }} />;
  return <button type="button" className={"il cell" + (value ? "" : " blank")} title={label + ": kliknij, aby zmienić"} onClick={() => setEdit(true)}><span className="il-t">{value || placeholder}</span><Icon k="pen" size={11} sw={1.8} /></button>;
}

type Bucket = { id: string; name: string; icon: string; hint?: string; rows: Connection[] };

export function ConnectionsPanel({ connections, companies }: { connections: Connection[]; companies: Company[] }) {
  const [, start] = useTransition();
  const [adding, setAdding] = useState(false);
  const patch = (id: string, p: ConnectionPatch) => start(() => updateConnectionAction(id, p));
  const active = connections.filter((c) => c.state === "active").length;
  // jedna lista „czyje to konto”: firmy, zawodowe bez firmy, prywatne (sfera wynika z wyboru)
  const owner = (c: Connection) => (c.companyId && companies.some((x) => x.id === c.companyId) ? c.companyId : c.sphere === "private" ? "private" : "work");
  const ownerOpts = (cur: string) => [
    ...companies.filter((x) => !x.endedAt || x.id === cur).map((x) => ({ key: x.id, on: x.id === cur, node: <span>{x.name}</span> })),
    { key: "work", on: cur === "work", node: <span>zawodowe, bez firmy</span> },
    { key: "private", on: cur === "private", node: <span>prywatne</span> },
  ];
  const ownerLabel = (key: string) => (key === "private" ? "prywatne" : key === "work" ? "zawodowe, bez firmy" : companies.find((x) => x.id === key)?.name ?? "firma");
  const setOwner = (id: string, key: string) => { const co = companies.find((x) => x.id === key); patch(id, co ? { companyId: co.id, sphere: co.sphere } : { companyId: null, sphere: key === "private" ? "private" : "work" }); };
  const buckets: Bucket[] = [
    ...companies.map((x) => ({ id: x.id, name: x.name, icon: "company", rows: connections.filter((c) => c.companyId === x.id) })),
    { id: "work", name: "Zawodowe, bez firmy", icon: "company", hint: "Przypisz firmę, żeby agent wiedział, czyje to konto i co zniknie po zakończeniu współpracy.", rows: connections.filter((c) => !c.companyId && c.sphere === "work") },
    { id: "private", name: "Prywatne", icon: "manual", rows: connections.filter((c) => !c.companyId && c.sphere === "private") },
  ].filter((b) => b.rows.length || (b.id !== "work" && b.id !== "private"));

  const row = (c: Connection) => {
    const w = whereOf(c), bridge = c.source === "bridge";
    const sub = [appName(c.app), bridge && c.provider !== "claude" ? `${w.label}${c.host ? ` (${c.host})` : ""}` : w.label, bridge ? ago(c.seenAt) : null, c.kind === "ical" || c.kind === "imap" ? null : c.url?.replace(/^https?:\/\//, "")].filter(Boolean).join(" · ");
    return (
      <div key={c.id} id={"conn-" + c.id} className={"lrow arow prow conn" + (c.state === "active" ? "" : " dim")}>
        <div className="p-head">
          <span className="c-ico" style={{ ["--c" as string]: toolColor(c.app) }} aria-hidden="true"><ToolIcon tool={c.app} size={16} /></span>
          <span className="conn-main">
            <InlineName name={c.label} label="Nazwa połączenia" onRename={(n) => patch(c.id, { label: n, ...(bridge ? {} : { app: appOfLabel(n) }) })} />
            <span className="conn-sub">{sub}</span>
          </span>
          <Cell value={c.account ?? ""} placeholder="konto / adres e-mail" label="Konto po stronie aplikacji" onSave={(v) => patch(c.id, { account: v || null })} />
          {c.kind === "ical" || c.kind === "imap" ? <Cell value={c.url ?? ""} placeholder={c.kind === "ical" ? "adres kalendarza" : "serwer IMAP"} label={c.kind === "ical" ? "Adres kalendarza iCal" : "Serwer IMAP"} onSave={(v) => patch(c.id, { url: v || null })} /> : null}
          <Picker cls="boxed" title="Czyje to konto: firma, zawodowe bez firmy albo prywatne" trigger={<span className="pp-t">{ownerLabel(owner(c))}</span>} onPick={(k) => setOwner(c.id, k)} options={ownerOpts(owner(c))} />
          {bridge
            ? <span className={"st" + (c.state === "active" ? " active" : "")} title="Stan zgłasza mostek z komputera">{CONNECTION_STATE_LABELS[c.state]}</span>
            : <Picker cls="boxed" title="Czy połączenie działa" trigger={<span className="pp-t">{CONNECTION_STATE_LABELS[c.state]}</span>} onPick={(k) => patch(c.id, { state: k as Connection["state"] })}
                options={(["active", "expired", "off"] as const).map((k) => ({ key: k, on: k === c.state, node: <span>{CONNECTION_STATE_LABELS[k]}</span> }))} />}
          <span className="p-act">
            <RemovePop label="Usuń połączenie" question={`Usunąć „${c.label}” z rejestru? Kroki, które je wskazują, zostaną bez wskazania.${bridge ? " Mostek dopisze je znowu, jeśli nadal je widzi." : ""}`} onYes={() => start(() => removeConnection(c.id))} />
          </span>
        </div>
      </div>
    );
  };

  return (
    <div className="conn-reg" id="registry">
      <div className="conn-title">
        <h3 className="set-sub">Do czego agent ma dostęp{connections.length ? <span className="sub"> · {plural(active, "działa", "działają", "działa")} z {connections.length}</span> : null}</h3>
        {adding ? <NewConnection companies={companies} onDone={() => setAdding(false)} /> : <button type="button" className="btn primary" onClick={() => setAdding(true)}>Nowe połączenie</button>}
      </div>
      <p className="sub" style={{ margin: 0 }}>Mostek zgłasza konektory ze swojego komputera sam. Resztę (konektory w aplikacji Claude, kalendarze) dopisz tutaj, żeby agent wiedział, czym dysponuje i z którego konta pisać.</p>
      {buckets.map((b) => (
        <div key={b.id} className="crow">
          <div className="lrow arow prow c-head">
            <div className="p-head">
              <span className="c-ico" aria-hidden="true"><Icon k={b.icon} size={16} sw={1.7} /></span>
              <span className="a-title p-name"><span className="ct">{b.name}</span></span>
              <span className="a-stats">{b.rows.length ? `${plural(b.rows.length, "połączenie", "połączenia", "połączeń")} · ${b.rows.filter((c) => c.state === "active").length} działa` : "brak połączeń"}</span>
            </div>
          </div>
          <div className="c-projects">
            {b.rows.length ? b.rows.map(row) : <span className="sub">{b.hint ?? "Brak połączeń tej firmy. Przypisz je wyborem w wierszu albo dodaj nowe."}</span>}
            {b.rows.length && b.hint ? <span className="sub">{b.hint}</span> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

// nowe połączenie w linii tytułu: nazwa, gdzie podpięte, czyje; konto i adres uzupełnia się potem klikiem w wierszu
function NewConnection({ companies, onDone }: { companies: Company[]; onDone: () => void }) {
  const [pending, start] = useTransition();
  const [where, setWhere] = useState("claude");
  const [own, setOwn] = useState<string>(companies.find((c) => !c.endedAt)?.id ?? "work");
  const w = WHERE.find((x) => x.key === where) ?? WHERE[0];
  const co = companies.find((c) => c.id === own) ?? null;
  const submit = (label: string) => start(async () => {
    await createConnectionAction({ label, app: appOfLabel(label), provider: w.provider, kind: w.kind, companyId: co?.id ?? null, sphere: co ? co.sphere : own === "private" ? "private" : "work" });
    onDone();
  });
  return (
    <form className="p-new" autoComplete="off" onSubmit={(e) => { e.preventDefault(); const v = (new FormData(e.currentTarget).get("name") as string).trim(); if (v) submit(v); }}>
      <input className="in" name="name" type="text" aria-label="Nazwa połączenia" placeholder="Nazwa jak w konektorze, np. Slack Pirxey" autoFocus onKeyDown={(e) => { if (e.key === "Escape") onDone(); }} />
      <Picker cls="boxed" title="Gdzie to połączenie jest podpięte" trigger={<span className="pp-t">{w.label}</span>} onPick={setWhere} options={WHERE.map((x) => ({ key: x.key, on: x.key === where, node: <span>{x.label}</span> }))} />
      <Picker cls="boxed" title="Czyje to konto" trigger={<span className="pp-t">{co?.name ?? (own === "private" ? "prywatne" : "zawodowe, bez firmy")}</span>} onPick={setOwn}
        options={[...companies.filter((c) => !c.endedAt).map((c) => ({ key: c.id, on: c.id === own, node: <span>{c.name}</span> })), { key: "work", on: own === "work", node: <span>zawodowe, bez firmy</span> }, { key: "private", on: own === "private", node: <span>prywatne</span> }]} />
      <button className="btn primary" type="submit" disabled={pending}>{pending ? "Dodaję…" : "Dodaj"}</button>
      <button className="icobtn" type="button" aria-label="Anuluj" onClick={onDone}><Icon k="x" size={12} sw={2} /></button>
    </form>
  );
}

// gotowa konfiguracja dla nowego silnika (Claude Code na innym komputerze albo koncie): Task Hub plus każdy konektor MCP z adresem
export function EngineConfig({ connections, mcp }: { connections: Connection[]; mcp: string }) {
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "mcp";
  const lines = [`claude mcp add --transport http task-hub ${mcp}`, ...connections.filter((c) => c.kind === "mcp" && c.url && /^https?:\/\//.test(c.url) && c.state !== "off").map((c) => `claude mcp add --transport ${(c.meta.transport as string)?.toLowerCase() === "sse" ? "sse" : "http"} ${slug(String(c.meta.server ?? c.label))} ${c.url}`)];
  const text = lines.join("\n");
  return (
    <div className="stack" style={{ gap: "var(--s-3)" }}>
      <p className="sub" style={{ margin: 0 }}>Komendy odtwarzają podłączenia w Claude Code na innym komputerze albo koncie; każdy konektor wymaga potem logowania (/mcp). Połączenia bez adresu (konektory w aplikacji Claude) dodaje się ręcznie w tamtym kliencie.</p>
      <div className="row" style={{ gap: "var(--s-3)", alignItems: "flex-start" }}><pre className="code" style={{ flex: 1 }}>{text}</pre><CopyButton text={text} /></div>
    </div>
  );
}
