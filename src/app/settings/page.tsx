// Ustawienia: dostawca modelu, projekty z ważnością, tokeny MCP i instrukcja podłączenia klientów.
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
      <form className="card row" action={saveSettings} style={{ flexWrap: "wrap" }}>
        <span className="sub">Skonfigurowane klucze: {avail.length ? avail.map((a) => a === "anthropic" ? "Claude" : "GPT").join(", ") : "brak (ANTHROPIC_API_KEY albo OPENAI_API_KEY w zmiennych środowiska)"}</span>
        <select className="in" name="aiProvider" defaultValue={pref} style={{ width: "auto" }}>
          <option value="">automatycznie</option><option value="anthropic">Claude</option><option value="openai">GPT</option>
        </select>
        <PendingButton>Zapisz</PendingButton>
      </form>
      {samples.length ? <div className="note" style={{ marginTop: 8 }}>{calibrationText(samples, toolLabel)}</div> : null}

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
        <TokenForm action={createToken} />
        {tokens.length ? (
          <table className="t"><thead><tr><th>Nazwa</th><th>Utworzony</th><th>Ostatnio użyty</th><th /></tr></thead>
            <tbody>{tokens.map((t) => <tr key={t.id}><td>{t.name}</td><td>{t.createdAt.slice(0, 10)}</td><td>{t.lastUsedAt ? t.lastUsedAt.slice(0, 16).replace("T", " ") : "nigdy"}</td><td><form action={revokeToken.bind(null, t.id)}><PendingButton className="pill danger">Unieważnij</PendingButton></form></td></tr>)}</tbody></table>
        ) : null}
        <div className="lbl">Adres serwera MCP</div>
        <pre className="code">{mcp}</pre>
        <div className="lbl">Claude Code</div>
        <pre className="code">{`claude mcp add --transport http task-hub ${mcp} --header "Authorization: Bearer TWÓJ_TOKEN"`}</pre>
        <div className="lbl">Claude (aplikacja) i ChatGPT</div>
        <div className="sub">Dodaj własny konektor MCP z tym adresem i nagłówkiem Authorization: Bearer TWÓJ_TOKEN. Narzędzia: list_tasks, get_task, get_rules, create_task, update_task, add_steps, update_step, complete_step, add_facts, add_snapshot, add_rule.</div>
      </div>
    </main>
  );
}
