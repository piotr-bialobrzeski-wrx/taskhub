// Wnętrze zadania: kanwa kroków z panelem. Panele (zadania i każdego kroku) są renderowane tu, na serwerze, i przekazywane do kanwy.
import { notFound } from "next/navigation";
import { requireOwner, appUrl } from "@/lib/session";
import * as repo from "@/lib/repo";
import { bundle } from "@/lib/services";
import { composeStatic } from "@/lib/agent/compose";
import { breakdownPrompt, handoffPrompt, claudeUrl, codeCommand } from "@/lib/agent/handoff";
import { EXTERNAL_TOOLS, TOOL_LABELS, toolLabel, type Question, type Step, type Task } from "@/lib/schema";
import { calEst, calibrationFor, estOf, fmtMin, spentMin, taskEst, taskSpent, todayISO } from "@/lib/time";
import { isComplete } from "@/lib/priority";
import { availableProviders } from "@/lib/ai";
import { externalLink } from "@/lib/links";
import { fmtDate, stepTile, taskStateOf, taskWaits, estText as estTextOf } from "@/lib/canvas/vm";
import { Why } from "@/components/Prio";
import { BlocksView } from "@/components/BlockRenderer";
import { PendingButton } from "@/components/Pending";
import { CopyButton } from "@/components/CopyButton";
import { Timer } from "@/components/Timer";
import { TaskCanvas } from "@/components/canvas/TaskCanvas";
import { Icon, plural } from "@/components/canvas/ui";
import { InlineDate, PrioPicker, ProjectPicker } from "@/components/canvas/widgets";
import { addSpent, answerQuestionForm, backToTodo, compose, dismissQuestion, factPref, handoff, linkSteps, linkTasks, markDone, prepare, removeStep, reopen, saveOutput, saveReport, setDue, setLevel, setProject, trashTask, updateStepForm, updateTaskForm } from "../../actions";

export const dynamic = "force-dynamic";

export default async function TaskPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ step?: string }> }) {
  const { id } = await params;
  const { step: focus } = await searchParams;
  const o = await requireOwner();
  const b = await bundle(o.id);
  const cur = b.scored.find((s) => s.task.id === id);
  if (!cur) notFound();
  const t = cur.task;
  const [factsPerStep, attachments, chatLog, groups, questions] = await Promise.all([
    Promise.all(t.steps.map((s) => repo.listFacts({ stepId: s.id }))),
    repo.listAttachments({ taskId: t.id }),
    repo.listChat(o.id, t.id, 2),
    repo.listGroups(o.id, t.id),
    repo.listQuestions(o.id, { taskId: t.id, open: true }),
  ]);
  const providers = availableProviders(), aiOn = providers.length > 0;
  const lastAgent = [...chatLog].reverse().find((m) => m.role === "agent");
  const origin = appUrl();
  const tiles = t.steps.map((s) => stepTile(t, s, b.tasks));
  const stateOf = (s: Step) => tiles.find((x) => x.id === s.id)!.state;
  const waits = taskWaits(t, b.tasks);
  const bp = !t.steps.length && !t.doneAt ? breakdownPrompt(t, b.rules, { appUrl: origin, projectName: cur.project?.name }) : null;

  // ---------- pasek stanu nad kanwą ----------
  const ready = tiles.filter((x) => x.state === "ready").length, handed = tiles.filter((x) => x.state === "handoff").length, drafts = tiles.filter((x) => x.state === "draft").length;
  const runbar = waits.length ? <span className="rb-t"><b>Czeka na zadanie:</b> {waits.map((w) => w.title).join(", ")}</span>
    : isComplete(t) ? <span className="rb-t"><b>Zadanie ukończone.</b> Wszystkie kroki zrobione.</span>
    : bp ? <><span className="rb-t"><b>Brak kroków.</b> {aiOn ? "Napisz w doku, co ma zrobić agent." : "Claude rozłoży je i zapisze tu przez konektor."}</span>{aiOn ? null : <a className="btn primary" href={claudeUrl(bp)} target="_blank" rel="noopener">Rozłóż w Claude</a>}</>
    : ready ? <span className="rb-t"><b>{ready} {ready === 1 ? "krok gotowy" : "kroki gotowe"}</b> do wykonania{ready > 1 ? " równolegle" : ""}</span>
    : handed ? <span className="rb-t"><b>{handed} {handed === 1 ? "krok jest" : "kroki są"} w Claude.</b> Raport wróci przez konektor albo wkleisz go w panelu.</span>
    : drafts ? <span className="rb-t"><b>{drafts} {drafts === 1 ? "szkic czeka" : "szkice czekają"}</b> na Twoje zatwierdzenie</span>
    : <span className="rb-t">Czeka na kroki wykonywane przez Ciebie</span>;

  // ---------- karta pytań agenta ----------
  const q: Question | undefined = questions[0];
  const questionsNode = q ? (
    <>
      <div className="ans-head">
        <span className="lbl" style={{ margin: 0 }}>Pytanie od Claude{q.stepId ? ` · ${t.steps.find((s) => s.id === q.stepId)?.title ?? ""}` : ""}{questions.length > 1 ? ` · jeszcze ${questions.length - 1}` : ""}</span>
        <span className="sp" />
        <form action={dismissQuestion.bind(null, t.id, q.id)}><button className="icobtn" type="submit" aria-label="Odrzuć pytanie" title="Odrzuć pytanie"><Icon k="x" size={12} sw={2} /></button></form>
      </div>
      <div className="ans-text">{q.text}</div>
      <form className="stack" action={answerQuestionForm}>
        <input type="hidden" name="taskId" value={t.id} /><input type="hidden" name="questionId" value={q.id} />
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
        {q.options.length ? <div className="actions">{q.options.map((op, i) => <button key={i} type="submit" name="option" value={op.label} className={"btn" + (q.recommended === i ? " primary" : "")} title={op.note}>{op.label}</button>)}</div> : null}
        <div className="row"><input className="in" name="answer" placeholder={q.options.length ? "Albo odpowiedz własnymi słowami…" : "Twoja odpowiedź…"} /><PendingButton className="btn primary">Odpowiedz</PendingButton></div>
      </form>
    </>
  ) : null;

  // ---------- panel zadania ----------
  const taskBar = <><PrioPicker base={cur.score.base} eff={cur.score.eff} why={cur.score.why.map((w) => `${w.v > 0 ? "+" : ""}${w.v} ${w.txt}`).join("; ")} cls="head" onPick={setLevel.bind(null, t.id)} /><span className="chip">{t.steps.filter((s) => s.status === "done").length}/{t.steps.length} kroków</span></>;
  const taskBody = (
    <>
      <h3>{t.title}</h3>
      {t.summary ? <p>{t.summary}</p> : null}
      <div className="time-row">
        <div><div className="lbl">Projekt</div><ProjectPicker projects={b.projects.map((p) => ({ id: p.id, name: p.name, color: p.color }))} value={t.projectId} cls="boxed" onPick={setProject.bind(null, t.id)} /></div>
        <div><div className="lbl">Termin</div><InlineDate value={t.due} min={todayISO()} onChange={setDue.bind(null, t.id)} /></div>
        <div><div className="lbl">Czas</div><div className="chip" style={{ height: 34, padding: "0 14px" }}>~{fmtMin(taskEst(t))}{taskSpent(t) ? ` · ⏱ ${fmtMin(taskSpent(t))}` : ""}</div></div>
      </div>
      <Why score={cur.score} />
      {t.doneAt ? (
        <div><div className="lbl">Co zostało zrobione · {fmtDate(t.doneAt)}</div>
          {t.noteSummary || t.noteText ? <div className="review"><div>{t.noteSummary ?? t.noteText}</div></div> : <div className="note">Brak podsumowania. Claude dopisze je przez konektor albo wpisz je w notatce.</div>}
          {t.noteText && t.noteText !== t.noteSummary ? <details className="edit" style={{ marginTop: 6 }}><summary>Notatka dla agentów</summary><div className="an">{t.noteText}</div></details> : null}
        </div>
      ) : null}
      {t.source ? <div><div className="lbl">Jak wpadło</div><div className="note">{t.source}</div></div> : null}
      {attachments.length ? (
        <div><div className="lbl">Grafiki i pliki</div>
          <div className="gal">{attachments.map((a) => (
            <div key={a.id} className="gal-item">
              {a.kind === "image" && a.url ? <a href={a.url} target="_blank" rel="noopener"><img src={a.url} alt={a.caption ?? a.name ?? ""} /></a> : <div className="ph">{a.kind === "file" ? "Plik" : "Link"}</div>}
              <div><b>{a.caption ?? a.name ?? "Załącznik"}</b>{a.url && a.kind !== "image" ? <a className="chip" href={a.url} target="_blank" rel="noopener">{a.name ?? a.url}</a> : null}{a.analysis ? <details><summary>Analiza agenta</summary><div className="an">{a.analysis}</div></details> : null}</div>
            </div>
          ))}</div>
        </div>
      ) : null}
      {t.dependsOn.length ? (
        <div><div className="lbl">Zaczyna się po zadaniach</div>
          <div className="deps">{t.dependsOn.map((d) => { const x = b.tasks.find((y) => y.id === d); return x ? (
            <form key={d} action={linkTasks.bind(null, d, t.id, false)}><button className="chip" type="submit" title="Usuń tę zależność"><span className="d" style={{ ["--c" as string]: isComplete(x) ? "var(--ok)" : "var(--sub)" }} />{x.title}<span className="x">×</span></button></form>
          ) : null; })}</div>
        </div>
      ) : null}
      {bp && !aiOn ? (
        <div><div className="lbl">Kroki</div>
          <p>Zadanie nie ma kroków. Przycisk „Rozłóż w Claude” nad kanwą otwiera rozmowę z gotowym promptem; Claude zapisze kroki tu przez konektor. Możesz też skopiować prompt.</p>
          <div className="actions" style={{ marginTop: 8 }}><CopyButton text={bp} label="Kopiuj prompt" /><CopyButton text={codeCommand(bp)} label="Kopiuj komendę Claude Code" /></div>
        </div>
      ) : null}
      <details className="edit">
        <summary>Edytuj tytuł, cel i opis</summary>
        <form className="stack" action={updateTaskForm}>
          <input type="hidden" name="id" value={t.id} /><input type="hidden" name="level" value={t.level} /><input type="hidden" name="due" value={t.due ?? ""} /><input type="hidden" name="projectId" value={t.projectId ?? ""} />
          <label className="field"><span>Tytuł</span><input className="in" name="title" defaultValue={t.title} required /></label>
          <label className="field"><span>Cel</span><textarea className="in" name="summary" defaultValue={t.summary} /></label>
          <label className="field"><span>Jak wpadło</span><textarea className="in" name="source" defaultValue={t.source} /></label>
          <div className="actions"><PendingButton className="btn primary">Zapisz</PendingButton></div>
        </form>
      </details>
      <div className="actions"><form action={trashTask.bind(null, t.id)}><PendingButton className="btn danger" title={`Do kosza; znika po ${repo.TRASH_DAYS} dniach`}>Do kosza</PendingButton></form></div>
    </>
  );

  // ---------- panele kroków ----------
  const panels: Record<string, React.ReactNode> = {};
  t.steps.forEach((s, i) => { panels[s.id] = <StepPanel t={t} s={s} state={stateOf(s)} facts={factsPerStep[i]} attachments={attachments} aiOn={aiOn} rules={b.rules} samples={b.samples} origin={origin} waits={waits.length > 0} />; });

  return (
    <TaskCanvas
      task={{ id: t.id, title: t.title, base: cur.score.base, eff: cur.score.eff, why: cur.score.why.map((w) => `${w.v > 0 ? "+" : ""}${w.v} ${w.txt}`).join("; "), state: taskStateOf(t, b.tasks), progress: { done: t.steps.filter((s) => s.status === "done").length, all: t.steps.length }, estText: estTextOf(t) }}
      steps={tiles}
      groups={groups.map((g) => ({ id: g.id, name: g.name, color: g.color, x: g.x, y: g.y, w: g.w, h: g.h, members: g.members, auto: g.auto }))}
      aiOn={aiOn} agent={providers.length ? (providers[0] === "anthropic" ? "Claude" : "GPT") : "Claude"}
      lastAgent={lastAgent ? { id: lastAgent.id, text: lastAgent.text } : null}
      focus={focus ?? null} runbar={runbar} taskBar={taskBar} taskBody={taskBody} panels={panels} questions={questionsNode} />
  );
}

function StepPanel({ t, s, state, facts, attachments, aiOn, rules, samples, origin, waits }: {
  t: Task; s: Step; state: string; facts: Awaited<ReturnType<typeof repo.listFacts>>; attachments: Awaited<ReturnType<typeof repo.listAttachments>>;
  aiOn: boolean; rules: Awaited<ReturnType<typeof repo.listRules>>; samples: Awaited<ReturnType<typeof repo.listSamples>>; origin: string; waits: boolean;
}) {
  const blocks = s.blocks?.length ? s.blocks : composeStatic(s, facts, attachments);
  const deps = s.dependsOn.map((d) => t.steps.find((x) => x.id === d)).filter((x): x is Step => !!x);
  const cal = calibrationFor(samples, s.tool);
  const ext = EXTERNAL_TOOLS.has(s.tool);
  const link = externalLink(s.link, origin);
  const prompt = s.status === "handoff" ? handoffPrompt(t, s, rules, { appUrl: origin, attachments: attachments.filter((a) => a.analysis) }) : null;
  const review = s.review as { summary?: string; links?: string[]; fits?: boolean; warning?: string; pending?: boolean } | null;
  const linkLabel = ext ? "Otwórz wynik" : s.tool === "manual" || s.tool === "claude" ? "Otwórz link" : `Otwórz w ${toolLabel(s.tool)}`;
  return (
    <>
      <h3>{s.title}</h3>
      {s.detail ? <p>{s.detail}</p> : null}
      <div className="actions">
        {s.status === "todo" ? (<>
          {aiOn && !ext && s.tool !== "manual" ? <form action={prepare.bind(null, t.id, s.id)}><PendingButton className="btn primary" busy="Agent przygotowuje…">Przygotuj</PendingButton></form> : null}
          {aiOn ? <form action={compose.bind(null, t.id, s.id)}><PendingButton className="btn" busy="Składam…" title="Agent składa panel z faktów, migawek i załączników">Pokaż kontekst</PendingButton></form> : null}
          {!aiOn || ext ? <form action={handoff.bind(null, t.id, s.id)}><PendingButton className={"btn" + (ext ? " primary" : "")}>{ext ? "Oddaj do Claude" : "Zrób w Claude"}</PendingButton></form> : null}
          <Timer stepId={s.id} onStop={addSpent.bind(null, t.id, s.id)} />
          <form action={markDone.bind(null, t.id, s.id)}><PendingButton className={"btn" + (ext ? "" : " primary")}>Gotowe</PendingButton></form>
        </>) : null}
        {s.status === "draft" ? (<>
          <form action={markDone.bind(null, t.id, s.id)}><PendingButton className="btn primary">Zatwierdź</PendingButton></form>
          {aiOn ? <form action={prepare.bind(null, t.id, s.id)}><PendingButton className="btn" busy="Agent poprawia…">Przygotuj od nowa</PendingButton></form> : null}
          <form action={backToTodo.bind(null, t.id, s.id)}><PendingButton className="btn">Odłóż</PendingButton></form>
        </>) : null}
        {s.status === "handoff" && prompt ? (<>
          <a className="btn primary" href={claudeUrl(prompt)} target="_blank" rel="noopener">Otwórz w Claude</a>
          <CopyButton text={prompt} label="Kopiuj prompt" />
          <CopyButton text={codeCommand(prompt)} label="Kopiuj komendę Claude Code" />
          <form action={backToTodo.bind(null, t.id, s.id)}><PendingButton className="btn"><Icon k="undo" size={13} sw={1.9} /> Cofnij</PendingButton></form>
        </>) : null}
        {s.status === "done" ? <form action={reopen.bind(null, t.id, s.id)}><PendingButton className="btn" title="Przywróć stan sprzed oznaczenia"><Icon k="undo" size={13} sw={1.9} /> Cofnij gotowe</PendingButton></form> : null}
        {link ? <a className="btn ico" href={link} target="_blank" rel="noopener" title={link}>{linkLabel}<Icon k="ext" size={13} sw={1.6} /></a> : null}
      </div>
      <div className="time-row">
        <div><div className="lbl">Szacunek</div><div className="chip" style={{ height: 34, padding: "0 14px" }}>{fmtMin(estOf(s))}{cal && state !== "done" && Math.abs(cal.k - 1) >= 0.1 ? ` → ~${fmtMin(calEst(s, samples))}` : ""}</div></div>
        <div><div className="lbl">Rzeczywiście</div><div className="chip" style={{ height: 34, padding: "0 14px" }}>{fmtMin(spentMin(s))}</div></div>
      </div>
      {cal && state !== "done" && Math.abs(cal.k - 1) >= 0.1 ? <div className="calib">Z Twoich czasów ({cal.scope === "tool" ? toolLabel(s.tool) : "ogólnie"}, {cal.n} {plural(cal.n, "krok", "kroki", "kroków")}): takie kroki trwają zwykle ×{String(cal.k).replace(".", ",")}.</div> : null}
      {deps.length ? (
        <div><div className="lbl">Czeka na</div>
          <div className="deps">{deps.map((d) => <form key={d.id} action={linkSteps.bind(null, t.id, d.id, s.id, false)}><button className="chip" type="submit" title="Usuń tę zależność"><span className="d" style={{ ["--c" as string]: d.status === "done" ? "var(--ok)" : "var(--sub)" }} />{d.title}<span className="x">×</span></button></form>)}</div>
        </div>
      ) : null}
      {state === "blocked" ? <div className="note">{waits ? "Całe zadanie czeka, aż skończą się zadania, po których ma ruszyć." : "Ten krok ruszy, gdy skończą się kroki, na które czeka."}</div> : null}

      {s.status === "handoff" ? (
        <form className="handoff-box" action={saveReport}>
          <input type="hidden" name="taskId" value={t.id} /><input type="hidden" name="stepId" value={s.id} />
          <div className="lbl">Raport z Claude</div>
          <textarea className="out" name="report" placeholder="Wklej link do artefaktu, PR albo podsumowanie tego, co powstało…" required />
          <div className="row"><input className="in" name="link" placeholder="Link do wyniku (opcjonalnie)" /><PendingButton className="btn primary" busy="Odbieram…">Odbierz</PendingButton></div>
        </form>
      ) : null}
      {s.status === "draft" ? (
        <form className="stack" action={saveOutput}>
          <input type="hidden" name="taskId" value={t.id} /><input type="hidden" name="stepId" value={s.id} />
          <div className="lbl">Szkic</div>
          <textarea className="out" name="output" defaultValue={s.output} />
          <div className="actions"><PendingButton className="btn">Zapisz treść</PendingButton></div>
        </form>
      ) : null}
      {review?.summary ? <div><div className="lbl">Odbiór agenta</div><div className={"review" + (review.fits === false || review.warning ? " warn" : "")}>{review.warning ? <div><b>Uwaga:</b> {review.warning}</div> : null}<div>{review.summary}</div>{review.links?.length ? <div className="deps">{review.links.map((u) => <a key={u} className="chip" href={u} target="_blank" rel="noopener"><span>{u.replace(/^https?:\/\//, "").slice(0, 40)}</span></a>)}</div> : null}</div></div> : null}
      {blocks.length ? <BlocksView blocks={blocks} form={s.blocks?.length ? { taskId: t.id, stepId: s.id } : undefined} /> : null}
      {s.status === "done" && s.report ? <div><div className="lbl">Raport</div><div className="note">{s.report}</div></div> : null}
      {s.status === "done" && s.output && !s.blocks?.length ? <div><div className="lbl">Wynik</div><div className="note">{s.output}</div></div> : null}
      {facts.length ? (
        <details className="edit">
          <summary>Fakty kroku ({facts.length}): przypnij lub ukryj, agent zapamięta</summary>
          <div className="stack">
            {facts.map((f) => (
              <div key={f.id} className="row" style={{ fontSize: 12.5 }}>
                <span style={{ flex: 1 }}><b>{f.label}</b>: {f.value}</span>
                <form action={factPref.bind(null, t.id, f.id!, { pinned: !f.pinned })}><PendingButton className="btn" title="Zawsze pokazuj">{f.pinned ? "📌 przypięte" : "Przypnij"}</PendingButton></form>
                <form action={factPref.bind(null, t.id, f.id!, { hidden: !f.hidden })}><PendingButton className="btn" title="Nie pokazuj">{f.hidden ? "ukryte" : "Ukryj"}</PendingButton></form>
              </div>
            ))}
          </div>
        </details>
      ) : null}
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
          <div className="actions"><PendingButton className="btn primary">Zapisz</PendingButton></div>
        </form>
        <form action={removeStep.bind(null, t.id, s.id)} style={{ marginTop: 8 }}><PendingButton className="btn danger">Usuń krok</PendingButton></form>
      </details>
    </>
  );
}
