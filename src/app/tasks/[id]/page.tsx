// Wnętrze zadania: kanwa kroków z panelem. Panele (zadania i każdego kroku) są renderowane tu, na serwerze, i przekazywane do kanwy.
// Pola kroku edytuje się w miejscu, w którym je widać (StepFields); jedna główna akcja na stan kroku.
import { notFound } from "next/navigation";
import { requireOwner, appUrl } from "@/lib/session";
import * as repo from "@/lib/repo";
import { bundle } from "@/lib/services";
import { composeStatic } from "@/lib/agent/compose";
import { breakdownPrompt, handoffPrompt, claudeUrl } from "@/lib/agent/handoff";
import { EXTERNAL_TOOLS, sphereOf, toolLabel, type Question, type Step, type Task } from "@/lib/schema";
import { calEst, calibrationFor, estOf, fmtMin, spentMin, taskEst, taskSpent, todayISO } from "@/lib/time";
import { isComplete } from "@/lib/priority";
import { availableProviders } from "@/lib/ai";
import { externalLink } from "@/lib/links";
import { stepsHint } from "@/lib/auto";
import { BRIDGE_ALIVE_MS } from "@/lib/bridge";
import { fmtDate, fmtTime, stepTile, taskStateOf, taskWaits, estText as estTextOf } from "@/lib/canvas/vm";
import { Why } from "@/components/Prio";
import { BlocksView } from "@/components/BlockRenderer";
import { PendingButton } from "@/components/Pending";
import { Timer } from "@/components/Timer";
import { TaskCanvas } from "@/components/canvas/TaskCanvas";
import { GrowTextarea } from "@/components/GrowTextarea";
import { ConfirmButton, InlineText, PromptBox, StepMeta } from "@/components/StepFields";
import { agentLabel, indexFrom } from "@/lib/search";
import { Icon, plural } from "@/components/canvas/ui";
import { InlineDate, PrioPicker, ProjectPicker } from "@/components/canvas/widgets";
import { addSpent, answerQuestionForm, approveStep, backToTodo, compose, dismissQuestion, factPref, handoff, linkTasks, markDone, prepare, removeStep, reopen, saveOutput, saveReport, setDue, setLevel, setProject, trashTask, updateTaskForm } from "../../actions";

export const dynamic = "force-dynamic";

export default async function TaskPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ step?: string }> }) {
  const { id } = await params;
  const { step: focus } = await searchParams;
  const o = await requireOwner();
  const b = await bundle(o.id);
  const cur = b.scored.find((s) => s.task.id === id);
  if (!cur) notFound();
  const t = cur.task;
  const [factsPerStep, attachments, chatLog, groups, questions, bridge] = await Promise.all([
    Promise.all(t.steps.map((s) => repo.listFacts({ stepId: s.id }))),
    repo.listAttachments({ taskId: t.id }),
    repo.listChat(o.id, t.id, 2),
    repo.listGroups(o.id, t.id),
    repo.listQuestions(o.id, { taskId: t.id, open: true }),
    repo.bridgeStatus(o.id, BRIDGE_ALIVE_MS),
  ]);
  const providers = availableProviders(), aiOn = providers.length > 0;
  const lastAgent = [...chatLog].reverse().find((m) => m.role === "agent");
  const origin = appUrl();
  const tiles = t.steps.map((s) => stepTile(t, s, b.tasks));
  const stateOf = (s: Step) => tiles.find((x) => x.id === s.id)!.state;
  const waits = taskWaits(t, b.tasks);
  const bp = !t.steps.length && !t.doneAt ? breakdownPrompt(t, b.rules, { appUrl: origin, projectName: cur.project?.name, companyId: cur.project?.companyId ?? null }) : null;

  // ---------- pasek nad kanwą: tylko to, co wymaga uwagi (stan kroków widać po kolorach kafelków) ----------
  const runbar = waits.length ? <span className="rb-t"><b>Czeka na zadanie:</b> {waits.map((w) => w.title).join(", ")}</span>
    : bp ? <span className="rb-t"><b>Bez kroków.</b> {aiOn ? "Napisz w doku, co ma zrobić agent." : "Claude rozpisze je i zacznie pracę."}</span>
    : null;

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
          <p>{stepsHint(bridge.alive)} Gdy się spieszysz, zrób to ręcznie w Claude (poniżej gotowy prompt).</p>
          <details className="edit" style={{ marginTop: 8 }}><summary>Rozpisz ręcznie w Claude</summary><PromptBox text={bp} openUrl={claudeUrl(bp)} /></details>
        </div>
      ) : null}
      <details className="edit">
        <summary>Edytuj tytuł, cel i opis</summary>
        <form className="stack" action={updateTaskForm}>
          <input type="hidden" name="id" value={t.id} /><input type="hidden" name="level" value={t.level} /><input type="hidden" name="due" value={t.due ?? ""} /><input type="hidden" name="projectId" value={t.projectId ?? ""} />
          <label className="field"><span>Tytuł</span><input className="in" name="title" defaultValue={t.title} required /></label>
          <label className="field"><span>Cel</span><GrowTextarea name="summary" defaultValue={t.summary} /></label>
          <label className="field"><span>Jak wpadło</span><GrowTextarea name="source" defaultValue={t.source} /></label>
          <div className="actions"><PendingButton className="btn primary">Zapisz</PendingButton></div>
        </form>
      </details>
      <div className="actions"><form action={trashTask.bind(null, t.id)}><PendingButton className="btn danger" title={`Do kosza; znika po ${repo.TRASH_DAYS} dniach`}>Do kosza</PendingButton></form></div>
    </>
  );

  // ---------- panele kroków ----------
  const panels: Record<string, React.ReactNode> = {};
  // połączenia do wyboru w kroku: tylko z tej sfery co zadanie (zadanie prywatne nie dostaje Slacka firmy); nazwa firmy do etykiety
  const sphere = sphereOf(cur.project, b.companies);
  const connections = b.connections.filter((c) => c.sphere === sphere).map((c) => ({ id: c.id, label: c.label, app: c.app, account: c.account, company: c.companyId ? b.companies.find((x) => x.id === c.companyId)?.name ?? null : null, sphere: c.sphere, active: c.state === "active" }));
  t.steps.forEach((s, i) => { panels[s.id] = <StepPanel t={t} s={s} state={stateOf(s)} facts={factsPerStep[i]} attachments={attachments} aiOn={aiOn} rules={b.rules} samples={b.samples} origin={origin} waits={waits.length > 0} companyId={cur.project?.companyId ?? null} connections={connections} />; });

  return (
    <TaskCanvas
      task={{ id: t.id, title: t.title, base: cur.score.base, eff: cur.score.eff, why: cur.score.why.map((w) => `${w.v > 0 ? "+" : ""}${w.v} ${w.txt}`).join("; "), state: taskStateOf(t, b.tasks), progress: { done: t.steps.filter((s) => s.status === "done").length, all: t.steps.length }, estText: estTextOf(t) }}
      steps={tiles}
      groups={groups.map((g) => ({ id: g.id, name: g.name, color: g.color, x: g.x, y: g.y, w: g.w, h: g.h, members: g.members, auto: g.auto }))}
      aiOn={aiOn} agent={agentLabel(providers)} index={indexFrom(b)}
      lastAgent={lastAgent ? { id: lastAgent.id, text: lastAgent.text } : null}
      focus={focus ?? null} runbar={runbar} taskBar={taskBar} taskBody={taskBody} panels={panels} questions={questionsNode} />
  );
}

function StepPanel({ t, s, state, facts, attachments, aiOn, rules, samples, origin, waits, companyId, connections }: {
  t: Task; s: Step; state: string; facts: Awaited<ReturnType<typeof repo.listFacts>>; attachments: Awaited<ReturnType<typeof repo.listAttachments>>;
  aiOn: boolean; rules: Awaited<ReturnType<typeof repo.listRules>>; samples: Awaited<ReturnType<typeof repo.listSamples>>; origin: string; waits: boolean; companyId: string | null;
  connections: Parameters<typeof StepMeta>[0]["connections"];
}) {
  // szczegóły są już pod tytułem, więc blok tekstu z tą samą treścią odpada
  const blocks = (s.blocks?.length ? s.blocks : composeStatic(s, facts, attachments)).filter((b) => !(b.type === "text" && !b.title && b.body.trim() === s.detail.trim()));
  const cal = calibrationFor(samples, s.tool);
  const calOn = !!cal && state !== "done" && Math.abs(cal.k - 1) >= 0.1;
  const ext = EXTERNAL_TOOLS.has(s.tool);
  const runnable = s.tool !== "manual";
  const link = externalLink(s.link, origin);
  const prompt = s.status === "handoff" ? handoffPrompt(t, s, rules, { appUrl: origin, companyId, attachments: attachments.filter((a) => a.analysis) }) : null;
  const review = s.review as { summary?: string; links?: string[]; fits?: boolean; warning?: string; pending?: boolean } | null;
  const linkLabel = ext ? "Otwórz wynik" : s.tool === "manual" || s.tool === "claude" ? "Otwórz link" : `Otwórz w ${toolLabel(s.tool)}`;
  const hasDraftBlock = !!s.blocks?.some((b) => b.type === "draft");
  return (
    <>
      <InlineText taskId={t.id} stepId={s.id} field="title" value={s.title} as="h3" placeholder="Tytuł kroku" />
      <InlineText taskId={t.id} stepId={s.id} field="detail" value={s.detail} as="p" placeholder="Dodaj szczegóły: co dokładnie, gdzie, dla kogo…" />
      <div className="actions">
        {s.status === "todo" ? (<>
          {aiOn && !ext && runnable ? <form action={prepare.bind(null, t.id, s.id)}><PendingButton className="btn primary" busy="Agent przygotowuje…">Przygotuj</PendingButton></form> : null}
          {aiOn ? <form action={compose.bind(null, t.id, s.id)}><PendingButton className="btn" busy="Składam…" title="Agent składa panel z faktów, migawek i załączników">Pokaż kontekst</PendingButton></form> : null}
          {!aiOn && runnable && state === "ready" ? <form action={handoff.bind(null, t.id, s.id)}><PendingButton className="btn primary" title="Claude weźmie ten krok teraz; kafelek pokaże, że trwa praca" busy="Uruchamiam…"><Icon k="play" size={12} sw={2} /> Uruchom</PendingButton></form> : null}
          <Timer stepId={s.id} onStop={addSpent.bind(null, t.id, s.id)} />
          <form action={markDone.bind(null, t.id, s.id)}><PendingButton className={"btn" + (!runnable ? " primary" : "")}>Gotowe</PendingButton></form>
        </>) : null}
        {s.status === "handoff" ? (<>
          <span className="working" title={prompt ? "Claude robi ten krok przez konektor; wynik pojawi się tutaj" : undefined}><span className="pulse" />Claude pracuje{s.handoffAt ? ` od ${fmtTime(s.handoffAt)}` : ""}</span>
          <form action={backToTodo.bind(null, t.id, s.id)}><PendingButton className="btn" title="Wróć do kroków gotowych; Claude odłoży ten krok" busy="Zatrzymuję…"><Icon k="stop" size={11} sw={2} /> Zatrzymaj</PendingButton></form>
        </>) : null}
        {s.status === "draft" ? (<>
          <form action={approveStep.bind(null, t.id, s.id)}><PendingButton className="btn primary" title={s.needsApproval ? "Claude wyśle dokładnie tę treść" : "Szkic jest dobry, krok gotowy"}>{s.needsApproval ? "Zatwierdź i wyślij" : "Zatwierdź"}</PendingButton></form>
          {aiOn ? <form action={prepare.bind(null, t.id, s.id)}><PendingButton className="btn" busy="Agent poprawia…">Przygotuj od nowa</PendingButton></form> : null}
          <form action={backToTodo.bind(null, t.id, s.id)}><PendingButton className="btn" title="Szkic zostaje, krok wraca do gotowych">Odłóż</PendingButton></form>
        </>) : null}
        {s.status === "done" ? <form action={reopen.bind(null, t.id, s.id)}><PendingButton className="btn" title="Otwórz krok ponownie, żeby coś zmienić"><Icon k="undo" size={13} sw={1.9} /> Cofnij gotowe</PendingButton></form> : null}
        {link ? <a className="btn ico" href={link} target="_blank" rel="noopener" title={link}>{linkLabel}<Icon k="ext" size={13} sw={1.6} /></a> : null}
      </div>
      <StepMeta taskId={t.id}
        step={{ id: s.id, tool: s.tool, estMin: estOf(s), spentMin: spentMin(s), needsApproval: s.needsApproval, dependsOn: s.dependsOn, estHint: calOn ? `→ ~${fmtMin(calEst(s, samples))}` : null, connectionId: s.connectionId }}
        steps={t.steps.filter((x) => x.id !== s.id).map((x) => ({ id: x.id, title: x.title, done: x.status === "done" }))}
        connections={connections}
        calText={calOn && cal ? `Z Twoich czasów (${cal.scope === "tool" ? toolLabel(s.tool) : "ogólnie"}, ${cal.n} ${plural(cal.n, "krok", "kroki", "kroków")}): takie kroki trwają zwykle ×${String(cal.k).replace(".", ",")}.` : null} />
      <InlineText taskId={t.id} stepId={s.id} field="link" value={s.link ?? ""} as="small" placeholder="Dodaj link do wyniku (ticket, wydarzenie, mail)…" shown={s.link ? "Link: " + s.link.replace(/^https?:\/\//, "").slice(0, 70) : undefined} />
      {state === "blocked" ? <div className="note">{waits ? "Całe zadanie czeka, aż skończą się zadania, po których ma ruszyć." : "Ten krok ruszy, gdy skończą się kroki, na które czeka."}</div> : null}

      {s.status === "handoff" && prompt ? (
        <details className="edit">
          <summary>Awaryjnie: zrób to poza aplikacją</summary>
          <div className="stack">
            <PromptBox text={prompt} openUrl={claudeUrl(prompt)} />
            <form className="handoff-box" action={saveReport}>
              <input type="hidden" name="taskId" value={t.id} /><input type="hidden" name="stepId" value={s.id} />
              <div className="lbl">Wynik zrobiony poza aplikacją</div>
              <GrowTextarea className="out" minRows={3} name="report" placeholder="Wklej, co powstało: podsumowanie, link do artefaktu albo PR…" required />
              <div className="row"><input className="in" name="link" placeholder="Link do wyniku (opcjonalnie)" /><PendingButton className="btn primary" busy="Zapisuję…">Zapisz jako gotowe</PendingButton></div>
            </form>
          </div>
        </details>
      ) : null}
      {s.status === "draft" && !hasDraftBlock ? (
        <form className="stack" action={saveOutput}>
          <input type="hidden" name="taskId" value={t.id} /><input type="hidden" name="stepId" value={s.id} />
          <div className="lbl">Szkic</div>
          <GrowTextarea className="out" minRows={3} name="output" defaultValue={s.output} />
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
      <div className="actions"><ConfirmButton label="Usuń krok" question="Usunąć ten krok? Tego nie da się cofnąć." yes="Tak, usuń" action={removeStep.bind(null, t.id, s.id)} /></div>
    </>
  );
}
