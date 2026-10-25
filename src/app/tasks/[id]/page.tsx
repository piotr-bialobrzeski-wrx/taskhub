// Wnętrze zadania: kanwa kroków z panelem. Panele (zadania i każdego kroku) są renderowane tu, na serwerze, i przekazywane do kanwy.
// Pola kroku edytuje się w miejscu, w którym je widać (StepFields); jedna główna akcja na stan kroku.
import { notFound } from "next/navigation";
import { requireOwner, appUrl } from "@/lib/session";
import * as repo from "@/lib/repo";
import { bundle } from "@/lib/services";
import { composeStatic } from "@/lib/agent/compose";
import { breakdownPrompt, handoffPrompt, claudeUrl } from "@/lib/agent/handoff";
import { EXTERNAL_TOOLS, isOwnerStep, sphereOf, toolLabel, type Block, type Question, type Step, type Task } from "@/lib/schema";
import { agentMinOf, calEst, calibrationFor, estOf, fmtMin, remainEst, spentMin, taskAgent, taskSpent, todayISO } from "@/lib/time";
import { isComplete } from "@/lib/priority";
import { availableProviders } from "@/lib/ai";
import { externalLink } from "@/lib/links";
import { fileName, isHttpUrl, safeHref } from "@/lib/safeurl";
import { bridgeHold, bridgeLabel, busyWith, noStepsWho, queueWho, type Worker } from "@/lib/auto";
import { BRIDGE_ALIVE_MS, connectorIssue, protocolOf } from "@/lib/bridge";
import { draftOf, draftsOf, optionsOf } from "@/lib/agent/approval";
import { liveActivity, liveKey } from "@/lib/live";
import { LivePoll } from "@/components/LivePoll";
import { Activity } from "@/components/Activity";
import type { TileActivity } from "@/components/canvas/ui";
import { fmtDate, fmtTime, stepTile, taskActivity, taskStateOf, taskWaits, estText as estTextOf } from "@/lib/canvas/vm";
import { Why } from "@/components/Prio";
import { BlocksView } from "@/components/BlockRenderer";
import { agentFeed, workBubble } from "@/lib/feed";
import { agentQueue } from "@/lib/agent/work";
import { decisionText, depCardsFor, destOf, foldsFor, hasComparison, kindsOf, nowHeading, openQuestions, pageLinks, readingResult, reportLines, splitBlocks, splitMain, stepKind, targetLink, whoDid, isProjectStep, projectPrompt, type CardState } from "@/lib/stepcard";
import { PendingButton } from "@/components/Pending";
import { CopyButton } from "@/components/CopyButton";
import { TaskCanvas } from "@/components/canvas/TaskCanvas";
import { GrowTextarea } from "@/components/GrowTextarea";
import { DoneAsk, InlineText, PromptBox, StepMeta, type StepConnection, type StepModelInfo } from "@/components/StepFields";
import { choiceOf, LEVEL_LABELS, modelConfig, modelLabel, runLabel, stepLevel } from "@/lib/agent/models";
import { agentLabel, indexFrom } from "@/lib/search";
import { Icon, plural } from "@/components/canvas/ui";
import { InlineDate, PrioPicker, ProjectPicker } from "@/components/canvas/widgets";
import { projColor } from "@/components/canvas/ui";
import { PublishCard, cardModeOf } from "@/components/PublishCard";
import { answerQuestionForm, restoreBlocksForm, backToTodo, cancelCloudRun, compose, dismissQuestion, factPref, handoff, linkTasks, markDone, prepare, reopen, runInCloud, saveReport, setDue, setLevel, setProject, trashTask, updateTaskForm } from "../../actions";

export const dynamic = "force-dynamic";

export default async function TaskPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ step?: string }> }) {
  const { id } = await params;
  const { step: focus } = await searchParams;
  const o = await requireOwner();
  const b = await bundle(o.id);
  const cur = b.scored.find((s) => s.task.id === id);
  if (!cur) notFound();
  const t = cur.task;
  const [factsPerStep, attachments, chatLog, groups, questions, bridge, stamp, pending] = await Promise.all([
    Promise.all(t.steps.map((s) => repo.listFacts({ stepId: s.id }))),
    repo.listAttachments({ taskId: t.id }),
    repo.listChat(o.id, t.id, 8),
    repo.listGroups(o.id, t.id),
    repo.listQuestions(o.id, { taskId: t.id, open: true }),
    repo.bridgeStatus(o.id, BRIDGE_ALIVE_MS),
    repo.changeStamp(o.id, id),
    repo.listPendingChat(o.id, t.id),
  ]);
  const providers = availableProviders(), aiOn = providers.length > 0;
  // dobór modelu kroku agenta (Ustawienia → Agent): co da „auto”, wybór Piotra i czym zrobił go ostatni bieg
  const mcfg = modelConfig(o.settings);
  const modelOf = (s: Step): (StepModelInfo & { now: string }) | null => {
    if (!mcfg || isOwnerStep(s)) return null;
    const lvl = stepLevel(s, { weight: cur.project?.weight }), auto = choiceOf(mcfg, lvl), cur2 = choiceOf(mcfg, lvl, s.modelPick);
    return {
      auto: `${LEVEL_LABELS[lvl]}: ${runLabel(auto.model, auto.effort)}`, pick: s.modelPick ?? null,
      choices: mcfg.choices.map((m) => ({ key: m, label: modelLabel(m) })), last: s.lastRun?.model ? runLabel(s.lastRun.model, s.lastRun.effort) : null,
      now: runLabel(cur2.model, cur2.effort),
    };
  };
  const feed = agentFeed(chatLog);
  const origin = appUrl();
  // kto pracuje teraz (mostek na komputerze z bieżącym biegiem albo automat o pełnej godzinie) i nad czym
  const w: Worker = { alive: bridge.alive, name: bridge.name, run: liveActivity(bridge.run), hold: bridgeHold(bridge.meta, bridge.pause) };
  const busy = busyWith(w.run, b.tasks);
  const tiles = t.steps.map((s) => stepTile(t, s, b.tasks, w.run));
  const stateOf = (s: Step) => tiles.find((x) => x.id === s.id)!.state;
  const waits = taskWaits(t, b.tasks);
  const bp = !t.steps.length && !t.doneAt ? breakdownPrompt(t, b.rules, { appUrl: origin, projectName: cur.project?.name, companyId: cur.project?.companyId ?? null }) : null;

  // ---------- dymek pracy nad polem czatu i pasek nad kanwą ----------
  // Dymek: mostek pracuje nad tym zadaniem (co robi teraz, które kroki, „Zatrzymaj”) albo wysłana wiadomość czeka (kto ją weźmie i kiedy).
  // Pasek: tylko to, czego dymek nie mówi (stan kroków widać po kolorach kafelków): czeka na inne zadanie, trwa wysyłka z tego zadania, zadanie bez kroków
  const who = bp ? noStepsWho(w, t.id, busy) : null;
  const queue = pending.length ? queueWho(w, t.id, pending.length, busy) : null;
  const aq = await agentQueue(o.id, w.run ? { taskId: w.run.taskId, stepId: w.run.stepId, since: w.run.since, kind: w.run.kind } : null);
  const bubble = workBubble({ task: t, w, pending, busy, queue: aq });
  const sending = w.run && w.run.kind === "send" && w.run.taskId === t.id ? w.run : null;
  // pasek ma zawsze jedną krótką linię; pełne zdanie i szczegóły (ścieżki, polecenia) są w podpowiedzi po najechaniu
  const runbar = waits.length ? <span className="rb-t" title={waits.map((x) => x.title).join(", ")}><b>Czeka na zadanie:</b> {waits.map((x) => x.title).join(", ")}</span>
    : sending ? <Activity text={sending.text} detail={sending.detail} since={sending.since} who={bridgeLabel(w)} big />
    : who && !bubble ? <span className="rb-t" title={who.text}><b>Bez kroków</b> · {aiOn ? "napisz w doku, co ma zrobić agent" : who.short}</span>
    : null;
  const runAction = who && who.kind !== "decomposing" && !aiOn ? { label: "Rozpisz teraz", anchor: "rozpisz" } : null;

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
  const taskBar = <><span className="d-title" title={t.title}>{t.title}</span><PrioPicker base={cur.score.base} eff={cur.score.eff} why={cur.score.why.map((w) => `${w.v > 0 ? "+" : ""}${w.v} ${w.txt}`).join("; ")} cls="head" onPick={setLevel.bind(null, t.id)} /><span className="chip">{t.steps.filter((s) => s.status === "done").length}/{t.steps.length} kroków</span></>;
  const taskBody = (
    <>
      {t.summary ? <p>{t.summary}</p> : null}
      <div className="time-row">
        <div><div className="lbl">Projekt</div><ProjectPicker projects={b.projects.map((p) => ({ id: p.id, name: p.name, color: p.color }))} value={t.projectId} cls="boxed" onPick={setProject.bind(null, t.id)} /></div>
        <div><div className="lbl">Termin</div><InlineDate value={t.due} min={todayISO()} onChange={setDue.bind(null, t.id)} /></div>
        <div><div className="lbl">Twój czas</div><div className="chip" style={{ height: 34, padding: "0 14px" }} title="Twoje kroki: ile zostało wg szacunków i ile już zmierzyłeś">{[remainEst(t) ? `Zostało ~${fmtMin(remainEst(t))}` : null, taskSpent(t) ? `⏱ ${fmtMin(taskSpent(t))}` : null].filter(Boolean).join(" · ") || "brak"}</div></div>
        {taskAgent(t) ? <div><div className="lbl">Czas Claude'a</div><div className="chip" style={{ height: 34, padding: "0 14px" }} title="Liczy się sam: od chwili, gdy Claude zaczął krok, do jego zamknięcia">{fmtMin(taskAgent(t))}</div></div> : null}
      </div>
      <Why score={cur.score} />
      {t.doneAt ? (
        <div><div className="lbl">Co zostało zrobione · {fmtDate(t.doneAt)}</div>
          {t.noteSummary || t.noteText ? <div className="review"><div>{t.noteSummary ?? t.noteText}</div></div> : <div className="note">Brak podsumowania. Claude dopisze je przez konektor albo wpisz je w notatce.</div>}
          {t.noteText && t.noteText !== t.noteSummary ? <details className="edit" style={{ marginTop: 6 }}><summary>Notatka dla agentów</summary><div className="an">{t.noteText}</div></details> : null}
        </div>
      ) : null}
      {t.source || (t.titleOriginal && t.titleOriginal !== t.title) ? (
        <div><div className="lbl">Jak wpadło</div>
          {t.source ? <div className="note">{t.source}</div> : null}
          {t.titleOriginal && t.titleOriginal !== t.title ? <div className="note sub" title="Claude przeredagował tytuł zadania; tak brzmiał na początku">Pierwotny tytuł: {t.titleOriginal}</div> : null}
        </div>
      ) : null}
      {attachments.length ? (
        <div><div className="lbl">Grafiki i pliki</div>
          <div className="gal">{attachments.map((a) => {
            // adres pliku tylko http(s) albo /api/files/<id>; SVG nie jako obrazek (serwer oddaje go do pobrania), tylko jako plik
            const href = safeHref(a.url), img = a.kind === "image" && !!href && !/svg/i.test(a.mime ?? "") && !/\.svg$/i.test(a.name ?? "");
            return (
            <div key={a.id} className="gal-item">
              {img ? <a href={href} target="_blank" rel="noopener"><img src={href} alt={a.caption ?? a.name ?? ""} /></a> : <div className="ph">{a.kind === "link" ? "Link" : "Plik"}</div>}
              <div><b>{a.caption ?? a.name ?? "Załącznik"}</b>{href && !img ? <a className="chip" href={href} target="_blank" rel="noopener">{a.name ?? a.url}</a> : null}{a.analysis ? <details><summary>Analiza agenta</summary><div className="an">{a.analysis}</div></details> : null}</div>
            </div>
            );
          })}</div>
        </div>
      ) : null}
      {t.dependsOn.length ? (
        <div><div className="lbl">Zaczyna się po zadaniach</div>
          <div className="deps">{t.dependsOn.map((d) => { const x = b.tasks.find((y) => y.id === d); return x ? (
            <form key={d} action={linkTasks.bind(null, d, t.id, false)}><button className="chip" type="submit" title="Usuń tę zależność"><span className="d" style={{ ["--c" as string]: isComplete(x) ? "var(--ok)" : "var(--sub)" }} /><span>{x.title}</span><span className="x">×</span></button></form>
          ) : null; })}</div>
        </div>
      ) : null}
      {bp && !aiOn && who ? (
        <div><div className="lbl">Kroki</div>
          <p>{who.text} Gdy się spieszysz, zrób to ręcznie w Claude (poniżej gotowy prompt).</p>
          <details id="rozpisz" className="edit" style={{ marginTop: 8 }}><summary>Rozpisz ręcznie w Claude</summary><PromptBox text={bp} openUrl={claudeUrl(bp)} /></details>
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
  const company = cur.project?.companyId ? b.companies.find((x) => x.id === cur.project!.companyId)?.name ?? null : null;
  const ctx = { color: cur.project ? projColor(cur.project.color) : "var(--sub)", text: [cur.project?.name ?? "bez projektu", company ?? (sphere === "private" ? "prywatne" : "zawodowe")].join(" · ") };
  // szkic do aplikacji, której mostek nie wyśle (brak konektora na Macu, kilka kont, konektor innej firmy): karta ostrzega i nie daje zatwierdzić
  const issueOf = (s: Step): string | null => {
    const m = cardModeOf(s), raw = draftOf(s)?.target.app;
    if (!raw || !s.needsApproval || (m !== "proposed" && m !== "parked") || destOf(s)?.kind !== "send") return null;
    return connectorIssue(b.connections, b.companies, { app: raw, connectionId: s.connectionId, companyId: cur.project?.companyId ?? null });
  };
  t.steps.forEach((s, i) => { panels[s.id] = <StepPanel t={t} s={s} state={stateOf(s)} facts={factsPerStep[i]} attachments={attachments} aiOn={aiOn} rules={b.rules} samples={b.samples} origin={origin} waits={waits.length > 0} companyId={cur.project?.companyId ?? null} company={company} connections={connections} ctx={ctx} ownerName={o.name?.split(" ")[0] || "Ty"} activity={tiles[i].activity} oldMac={protocolOf(bridge.meta.v) < 2} macAlive={bridge.alive} issue={issueOf(s)} model={modelOf(s)} project={cur.project?.name ?? null} />; });

  return (
    <>
    <LivePoll taskId={t.id} liveKey={liveKey(stamp, bridge.run, bridge.alive)} active={!!w.run || !!bubble || pending.length > 0 || t.steps.some((s) => s.status === "handoff" || !!s.cloud) || (!!bp && !t.doneAt)} />
    <TaskCanvas
      project={cur.project ? { name: cur.project.name, color: projColor(cur.project.color) } : null}
      task={{ id: t.id, title: t.title, base: cur.score.base, eff: cur.score.eff, why: cur.score.why.map((w) => `${w.v > 0 ? "+" : ""}${w.v} ${w.txt}`).join("; "), state: taskStateOf(t, b.tasks), progress: { done: t.steps.filter((s) => s.status === "done").length, all: t.steps.length }, estText: estTextOf(t), activity: taskActivity(t.id, w.run), pending: pending.length }}
      queue={queue}
      agentQueue={aq}
      steps={tiles}
      groups={groups.map((g) => ({ id: g.id, name: g.name, color: g.color, x: g.x, y: g.y, w: g.w, h: g.h, members: g.members, auto: g.auto }))}
      aiOn={aiOn} agent={agentLabel(providers)} index={indexFrom(b)}
      feed={feed} work={bubble}
      focus={focus ?? null} runbar={runbar} runAction={runAction} taskBar={taskBar} taskBody={taskBody} panels={panels} questions={questionsNode} />
    </>
  );
}

function StepPanel({ t, s, state, facts, attachments, aiOn, rules, samples, origin, waits, companyId, company, connections, ctx, ownerName, activity, oldMac, macAlive, issue, model, project }: {
  t: Task; s: Step; state: string; facts: Awaited<ReturnType<typeof repo.listFacts>>; attachments: Awaited<ReturnType<typeof repo.listAttachments>>;
  aiOn: boolean; rules: Awaited<ReturnType<typeof repo.listRules>>; samples: Awaited<ReturnType<typeof repo.listSamples>>; origin: string; waits: boolean; companyId: string | null; company: string | null;
  connections: StepConnection[]; ctx: { color: string; text: string }; ownerName: string; activity: TileActivity | null; oldMac: boolean; macAlive: boolean; issue: string | null;
  model: (StepModelInfo & { now: string }) | null; project: string | null;
}) {
  // szczegóły są już w sekcji „Co”, więc blok tekstu z tą samą treścią odpada
  const blocks = (s.blocks?.length ? s.blocks : composeStatic(s, facts, attachments)).filter((b) => !(b.type === "text" && !b.title && b.body.trim() === s.detail.trim()));
  // kalibracja tylko dla kroków Piotra (jego szacunki); czas Claude'a liczy się sam
  const own = isOwnerStep(s), agentMin = agentMinOf(s);
  const cal = own ? calibrationFor(samples, s.tool, "owner") : null;
  const calOn = !!cal && state !== "done" && Math.abs(cal.k - 1) >= 0.1;
  const ext = EXTERNAL_TOOLS.has(s.tool) || s.tool === "file";   // plik na Macu robi tylko mostek: bez „Przygotuj”
  // jeden zestaw przycisków na rodzaj kroku: krok Claude'a (Przygotuj / Uruchom), decyzja Piotra (odpowiedź na kartce zamyka krok),
  // „Przeczytaj …” (Przeczytane), krok poza aplikacją (Zrobione z pytaniem o czas); szkic ma kartę publikacji
  const kind = stepKind(s);
  const open = kind === "decision" ? openQuestions(s) : [];
  const indexOf = (b: Block) => s.blocks?.indexOf(b) ?? -1;
  const link = externalLink(s.link, origin);
  const prompt = s.status === "handoff" ? handoffPrompt(t, s, rules, { appUrl: origin, companyId, attachments: attachments.filter((a) => a.analysis) }) : null;
  const review = s.review as { summary?: string; links?: string[]; fits?: boolean; warning?: string; pending?: boolean } | null;
  // karta publikacji zastępuje blok szkicu i rząd akcji: decyzja stoi przy miejscu docelowym i podglądzie
  const mode = cardModeOf(s);
  const done = s.status === "done";
  // sekcje (paczka 2, punkt 8; paczka 15): „Teraz” = stan i jedyny wyróżniony blok (akcje, czynność Claude, karta publikacji albo wynik),
  // pod nim główna treść, potem „Skąd” = materiały; wynik kroku (blok zmian w kodzie) idzie do „Teraz”, nie między materiały
  const { result, material: material0 } = splitBlocks(blocks);
  const material = open.length ? material0.filter((b) => !(open as Block[]).includes(b)) : material0;   // otwarte pytania decyzji stoją w „Teraz”, nie między materiałami
  const form = s.blocks?.length ? { taskId: t.id, stepId: s.id } : undefined;
  const folds = foldsFor(state as CardState, mode, readingResult(s, material));
  const cmp = hasComparison(material);   // kartka porównania (paczka 10, punkt 1): porównywane elementy u góry na całą szerokość, pod nimi karta publikacji
  // wybrana opcja już poszła, a krok wrócił do zrobienia: „Już wysłano” zamiast „Odłożony szkic” albo „Wybierz opcję” (karta nie daje zgody)
  // krok „Zleć w projekcie: …” robi wątek projektu Claude w chmurze: nagłówek mówi gdzie, a zamiast „Uruchom” jest polecenie do skopiowania
  // krok z kodem w projekcie Task Hub (paczka 14, punkt 1) też: mostek go nie zrobi, więc zamiast „Przygotuj” / „Uruchom” jest „Uruchom w chmurze”
  const inProject = (kind === "offline" || kind === "agent") && isProjectStep(s, project);
  const head0 = nowHeading(state as CardState, mode, s.dependsOn.length, waits, mode === "sent" ? destOf(s) : undefined, draftsOf(s).length, optionsOf(s).chosen?.status === "sent");
  // „Uruchom w chmurze” (paczka 13, punkt 3): kliknięte czeka, aż mostek na Macu odpali chmurę (queued), potem aż chmura weźmie krok (rung)
  const cloud = s.status === "todo" && inProject ? s.cloud ?? null : null;
  const cloudTitle = cloud?.state === "rung" ? "Chmura rusza" : cloud ? "Czeka na chmurę" : "Do zrobienia w projekcie w chmurze";
  const head = inProject && state === "ready" && !mode ? { ...head0, title: cloudTitle } : head0;
  const cloudNote = !cloud ? null : cloud.state === "rung" ? `Mac odpalił Claude w chmurze${cloud.rungAt ? ` o ${fmtTime(cloud.rungAt)}` : ""}; zaraz weźmie ten krok i zamknie go z wynikiem.`
    : macAlive ? "Mac zaraz odpali Claude w chmurze; to trwa kilkanaście sekund." : "Aplikacja Task Hub na Macu teraz nie działa: chmura ruszy, gdy Mac wróci. Awaryjnie skopiuj polecenie i wklej je w projekcie Claude.";
  const draft = draftOf(s);   // wybrana opcja albo pierwszy szkic: linie raportu bez powtórki jej treści
  // raport bez powtórki streszczenia bloku zmian ani treści szkicu; „Do potwierdzenia: …” jako osobna linia
  const lines = reportLines(s.report, [...result.map((b) => b.summary), draft?.body]);
  const outputExtra = done && s.output && s.output.trim() !== (s.report ?? "").trim() && !s.blocks?.length && mode !== "sent" ? s.output : null;
  // linki w rzędzie akcji: po wysyłce żadnych (karta ma link do wyniku); zrobiony krok z blokiem zmian pod kartą nie powtarza „Otwórz podgląd”,
  // bo ten przycisk niesie blok zmian (BlockRenderer); „Repozytorium” i inne linki zostają
  const found = pageLinks(s, result[0] ?? null, link ?? null, mode, done);
  const done0 = done && !found.length && mode !== "sent" ? targetLink(s, s.blocks) : null;   // zrobione bez linku do wyniku: zostaje chociaż miejsce, którego dotyczyło
  const links = done0 ? [done0] : found;
  // miejsce docelowe (ticket, wątek, dokument) w nagłówku „Teraz” tylko bez karty publikacji: karta ma własny przycisk celu w nagłówku (przy opcjach
  // każda swój); po wysyłce jego miejsce zajmuje link do wyniku
  const target = !done && !mode ? targetLink(s, s.blocks) : null;
  const deps = s.dependsOn.length;
  const tech = [toolLabel(s.tool), model && !done ? model.now : null, own ? `~${fmtMin(estOf(s))}${spentMin(s) ? ` / ${fmtMin(spentMin(s))}` : ""}` : agentMin ? `Claude ${fmtMin(agentMin)}` : null, s.needsApproval ? "wymaga zgody" : "bez zgody", deps && !done ? `czeka na ${deps}` : null].filter(Boolean).join(" · ");
  const took = whoDid(s) === "Ty" ? spentMin(s) : agentMin;
  const meta = done && s.filePath ? `Zapisano na Macu · ${fileName(s.filePath)}` : done ? `${whoDid(s)}${took ? ` · ${fmtMin(took)}` : ""}` : state === "ready" && !mode ? (own ? `Ty · ~${fmtMin(estOf(s))}` : `${toolLabel(s.tool)} · Claude`) : null;

  const now = (
    <div className={"zone ans now " + head.cls}>
      <div className="now-h">
        {s.status === "handoff" && !mode ? (activity ? <Activity text={activity.text} detail={activity.detail} since={activity.since} who="Claude" big />
          : <span className="working" title={s.cloud ? "Claude w chmurze robi ten krok; wynik pojawi się tutaj" : prompt ? "Claude robi ten krok przez konektor; wynik pojawi się tutaj" : undefined}><span className="pulse" />{s.cloud ? "Claude w chmurze pracuje" : "Claude pracuje"}{s.handoffAt ? ` od ${fmtTime(s.handoffAt)}` : ""}</span>)
          : <span>{head.title}{done && s.doneAt ? ` ${fmtTime(s.doneAt)}` : ""}</span>}
        {meta ? <small>· {meta}</small> : null}
        {target && isHttpUrl(target.url) ? <><span className="sp" /><a className="btn ico" href={target.url} target="_blank" rel="noopener" title={`Tu trafi wynik kroku: ${target.url}`}>{target.label}<Icon k="ext" size={13} sw={1.6} /></a></> : null}
        {done && s.filePath ? <><span className="sp" /><CopyButton text={s.filePath} label="Kopiuj ścieżkę" /></> : null}
      </div>
      {s.tool === "file" && s.status === "todo" && oldMac ? <div className="note">Ten krok zapisze plik aplikacja Task Hub na Macu od wersji 0.1.7. Zaktualizuj ją w menu aplikacji.</div> : null}
      {mode ? <PublishCard t={t} s={s} mode={mode} aiOn={aiOn} ownerName={ownerName} link={link ?? null} connections={connections} company={company} activity={activity} issue={issue}
        waitsOn={t.steps.filter((x) => s.dependsOn.includes(x.id) && x.status !== "done").map((x) => `${String(t.steps.indexOf(x) + 1).padStart(2, "0")} „${x.title}”`)} /> : null}
      {cloudNote && !mode ? <div className="note">{cloudNote}</div> : null}
      {!mode && state === "blocked" ? <div className="note">{waits ? "Całe zadanie czeka, aż skończą się zadania, po których ma ruszyć." : "Ten krok ruszy, gdy skończą się kroki, na które czeka."}</div> : null}
      {open.length && !done ? <BlocksView blocks={open} form={form} indexOf={indexOf} /> : null}
      {done && kind === "decision" && decisionText(s) ? <div className="note">{decisionText(s)}</div> : null}
      {done && result.length ? <BlocksView blocks={result} form={form} indexOf={indexOf} /> : null}
      {done && lines.length ? <div className="stack">{lines.map((l, i) => l.confirm
        ? <div key={i} className="confirm"><b>Do potwierdzenia:</b><span>{l.text.replace(/^do potwierdzenia:\s*/i, "")}</span></div>
        : <div key={i} className="note">{l.text}</div>)}</div> : null}
      {outputExtra ? <div className="note">{outputExtra}</div> : null}
      {review?.summary ? <div className={"review" + (review.fits === false || review.warning ? " warn" : "")}>{review.warning ? <div><b>Uwaga:</b> {review.warning}</div> : null}<div>{review.summary}</div>{review.links?.filter(isHttpUrl).length ? <div className="deps">{review.links.filter(isHttpUrl).map((u) => <a key={u} className="chip" href={u} target="_blank" rel="noopener"><span>{u.replace(/^https?:\/\//, "").slice(0, 40)}</span></a>)}</div> : null}</div> : null}
      {!mode || mode === "sent" || mode === "unsent" ? (
        <div className="actions">
          {s.status === "todo" && kind === "agent" && !inProject ? (<>
            {aiOn && !ext ? <form action={prepare.bind(null, t.id, s.id)}><PendingButton className="btn primary" busy="Agent przygotowuje…">Przygotuj</PendingButton></form> : null}
            {aiOn ? <form action={compose.bind(null, t.id, s.id)}><PendingButton className="btn" busy="Składam…" title="Agent składa panel z faktów, migawek i załączników">Pokaż kontekst</PendingButton></form> : null}
            {!aiOn && state === "ready" ? <form action={handoff.bind(null, t.id, s.id)}><PendingButton className="btn primary" title="Claude weźmie ten krok teraz; kafelek pokaże, że trwa praca" busy="Uruchamiam…"><Icon k="play" size={12} sw={2} /> Uruchom</PendingButton></form> : null}
          </>) : null}
          {s.status === "todo" && inProject && !cloud && state === "ready" ? <form action={runInCloud.bind(null, t.id, s.id)}><PendingButton className="btn primary" title="Claude w chmurze weźmie ten krok (odpala go aplikacja Task Hub na Macu) i zamknie go z wynikiem" busy="Zlecam…"><Icon k="play" size={12} sw={2} /> Uruchom w chmurze</PendingButton></form> : null}
          {cloud ? <form action={cancelCloudRun.bind(null, t.id, s.id)}><PendingButton className="btn" title="Chmura nie weźmie tego kroku; możesz zlecić go jeszcze raz" busy="Wycofuję…"><Icon k="stop" size={11} sw={2} /> Wycofaj</PendingButton></form> : null}
          {s.status === "todo" && inProject ? <CopyButton className="btn" text={projectPrompt(t, s, origin)} label="Kopiuj polecenie" title="Awaryjnie: polecenie dla wątku w projekcie Claude w chmurze; wklej je tam, a wątek przeczyta zadanie i zamknie ten krok" /> : null}
          {s.status === "todo" && kind === "offline" && !cloud ? <DoneAsk taskId={t.id} stepId={s.id} est={estOf(s)} title={s.title} primary={!inProject} /> : null}
          {s.status === "todo" && kind === "reading" ? <form action={markDone.bind(null, t.id, s.id)}><PendingButton className="btn primary" busy="Zapisuję…">Przeczytane</PendingButton></form> : null}
          {s.status === "todo" && kind === "decision" && !open.length ? <form action={markDone.bind(null, t.id, s.id)}><PendingButton className="btn primary" busy="Zapisuję…" title="Odpowiedzi już są; krok sprzed paczki 7 zamyka ten przycisk">Zrobione</PendingButton></form> : null}
          {s.status === "handoff" ? <form action={backToTodo.bind(null, t.id, s.id)}><PendingButton className="btn" title="Krok wraca do zrobienia; Claude odłoży ten krok" busy="Zatrzymuję…"><Icon k="stop" size={11} sw={2} /> Zatrzymaj</PendingButton></form> : null}
          {links.filter((l) => isHttpUrl(l.url)).map((l, i) => <a key={l.url} className={"btn ico" + (done && i === 0 ? " primary" : "")} href={l.url} target="_blank" rel="noopener" title={l.url}>{l.label}<Icon k="ext" size={13} sw={1.6} /></a>)}
          {done && kind === "decision" ? <form action={reopen.bind(null, t.id, s.id)}><PendingButton className="btn" busy="Otwieram…" title="Pytanie wraca na kartkę; nowa odpowiedź zamknie krok od nowa, a Claude poprawi to, co po niej przygotował"><Icon k="undo" size={13} sw={1.9} /> Zmień odpowiedź</PendingButton></form> : null}
          {done && kind !== "decision" ? <form action={reopen.bind(null, t.id, s.id)}><PendingButton className="btn" title="Otwórz krok ponownie, żeby coś zmienić"><Icon k="undo" size={13} sw={1.9} /> Przywróć do zrobienia</PendingButton></form> : null}
        </div>
      ) : null}
      {s.status === "handoff" && prompt ? (
        <details className="edit">
          <summary>Awaryjnie: zrób to poza aplikacją</summary>
          <div className="stack">
            <PromptBox text={prompt} openUrl={claudeUrl(prompt)} />
            <form className="handoff-box" action={saveReport}>
              <input type="hidden" name="taskId" value={t.id} /><input type="hidden" name="stepId" value={s.id} />
              <div className="lbl">Wynik zrobiony poza aplikacją</div>
              <GrowTextarea className="out" minRows={3} name="report" placeholder="Wklej, co powstało: podsumowanie, link do artefaktu albo PR…" required />
              <div className="row"><input className="in" name="link" placeholder="Link do wyniku (opcjonalnie)" /><PendingButton className="btn primary" busy="Zapisuję…">Zapisz jako zrobione</PendingButton></div>
            </form>
          </div>
        </details>
      ) : null}
    </div>
  );
  const brief = <InlineText taskId={t.id} stepId={s.id} field="detail" value={s.detail} as="p" placeholder="Dodaj szczegóły: co dokładnie, gdzie, dla kogo…" />;
  // kartka zmieniona przez agenta po odpowiedzi Piotra: jedno kliknięcie przywraca poprzednią wersję (drugie wraca do zmienionej)
  const undo = s.hasPrevBlocks && !done ? (
    <form action={restoreBlocksForm} className="undo"><input type="hidden" name="taskId" value={t.id} /><input type="hidden" name="stepId" value={s.id} /><button type="submit" className="btn sm">Cofnij zmianę kartki</button></form>
  ) : null;
  // paczka 15 (punkty 7–9): bez sekcji „Co” (opis kroku idzie na dół, do zwiniętych informacji); główna treść zaraz pod „Teraz”,
  // „Skąd” (materiał z pochodzeniem) pod nią i zwinięte; karta z kartą publikacji i odczyt bez zmian (materiał jest tam treścią)
  const split = mode || readingResult(s, material) ? { main: [], sources: material } : splitMain(material);
  const main = split.main.length && folds.material ? <div className="zone src main">{undo ? <div className="lbl">{undo}</div> : null}<BlocksView blocks={split.main} form={form} indexOf={indexOf} /></div>
    : split.main.length ? <details className="fold"><summary><span className="k">Wynik</span><span className="t">{kindsOf(split.main)}</span><Icon k="chev" size={10} sw={2.2} /></summary><BlocksView blocks={split.main} form={form} indexOf={indexOf} /></details> : null;
  const kinds = kindsOf(split.sources);
  const srcOpen = folds.material && !split.main.length;   // „Skąd” rozwinięte tylko, gdy na karcie nie ma innej treści
  const skad = split.sources.length ? (srcOpen
    ? <div className="zone src"><div className="lbl">Skąd<span className="n">{kinds}</span>{split.main.length ? null : undo}</div><BlocksView blocks={split.sources} form={form} indexOf={indexOf} /></div>
    : <details className="fold"><summary><span className="k">Skąd</span><span className="t">{kinds}</span><Icon k="chev" size={10} sw={2.2} /></summary><BlocksView blocks={split.sources} form={form} indexOf={indexOf} /></details>) : null;
  // paczka 17, punkt 1: materiał z kroków Claude'a, od których zależy ten krok Piotra, stoi na jego kartce (tylko do odczytu)
  const fromDeps = depCardsFor(t.steps, s).map((d) => (
    <div key={d.id} className="zone src"><div className="lbl">Z kroku {String(d.idx).padStart(2, "0")}<span className="n">{d.title}</span></div><BlocksView blocks={d.blocks} /></div>
  ));
  // krok bez żadnej treści od agenta: opis zostaje na wierzchu, inaczej karta byłaby pusta
  const bare = !material.length && !result.length && !mode;
  return (
    <>
      {mode && skad && srcOpen ? (cmp ? <>{skad}{now}</> : <div className="zones two">{now}{skad}</div>) : <>{now}{main}{skad}</>}
      {bare ? <div className="zone">{brief}</div> : null}
      {fromDeps}
      <details className="edit tech">
        <summary><span className="k">Szczegóły techniczne</span> · {tech}</summary>
        <div className="stack">
          {/* paczka 15, punkt 6: zadanie, projekt i firma tylko tutaj, na dole karty */}
          <div className="pctx"><span className="d" style={{ ["--c" as string]: ctx.color }} /><span>Zadanie <b>{t.title}</b> · {ctx.text}</span></div>
          {bare ? null : <div className="zone"><div className="lbl">Opis kroku</div>{brief}</div>}
          <StepMeta taskId={t.id}
            step={{ id: s.id, tool: s.tool, own, agentMin, estMin: estOf(s), spentMin: spentMin(s), needsApproval: s.needsApproval, dependsOn: s.dependsOn, estHint: calOn ? `→ ~${fmtMin(calEst(s, samples))}` : null, connectionId: s.connectionId }}
            steps={t.steps.filter((x) => x.id !== s.id).map((x) => ({ id: x.id, title: x.title, done: x.status === "done" }))}
            connections={connections} showConnection model={done ? null : model}
            calText={calOn && cal ? `Z Twoich czasów (${cal.n} ${plural(cal.n, "krok", "kroki", "kroków")}): takie kroki trwają zwykle ×${String(cal.k).replace(".", ",")}.` : null} />
          <InlineText taskId={t.id} stepId={s.id} field="link" value={s.link ?? ""} as="small" placeholder="Dodaj link do wyniku (ticket, wydarzenie, mail)…" shown={s.link ? "Link: " + s.link.replace(/^https?:\/\//, "").slice(0, 70) : undefined} />
        </div>
      </details>
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
    </>
  );
}
