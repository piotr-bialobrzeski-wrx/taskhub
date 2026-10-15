"use client";
// Poziom 1: wszystkie zadania jako kafelki na kanwie (albo lista), pasek-pigułka, menu, zaznaczanie zbiorcze, archiwum, dok czatu.
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Canvas, type CanvasApi, type CanvasGroup, type CanvasItem } from "./Canvas";
import { GHEAD, GPAD, TASK_SIZE } from "@/lib/canvas/layout";
import { Icon, Lvl, ToolIcon, TS_LABEL, TS_SHORT, GCOL, plural, projColor, toolColor, type GroupVM, type ProjTask, type ProjectRow, type TaskTile } from "./ui";
import { Dock, Namer, PrioPicker, ProjectPicker, Toast, useToast } from "./widgets";
import { Projects, type ProjectPatch } from "./Projects";
import { autoLayout, batchTasks, chat, createGroupAction, createProjectAction, createTaskQuick, deleteGroupAction, linkTasks, logout, purgeTaskAction, removeProject, reopenLast, restoreTask, saveTaskPositions, updateGroupAction, updateProjectAction } from "@/app/actions";

export type ArchRow = { id: string; title: string; when: string; summary: string | null; base: number; eff: number; project: string | null };
export type BoardProps = {
  tasks: TaskTile[]; groups: GroupVM[]; projects: ProjectRow[]; projTasks: ProjTask[];
  aiOn: boolean; agent: string; lastAgent: { id: string; text: string } | null;
  archive: { done: ArchRow[]; trash: ArchRow[]; trashDays: number };
};

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
      <span className="t-row">
        <span className="bar"><b style={{ width: pct + "%" }} /></span>
        <span className="cnt" style={{ fontVariantNumeric: "tabular-nums" }} title={`Kroki ${t.progress.done}/${t.progress.all} · ${t.estText}`}>{cnt}</span>
        {t.drafts ? <span className="st draft" title={`${t.drafts} do zatwierdzenia`}>{t.drafts} szkic{t.drafts === 1 ? "" : t.drafts < 5 ? "e" : "ów"}</span> : null}
        {t.handed ? <span className="st handoff" title={`${t.handed} w Claude`}>{t.handed} w Claude</span> : null}
        {t.questions ? <span className="st draft" style={{ display: "inline-flex", gap: 3 }} title="Pytania od agenta czekają na Twoją odpowiedź"><Icon k="question" size={12} sw={1.8} />{t.questions}</span> : null}
      </span>
    </>
  );
}

export function AgentPill({ agent, aiOn }: { agent: string; aiOn: boolean }) {
  return (
    <div className="gpill glass" aria-label="Agent" title={aiOn ? "Agent wbudowany w aplikację" : "Twój Claude podłączony przez konektor Task Hub"}>
      <span className="agent-label">Agent</span><span className="seg on">{agent}</span>
    </div>
  );
}
export const ViewPill = ({ view, onView }: { view: "canvas" | "list"; onView: (v: "canvas" | "list") => void }) => (
  <div className="gpill glass center" role="tablist" aria-label="Widok">
    <button className={"seg" + (view === "canvas" ? " on" : "")} role="tab" aria-selected={view === "canvas"} onClick={() => onView("canvas")}><Icon k="canvas" size={14} />Kanwa</button>
    <button className={"seg" + (view === "list" ? " on" : "")} role="tab" aria-selected={view === "list"} onClick={() => onView("list")}><Icon k="list" size={14} />Lista</button>
  </div>
);
export function useView(key: string) {
  const [view, setView] = useState<"canvas" | "list">("canvas");
  useEffect(() => { try { const v = localStorage.getItem("th-view-" + key); if (v === "list") setView("list"); } catch { /* brak storage */ } }, [key]);
  const onView = (v: "canvas" | "list") => { setView(v); try { localStorage.setItem("th-view-" + key, v); } catch { /* brak storage */ } };
  return { view, onView };
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
      <button className="icobtn" type="button" aria-label="Odznacz grupę" onClick={onClear}><Icon k="x" size={12} sw={2} /></button>
    </div>
  );
}

// szukajka: bez wielkości liter i ogonków; każde wpisane słowo musi wystąpić w tytule, opisie, projekcie albo stanie
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ł/g, "l");
export function matchTask(t: TaskTile, words: string[]) { const hay = norm(`${t.title} ${t.summary} ${t.project?.name ?? ""} ${TS_LABEL[t.state]}`); return words.every((w) => hay.includes(w)); }

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
  const [namer, setNamer] = useState<"tile" | "group" | "project" | null>(null);
  const [arch, setArch] = useState<"done" | "trash" | null>(null);
  const [proj, setProj] = useState(false);
  const [q, setQ] = useState("");
  const [qOpen, setQOpen] = useState(false);
  const qRef = useRef<HTMLInputElement>(null);
  const off = !!arch || proj;   // widok archiwum albo projektów zakrywa kanwę
  const [archQ, setArchQ] = useState("");
  const [purgeId, setPurgeId] = useState<string | null>(null);
  const [answerOff, setAnswerOff] = useState(true);

  useEffect(() => { try { setAnswerOff(!p.lastAgent || sessionStorage.getItem("th-ans") === p.lastAgent.id); } catch { setAnswerOff(!p.lastAgent); } }, [p.lastAgent]);
  useEffect(() => { setSel((s) => { const n = new Set([...s].filter((id) => p.tasks.some((t) => t.id === id))); return n.size === s.size ? s : n; }); }, [p.tasks]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setMenu(false); setConfirm(false); setNamer(null); setSel(new Set()); setSelGroup(null); return; }
      // „/” albo Ctrl/Cmd+K: kursor do szukajki (poza polami tekstowymi)
      const inField = (e.target as HTMLElement).closest("input, textarea, [contenteditable]");
      if ((e.key === "/" && !inField) || (e.key.toLowerCase() === "k" && (e.ctrlKey || e.metaKey))) { e.preventDefault(); qRef.current?.focus(); }
    };
    document.addEventListener("keydown", key); return () => document.removeEventListener("keydown", key);
  }, []);

  const byId = useMemo(() => new Map(p.tasks.map((t) => [t.id, t])), [p.tasks]);
  const words = useMemo(() => norm(q).split(/\s+/).filter(Boolean), [q]);
  const hits = useMemo(() => (words.length ? p.tasks.filter((t) => matchTask(t, words)) : p.tasks), [p.tasks, words]);
  const hitIds = useMemo(() => new Set(hits.map((t) => t.id)), [hits]);
  // w trakcie szukania pasujące kafelki zostają, reszta blednie
  const items: CanvasItem[] = useMemo(() => p.tasks.map((t) => ({ id: t.id, dependsOn: t.dependsOn, pos: t.pos, cls: "task " + t.state + (words.length ? (hitIds.has(t.id) ? " hit" : " dim") : ""), done: t.state === "done", aria: "Otwórz zadanie " + t.title })), [p.tasks, words.length, hitIds]);
  const groups: CanvasGroup[] = useMemo(() => p.groups.map((g) => ({ ...g })), [p.groups]);
  const group = selGroup ? p.groups.find((g) => g.id === selGroup) ?? null : null;
  const open = (id: string) => router.push(`/tasks/${id}`);
  const ids = [...sel];
  const goTo = (id: string) => { api.current?.centerOn(id); setSel(new Set([id])); setSelGroup(null); setQOpen(false); };

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

  const n = sel.size, word = plural(n, "zadanie", "zadania", "zadań");
  const aq = archQ.trim().toLowerCase();
  const archRows = (arch === "done" ? p.archive.done : p.archive.trash).filter((r) => !aq || (r.title + " " + (r.summary ?? "")).toLowerCase().includes(aq));

  return (
    <div className="app">
      {off ? null : view === "canvas" ? (
        <Canvas zoomKey="board" apiRef={api} items={items} size={TASK_SIZE} groups={groups} render={(id) => <TaskTileView t={byId.get(id)!} />}
          selected={sel} onSelect={(s) => { setSel(s); setConfirm(false); }} selectedGroup={selGroup} onSelectGroup={setSelGroup} renaming={renaming} onRename={(id, name) => setRenaming(name == null ? null : id)}
          onOpen={(id) => { if (id) open(id); }} onMove={(moved) => run(() => saveTaskPositions(moved))}
          onLink={(from, to) => run(() => linkTasks(from, to, true), "Połączono: drugie zadanie zacznie się po pierwszym")} onUnlink={(from, to) => run(() => linkTasks(from, to, false), "Usunięto połączenie")}
          onGroupChange={(id, patch) => run(() => updateGroupAction(null, id, patch))} onGroupCreate={(rect, members) => run(async () => { await freeze(members); await createGroupAction(null, "Nowa grupa", members, rect); })}
          onAutoLayout={() => run(() => autoLayout(null), "Ułożono")}
          empty={p.tasks.length ? null : (
            <div className="empty glass"><h2>Pierwsze zadanie</h2><p>{p.aiOn ? "Opisz je w polu na dole. Agent ustali kroki, kolejność i to, co może iść równolegle." : "Opisz je w polu na dole. Powstanie zadanie, a kroki ułoży Twój Claude przez konektor Task Hub."}</p></div>
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
              <input className="arch-q" type="search" placeholder="Szukaj…" value={archQ} onChange={(e) => setArchQ(e.target.value)} aria-label="Szukaj w archiwum" />
            </div>
            <p>{arch === "done" ? "Ukończone zadania zostają tu na zawsze; agent dostaje ich notatki jako kontekst." : `Zadania w koszu znikają po ${p.archive.trashDays} dniach; agenci ich nie widzą.`}</p>
          </div>
          <div className="stage-grp">
            {archRows.length ? archRows.map((r) => (
              <div key={r.id} className="lrow arow">
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
            )) : <p className="sub">Pusto.</p>}
          </div>
        </div>
      ) : null}

      {proj ? (
        <Projects projects={p.projects} tasks={p.projTasks} onTask={open} onNew={() => setNamer("project")}
          onPatch={(id, patch: ProjectPatch) => run(() => updateProjectAction(id, patch))} onRemove={(id) => run(() => removeProject(id), "Usunięto projekt, zadania zostały")} />
      ) : null}

      <div className="pillbar">
        <div className="gpill glass">
          {arch || proj ? (
            <><button className="icobtn" type="button" aria-label="Wróć do kanwy" onClick={() => { setArch(null); setProj(false); }}><Icon k="back" size={15} sw={1.8} /></button><span className="crumb"><span className="ct">{proj ? "Projekty" : "Archiwum"}</span></span></>
          ) : (
            <>
              <button className="icobtn" type="button" aria-label="Menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}><Icon k="menu" size={15} sw={1.7} /></button>
              <span className="crumb"><span className="logo"><Icon k="logo" size={12} sw={2} /></span><span className="ct">Task Hub</span></span>
              {view === "canvas" ? (
                <>
                  <span className="vd" />
                  <button className="icobtn mk" type="button" title="Nowe zadanie jako kafelek" onClick={() => setNamer(namer === "tile" ? null : "tile")}><Icon k="tile" size={18} />Kafelek</button>
                  <button className="icobtn mk" type="button" title={n ? "Zgrupuj zaznaczone" : "Nowa grupa"} onClick={() => setNamer(namer === "group" ? null : "group")}><Icon k="group" size={18} />Grupa</button>
                </>
              ) : null}
            </>
          )}
        </div>
        {off ? null : <ViewPill view={view} onView={onView} />}
        <span className="sp" />
        {off ? null : (
          <div className={"gpill glass srch" + (q ? " on" : "")} role="search">
            <Icon k="search" size={15} sw={1.8} />
            <input ref={qRef} type="text" value={q} placeholder="Szukaj zadań… (/)" aria-label="Szukaj zadań" autoComplete="off" spellCheck={false}
              onChange={(e) => { setQ(e.currentTarget.value); setQOpen(true); }} onFocus={() => setQOpen(true)} onBlur={() => setTimeout(() => setQOpen(false), 150)}
              onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); setQ(""); e.currentTarget.blur(); } else if (e.key === "Enter" && hits.length && words.length) { e.preventDefault(); if (view === "canvas") goTo(hits[0].id); else open(hits[0].id); } }} />
            {q ? <button className="icobtn sm" type="button" aria-label="Wyczyść" onClick={() => { setQ(""); qRef.current?.focus(); }}><Icon k="x" size={11} sw={2.2} /></button> : null}
            {qOpen && words.length ? (
              <div className="sres glass" role="listbox" aria-label="Pasujące zadania">
                {hits.length ? hits.slice(0, 8).map((t) => (
                  <button key={t.id} type="button" role="option" className="sr" onMouseDown={(e) => e.preventDefault()} onClick={() => (view === "canvas" ? goTo(t.id) : open(t.id))} onDoubleClick={() => open(t.id)} title="Kliknij: pokaż na kanwie · dwuklik: otwórz">
                    <Lvl base={t.base} eff={t.eff} /><span className="n-title">{t.title}</span>
                    {t.project ? <span className="proj-tag" style={{ ["--c" as string]: projColor(t.project.color) }}>{t.project.name}</span> : null}
                    <span className={"st " + t.state}>{TS_SHORT[t.state]}</span>
                  </button>
                )) : <span className="sub" style={{ padding: "6px 10px" }}>Brak pasujących zadań</span>}
                {hits.length > 8 ? <span className="sub" style={{ padding: "4px 10px" }}>…i jeszcze {hits.length - 8}</span> : null}
              </div>
            ) : null}
          </div>
        )}
        <AgentPill agent={p.agent} aiOn={p.aiOn} />
      </div>

      {menu ? (
        <div className="menu glass" role="menu" onPointerDown={(e) => e.stopPropagation()}>
          <button className="mi" role="menuitem" type="button" onClick={() => { setMenu(false); setProj(true); setArch(null); setSel(new Set()); setSelGroup(null); }}>Projekty<small>Kolor, ważność, język i zadania każdego projektu</small></button>
          <Link className="mi" role="menuitem" href="/settings" onClick={() => setMenu(false)}>Ustawienia<small>Agent, konektor i podłączeni klienci</small></Link>
          <Link className="mi" role="menuitem" href="/rules" onClick={() => setMenu(false)}>Zasady pracy<small>Jak agent ma działać: ogólne, projektu, narzędzia</small></Link>
          <hr />
          <button className="mi" role="menuitem" type="button" onClick={() => { setMenu(false); run(() => autoLayout(null), "Ułożono wszystkie zadania"); }}>Ułóż wszystkie zadania automatycznie<small>Usuwa ręczne położenia na tej kanwie</small></button>
          <hr />
          <button className="mi" role="menuitem" type="button" onClick={() => { setMenu(false); setArch("done"); setProj(false); setSel(new Set()); setSelGroup(null); }}>Archiwum<small>Ukończone zadania i kosz</small></button>
          <hr />
          <form action={logout}><button className="mi" role="menuitem" type="submit" style={{ width: "100%" }}>Wyloguj</button></form>
        </div>
      ) : null}
      {menu ? <div style={{ position: "absolute", inset: 0, zIndex: 11 }} onPointerDown={() => setMenu(false)} /> : null}

      {namer === "tile" ? <Namer label="Nazwa nowego zadania" placeholder="Nazwa zadania" onClose={() => setNamer(null)} onSubmit={(name) => { setNamer(null); run(() => createTaskQuick(name), "Dodano zadanie"); }} /> : null}
      {namer === "group" ? <Namer label="Nazwa grupy" placeholder={n ? `Nazwa grupy dla ${n} ${word}` : "Nazwa grupy"} onClose={() => setNamer(null)} onSubmit={makeGroup} /> : null}
      {namer === "project" ? <Namer label="Nazwa nowego projektu" placeholder="Nazwa projektu" onClose={() => setNamer(null)} onSubmit={(name) => { setNamer(null); run(() => createProjectAction(name), "Dodano projekt"); }} /> : null}

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
            <><span className="rb-t">Zaznaczono <b>{n} {word}</b></span><span className="dv" />
              <ProjectPicker projects={p.projects} value={null} cls="btn" onPick={(id) => batch({ projectId: id }, id ? "Przypisano do projektu" : "Odpięto od projektu")} />
              <PrioPicker base={3} cls="btn" onPick={(l) => batch({ level: l }, "Zmieniono priorytet")} />
              <button className="btn" type="button" onClick={() => setNamer("group")}>Zgrupuj</button>
              <button className="btn" type="button" onClick={() => batch({ done: true }, "Oznaczono jako gotowe")}>Oznacz jako gotowe</button>
              <button className="btn danger" type="button" onClick={() => setConfirm(true)}>Usuń</button>
              <button className="icobtn" type="button" aria-label="Odznacz wszystko" title="Odznacz (Esc)" onClick={() => { setSel(new Set()); setConfirm(false); }}><Icon k="x" size={12} sw={2} /></button></>
          )}
        </div>
      ) : null}

      {!off && p.lastAgent && !answerOff && !n && !group ? (
        <div className="answer glass" aria-live="polite">
          <div className="ans-head"><span className="lbl" style={{ margin: 0 }}>Agent</span><span className="sp" /><button className="icobtn" type="button" aria-label="Zamknij odpowiedź" onClick={() => { setAnswerOff(true); try { sessionStorage.setItem("th-ans", p.lastAgent!.id); } catch { /* brak storage */ } }}><Icon k="x" size={12} sw={2} /></button></div>
          <div className="ans-text">{p.lastAgent.text}</div>
        </div>
      ) : null}

      {off ? null : <Dock action={chat} taskId={null} busyText={p.aiOn ? "Agent myśli…" : "Zapisuję…"} placeholder={p.aiOn ? "Opisz nowe zadanie albo zapytaj o swoje zadania…" : "Opisz nowe zadanie albo wklej wiadomość; kroki ułoży Claude przez konektor…"} />}
      <Toast text={toast} />
    </div>
  );
}
