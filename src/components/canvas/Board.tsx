"use client";
// Poziom 1: wszystkie zadania jako kafelki na kanwie (albo lista), pasek-pigułka, menu pod logo, zaznaczanie zbiorcze, archiwum, projekty, dok czatu.
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Canvas, type CanvasApi, type CanvasGroup, type CanvasItem } from "./Canvas";
import { GHEAD, GPAD, TASK_SIZE } from "@/lib/canvas/layout";
import { Icon, Lvl, ToolIcon, TS_LABEL, TS_SHORT, GCOL, plural, projColor, toolColor, type CompanyRow, type GroupVM, type ProjTask, type ProjectRow, type TaskTile } from "./ui";
import { Dock, Namer, PrioPicker, ProjectPicker, Toast, useToast } from "./widgets";
import { AgentPill, BackPill, BrandButton, MakePill, ViewPill, useView } from "./pills";
import { SearchPill } from "./SearchPill";
import { Projects, type ProjectPatch } from "./Projects";
import { matches, norm, tokens, type Screen, type SearchItem } from "@/lib/search-core";
import { autoLayout, batchTasks, chat, createCompanyAction, createGroupAction, createProjectAction, createTaskQuick, deleteGroupAction, linkTasks, logout, purgeTaskAction, removeCompany, removeProject, reopenLast, restoreLayout, restoreTask, saveTaskPositions, updateCompanyAction, updateGroupAction, updateProjectAction } from "@/app/actions";
import { Activity } from "@/components/Activity";

export type ArchRow = { id: string; title: string; when: string; summary: string | null; base: number; eff: number; project: string | null };
// parametry z adresu, którymi szukajka z innych ekranów otwiera właściwy widok (/?view=projects&p=…, /?view=done&t=…, /?focus=…)
export type BoardInitial = { view?: string; p?: string; t?: string; focus?: string };
export type BoardProps = {
  tasks: TaskTile[]; groups: GroupVM[]; projects: ProjectRow[]; companies: CompanyRow[]; projTasks: ProjTask[]; index: SearchItem[]; initial: BoardInitial;
  aiOn: boolean; agent: string; lastAgent: { id: string; text: string; link?: string | null } | null;
  archive: { done: ArchRow[]; trash: ArchRow[]; trashDays: number };
};
type LayoutSnap = { items: { id: string; x: number; y: number }[]; groups: { id: string; x: number; y: number; w: number; h: number; auto: boolean }[] };
const UNDO_MS = 8000;   // tyle „Cofnij” zostaje po „Ułóż”

export function TaskTileView({ t }: { t: TaskTile }) {
  const pct = t.progress.all ? (100 * t.progress.done) / t.progress.all : 0;
  // przy dwóch i więcej plakietkach licznik skraca się do „zrobione/wszystkie”, żeby nic nie było ucięte
  const badges = (t.drafts ? 1 : 0) + (t.handed ? 1 : 0) + (t.questions ? 1 : 0);
  const cnt = !t.progress.all ? t.estText : badges >= 2 ? `${t.progress.done}/${t.progress.all}` : `${t.progress.done}/${t.progress.all} · ${t.estText}`;
  return (
    <>
      <span className="t-head">
        <span className="t-ico" style={{ ["--c" as string]: toolColor(t.tool) }}><ToolIcon tool={t.tool} /></span>
        <span className="t-main">
          {t.project ? <span className="proj-tag" style={{ ["--c" as string]: projColor(t.project.color) }}>{t.project.name}</span> : null}
          <span className="n-title">{t.title}</span>
          {t.summary ? <span className={"t-sum" + (t.state === "done" ? " done" : "")}>{t.summary}</span> : null}
        </span>
      </span>
      <span className="t-row" style={{ marginTop: "auto" }}>
        <Lvl base={t.base} eff={t.eff} why={t.why} />
        {t.due ? <span className={"st due " + t.due.cls} title={"Termin: " + t.due.iso}>{t.due.text}</span> : null}
        <span className={"st " + t.state} title={TS_LABEL[t.state]}>{TS_SHORT[t.state]}</span>
      </span>
      {t.activity ? (
        <span className="t-row"><Activity text={t.activity.text} detail={t.activity.detail} since={t.activity.since} who="Claude" /></span>
      ) : (
        <span className="t-row">
          <span className="bar"><b style={{ width: pct + "%" }} /></span>
          <span className="cnt" style={{ fontVariantNumeric: "tabular-nums" }} title={`Kroki ${t.progress.done}/${t.progress.all} · ${t.estText}`}>{cnt}</span>
          {t.drafts ? <span className="st draft" title={`${t.drafts} do zatwierdzenia`}>{t.drafts} szkic{t.drafts === 1 ? "" : t.drafts < 5 ? "e" : "ów"}</span> : null}
          {t.handed ? <span className="st handoff" title={`${t.handed} w Claude`}>{t.handed} w Claude</span> : null}
          {t.questions ? <span className="st draft" style={{ display: "inline-flex", gap: 3 }} title="Pytania od agenta czekają na Twoją odpowiedź"><Icon k="question" size={12} sw={1.8} />{t.questions}</span> : null}
        </span>
      )}
    </>
  );
}

// pasek zaznaczonej grupy: kolor, nazwa, zaznacz kafelki, rozgrupuj
export function GroupBar({ g, onColor, onRename, onSelectMembers, onUngroup, onClear }: { g: GroupVM; onColor: (c: number) => void; onRename: () => void; onSelectMembers: () => void; onUngroup: () => void; onClear: () => void }) {
  return (
    <div className="selbar glass" role="toolbar" aria-label="Grupa">
      <span className="rb-t">Grupa <b>{g.name}</b></span><span className="dv" />
      {GCOL.map((c, i) => <button key={i} type="button" className={"gdot" + (g.color % GCOL.length === i ? " on" : "")} style={{ ["--g" as string]: c }} aria-label={"Kolor " + (i + 1)} onClick={() => onColor(i)} />)}
      <span className="dv" />
      <button className="btn" type="button" onClick={onRename}>Zmień nazwę</button>
      <button className="btn" type="button" disabled={!g.members.length} onClick={onSelectMembers}>Zaznacz kafelki</button>
      <button className="btn danger" type="button" title="Usuwa tylko prostokąt, kafelki zostają" onClick={onUngroup}>Rozgrupuj</button>
      <button className="icobtn end" type="button" aria-label="Odznacz grupę" onClick={onClear}><Icon k="x" size={12} sw={2} /></button>
    </div>
  );
}

// „Ułóż” zapamiętuje układ sprzed ułożenia; „Cofnij” (przez kilka sekund) go przywraca. Wspólne dla obu poziomów kanwy.
export function useUndoLayout(run: (fn: () => Promise<unknown>, ok?: string) => void) {
  const [snap, setSnap] = useState<LayoutSnap | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const remember = (s: LayoutSnap) => { setSnap(s); clearTimeout(timer.current); timer.current = window.setTimeout(() => setSnap(null), UNDO_MS); };
  const undo = (taskId: string | null) => { const s = snap; if (!s) return; setSnap(null); clearTimeout(timer.current); run(() => restoreLayout(taskId, s.items, s.groups), "Przywrócono poprzedni układ"); };
  return { canUndo: !!snap, remember, undo };
}
export function layoutSnapshot(api: CanvasApi | null, ids: string[], groups: GroupVM[]): LayoutSnap {
  const P = api?.positions() ?? {}, R = api?.groupRects() ?? {};
  return {
    items: ids.filter((k) => P[k]).map((k) => ({ id: k, x: Math.round(P[k].x), y: Math.round(P[k].y) })),
    groups: groups.filter((g) => R[g.id]).map((g) => ({ id: g.id, x: Math.round(R[g.id].x), y: Math.round(R[g.id].y), w: Math.round(R[g.id].w), h: Math.round(R[g.id].h), auto: g.auto })),
  };
}

export function Board(p: BoardProps) {
  const router = useRouter();
  const { toast, run } = useToast();
  const { view, onView } = useView("board");
  const api = useRef<CanvasApi | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [selGroup, setSelGroup] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [namer, setNamer] = useState<"tile" | "group" | null>(null);
  const [arch, setArch] = useState<"done" | "trash" | null>(null);
  const [proj, setProj] = useState(false);
  const [q, setQ] = useState("");
  const [focus, setFocus] = useState<string | null>(null);        // kafelek do wyśrodkowania, gdy kanwa będzie na ekranie
  const [projFocus, setProjFocus] = useState<string | null>(null);
  const [archFocus, setArchFocus] = useState<string | null>(null);
  const off = !!arch || proj;   // widok archiwum albo projektów zakrywa kanwę
  const [purgeId, setPurgeId] = useState<string | null>(null);
  const [answerOff, setAnswerOff] = useState(true);
  const undoL = useUndoLayout(run);
  const applied = useRef<string>("");

  useEffect(() => { try { setAnswerOff(!p.lastAgent || sessionStorage.getItem("th-ans") === p.lastAgent.id); } catch { setAnswerOff(!p.lastAgent); } }, [p.lastAgent]);
  useEffect(() => { setSel((s) => { const n = new Set([...s].filter((id) => p.tasks.some((t) => t.id === id))); return n.size === s.size ? s : n; }); }, [p.tasks]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { setMenu(false); setConfirm(false); setNamer(null); setSel(new Set()); setSelGroup(null); } };
    document.addEventListener("keydown", key); return () => document.removeEventListener("keydown", key);
  }, []);
  // wejście z adresu (wynik szukania na innym ekranie): otwórz widok, potem wyczyść adres, żeby odświeżenie wracało na kanwę
  useEffect(() => {
    const i = p.initial, key = JSON.stringify(i);
    if (!i || applied.current === key) return;
    applied.current = key;
    if (i.view === "projects") { setProj(true); setArch(null); setProjFocus(i.p ?? null); }
    else if (i.view === "done" || i.view === "trash") { setArch(i.view); setProj(false); setArchFocus(i.t ?? null); }
    else if (i.focus) { setArch(null); setProj(false); onView("canvas"); setFocus(i.focus); }
    else return;
    window.history.replaceState(window.history.state, "", "/");
  }, [p.initial]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!focus || off || view !== "canvas") return;
    const t = setTimeout(() => { api.current?.centerOn(focus); setSel(new Set([focus])); setSelGroup(null); setFocus(null); }, 120);
    return () => clearTimeout(t);
  }, [focus, off, view]);
  useEffect(() => {
    if (!archFocus || !arch) return;
    const el = document.getElementById("arch-" + archFocus); if (!el) return;
    el.scrollIntoView({ block: "center" }); el.classList.add("hl");
    const t = setTimeout(() => { el.classList.remove("hl"); setArchFocus(null); }, 3000); return () => clearTimeout(t);
  }, [archFocus, arch]);

  const byId = useMemo(() => new Map(p.tasks.map((t) => [t.id, t])), [p.tasks]);
  const words = useMemo(() => tokens(q), [q]);
  // trafienia wśród kafelków z tego samego indeksu, co lista wyników
  const hitIds = useMemo(() => new Set(p.index.filter((it) => it.kind === "task" && matches(it.hay, words)).map((it) => it.id)), [p.index, words]);
  const hits = useMemo(() => (words.length ? p.tasks.filter((t) => hitIds.has(t.id)) : p.tasks), [p.tasks, words, hitIds]);
  // w trakcie szukania pasujące kafelki zostają, reszta blednie
  const items: CanvasItem[] = useMemo(() => p.tasks.map((t) => ({ id: t.id, dependsOn: t.dependsOn, pos: t.pos, cls: "task " + t.state + (words.length ? (hitIds.has(t.id) ? " hit" : " dim") : ""), done: t.state === "done", aria: "Otwórz zadanie " + t.title })), [p.tasks, words.length, hitIds]);
  const groups: CanvasGroup[] = useMemo(() => p.groups.map((g) => ({ ...g })), [p.groups]);
  const group = selGroup ? p.groups.find((g) => g.id === selGroup) ?? null : null;
  const open = (id: string) => router.push(`/tasks/${id}`);
  const ids = [...sel];
  const screen: Screen = arch ?? (proj ? "projects" : "canvas");
  const showCanvas = () => { setArch(null); setProj(false); setSel(new Set()); setSelGroup(null); };
  // wynik szukania obsłużony na miejscu: zadanie → środek kanwy, projekt → widok projektów, archiwum → właściwa zakładka; reszta idzie pod adres
  const onPick = (it: SearchItem): boolean => {
    if (it.kind === "task") { if (view === "canvas") { setArch(null); setProj(false); setFocus(it.id); } else open(it.id); return true; }
    if (it.kind === "project") { setArch(null); setProj(true); setProjFocus(it.id); return true; }
    if (it.kind === "done" || it.kind === "trash") { setProj(false); setArch(it.kind); setArchFocus(it.id); return true; }
    return false;
  };

  // grupa ułożona automatycznie (np. przez agenta) dostaje na stałe prostokąt i położenia kafelków z pierwszego narysowania:
  // inaczej skakała po kanwie przy każdej zmianie wolnych kafelków
  useEffect(() => {
    const autos = p.groups.filter((g) => g.auto);
    if (!autos.length || view !== "canvas" || off) return;
    const t = setTimeout(() => {
      const rects = api.current?.groupRects() ?? {}, P = api.current?.positions() ?? {};
      autos.forEach((g) => {
        const r = rects[g.id]; if (!r) return;
        const list = g.members.filter((k) => P[k]).map((k) => ({ id: k, x: Math.round(P[k].x), y: Math.round(P[k].y) }));
        run(async () => { if (list.length) await saveTaskPositions(list); await updateGroupAction(null, g.id, { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h), auto: false }); });
      });
    }, 300);
    return () => clearTimeout(t);
  }, [p.groups, view, off]);   // eslint-disable-line react-hooks/exhaustive-deps

  const groupRect = (members: string[]) => {
    const P = api.current?.positions() ?? {};
    const xs = members.map((k) => P[k]).filter(Boolean);
    if (!xs.length) { const c = api.current?.viewCenter() ?? { x: 300, y: 300 }; return { x: Math.max(0, c.x - 180), y: Math.max(60, c.y - 120), w: 360, h: 240 }; }
    const x = Math.min(...xs.map((q) => q.x)) - GPAD, y = Math.min(...xs.map((q) => q.y)) - GPAD - GHEAD;
    return { x, y, w: Math.max(...xs.map((q) => q.x)) + TASK_SIZE.w + GPAD - x, h: Math.max(...xs.map((q) => q.y)) + TASK_SIZE.h + GPAD - y };
  };
  // tworzenie grupy nigdy nie przesuwa kafelków: ich bieżące położenia są zapisywane, a prostokąt powstaje wokół nich
  const freeze = (members: string[]) => { const P = api.current?.positions() ?? {}; const list = members.filter((k) => P[k]).map((k) => ({ id: k, x: Math.round(P[k].x), y: Math.round(P[k].y) })); return list.length ? saveTaskPositions(list) : Promise.resolve(); };
  // bez zaznaczenia: prostokąt na środku widoku obejmuje kafelki, których środek w nim leży
  const makeGroup = (name: string) => {
    let members = ids; const rect = groupRect(members);
    if (!members.length) { const P = api.current?.positions() ?? {}; members = p.tasks.map((t) => t.id).filter((k) => P[k] && P[k].x + TASK_SIZE.w / 2 >= rect.x && P[k].x + TASK_SIZE.w / 2 <= rect.x + rect.w && P[k].y + TASK_SIZE.h / 2 >= rect.y && P[k].y + TASK_SIZE.h / 2 <= rect.y + rect.h); }
    setNamer(null); setSel(new Set()); run(async () => { await freeze(members); const id = await createGroupAction(null, name, members, rect); setSelGroup(id); });
  };
  const batch = (op: Parameters<typeof batchTasks>[1], ok: string) => { const list = ids; setConfirm(false); setSel(new Set()); run(() => batchTasks(list, op), ok); };
  const layoutNow = () => { undoL.remember(layoutSnapshot(api.current, p.tasks.map((t) => t.id), p.groups)); run(() => autoLayout(null), "Ułożono"); };

  const n = sel.size, word = plural(n, "zadanie", "zadania", "zadań");
  const allDone = n > 0 && ids.every((id) => byId.get(id)?.state === "done");   // same ukończone: przycisk cofa „gotowe”
  const archRows = (arch === "done" ? p.archive.done : p.archive.trash).filter((r) => !words.length || matches(norm(`${r.title} ${r.summary ?? ""} ${r.project ?? ""}`), words));

  return (
    <div className="app">
      {off ? null : view === "canvas" ? (
        <Canvas zoomKey="board" apiRef={api} items={items} size={TASK_SIZE} groups={groups} render={(id) => <TaskTileView t={byId.get(id)!} />}
          selected={sel} onSelect={(s) => { setSel(s); setConfirm(false); }} selectedGroup={selGroup} onSelectGroup={setSelGroup} renaming={renaming} onRename={(id, name) => setRenaming(name == null ? null : id)}
          onOpen={(id) => { if (id) open(id); }} onMove={(moved) => run(() => saveTaskPositions(moved))}
          onLink={(from, to) => run(() => linkTasks(from, to, true), "Połączono: drugie zadanie zacznie się po pierwszym")} onUnlink={(from, to) => run(() => linkTasks(from, to, false), "Usunięto połączenie")}
          onGroupChange={(id, patch) => run(() => updateGroupAction(null, id, patch))} onGroupCreate={(rect, members) => run(async () => { await freeze(members); await createGroupAction(null, "Nowa grupa", members, rect); })}
          onAutoLayout={layoutNow} onUndoLayout={undoL.canUndo ? () => undoL.undo(null) : null}
          empty={p.tasks.length ? null : (
            <div className="empty glass"><h2>Pierwsze zadanie</h2><p>Napisz na dole, co masz na głowie, albo wklej maila czy wiadomość. Task Hub zrobi z tego zadanie i poprowadzi je krok po kroku.</p></div>
          )} />
      ) : (
        <div className="listview">
          <div className="stage-grp">
            {hits.length ? hits.map((t) => (
              <button key={t.id} type="button" className="lrow" onClick={() => open(t.id)}>
                <Lvl base={t.base} eff={t.eff} why={t.why} />
                <span className="n-title">{t.title}</span>
                {t.due ? <span className={"st due " + t.due.cls}>{t.due.text}</span> : null}
                <span className={"st " + t.state} style={{ margin: 0 }}>{TS_LABEL[t.state]}</span>
                <span className="n-meta" style={{ margin: 0 }}>{t.progress.done}/{t.progress.all}</span>
              </button>
            )) : <p className="sub">{words.length ? "Brak pasujących zadań." : "Brak zadań."}</p>}
          </div>
        </div>
      )}

      {arch ? (
        <div className="listview" aria-label="Archiwum">
          <div className="arch-head">
            <div className="arch-tabs">
              <button className={"seg" + (arch === "done" ? " on" : "")} type="button" onClick={() => setArch("done")}>Ukończone ({p.archive.done.length})</button>
              <button className={"seg" + (arch === "trash" ? " on" : "")} type="button" onClick={() => setArch("trash")}>Kosz ({p.archive.trash.length})</button>
            </div>
            <p>{arch === "done" ? "Ukończone zadania zostają tu na zawsze; agent dostaje ich notatki jako kontekst." : `Zadania w koszu znikają po ${p.archive.trashDays} dniach; agenci ich nie widzą.`}</p>
          </div>
          <div className="stage-grp">
            {archRows.length ? archRows.map((r) => (
              <div key={r.id} id={"arch-" + r.id} className="lrow arow">
                <span style={{ paddingTop: 3 }}><Lvl base={r.base} eff={r.eff} /></span>
                <div className="a-main">
                  <button type="button" className="a-title" onClick={() => open(r.id)}>{r.title}</button>
                  <span className="a-meta">{r.when}{r.project ? ` · ${r.project}` : ""}</span>
                  {r.summary ? <span className="a-note">{r.summary}</span> : null}
                </div>
                <div className="a-act">
                  {arch === "done" ? <button className="btn" type="button" onClick={() => run(() => reopenLast(r.id), "Otwarto ponownie")}>Otwórz ponownie</button> : purgeId === r.id ? (
                    <><button className="btn danger" type="button" onClick={() => { setPurgeId(null); run(() => purgeTaskAction(r.id), "Usunięto na zawsze"); }}>Tak, usuń</button><button className="btn" type="button" onClick={() => setPurgeId(null)}>Anuluj</button></>
                  ) : (
                    <><button className="btn" type="button" onClick={() => run(() => restoreTask(r.id), "Przywrócono")}>Przywróć</button><button className="btn danger" type="button" onClick={() => setPurgeId(r.id)}>Usuń na zawsze</button></>
                  )}
                </div>
              </div>
            )) : <p className="sub">{words.length ? "Nic nie pasuje." : "Pusto."}</p>}
          </div>
        </div>
      ) : null}

      {proj ? (
        <Projects projects={p.projects} companies={p.companies} tasks={p.projTasks} focus={projFocus} onTask={open} onNew={(name) => run(() => createProjectAction(name), "Dodano projekt")}
          onPatch={(id, patch: ProjectPatch) => run(() => updateProjectAction(id, patch))} onRemove={(id) => run(() => removeProject(id), "Usunięto projekt, zadania zostały")}
          onCompanyNew={(name) => run(() => createCompanyAction(name), "Dodano firmę")} onCompanyPatch={(id, patch) => run(() => updateCompanyAction(id, patch))}
          onCompanyRemove={(id) => run(() => removeCompany(id), "Usunięto firmę, jej projekty są teraz prywatne")} />
      ) : null}

      <div className="pillbar">
        <div className="pl">
          {off ? <BackPill title={proj ? "Projekty" : "Archiwum"} onBack={showCanvas} /> : (
            <>
              <div className="gpill glass"><BrandButton open={menu} onClick={() => setMenu((m) => !m)} /></div>
            </>
          )}
        </div>
        {off ? null : <ViewPill view={view} onView={onView} />}
        <span className="sp" />
        <SearchPill index={p.index} screen={screen} value={q} onChange={setQ} onPick={onPick} />
        <AgentPill agent={p.agent} aiOn={p.aiOn} />
      </div>
      {!off && view === "canvas" ? <MakePill tileTitle="Nowe zadanie jako kafelek" groupTitle={n ? "Zgrupuj zaznaczone" : "Nowa grupa"} onTile={() => setNamer(namer === "tile" ? null : "tile")} onGroup={() => setNamer(namer === "group" ? null : "group")} /> : null}

      {menu ? (
        <div className="menu glass" role="menu" onPointerDown={(e) => e.stopPropagation()}>
          <button className="mi" role="menuitem" type="button" onClick={() => { setMenu(false); setProj(true); setArch(null); setSel(new Set()); setSelGroup(null); }}>Projekty<small>Kolor, ważność, język i zadania każdego projektu</small></button>
          <Link className="mi" role="menuitem" href="/settings" onClick={() => setMenu(false)}>Ustawienia<small>Agent, konektor i podłączeni klienci</small></Link>
          <Link className="mi" role="menuitem" href="/rules" onClick={() => setMenu(false)}>Zasady pracy<small>Jak agent ma działać: ogólne, projektu, narzędzia</small></Link>
          <hr />
          <button className="mi" role="menuitem" type="button" onClick={() => { setMenu(false); setArch("done"); setProj(false); setSel(new Set()); setSelGroup(null); }}>Archiwum<small>Ukończone zadania i kosz</small></button>
          <hr />
          <form action={logout}><button className="mi" role="menuitem" type="submit" style={{ width: "100%" }}>Wyloguj</button></form>
        </div>
      ) : null}
      {menu ? <div style={{ position: "absolute", inset: 0, zIndex: 11 }} onPointerDown={() => setMenu(false)} /> : null}

      {namer === "tile" ? <Namer label="Nazwa nowego zadania" placeholder="Nazwa zadania" onClose={() => setNamer(null)} onSubmit={(name) => { setNamer(null); run(() => createTaskQuick(name), "Dodano zadanie"); }} /> : null}
      {namer === "group" ? <Namer label="Nazwa grupy" placeholder={n ? `Nazwa grupy dla ${n} ${word}` : "Nazwa grupy"} onClose={() => setNamer(null)} onSubmit={makeGroup} /> : null}

      {!off && view === "canvas" && group && !n ? (
        <GroupBar g={group} onColor={(c) => run(() => updateGroupAction(null, group.id, { color: c }))} onRename={() => setRenaming(group.id)}
          onSelectMembers={() => { setSel(new Set(group.members)); setSelGroup(null); }} onUngroup={() => { setSelGroup(null); run(() => deleteGroupAction(null, group.id), "Rozgrupowano, kafelki zostały"); }} onClear={() => setSelGroup(null)} />
      ) : null}
      {!off && view === "canvas" && n ? (
        <div className="selbar glass" role="toolbar" aria-label="Akcje dla zaznaczonych">
          {confirm ? (
            <><span className="rb-t">Przenieść <b>{n} {word}</b> do kosza?</span><span className="dv" />
              <button className="btn danger" type="button" onClick={() => batch({ trash: true }, "Przeniesiono do kosza")}>Tak, do kosza</button><button className="btn" type="button" onClick={() => setConfirm(false)}>Anuluj</button></>
          ) : (
            <><span className="rb-t"><b>{n} {word}</b></span><span className="dv" />
              <ProjectPicker projects={p.projects} value={null} cls="btn" onPick={(id) => batch({ projectId: id }, id ? "Przypisano do projektu" : "Odpięto od projektu")} />
              <PrioPicker base={3} cls="btn" onPick={(l) => batch({ level: l }, "Zmieniono priorytet")} />
              <button className="btn" type="button" onClick={() => setNamer("group")}>Zgrupuj</button>
              {allDone ? <button className="btn" type="button" onClick={() => batch({ done: false }, "Przywrócono do pracy")}>Wróć do pracy</button>
                : <button className="btn" type="button" onClick={() => batch({ done: true }, "Oznaczono jako gotowe")}>Oznacz jako gotowe</button>}
              <button className="btn danger" type="button" onClick={() => setConfirm(true)}>Usuń</button>
              <button className="icobtn end" type="button" aria-label="Odznacz wszystko" title="Odznacz (Esc)" onClick={() => { setSel(new Set()); setConfirm(false); }}><Icon k="x" size={12} sw={2} /></button></>
          )}
        </div>
      ) : null}

      {!off && p.lastAgent && !answerOff && !n && !group ? (
        <div className="answer plain glass" role="status" aria-live="polite">
          <div className="ans-text">{p.lastAgent.text}</div>
          {p.lastAgent.link ? <div className="ans-acts"><a className="btn ico" href={p.lastAgent.link} target="_blank" rel="noopener" title={p.lastAgent.link}>Otwórz wynik<Icon k="ext" size={13} sw={1.6} /></a></div> : null}
          <button className="icobtn ans-x" type="button" aria-label="Zamknij odpowiedź" title="Zamknij" onClick={() => { setAnswerOff(true); try { sessionStorage.setItem("th-ans", p.lastAgent!.id); } catch { /* brak storage */ } }}><Icon k="x" size={12} sw={2} /></button>
        </div>
      ) : null}

      {off ? null : <Dock action={chat} taskId={null} busyText={p.aiOn ? "Agent myśli…" : "Zapisuję…"} placeholder="Co masz na głowie? Wklej maila, wiadomość albo opisz zadanie…" />}
      <Toast text={toast} />
    </div>
  );
}
