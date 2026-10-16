"use client";
// Formularz zasady: zakres z własnej listy (nie systemowej); projekt albo narzędzie pojawia się dopiero, gdy zakres tego wymaga.
// Treść rośnie sama razem z tekstem, bez uchwytu. Widoczność (prywatna/projekt/wspólna) ma znaczenie dopiero przy kilku użytkownikach, więc zostaje domyślna.
import { useState } from "react";
import { Picker } from "@/components/canvas/widgets";
import { GrowTextarea } from "@/components/GrowTextarea";
import { PendingButton } from "@/components/Pending";
import { projColor } from "@/components/canvas/ui";
import { TOOL_LABELS, type Rule } from "@/lib/schema";

const SCOPES: Record<Rule["scope"], string> = { global: "ogólna, stosowana zawsze", project: "dla projektu", tool: "dla narzędzia" };
type Proj = { id: string; name: string; color: number };

export function RuleForm({ r, projects, action }: { r?: Rule; projects: Proj[]; action: (fd: FormData) => Promise<void> }) {
  const [scope, setScope] = useState<Rule["scope"]>(r?.scope ?? "global");
  const [projectId, setProjectId] = useState<string>(r?.projectId && projects.some((p) => p.id === r.projectId) ? r.projectId : projects[0]?.id ?? "");
  const [tool, setTool] = useState<string>(r?.tool && TOOL_LABELS[r.tool] ? r.tool : "slack");
  const proj = projects.find((p) => p.id === projectId) ?? null;
  const dot = (p: Proj) => <span className="pdot" style={{ ["--c" as string]: projColor(p.color) }} />;
  return (
    <form className="stack" action={action}>
      {r ? <input type="hidden" name="id" value={r.id} /> : null}
      <input type="hidden" name="scope" value={scope} />
      <input type="hidden" name="projectId" value={scope === "project" ? projectId : ""} />
      <input type="hidden" name="tool" value={scope === "tool" ? tool : ""} />
      <input type="hidden" name="visibility" value={r?.visibility ?? "private"} />
      <div className="row" style={{ flexWrap: "wrap", alignItems: "flex-end" }}>
        <div className="field"><span>Zakres</span>
          <Picker cls="boxed" title="Zakres zasady" trigger={<span className="pp-t">{SCOPES[scope]}</span>} onPick={(k) => setScope(k as Rule["scope"])}
            options={(Object.keys(SCOPES) as Rule["scope"][]).map((k) => ({ key: k, on: k === scope, node: <span>{SCOPES[k]}</span> }))} /></div>
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
      </div>
      <label className="field"><span>Tytuł</span><input className="in" name="title" defaultValue={r?.title ?? ""} placeholder="np. Styl wiadomości na Slacku" required /></label>
      <label className="field"><span>Treść</span>
        <GrowTextarea name="body" defaultValue={r?.body ?? ""} placeholder="np. Krótko, po polsku, bez emoji, na końcu pytanie o termin." required /></label>
      <div className="actions"><PendingButton className="pill primary">Zapisz</PendingButton></div>
    </form>
  );
}
