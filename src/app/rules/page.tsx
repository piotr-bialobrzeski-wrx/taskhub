// Zasady pracy w trzech rodzajach: profile (dane), zasady (zawsze w prompcie), procedury (w całości tylko, gdy pasuje wyzwalacz).
// Jedno źródło prawdy dla agenta w aplikacji i klientów MCP. Każda zmiana zostawia wersję w historii, widocznej przy karcie.
// Pasek u góry jak na kanwie (wstecz, szukajka, agent); formularz z własnymi listami wyboru, projekt albo narzędzie tylko gdy zakres tego wymaga.
import { requireOwner } from "@/lib/session";
import * as repo from "@/lib/repo";
import { availableProviders } from "@/lib/ai";
import { agentLabel, indexFrom } from "@/lib/search";
import { bundle } from "@/lib/services";
import { toolLabel, type Rule, type RuleKind } from "@/lib/schema";
import { PendingButton } from "@/components/Pending";
import { RuleForm } from "@/components/RuleForm";
import { HashOpener, PageBar } from "@/components/PageBar";
import { projColor } from "@/components/canvas/ui";
import { removeRule, saveRule } from "../actions";

export const dynamic = "force-dynamic";

const CHANGE: Record<repo.RuleChange, string> = { created: "dodana", updated: "zmieniona", deleted: "usunięta" };
const when = (iso: string) => new Date(iso).toLocaleString("pl-PL", { timeZone: "Europe/Warsaw", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export default async function Rules() {
  const o = await requireOwner();
  const [b, versions] = await Promise.all([bundle(o.id), repo.listRuleVersions(o.id)]);
  const rules = b.rules, projects = b.projects.map((p) => ({ id: p.id, name: p.name, color: p.color })), companies = b.companies.map((c) => ({ id: c.id, name: c.name }));
  const avail = availableProviders();
  const proj = (id: string | null) => projects.find((p) => p.id === id) ?? null;
  const comp = (id: string | null) => companies.find((c) => c.id === id) ?? null;
  const history = new Map<string, repo.RuleVersion[]>();
  for (const v of versions) history.set(v.ruleId, [...(history.get(v.ruleId) ?? []), v]);
  const groups: { key: RuleKind; title: string; hint: string }[] = [
    { key: "profile", title: "Profile", hint: "Fakty o firmach, projektach i narzędziach: język, klient, kanały. Agent dostaje je jako dane." },
    { key: "rule", title: "Zasady", hint: "Krótkie reguły, zawsze w prompcie agenta. Im krócej, tym lepiej je stosuje." },
    { key: "procedure", title: "Procedury", hint: "Dłuższe instrukcje. Agent dostaje pełną treść, gdy pasuje wyzwalacz; inaczej tylko skrót w spisie." },
  ];
  const chars = rules.filter((r) => r.kind !== "procedure").reduce((a, r) => a + r.body.length, 0);
  return (
    <main className="page withbar">
      <PageBar title="Zasady pracy" index={indexFrom(b)} screen="rules" agent={agentLabel(avail)} aiOn={avail.length > 0} />
      <HashOpener />
      <p className="sub" style={{ marginTop: 0 }}>Agent w aplikacji, Claude, Claude Code i GPT dostają te zasady przy każdym zadaniu (przez konektor MCP albo w prompcie). Profile i zasady idą zawsze{chars ? ` (razem ${chars.toLocaleString("pl-PL")} znaków)` : ""}, procedury tylko wtedy, gdy pasują do pracy.</p>
      {groups.map((g) => {
        const list = rules.filter((r) => r.kind === g.key);
        return (
          <section key={g.key}>
            <h2 className="sec">{g.title} ({list.length}) <span style={{ textTransform: "none", letterSpacing: 0 }}>· {g.hint}</span></h2>
            <div className="stack">
              {list.map((r) => {
                const pr = r.scope === "project" ? proj(r.projectId) : null;
                const hist = (history.get(r.id) ?? []).slice(1);   // najnowsza migawka = stan bieżący, pokazujemy wcześniejsze
                return (
                  <div key={r.id} id={"rule-" + r.id} className="card rule">
                    <div>
                      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                        <b>{r.title}</b>
                        {r.scope === "global" ? <span className="chip">ogólna</span> : null}
                        {r.scope === "company" ? <span className="chip" title="Zasada firmy: wchodzi do każdego zadania jej projektów">firma: {comp(r.companyId)?.name ?? "firma usunięta"}</span> : null}
                        {r.scope === "project" ? <span className="chip">{pr ? <span className="pdot" style={{ ["--c" as string]: projColor(pr.color) }} /> : null}{pr?.name ?? "projekt usunięty"}</span> : null}
                        {r.scope === "tool" ? <span className="chip">{toolLabel(r.tool ?? "")}</span> : null}
                        {r.kind === "procedure" && r.trigger ? <span className="chip">gdy: {r.trigger}</span> : null}
                        {r.originCompanyId ? <span className="chip" title="Wypracowana w tej firmie; można ją firmie oddać">z: {comp(r.originCompanyId)?.name ?? "firma usunięta"}</span> : null}
                      </div>
                      {r.kind === "procedure" && r.summary ? <p className="sub" style={{ marginTop: 4 }}>{r.summary}</p> : null}
                      <p>{r.body}</p>
                      <details className="edit" style={{ marginTop: 8 }}><summary>Edytuj</summary><RuleForm r={r} projects={projects} companies={companies} action={saveRule} /></details>
                      {hist.length ? (
                        <details className="edit" style={{ marginTop: 4 }}><summary>Historia zmian ({hist.length})</summary>
                          <div className="stack" style={{ marginTop: 8 }}>
                            {hist.map((v) => (
                              <div key={v.id}>
                                <div className="sub">{when(v.changedAt)} · {CHANGE[v.change]} · {v.title}{v.kind !== r.kind ? ` · ${v.kind}` : ""}</div>
                                <p style={{ margin: "2px 0 0" }}>{v.body}</p>
                              </div>
                            ))}
                          </div>
                        </details>
                      ) : null}
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
      <div className="card"><RuleForm projects={projects} companies={companies} action={saveRule} /></div>
    </main>
  );
}
