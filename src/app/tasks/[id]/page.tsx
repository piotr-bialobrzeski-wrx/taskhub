// Wnętrze zadania: nagłówek z priorytetem i powodami, kroki z panelami z bloków, akcje na górze panelu, czat w kontekście zadania.
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOwner, appUrl } from "@/lib/session";
import * as repo from "@/lib/repo";
import { bundle } from "@/lib/services";
import { composeStatic } from "@/lib/agent/compose";
import { handoffPrompt, claudeUrl, codeCommand } from "@/lib/agent/handoff";
import { EXTERNAL_TOOLS, TOOL_LABELS, toolLabel, type Step } from "@/lib/schema";
import { calEst, calibrationFor, estOf, fmtMin, remainCal, spentMin, taskEst, taskSpent } from "@/lib/time";
import { LEVELS } from "@/lib/priority";
import { availableProviders } from "@/lib/ai";
import { Prio, Why } from "@/components/Prio";
import { BlocksView, toolColor } from "@/components/BlockRenderer";
import { ChatBar } from "@/components/ChatBar";
import { PendingButton } from "@/components/Pending";
import { CopyButton } from "@/components/CopyButton";
import { Timer } from "@/components/Timer";
import { addSpent, addStepForm, backToTodo, chat, compose, factPref, handoff, markDone, prepare, removeStep, reopen, saveOutput, saveReport, trashTask, updateStepForm, updateTaskForm } from "../../actions";

export const dynamic = "force-dynamic";

const STATUS: Record<Step["status"], string> = { todo: "do zrobienia", draft: "do zatwierdzenia", done: "gotowe", handoff: "w Claude" };

export default async function TaskPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ step?: string }> }) {
  const { id } = await params;
  const { step: focus } = await searchParams;
  const o = await requireOwner();
  const b = await bundle(o.id);
  const cur = b.scored.find((s) => s.task.id === id);
  if (!cur) notFound();
  const t = cur.task;
  const [factsPerStep, attachments, chatLog] = await Promise.all([
    Promise.all(t.steps.map((s) => repo.listFacts({ stepId: s.id }))),
    repo.listAttachments({ taskId: t.id }),
    repo.listChat(o.id, t.id, 2),
  ]);
  const aiOn = availableProviders().length > 0;
  const lastAgent = [...chatLog].reverse().find((m) => m.role === "agent");
  const titleOf = (sid: string) => t.steps.find((s) => s.id === sid)?.title ?? "?";
  const blockedBy = (s: Step) => s.dependsOn.filter((d) => t.steps.find((x) => x.id === d)?.status !== "done");

  return (
    <main className="app">
      <div className="top">
        <Link className="pill" href="/">← Kanwa</Link>
        <span className="sp" />
        <Link className="pill" href="/rules">Zasady</Link>
        <Link className="pill" href="/settings">Ustawienia</Link>
      </div>

      <section className="card stack">
        <div className="row" style={{ flexWrap: "wrap" }}>
          <Prio score={cur.score} label />
          <h1 style={{ margin: 0, fontSize: 20, flex: 1 }}>{t.title}</h1>
          {cur.project ? <span className={"chip pc-" + cur.project.color}><span className="d" />{cur.project.name} · ważność {cur.project.weight}/5</span> : null}
          {t.due ? <span className="st">termin {t.due}</span> : null}
          {t.doneAt ? <span className="st done">ukończone {t.doneAt.slice(0, 10)}</span> : null}
        </div>
        {t.summary ? <p style={{ margin: 0 }}>{t.summary}</p> : null}
        {t.noteSummary ? <div className="note ok">{t.noteSummary}</div> : null}
        <div className="row sub" style={{ flexWrap: "wrap" }}>
          <span>szacunek {fmtMin(taskEst(t))}</span>
          <span>zostało ~{fmtMin(remainCal(t, b.samples))}</span>
          {taskSpent(t) ? <span>zrobione {fmtMin(taskSpent(t))}</span> : null}
          {t.dependsOn.length ? <span>po: {t.dependsOn.map((d) => b.tasks.find((x) => x.id === d)?.title ?? "?").join(", ")}</span> : null}
        </div>
        <Why score={cur.score} />
        {t.source ? <details className="edit"><summary>Jak wpadło</summary><div className="note">{t.source}</div></details> : null}
        {t.noteText ? <details className="edit"><summary>Notatka końcowa dla agentów</summary><div className="note">{t.noteText}</div></details> : null}
        <details className="edit">
          <summary>Edytuj zadanie</summary>
          <form className="stack" action={updateTaskForm}>
            <input type="hidden" name="id" value={t.id} />
            <label className="field"><span>Tytuł</span><input className="in" name="title" defaultValue={t.title} required /></label>
            <label className="field"><span>Cel</span><textarea className="in" name="summary" defaultValue={t.summary} /></label>
            <label className="field"><span>Jak wpadło</span><textarea className="in" name="source" defaultValue={t.source} /></label>
            <div className="grid2">
              <label className="field"><span>Priorytet</span>
                <select className="in" name="level" defaultValue={t.level}>{[5, 4, 3, 2, 1].map((l) => <option key={l} value={l}>{l} · {LEVELS[l]}</option>)}</select></label>
              <label className="field"><span>Termin</span><input className="in" type="date" name="due" defaultValue={t.due ?? ""} /></label>
              <label className="field"><span>Projekt</span>
                <select className="in" name="projectId" defaultValue={t.projectId ?? ""}><option value="">bez projektu</option>{b.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            </div>
            <div className="actions"><PendingButton className="pill primary">Zapisz</PendingButton></div>
          </form>
          <form action={trashTask.bind(null, t.id)} style={{ marginTop: 12 }}><PendingButton className="pill danger">Do kosza</PendingButton></form>
        </details>
      </section>

      <h2 className="sec">Kroki</h2>
      <div className="stack">
        {t.steps.map((s, i) => {
          const facts = factsPerStep[i];
          const blocks = s.blocks?.length ? s.blocks : composeStatic(s, facts, attachments);
          const waiting = blockedBy(s);
          const cal = calibrationFor(b.samples, s.tool);
          const ext = EXTERNAL_TOOLS.has(s.tool);
          const prompt = s.status === "handoff" ? handoffPrompt(t, s, b.rules, { appUrl: appUrl(), attachments: attachments.filter((a) => a.analysis) }) : null;
          const review = s.review as { summary?: string; links?: string[]; fits?: boolean; warning?: string; pending?: boolean } | null;
          return (
            <section key={s.id} id={s.id} className={`step ${s.status}`} style={focus === s.id ? { boxShadow: "inset 0 0 0 2px var(--accent)" } : undefined}>
              <div className="head">
                <span className="idx">{i + 1}</span>
                <h3>{s.title}</h3>
                <span className="chip"><span className="tool-dot" style={{ ["--c" as string]: toolColor(s.tool) }} />{toolLabel(s.tool)}</span>
                <span className={"st " + s.status}>{STATUS[s.status]}</span>
                <span className="sp" />
                <span className="sub">
                  {fmtMin(estOf(s))}{cal ? ` → ~${fmtMin(calEst(s, b.samples))}` : ""}{spentMin(s) ? ` · zrobione ${fmtMin(spentMin(s))}` : ""}
                </span>
              </div>
              {waiting.length ? <div className="sub warn">Czeka na: {waiting.map(titleOf).join(", ")}</div> : null}

              {/* akcje na górze panelu */}
              <div className="actions">
                {s.link ? <a className="pill" href={s.link} target="_blank" rel="noopener">Otwórz w {toolLabel(s.tool)} ↗</a> : null}
                {s.status === "todo" ? (<>
                  {aiOn && !ext && s.tool !== "manual" ? <form action={prepare.bind(null, t.id, s.id)}><PendingButton busy="Agent przygotowuje…">Przygotuj</PendingButton></form> : null}
                  {aiOn ? <form action={compose.bind(null, t.id, s.id)}><PendingButton busy="Składam…" title="Agent składa panel z faktów, migawek i załączników">Pokaż kontekst</PendingButton></form> : null}
                  <form action={handoff.bind(null, t.id, s.id)}><PendingButton>{ext ? "Oddaj do Claude" : "Zrób w Claude"}</PendingButton></form>
                  <Timer stepId={s.id} onStop={addSpent.bind(null, t.id, s.id)} />
                  <form action={markDone.bind(null, t.id, s.id)}><PendingButton className="pill primary">Gotowe</PendingButton></form>
                </>) : null}
                {s.status === "draft" ? (<>
                  <form action={markDone.bind(null, t.id, s.id)}><PendingButton className="pill primary">Zatwierdź</PendingButton></form>
                  {aiOn ? <form action={prepare.bind(null, t.id, s.id)}><PendingButton busy="Agent poprawia…">Przygotuj od nowa</PendingButton></form> : null}
                  <form action={backToTodo.bind(null, t.id, s.id)}><PendingButton>Odłóż</PendingButton></form>
                </>) : null}
                {s.status === "handoff" ? (<>
                  <a className="pill primary" href={claudeUrl(prompt!)} target="_blank" rel="noopener">Otwórz w Claude ↗</a>
                  <CopyButton text={prompt!} label="Kopiuj prompt" />
                  <CopyButton text={codeCommand(prompt!)} label="Kopiuj komendę Claude Code" />
                  <form action={backToTodo.bind(null, t.id, s.id)}><PendingButton>Cofnij</PendingButton></form>
                </>) : null}
                {s.status === "done" ? <form action={reopen.bind(null, t.id, s.id)}><PendingButton>Otwórz ponownie</PendingButton></form> : null}
              </div>

              {s.status === "handoff" ? (
                <form className="stack" action={saveReport}>
                  <input type="hidden" name="taskId" value={t.id} /><input type="hidden" name="stepId" value={s.id} />
                  <div className="sub">Po pracy w Claude wklej raport (albo pozwól klientowi MCP zgłosić wynik przez complete_step).</div>
                  <textarea className="out" name="report" placeholder="Raport: co powstało, gdzie, link" required />
                  <div className="row"><input className="in" name="link" placeholder="Link do wyniku (opcjonalnie)" /><PendingButton className="pill primary" busy="Odbieram…">Odbierz</PendingButton></div>
                </form>
              ) : null}

              {s.status === "draft" ? (
                <form className="stack" action={saveOutput}>
                  <input type="hidden" name="taskId" value={t.id} /><input type="hidden" name="stepId" value={s.id} />
                  <textarea className="out" name="output" defaultValue={s.output} />
                  <div className="actions"><PendingButton>Zapisz treść</PendingButton></div>
                </form>
              ) : null}

              {review?.summary ? <div className={"note " + (review.fits === false ? "warn" : "")}>{review.summary}{review.warning ? " " + review.warning : ""}{review.links?.length ? <div className="links" style={{ marginTop: 6 }}>{review.links.map((u) => <a key={u} className="pill" href={u} target="_blank" rel="noopener">{u.replace(/^https?:\/\//, "").slice(0, 40)} ↗</a>)}</div> : null}</div> : null}

              {blocks.length ? <BlocksView blocks={blocks} /> : null}

              {facts.length ? (
                <details className="edit">
                  <summary>Fakty kroku ({facts.length}): przypnij lub ukryj, agent zapamięta</summary>
                  <div className="stack">
                    {facts.map((f) => (
                      <div key={f.id} className="row" style={{ fontSize: 12.5 }}>
                        <span style={{ flex: 1 }}><b>{f.label}</b>: {f.value}</span>
                        <form action={factPref.bind(null, t.id, f.id!, { pinned: !f.pinned })}><PendingButton className="pill" title="Zawsze pokazuj">{f.pinned ? "📌 przypięte" : "Przypnij"}</PendingButton></form>
                        <form action={factPref.bind(null, t.id, f.id!, { hidden: !f.hidden })}><PendingButton className="pill" title="Nie pokazuj">{f.hidden ? "ukryte" : "Ukryj"}</PendingButton></form>
                      </div>
                    ))}
                  </div>
                </details>
              ) : null}

              {s.status === "done" && s.report ? <details className="edit"><summary>Raport</summary><div className="note">{s.report}</div></details> : null}

              <details className="edit">
                <summary>Edytuj krok</summary>
                <form className="stack" action={updateStepForm}>
                  <input type="hidden" name="taskId" value={t.id} /><input type="hidden" name="stepId" value={s.id} />
                  <label className="field"><span>Tytuł</span><input className="in" name="title" defaultValue={s.title} required /></label>
                  <label className="field"><span>Szczegóły</span><textarea className="in" name="detail" defaultValue={s.detail} /></label>
                  <div className="grid2">
                    <label className="field"><span>Narzędzie</span>
                      <select className="in" name="tool" defaultValue={s.tool}>{Object.entries(TOOL_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}{TOOL_LABELS[s.tool] ? null : <option value={s.tool}>{s.tool}</option>}</select></label>
                    <label className="field"><span>Szacunek (min, co 15)</span><input className="in" type="number" name="est" min={15} step={15} defaultValue={s.estMin} /></label>
                    <label className="field"><span>Czas zrobiony (min)</span><input className="in" type="number" name="spentMin" min={0} step={5} defaultValue={Math.round(s.spentSec / 60)} /></label>
                    <label className="field"><span>Po kroku</span>
                      <select className="in" name="after" defaultValue={s.dependsOn[0] ?? ""}><option value="">bez zależności</option>{t.steps.filter((x) => x.id !== s.id).map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}</select></label>
                  </div>
                  <label className="field"><span>Link (gdzie to jest w {toolLabel(s.tool)})</span><input className="in" name="link" defaultValue={s.link ?? ""} placeholder="https://…" /></label>
                  <label className="row" style={{ fontSize: 12.5 }}><input type="checkbox" name="needsApproval" defaultChecked={s.needsApproval} /> wymaga zatwierdzenia (wysyła coś na zewnątrz)</label>
                  <div className="actions"><PendingButton className="pill primary">Zapisz</PendingButton></div>
                </form>
                <form action={removeStep.bind(null, t.id, s.id)} style={{ marginTop: 8 }}><PendingButton className="pill danger">Usuń krok</PendingButton></form>
              </details>
            </section>
          );
        })}
      </div>

      <details className="edit card" style={{ marginTop: 12 }}>
        <summary>Dodaj krok ręcznie</summary>
        <form className="stack" action={addStepForm}>
          <input type="hidden" name="taskId" value={t.id} />
          <label className="field"><span>Tytuł</span><input className="in" name="title" required /></label>
          <label className="field"><span>Szczegóły</span><textarea className="in" name="detail" /></label>
          <div className="grid2">
            <label className="field"><span>Narzędzie</span><select className="in" name="tool" defaultValue="manual">{Object.entries(TOOL_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label className="field"><span>Szacunek (min)</span><input className="in" type="number" name="est" min={15} step={15} defaultValue={15} /></label>
            <label className="field"><span>Po kroku</span><select className="in" name="after" defaultValue=""><option value="">bez zależności</option>{t.steps.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}</select></label>
            <label className="field"><span>Link</span><input className="in" name="link" placeholder="https://…" /></label>
          </div>
          <label className="row" style={{ fontSize: 12.5 }}><input type="checkbox" name="needsApproval" /> wymaga zatwierdzenia</label>
          <div className="actions"><PendingButton className="pill primary">Dodaj</PendingButton></div>
        </form>
      </details>

      {lastAgent ? <div className="reply note"><span className="lbl">Agent</span>{lastAgent.text}</div> : null}
      <ChatBar action={chat} taskId={t.id} placeholder="Napisz do agenta o tym zadaniu: dodaj krok, zmień, podaj adresata…" />
    </main>
  );
}
