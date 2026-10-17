"use client";
// Formularz zasady: rodzaj (profil / zasada / procedura) i zakres z własnych list (nie systemowych); firma, projekt albo narzędzie pojawia się
// dopiero, gdy zakres tego wymaga; skrót i wyzwalacz tylko dla procedury. Pochodzenie (moja albo wypracowana w firmie) tylko, gdy są firmy. Treść rośnie sama razem z tekstem, bez uchwytu.
// Widoczność (prywatna/projekt/wspólna) ma znaczenie dopiero przy kilku użytkownikach, więc zostaje domyślna.
import { useState } from "react";
import { Picker } from "@/components/canvas/widgets";
import { GrowTextarea } from "@/components/GrowTextarea";
import { PendingButton } from "@/components/Pending";
import { projColor } from "@/components/canvas/ui";
import { RULE_KINDS, TOOL_LABELS, type Rule, type RuleKind } from "@/lib/schema";

const KINDS: Record<RuleKind, string> = { profile: "profil: dane o projekcie albo narzędziu", rule: "zasada: zawsze w prompcie", procedure: "procedura: w całości, gdy pasuje wyzwalacz" };
const SCOPES: Record<Rule["scope"], string> = { global: "ogólna, stosowana zawsze", company: "dla firmy", project: "dla projektu", tool: "dla narzędzia" };
const BODY_HINT: Record<RuleKind, string> = {
  profile: "np. Język: angielski. Klient: Shiftwow. Kanał: #shiftwow-dev.",
  rule: "np. Krótko, po polsku, bez emoji, na końcu pytanie o termin.",
  procedure: "np. 1. Tytuł od czasownika. 2. Sekcje: cel, kryteria, uwagi. 3. ...",
};
type Proj = { id: string; name: string; color: number };
type Comp = { id: string; name: string };

export function RuleForm({ r, projects, companies = [], action }: { r?: Rule; projects: Proj[]; companies?: Comp[]; action: (fd: FormData) => Promise<void> }) {
  const [kind, setKind] = useState<RuleKind>(r?.kind ?? "rule");
  const [scope, setScope] = useState<Rule["scope"]>(r?.scope ?? "global");
  const [projectId, setProjectId] = useState<string>(r?.projectId && projects.some((p) => p.id === r.projectId) ? r.projectId : projects[0]?.id ?? "");
  const [companyId, setCompanyId] = useState<string>(r?.companyId && companies.some((c) => c.id === r.companyId) ? r.companyId : companies[0]?.id ?? "");
  const [origin, setOrigin] = useState<string>(r?.originCompanyId && companies.some((c) => c.id === r.originCompanyId) ? r.originCompanyId : "");
  const [tool, setTool] = useState<string>(r?.tool && TOOL_LABELS[r.tool] ? r.tool : "slack");
  const proj = projects.find((p) => p.id === projectId) ?? null;
  const comp = companies.find((c) => c.id === companyId) ?? null;
  const dot = (p: Proj) => <span className="pdot" style={{ ["--c" as string]: projColor(p.color) }} />;
  return (
    <form className="stack" action={action}>
      {r ? <input type="hidden" name="id" value={r.id} /> : null}
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="scope" value={scope} />
      <input type="hidden" name="companyId" value={scope === "company" ? companyId : ""} />
      <input type="hidden" name="projectId" value={scope === "project" ? projectId : ""} />
      <input type="hidden" name="tool" value={scope === "tool" ? tool : ""} />
      <input type="hidden" name="originCompanyId" value={origin} />
      <input type="hidden" name="visibility" value={r?.visibility ?? "private"} />
      <div className="row" style={{ flexWrap: "wrap", alignItems: "flex-end" }}>
        <div className="field"><span>Rodzaj</span>
          <Picker cls="boxed" title="Rodzaj zasady" trigger={<span className="pp-t">{KINDS[kind]}</span>} onPick={(k) => setKind(k as RuleKind)}
            options={RULE_KINDS.map((k) => ({ key: k, on: k === kind, node: <span>{KINDS[k]}</span> }))} /></div>
        <div className="field"><span>Zakres</span>
          <Picker cls="boxed" title="Zakres zasady" trigger={<span className="pp-t">{SCOPES[scope]}</span>} onPick={(k) => setScope(k as Rule["scope"])}
            options={(Object.keys(SCOPES) as Rule["scope"][]).filter((k) => k !== "company" || companies.length).map((k) => ({ key: k, on: k === scope, node: <span>{SCOPES[k]}</span> }))} /></div>
        {scope === "company" ? (
          <div className="field"><span>Firma</span>
            {companies.length ? (
              <Picker cls="boxed" title="Firma, której dotyczy zasada" trigger={<span className="pp-t">{comp?.name ?? "wybierz firmę"}</span>} onPick={setCompanyId}
                options={companies.map((c) => ({ key: c.id, on: c.id === companyId, node: <span>{c.name}</span> }))} />
            ) : <span className="sub" style={{ lineHeight: "34px" }}>Najpierw dodaj firmę w menu → Projekty.</span>}
          </div>
        ) : null}
        {scope === "project" ? (
          <div className="field"><span>Projekt</span>
            {projects.length ? (
              <Picker cls="boxed" title="Projekt, którego dotyczy zasada" trigger={proj ? <>{dot(proj)}<span className="pp-t">{proj.name}</span></> : <span className="pp-t">wybierz projekt</span>} onPick={setProjectId}
                options={projects.map((p) => ({ key: p.id, on: p.id === projectId, node: <>{dot(p)}{p.name}</> }))} />
            ) : <span className="sub" style={{ lineHeight: "34px" }}>Najpierw dodaj projekt w menu → Projekty.</span>}
          </div>
        ) : null}
        {scope === "tool" ? (
          <div className="field"><span>Narzędzie</span>
            <Picker cls="boxed" title="Narzędzie, którego dotyczy zasada" trigger={<span className="pp-t">{TOOL_LABELS[tool]}</span>} onPick={setTool}
              options={Object.entries(TOOL_LABELS).map(([k, v]) => ({ key: k, on: k === tool, node: <span>{v}</span> }))} />
          </div>
        ) : null}
        {companies.length ? (
          <div className="field"><span>Pochodzenie</span>
            <Picker cls="boxed" title="Gdzie zasada została wypracowana: moja zostaje ze mną, firmową można oddać firmie" trigger={<span className="pp-t">{companies.find((c) => c.id === origin)?.name ?? "moja"}</span>} onPick={setOrigin}
              options={[{ key: "", on: !origin, node: <span>moja</span> }, ...companies.map((c) => ({ key: c.id, on: c.id === origin, node: <span>wypracowana w: {c.name}</span> }))]} />
          </div>
        ) : null}
      </div>
      <label className="field"><span>Tytuł</span><input className="in" name="title" defaultValue={r?.title ?? ""} placeholder={kind === "profile" ? "np. Shiftwow" : kind === "procedure" ? "np. User story w ClickUp" : "np. Styl wiadomości na Slacku"} required /></label>
      {kind === "procedure" ? (
        <>
          <label className="field"><span>Skrót do spisu</span><input className="in" name="summary" defaultValue={r?.summary ?? ""} placeholder="jedno zdanie: co obejmuje ta procedura" required /></label>
          <label className="field"><span>Wyzwalacz</span><input className="in" name="trigger" defaultValue={r?.trigger ?? ""} placeholder="słowa po przecinku: narzędzie, temat, słowo z tytułu kroku, np. clickup, story, bug" /></label>
        </>
      ) : null}
      <label className="field"><span>Treść</span>
        <GrowTextarea name="body" defaultValue={r?.body ?? ""} placeholder={BODY_HINT[kind]} required /></label>
      <div className="actions"><PendingButton className="pill primary">Zapisz</PendingButton></div>
    </form>
  );
}
