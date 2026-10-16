// Zasady pracy: ogólne, projektu, narzędzia. Jedno źródło prawdy dla agenta w aplikacji i klientów MCP.
// Pasek u góry jak na kanwie (wstecz, szukajka, agent); formularz z własnymi listami wyboru, projekt albo narzędzie tylko gdy zakres tego wymaga.
import { requireOwner } from "@/lib/session";
import * as repo from "@/lib/repo";
import { availableProviders } from "@/lib/ai";
import { agentLabel, indexFrom } from "@/lib/search";
import { bundle } from "@/lib/services";
import { toolLabel, type Rule } from "@/lib/schema";
import { PendingButton } from "@/components/Pending";
import { RuleForm } from "@/components/RuleForm";
import { HashOpener, PageBar } from "@/components/PageBar";
import { projColor } from "@/components/canvas/ui";
import { removeRule, saveRule } from "../actions";

export const dynamic = "force-dynamic";

export default async function Rules() {
  const o = await requireOwner();
  const b = await bundle(o.id);
  const rules = b.rules, projects = b.projects.map((p) => ({ id: p.id, name: p.name, color: p.color }));
  const avail = availableProviders();
  const proj = (id: string | null) => projects.find((p) => p.id === id) ?? null;
  const groups: { key: Rule["scope"]; title: string; hint: string }[] = [
    { key: "global", title: "Ogólne", hint: "Twój styl i preferencje, stosowane zawsze." },
    { key: "project", title: "Projektu", hint: "Język, styl ticketów, kanały, klient." },
    { key: "tool", title: "Narzędzia", hint: "Jak pisać w Slacku, mailu, ClickUpie." },
  ];
  return (
    <main className="page withbar">
      <PageBar title="Zasady pracy" index={indexFrom(b)} screen="rules" agent={agentLabel(avail)} aiOn={avail.length > 0} />
      <HashOpener />
      <p className="sub" style={{ marginTop: 0 }}>Agent w aplikacji, Claude, Claude Code i GPT dostają te zasady przy każdym zadaniu (przez konektor MCP albo w prompcie). Klienci trzymają u siebie tylko konfigurację narzędzi.</p>
      {groups.map((g) => {
        const list = rules.filter((r) => r.scope === g.key);
        return (
          <section key={g.key}>
            <h2 className="sec">{g.title} ({list.length}) <span style={{ textTransform: "none", letterSpacing: 0 }}>· {g.hint}</span></h2>
            <div className="stack">
              {list.map((r) => {
                const pr = r.scope === "project" ? proj(r.projectId) : null;
                return (
                  <div key={r.id} id={"rule-" + r.id} className="card rule">
                    <div>
                      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                        <b>{r.title}</b>
                        {r.scope === "project" ? <span className="chip">{pr ? <span className="pdot" style={{ ["--c" as string]: projColor(pr.color) }} /> : null}{pr?.name ?? "projekt usunięty"}</span> : null}
                        {r.scope === "tool" ? <span className="chip">{toolLabel(r.tool ?? "")}</span> : null}
                      </div>
                      <p>{r.body}</p>
                      <details className="edit" style={{ marginTop: 8 }}><summary>Edytuj</summary><RuleForm r={r} projects={projects} action={saveRule} /></details>
                    </div>
                    <form action={removeRule.bind(null, r.id)}><PendingButton className="pill danger">Usuń</PendingButton></form>
                  </div>
                );
              })}
              {list.length ? null : <p className="sub" style={{ margin: 0 }}>Jeszcze nic tu nie ma.</p>}
            </div>
          </section>
        );
      })}
      <h2 className="sec" id="new-rule">Nowa zasada</h2>
      <div className="card"><RuleForm projects={projects} action={saveRule} /></div>
    </main>
  );
}
