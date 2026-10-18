"use client";
// Poziom 2: kafelek zadania (origin) i kafelki kroków na kanwie, panel szczegółów (treść z serwera), pasek stanu, dok w kontekście zadania.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Canvas, type CanvasApi, type CanvasGroup, type CanvasItem } from "./Canvas";
import { GHEAD, GPAD, STEP_SIZE } from "@/lib/canvas/layout";
import { Icon, Lvl, ST_LABEL, TS_LABEL, plural, toolColor, type GroupVM, type StepTile, type TaskStateKey, type TileActivity } from "./ui";
import { msgCount, type Queue } from "@/lib/auto";
import { GroupBar, layoutSnapshot, useUndoLayout } from "./Board";
import { AgentPill, BackPill, MakePill, ViewPill, useView } from "./pills";
import { SearchPill } from "./SearchPill";
import type { SearchItem } from "@/lib/search-core";
import { Dock, Namer, TileMenu, Toast, useToast } from "./widgets";
import { InlineText } from "@/components/StepFields";
import { Activity } from "@/components/Activity";
import { addStepQuick, autoLayout, batchSteps, chat, createGroupAction, deleteGroupAction, handoff, linkSteps, saveStepPositions, updateGroupAction } from "@/app/actions";

export type TaskCanvasProps = {
  task: { id: string; title: string; base: number; eff: number; why: string; state: TaskStateKey; progress: { done: number; all: number }; estText: string; activity: TileActivity | null; pending: number };
  queue: Queue | null;                     // wiadomości Piotra bez odpowiedzi: kto je weźmie i kiedy (karta nad dokiem, historia rozmowy)
  steps: (StepTile & { toolName: string })[];
  groups: GroupVM[]; index: SearchItem[];
  aiOn: boolean; agent: string; lastAgent: { id: string; text: string; stepId?: string | null; link?: string | null } | null;
  focus: string | null;
  runbar: ReactNode;                       // treść paska stanu nad kanwą
  runAction?: { label: string; anchor: string } | null;   // przycisk w pasku: otwiera panel zadania i rozwija wskazaną sekcję
  taskBar: ReactNode; taskBody: ReactNode; // panel zadania
  panels: Record<string, ReactNode>;       // panele kroków, klucz = id kroku
  questions: ReactNode | null;             // karta pytań agenta
};

const pad = (n: number) => String(n).padStart(2, "0");
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

export function TaskCanvas(p: TaskCanvasProps) {
  const router = useRouter();
  const { toast, run } = useToast();
  const undoL = useUndoLayout(run);
  const { view, onView } = useView("task");
  const api = useRef<CanvasApi | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [selGroup, setSelGroup] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [panel, setPanel] = useState<string | null>(() => (p.focus && p.steps.some((s) => s.id === p.focus) ? p.focus : null));
  const [confirm, setConfirm] = useState(false);
  const [tmenu, setTmenu] = useState<{ id: string | null; x: number; y: number } | null>(null);   // menu kafelka (prawy klik); null = kafelek zadania
  const [namer, setNamer] = useState<"tile" | "group" | null>(null);
  // kontekst pola czatu: domyślnie to, co jest otwarte (krok w panelu, inaczej zadanie); X zawęża o poziom wyżej (krok → zadanie → wszystkie zadania)
  const [ctxLevel, setCtxLevel] = useState<"auto" | "task" | "global">("auto");
  // szerokość panelu: dwa tryby (wąski do 600 px, szeroki do 1200 px) zapamiętane jako wybór, a uchwyt nadpisuje je dokładną szerokością
  const [wide, setWide] = useState(false);
  const [gripW, setGripW] = useState<number | null>(null);
  const [ww, setWw] = useState(1280);
  const [gripOn, setGripOn] = useState(false);
  const [answerOff, setAnswerOff] = useState(true);
  const grip = useRef<{ x: number; w: number } | null>(null);
  const maxW = Math.max(360, ww - 32);
  const dw = clamp(gripW ?? (wide ? Math.min(1200, ww - 64) : Math.min(600, ww - 32)), 360, maxW);
  const cramped = ww - dw < 420;   // szeroki panel zostawia za mało miejsca: pasek stanu i karta odpowiedzi chowają się do czasu zwężenia

  useEffect(() => {
    try { setWide(localStorage.getItem("th-wide") === "1"); const w = Number(localStorage.getItem("th-dw")); if (w) setGripW(w); } catch { /* brak storage */ }
    const size = () => setWw(window.innerWidth); size();
    window.addEventListener("resize", size); return () => window.removeEventListener("resize", size);
  }, []);
  // przycisk w pasku („Rozpisz teraz”): panel zadania i rozwinięta sekcja, do której prowadzi
  const runAct = (anchor: string) => { setSel(new Set()); setPanel("__task"); setTimeout(() => { const el = document.getElementById(anchor); if (el instanceof HTMLDetailsElement) el.open = true; el?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, 80); };
  useEffect(() => { try { setAnswerOff(!p.lastAgent || sessionStorage.getItem("th-ans-" + p.task.id) === p.lastAgent.id); } catch { setAnswerOff(!p.lastAgent); } }, [p.lastAgent, p.task.id]);
  useEffect(() => {
    setSel((s) => { const n = new Set([...s].filter((id) => p.steps.some((x) => x.id === id))); return n.size === s.size ? s : n; });
    setPanel((cur) => (cur && cur !== "__task" && !p.steps.some((x) => x.id === cur) ? null : cur));
  }, [p.steps]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { setConfirm(false); setNamer(null); setSel(new Set()); setSelGroup(null); setPanel(null); } };
    document.addEventListener("keydown", key); return () => document.removeEventListener("keydown", key);
  }, []);

  const byId = useMemo(() => new Map(p.steps.map((s) => [s.id, s])), [p.steps]);
  const items: CanvasItem[] = useMemo(() => p.steps.map((s) => ({ id: s.id, dependsOn: s.dependsOn, pos: s.pos, cls: s.state + (panel === s.id ? " sel" : ""), done: s.state === "done", aria: `Krok ${s.idx}: ${s.title}` })), [p.steps, panel]);
  const groups: CanvasGroup[] = useMemo(() => p.groups.map((g) => ({ ...g })), [p.groups]);
  const group = selGroup ? p.groups.find((g) => g.id === selGroup) ?? null : null;
  const ids = [...sel], n = sel.size, word = plural(n, "krok", "kroki", "kroków");
  const allDone = n > 0 && ids.every((id) => byId.get(id)?.state === "done");
  const t = p.task;

  const groupRect = (members: string[]) => {
    const P = api.current?.positions() ?? {};
    const xs = members.map((k) => P[k]).filter(Boolean);
    if (!xs.length) { const c = api.current?.viewCenter() ?? { x: 400, y: 300 }; return { x: Math.max(0, c.x - 180), y: Math.max(60, c.y - 100), w: 360, h: 200 }; }
    const x = Math.min(...xs.map((q) => q.x)) - GPAD, y = Math.min(...xs.map((q) => q.y)) - GPAD - GHEAD;
    return { x, y, w: Math.max(...xs.map((q) => q.x)) + STEP_SIZE.w + GPAD - x, h: Math.max(...xs.map((q) => q.y)) + STEP_SIZE.h + GPAD - y };
  };
  const freeze = (members: string[]) => { const P = api.current?.positions() ?? {}; const list = members.filter((k) => P[k]).map((k) => ({ id: k, x: Math.round(P[k].x), y: Math.round(P[k].y) })); return list.length ? saveStepPositions(t.id, list) : Promise.resolve(); };
  const after = n === 1 ? ids[0] : panel && panel !== "__task" ? panel : null;
  // pojedyncze kliknięcie otwiera panel kroku (pierścień akcentu); zaznaczenie zbiorcze to ramka albo Shift/Ctrl
  const openStep = (id: string) => { setSel(new Set()); setSelGroup(null); setPanel(id); setConfirm(false); };
  // pasek panelu kroku: numer, tytuł (edycja klikiem, do 2 linii), stan; narzędzie jest w technikaliach, nie dubluje się tu
  const stepBar = (s: StepTile & { toolName: string }) => (
    <><span className="n-num">{pad(s.idx)}</span><InlineText taskId={t.id} stepId={s.id} field="title" value={s.title} as="bar" placeholder="Tytuł kroku" /><span className={"st " + s.state} style={{ margin: 0 }}>{ST_LABEL[s.state]}</span></>
  );
  const onGrip = (e: React.PointerEvent) => { e.preventDefault(); (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); grip.current = { x: e.clientX, w: dw }; setGripOn(true); };
  const onGripMove = (e: React.PointerEvent) => { const g = grip.current; if (!g) return; setGripW(clamp(g.w + (g.x - e.clientX), 360, window.innerWidth - 32)); };
  const endGrip = () => { if (!grip.current) return; grip.current = null; setGripOn(false); try { localStorage.setItem("th-dw", String(dw)); } catch { /* brak storage */ } };
  const widen = () => { const w = !wide; setWide(w); setGripW(null); try { localStorage.setItem("th-wide", w ? "1" : "0"); localStorage.removeItem("th-dw"); } catch { /* brak storage */ } };
  const cur = panel && panel !== "__task" ? byId.get(panel) ?? null : null;
  useEffect(() => { setCtxLevel("auto"); }, [panel]);
  const ctxGlobal = ctxLevel === "global";
  const ctxStep = ctxLevel === "auto" ? cur : null;
  // wynik szukania: krok tego zadania otwiera się na miejscu (panel + środek kanwy); reszta prowadzi pod swój adres
  const onPick = (it: SearchItem): boolean => {
    if (it.kind !== "step" || it.taskId !== t.id) return false;
    openStep(it.id); if (view === "canvas") api.current?.centerOn(it.id); return true;
  };
  const layoutNow = () => { undoL.remember(layoutSnapshot(api.current, p.steps.map((s) => s.id), p.groups)); run(() => autoLayout(t.id), "Ułożono"); };

  return (
    <div className={"app" + (panel && cramped ? " cramped" : "")} style={panel ? { ["--dw" as string]: dw + "px" } : undefined}>
      {view === "canvas" ? (
        <Canvas zoomKey={"task"} apiRef={api} items={items} size={STEP_SIZE} groups={groups} render={(id) => { const s = byId.get(id)!; return (
            <>
              <span className="n-top"><span className="n-num">{pad(s.idx)}</span><span className="chip tool" style={{ ["--c" as string]: toolColor(s.tool) }}>{s.toolName}</span><span className={"st " + s.state}>{ST_LABEL[s.state]}</span></span>
              <span className="n-title">{s.title}</span>
              <span className="n-meta">{s.activity ? <Activity text={s.activity.text} detail={s.activity.detail} since={s.activity.since} /> : s.meta}</span>
            </>); }}
          origin={{ cls: "task " + t.state, node: (
            <>
              <span className="n-top"><Lvl base={t.base} eff={t.eff} why={t.why} /><span className="st" style={{ marginLeft: "auto", background: "rgba(255,255,255,.2)", color: "#fff" }}>{TS_LABEL[t.state]}</span>
                {t.pending ? <span className="st" style={{ background: "rgba(255,255,255,.2)", color: "#fff" }} title="Twoje wiadomości czekają na odpowiedź agenta">{msgCount(t.pending)}</span> : null}</span>
              <span className="n-title" style={{ WebkitLineClamp: 3 }}>{t.title}</span>
              <span className="n-meta">{t.activity ? <Activity text={t.activity.text} detail={t.activity.detail} since={t.activity.since} who="Mostek" /> : `${t.progress.done}/${t.progress.all} kroków · ${t.estText}`}</span>
            </>) }}
          selected={sel} onSelect={(s) => { setSel(s); setConfirm(false); if (!s.size) setPanel(null); }} selectedGroup={selGroup} onSelectGroup={setSelGroup} renaming={renaming} onRename={(id, name) => setRenaming(name == null ? null : id)}
          onOpen={(id) => { if (id) openStep(id); else setPanel("__task"); }} onClickTile={(id) => { if (id === "__origin") { setSel(new Set()); setPanel("__task"); } else openStep(id); }}
          onMenu={(id, at) => setTmenu({ id, ...at })} onMove={(moved) => run(() => saveStepPositions(t.id, moved))}
          onLink={(from, to) => run(() => linkSteps(t.id, from, to, true), "Połączono: drugi krok zacznie się po pierwszym")} onUnlink={(from, to) => run(() => linkSteps(t.id, from, to, false), "Usunięto połączenie")}
          onGroupChange={(id, patch) => run(() => updateGroupAction(t.id, id, patch))} onGroupCreate={(rect, members) => run(async () => { await freeze(members); await createGroupAction(t.id, "Nowa grupa", members, rect); })}
          onAutoLayout={layoutNow} onUndoLayout={undoL.canUndo ? () => undoL.undo(t.id) : null} />
      ) : (
        <div className="listview">
          <div className="stage-grp">
            <button type="button" className="lrow" onClick={() => setPanel("__task")}><Lvl base={t.base} eff={t.eff} why={t.why} /><span className="n-title">{t.title}</span><span className="n-meta" style={{ margin: 0 }}>{t.progress.done}/{t.progress.all}</span></button>
            {p.steps.map((s) => (
              <button key={s.id} type="button" className="lrow" onClick={() => openStep(s.id)}>
                <span className="n-num">{pad(s.idx)}</span><span className="chip tool" style={{ ["--c" as string]: toolColor(s.tool) }}>{s.toolName}</span>
                <span className="n-title">{s.title}</span><span className={"st " + s.state} style={{ margin: 0 }}>{ST_LABEL[s.state]}</span>
              </button>
            ))}
            {p.steps.length ? null : <p className="sub">Brak kroków.</p>}
          </div>
        </div>
      )}

      <div className="pillbar">
        <div className="pl">
          <BackPill onBack={() => router.push("/")}><Lvl base={t.base} eff={t.eff} why={t.why} /><span className="ct">{t.title}</span></BackPill>
        </div>
        <ViewPill view={view} onView={onView} />
        <span className="sp" />
        <SearchPill index={p.index} screen="task" here={t.id} onPick={onPick} />
        <AgentPill agent={p.agent} aiOn={p.aiOn} />
      </div>
      {view === "canvas" ? <MakePill tileTitle={after ? "Nowy krok po zaznaczonym" : "Nowy krok"} groupTitle={n ? "Zgrupuj zaznaczone" : "Nowa grupa"} onTile={() => setNamer(namer === "tile" ? null : "tile")} onGroup={() => setNamer(namer === "group" ? null : "group")} /> : null}

      {p.runbar ? <div className={"runbar glass" + (panel ? " withpanel" : "")}>{p.runbar}{p.runAction ? <button className="btn" type="button" onClick={() => runAct(p.runAction!.anchor)}>{p.runAction.label}</button> : null}</div> : null}

      {namer === "tile" ? <Namer label="Nazwa nowego kroku" placeholder={after ? "Nazwa kroku (po zaznaczonym)" : "Nazwa kroku"} onClose={() => setNamer(null)} onSubmit={(name) => { setNamer(null); run(() => addStepQuick(t.id, name, after), "Dodano krok"); }} /> : null}
      {namer === "group" ? <Namer label="Nazwa grupy" placeholder={n ? `Nazwa grupy dla ${n} ${word}` : "Nazwa grupy"} onClose={() => setNamer(null)} onSubmit={(name) => { const members = ids; const rect = groupRect(members); setNamer(null); setSel(new Set()); setPanel(null); run(async () => { await freeze(members); const id = await createGroupAction(t.id, name, members, rect); setSelGroup(id); }); }} /> : null}
      {tmenu ? <TileMenu at={tmenu} onClose={() => setTmenu(null)} items={(() => { const id = tmenu.id; if (!id) return [{ label: "Otwórz zadanie", onPick: () => { setSel(new Set()); setPanel("__task"); } }]; const st = byId.get(id), on = sel.has(id), done = st?.state === "done"; return [
        { label: "Otwórz", onPick: () => openStep(id) },
        ...(st && st.state === "ready" && st.tool !== "manual" && !p.aiOn ? [{ label: "Uruchom", onPick: () => run(() => handoff(t.id, id), "Claude bierze ten krok") }] : []),
        { label: on ? "Odznacz" : "Zaznacz", onPick: () => { const s = new Set(sel); if (on) s.delete(id); else s.add(id); setSel(s); } },
        { label: "Zgrupuj", onPick: () => { setSel(new Set([...sel, id])); setNamer("group"); } },
        { label: done ? "Wróć do pracy" : "Oznacz jako gotowe", onPick: () => run(() => batchSteps(t.id, [id], { done: !done }), done ? "Przywrócono do pracy" : "Oznaczono jako gotowe") },
        { label: "Usuń…", danger: true, onPick: () => { setPanel(null); setSel(new Set([id])); setConfirm(true); } },
      ]; })()} /> : null}

      {view === "canvas" && group && !n ? (
        <GroupBar g={group} onColor={(c) => run(() => updateGroupAction(t.id, group.id, { color: c }))} onRename={() => setRenaming(group.id)}
          onSelectMembers={() => { setSel(new Set(group.members)); setSelGroup(null); }} onUngroup={() => { setSelGroup(null); run(() => deleteGroupAction(t.id, group.id), "Rozgrupowano, kafelki zostały"); }} onClear={() => setSelGroup(null)} />
      ) : null}
      {view === "canvas" && (n > 1 || (n === 1 && confirm)) ? (   /* jeden krok: tylko potwierdzenie usunięcia z menu kafelka */
        <div className="selbar glass" role="toolbar" aria-label="Akcje dla zaznaczonych">
          {confirm ? (
            <><span className="rb-t">Usunąć <b>{n} {word}</b>? Tego nie da się cofnąć.</span><span className="dv" />
              <button className="btn danger" type="button" onClick={() => { const list = ids; setConfirm(false); setSel(new Set()); setPanel(null); run(() => batchSteps(t.id, list, { remove: true }), "Usunięto"); }}>Tak, usuń</button><button className="btn" type="button" onClick={() => setConfirm(false)}>Anuluj</button></>
          ) : (
            <><span className="rb-t"><b>{n} {word}</b></span><span className="dv" />
              <button className="btn" type="button" onClick={() => setNamer("group")}>Zgrupuj</button>
              {allDone ? <button className="btn" type="button" onClick={() => { const list = ids; setSel(new Set()); run(() => batchSteps(t.id, list, { done: false }), "Przywrócono do pracy"); }}>Wróć do pracy</button>
                : <button className="btn" type="button" onClick={() => { const list = ids; setSel(new Set()); run(() => batchSteps(t.id, list, { done: true }), "Oznaczono jako gotowe"); }}>Oznacz jako gotowe</button>}
              <button className="btn danger" type="button" onClick={() => setConfirm(true)}>Usuń</button>
              <button className="icobtn end" type="button" aria-label="Odznacz wszystko" title="Odznacz (Esc)" onClick={() => { setSel(new Set()); setConfirm(false); }}><Icon k="x" size={12} sw={2} /></button></>
          )}
        </div>
      ) : null}

      {panel ? (
        <aside className="detail glass" style={{ ["--dw" as string]: dw + "px" }} aria-live="polite" onPointerDown={(e) => e.stopPropagation()}>
          <div className={"grip" + (gripOn ? " on" : "")} title="Przeciągnij, aby zmienić szerokość" onPointerDown={onGrip} onPointerMove={onGripMove} onPointerUp={endGrip} onPointerCancel={endGrip} />
          <div className="d-bar">
            {panel === "__task" ? p.taskBar : cur ? stepBar(cur) : null}
            <button className={"icobtn" + (wide && gripW == null ? " on" : "")} type="button" aria-label={wide ? "Węziej" : "Szerzej"} title={wide ? "Węziej" : "Szerzej (kartka obok siebie)"} aria-pressed={wide} onClick={widen}><Icon k="widen" size={14} sw={1.6} /></button>
            <button className="icobtn" type="button" aria-label="Zamknij" onClick={() => { setPanel(null); setSel(new Set()); }}><Icon k="x" size={12} sw={2} /></button>
          </div>
          <div className="d-body" key={panel}>{panel === "__task" ? p.taskBody : p.panels[panel]}</div>
        </aside>
      ) : null}

      {p.questions && !n && !group ? <div className={"answer glass" + (panel ? " withpanel" : "")} aria-live="polite">{p.questions}</div> : null}
      {/* karta nad dokiem: najpierw stan kolejki wiadomości (znika sam po odpowiedzi), pod nim ostatni komunikat agenta (X zamyka tylko komunikat) */}
      {!p.questions && (p.queue || (p.lastAgent && !answerOff)) && !n && !group ? (
        <div className={"answer plain glass" + (panel ? " withpanel" : "") + (p.queue && !(p.lastAgent && !answerOff) ? " qonly" : "")} role="status" aria-live="polite">
          {p.queue ? <div className="ans-q">{p.queue.activity ? <Activity text={p.queue.activity.text} detail={p.queue.activity.detail} since={p.queue.activity.since} who={p.queue.text + " ·"} /> : <><i className="pulse" aria-hidden="true" /><span>{p.queue.text}</span></>}</div> : null}
          {p.lastAgent && !answerOff ? (<>
            <div className="ans-text">{p.lastAgent.text}</div>
            {(p.lastAgent.stepId && byId.has(p.lastAgent.stepId)) || p.lastAgent.link ? (
              <div className="ans-acts">
                {p.lastAgent.stepId && byId.has(p.lastAgent.stepId) ? <button className="btn" type="button" onClick={() => openStep(p.lastAgent!.stepId!)}>Otwórz krok {pad(byId.get(p.lastAgent.stepId)!.idx)}</button> : null}
                {p.lastAgent.link ? <a className="btn ico" href={p.lastAgent.link} target="_blank" rel="noopener" title={p.lastAgent.link}>Otwórz wynik<Icon k="ext" size={13} sw={1.6} /></a> : null}
              </div>
            ) : null}
            <button className="icobtn ans-x" type="button" aria-label="Zamknij odpowiedź" title="Zamknij" onClick={() => { setAnswerOff(true); try { sessionStorage.setItem("th-ans-" + t.id, p.lastAgent!.id); } catch { /* brak storage */ } }}><Icon k="x" size={12} sw={2} /></button>
          </>) : null}
        </div>
      ) : null}

      <Dock action={chat} taskId={ctxGlobal ? null : t.id} stepId={ctxStep?.id ?? null} busyText={p.aiOn ? "Agent myśli…" : "Zapisuję…"}
        queue={ctxGlobal ? null : p.queue} version={`${p.lastAgent?.id ?? ""}|${p.queue?.n ?? 0}|${p.queue?.kind ?? ""}|${p.queue?.activity?.text ?? ""}`}
        placeholder={ctxGlobal ? "Co masz na głowie? Wklej maila, wiadomość albo opisz zadanie…" : ctxStep ? "Napisz, co dalej z tym krokiem: popraw szkic, dopisz, zapytaj…" : "Napisz, co dalej z tym zadaniem, albo dopisz notatkę…"}
        context={ctxGlobal
          ? <span className="ctx"><span className="k">Kontekst: wszystkie zadania</span><button type="button" aria-label="Wróć do kontekstu zadania" title="Wróć do kontekstu zadania" onClick={() => setCtxLevel("auto")}><Icon k="undo" size={12} sw={1.9} /></button></span>
          : ctxStep
            ? <span className="ctx" title="Wiadomość dotyczy otwartego kroku"><span className="k">Kontekst: krok {pad(ctxStep.idx)}</span><b>{ctxStep.title}</b><button type="button" aria-label="Pisz w kontekście całego zadania" title="Pisz w kontekście całego zadania" onClick={() => setCtxLevel("task")}><Icon k="x" size={12} sw={2} /></button></span>
            : <span className="ctx" title="Wiadomość dotyczy tego zadania"><span className="k">Kontekst:</span><b>{t.title}</b><button type="button" aria-label="Pisz w kontekście wszystkich zadań" title="Pisz w kontekście wszystkich zadań" onClick={() => setCtxLevel("global")}><Icon k="x" size={12} sw={2} /></button></span>} />
      <Toast text={toast} />
    </div>
  );
}
