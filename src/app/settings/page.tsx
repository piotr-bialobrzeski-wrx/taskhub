// Ustawienia: dostawca modelu (gdy jest klucz), projekty z ważnością, konektory MCP i instrukcja podłączenia klientów.
import Link from "next/link";
import { requireOwner, appUrl } from "@/lib/session";
import * as repo from "@/lib/repo";
import { availableProviders } from "@/lib/ai";
import { calibrationText } from "@/lib/time";
import { toolLabel } from "@/lib/schema";
import { PendingButton } from "@/components/Pending";
import { TokenForm } from "@/components/TokenForm";
import { createToken, removeProject, revokeToken, saveProject, saveSettings } from "../actions";

export const dynamic = "force-dynamic";

export default async function Settings() {
  const o = await requireOwner();
  const [projects, tokens, samples] = await Promise.all([repo.listProjects(o.id), repo.listApiTokens(o.id), repo.listSamples(o.id)]);
  const avail = availableProviders();
  const pref = (o.settings as { aiProvider?: string }).aiProvider ?? "";
  const mcp = appUrl() + "/api/mcp";
  return (
    <main className="app">
      <div className="top"><Link className="pill" href="/">← Kanwa</Link><h1>Ustawienia</h1><span className="sp" /><Link className="pill" href="/rules">Zasady</Link></div>

      <h2 className="sec">Agent</h2>
      {avail.length ? (
        <form className="card row" action={saveSettings} style={{ flexWrap: "wrap" }}>
          <span className="sub">Skonfigurowane klucze: {avail.map((a) => a === "anthropic" ? "Claude" : "GPT").join(", ")}</span>
          <select className="in" name="aiProvider" defaultValue={pref} style={{ width: "auto" }}>
            <option value="">automatycznie</option><option value="anthropic">Claude</option><option value="openai">GPT</option>
          </select>
          <PendingButton>Zapisz</PendingButton>
        </form>
      ) : (
        <div className="card sub">Bez klucza modelu (ANTHROPIC_API_KEY albo OPENAI_API_KEY) agent wbudowany jest wyłączony. Pracę agenta wykonuje Twój Claude z subskrypcji podłączony przez konektor poniżej: rozkłada zadania na kroki, zbiera fakty, układa panele kroków, pisze szkice i zgłasza wyniki.</div>
      )}
      <h2 className="sec">Projekty i ich ważność</h2>
      <div className="stack">
        {projects.map((p) => (
          <form key={p.id} className="card row" action={saveProject} style={{ flexWrap: "wrap" }}>
            <input type="hidden" name="id" value={p.id} />
            <span className={"chip pc-" + p.color}><span className="d" /></span>
            <input className="in" name="name" defaultValue={p.name} style={{ maxWidth: 260 }} required />
            <label className="row" style={{ gap: 6 }}><span className="sub">ważność</span>
              <select className="in" name="weight" defaultValue={p.weight} style={{ width: "auto" }}>{[5, 4, 3, 2, 1].map((w) => <option key={w} value={w}>{w}</option>)}</select></label>
            <label className="row" style={{ gap: 6 }}><span className="sub">język</span><input className="in" name="language" defaultValue={p.language} style={{ width: 70 }} /></label>
            <PendingButton>Zapisz</PendingButton>
            <button className="pill danger" type="submit" formAction={removeProject.bind(null, p.id)}>Usuń</button>
          </form>
        ))}
        <form className="card row" action={saveProject} style={{ flexWrap: "wrap" }}>
          <input className="in" name="name" placeholder="Nowy projekt" style={{ maxWidth: 260 }} required />
          <label className="row" style={{ gap: 6 }}><span className="sub">ważność</span><select className="in" name="weight" defaultValue={3} style={{ width: "auto" }}>{[5, 4, 3, 2, 1].map((w) => <option key={w} value={w}>{w}</option>)}</select></label>
          <label className="row" style={{ gap: 6 }}><span className="sub">język</span><input className="in" name="language" defaultValue="pl" style={{ width: 70 }} /></label>
          <PendingButton className="pill primary">Dodaj</PendingButton>
        </form>
      </div>

      <h2 className="sec">Klienci MCP (Claude, Claude Code, ChatGPT)</h2>
      <div className="card stack">
        <div className="lbl">Adres konektora Task Hub</div>
        <pre className="code">{mcp}</pre>
        <div className="lbl">Aplikacja Claude (przeglądarka, komputer, telefon)</div>
        <div className="sub">Ustawienia Claude → Connectors → Add custom connector → nazwa „Task Hub”, adres jak wyżej → Add → Connect. Otworzy się strona Task Hub z prośbą o zgodę; potwierdzasz hasłem aplikacji. Połączenie pojawi się niżej na liście i można je unieważnić.</div>
        <div className="lbl">Claude Code</div>
        <pre className="code">{`claude mcp add --transport http task-hub ${mcp}`}</pre>
        <div className="sub">Potem w Claude Code wpisz /mcp, wybierz task-hub i zaloguj się w przeglądarce. Zamiast logowania można podać token: dopisz do komendy --header "Authorization: Bearer TWÓJ_TOKEN".</div>
        <div className="lbl">ChatGPT</div>
        <div className="sub">Settings → Connectors → Create → adres jak wyżej, uwierzytelnianie OAuth; dalej jak w aplikacji Claude.</div>
        <div className="lbl">Tokeny i połączenia</div>
        <TokenForm action={createToken} />
        {tokens.length ? (
          <table className="t"><thead><tr><th>Nazwa</th><th>Utworzony</th><th>Ostatnio użyty</th><th /></tr></thead>
            <tbody>{tokens.map((t) => <tr key={t.id}><td>{t.name}</td><td>{t.createdAt.slice(0, 10)}</td><td>{t.lastUsedAt ? t.lastUsedAt.slice(0, 16).replace("T", " ") : "nigdy"}</td><td><form action={revokeToken.bind(null, t.id)}><PendingButton className="pill danger">Unieważnij</PendingButton></form></td></tr>)}</tbody></table>
        ) : <div className="sub">Jeszcze nic nie jest podłączone.</div>}
        <div className="sub">Narzędzia konektora: list_tasks, get_task, get_rules, create_task, update_task, add_steps, update_step, set_blocks, complete_step, add_facts, add_snapshot, add_rule.</div>
      </div>
    </main>
  );
}
