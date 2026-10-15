// Zasady pracy: ogólne, projektu, narzędzia. Jedno źródło prawdy dla agenta w aplikacji i klientów MCP.
import Link from "next/link";
import { requireOwner } from "@/lib/session";
import * as repo from "@/lib/repo";
import { TOOL_LABELS, toolLabel, type Rule } from "@/lib/schema";
import { PendingButton } from "@/components/Pending";
import { removeRule, saveRule } from "../actions";

export const dynamic = "force-dynamic";

function RuleForm({ r, projects }: { r?: Rule; projects: { id: string; name: string }[] }) {
  return (
    <form className="stack" action={saveRule}>
      {r ? <input type="hidden" name="id" value={r.id} /> : null}
      <div className="grid2">
        <label className="field"><span>Zakres</span>
          <select className="in" name="scope" defaultValue={r?.scope ?? "global"}><option value="global">ogólna (zawsze)</option><option value="project">projekt</option><option value="tool">narzędzie</option></select></label>
        <label className="field"><span>Projekt (gdy zakres: projekt)</span>
          <select className="in" name="projectId" defaultValue={r?.projectId ?? ""}><option value="">—</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label className="field"><span>Narzędzie (gdy zakres: narzędzie)</span>
          <select className="in" name="tool" defaultValue={r?.tool ?? ""}><option value="">—</option>{Object.entries(TOOL_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="field"><span>Widoczność</span>
          <select className="in" name="visibility" defaultValue={r?.visibility ?? "private"}><option value="private">prywatna</option><option value="project">projekt</option><option value="shared">wspólna</option></select></label>
      </div>
      <label className="field"><span>Tytuł</span><input className="in" name="title" defaultValue={r?.title ?? ""} placeholder="np. Styl wiadomości na Slacku" required /></label>
      <label className="field"><span>Treść</span><textarea className="in" name="body" defaultValue={r?.body ?? ""} placeholder="np. Krótko, po polsku, bez emoji, na końcu pytanie o termin." required /></label>
      <div className="actions"><PendingButton className="pill primary">Zapisz</PendingButton></div>
    </form>
  );
}

export default async function Rules() {
  const o = await requireOwner();
  const [rules, projects] = await Promise.all([repo.listRules(o.id), repo.listProjects(o.id)]);
  const pname = (id: string | null) => projects.find((p) => p.id === id)?.name ?? "?";
  const groups: { key: Rule["scope"]; title: string; hint: string }[] = [
    { key: "global", title: "Ogólne", hint: "Twój styl i preferencje, stosowane zawsze." },
    { key: "project", title: "Projektu", hint: "Język, styl ticketów, kanały, klient." },
    { key: "tool", title: "Narzędzia", hint: "Jak pisać w Slacku, mailu, ClickUpie." },
  ];
  return (
    <main className="app">
      <div className="top"><Link className="pill" href="/">← Kanwa</Link><h1>Zasady pracy</h1><span className="sp" /><Link className="pill" href="/settings">Ustawienia</Link></div>
      <p className="sub" style={{ marginTop: 0 }}>Agent w aplikacji, Claude, Claude Code i GPT dostają te zasady przy każdym zadaniu (przez konektor MCP albo w prompcie). Klienci trzymają u siebie tylko konfigurację narzędzi.</p>
      {groups.map((g) => {
        const list = rules.filter((r) => r.scope === g.key);
        return (
          <section key={g.key}>
            <h2 className="sec">{g.title} ({list.length}) <span style={{ textTransform: "none", letterSpacing: 0 }}>· {g.hint}</span></h2>
            <div className="stack">
              {list.map((r) => (
                <div key={r.id} className="card rule">
                  <div>
                    <div className="row" style={{ gap: 8 }}><b>{r.title}</b>{r.scope === "project" ? <span className="chip">{pname(r.projectId)}</span> : null}{r.scope === "tool" ? <span className="chip">{toolLabel(r.tool ?? "")}</span> : null}<span className="tag">{r.visibility}</span></div>
                    <p>{r.body}</p>
                    <details className="edit" style={{ marginTop: 8 }}><summary>Edytuj</summary><RuleForm r={r} projects={projects} /></details>
                  </div>
                  <form action={removeRule.bind(null, r.id)}><PendingButton className="pill danger">Usuń</PendingButton></form>
                </div>
              ))}
            </div>
          </section>
        );
      })}
      <h2 className="sec">Nowa zasada</h2>
      <div className="card"><RuleForm projects={projects} /></div>
    </main>
  );
}
