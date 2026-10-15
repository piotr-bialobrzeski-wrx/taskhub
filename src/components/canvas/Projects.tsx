"use client";
// Widok „Projekty” (z menu): każdy projekt z kolorem, ważnością, językiem i listą swoich zadań; nazwa jest polem zmiany nazwy.
import { useState } from "react";
import { fmtMin } from "@/lib/time";
import { Icon, Lvl, TS_LABEL, GCOL, plural, projColor, type ProjTask, type ProjectRow } from "./ui";
import { Picker } from "./widgets";

export const LANGS: Record<string, string> = { pl: "polski", en: "angielski", de: "niemiecki", uk: "ukraiński", fr: "francuski", es: "hiszpański" };
const WEIGHTS: Record<number, string> = { 5: "najwyższa", 4: "wysoka", 3: "zwykła", 2: "niska", 1: "najniższa" };

export type ProjectPatch = { name?: string; weight?: number; language?: string; color?: number };
type Props = {
  projects: ProjectRow[]; tasks: ProjTask[];
  onTask: (id: string) => void; onPatch: (id: string, patch: ProjectPatch) => void; onRemove: (id: string) => void; onNew: () => void;
};

function Name({ name, onRename }: { name: string; onRename: (n: string) => void }) {
  const [edit, setEdit] = useState(false);
  if (!edit) return <button type="button" className="a-title p-name" title="Kliknij, aby zmienić nazwę" onClick={() => setEdit(true)}>{name}<Icon k="pen" size={12} sw={1.8} /></button>;
  const done = (v: string) => { setEdit(false); const n = v.trim(); if (n && n !== name) onRename(n); };
  return (
    <input className="p-input" defaultValue={name} aria-label="Nazwa projektu" autoFocus onFocus={(e) => e.currentTarget.select()}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); done(e.currentTarget.value); } else if (e.key === "Escape") { e.preventDefault(); setEdit(false); } }}
      onBlur={(e) => done(e.currentTarget.value)} />
  );
}

function TaskRow({ t, onOpen }: { t: ProjTask; onOpen: () => void }) {
  return (
    <button type="button" className="p-task" onClick={onOpen}>
      <Lvl base={t.base} eff={t.eff} />
      <span className="n-title">{t.title}</span>
      {t.due ? <span className={"st due " + t.due.cls}>{t.due.text}</span> : null}
      <span className={"st " + t.state}>{TS_LABEL[t.state]}</span>
    </button>
  );
}

function Stats({ list }: { list: ProjTask[] }) {
  const open = list.filter((t) => t.state !== "done"), remain = open.reduce((a, t) => a + t.remain, 0), spent = list.reduce((a, t) => a + t.spent, 0);
  return (
    <span className="a-stats">
      <span>{open.length} {plural(open.length, "otwarte", "otwarte", "otwartych")} · {list.length - open.length} ukończ.</span>
      {remain ? <span title="Pozostały szacunek">~{fmtMin(remain)} do zrobienia</span> : null}
      {spent ? <span title="Czas zmierzony">⏱ {fmtMin(spent)}</span> : null}
    </span>
  );
}

export function Projects({ projects, tasks, onTask, onPatch, onRemove, onNew }: Props) {
  const [confirm, setConfirm] = useState<string | null>(null);
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setFolded((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const of = (id: string | null) => tasks.filter((t) => t.projectId === id);
  const loose = of(null);

  const card = (pr: ProjectRow | null) => {
    const id = pr ? pr.id : "none", list = of(pr ? pr.id : null), open = !folded.has(id);
    return (
      <div key={id} className="lrow arow prow">
        <div className="p-head">
          {pr ? (
            <Picker cls="dot" title="Kolor projektu" onPick={(k) => onPatch(pr.id, { color: Number(k) })} trigger={<span className="pdot" style={{ ["--c" as string]: projColor(pr.color) }} />}
              options={GCOL.map((c, i) => ({ key: String(i), on: pr.color % GCOL.length === i, node: <><span className="pdot" style={{ ["--c" as string]: c }} />Kolor {i + 1}</> }))} />
          ) : <span className="pdot" style={{ ["--c" as string]: "var(--sub)", margin: "0 var(--s-2)" }} />}
          <div className="a-main">
            <div className="p-line">
              {pr ? <Name name={pr.name} onRename={(n) => onPatch(pr.id, { name: n })} /> : <span className="a-title">Bez projektu</span>}
              {pr ? (
                <>
                  <Picker cls="btn" title="Ważność projektu: podnosi albo obniża priorytet jego zadań" onPick={(k) => onPatch(pr.id, { weight: Number(k) })}
                    trigger={<><Lvl base={pr.weight} eff={pr.weight} />ważność {WEIGHTS[pr.weight] ?? pr.weight}</>}
                    options={[5, 4, 3, 2, 1].map((w) => ({ key: String(w), on: w === pr.weight, node: <><Lvl base={w} eff={w} />{WEIGHTS[w]}</> }))} />
                  <Picker cls="btn" title="Język, w którym agent pisze w tym projekcie" onPick={(k) => onPatch(pr.id, { language: k })}
                    trigger={<>{LANGS[pr.language] ?? pr.language}</>}
                    options={Object.entries(LANGS).map(([k, v]) => ({ key: k, on: k === pr.language, node: <span>{v}</span> }))} />
                </>
              ) : null}
            </div>
            <Stats list={list} />
          </div>
          <div className="a-act">
            {pr ? (confirm === pr.id ? (
              <><span className="sub" style={{ alignSelf: "center" }}>Usunąć? Zadania zostaną.</span><button className="btn danger" type="button" onClick={() => { setConfirm(null); onRemove(pr.id); }}>Tak, usuń</button><button className="btn" type="button" onClick={() => setConfirm(null)}>Anuluj</button></>
            ) : <button className="icobtn" type="button" aria-label="Usuń projekt" title="Usuń projekt (zadania zostaną)" onClick={() => setConfirm(pr.id)}><Icon k="trash" size={14} sw={1.7} /></button>) : null}
            <button className="icobtn" type="button" aria-label={open ? "Zwiń zadania" : "Rozwiń zadania"} aria-expanded={open} onClick={() => toggle(id)} style={{ transform: open ? "rotate(180deg)" : "none" }}><Icon k="chev" size={12} sw={2.2} /></button>
          </div>
        </div>
        {open ? <div className="p-tasks">{list.length ? list.map((t) => <TaskRow key={t.id} t={t} onOpen={() => onTask(t.id)} />) : <span className="sub">Brak zadań. Przypisz je w panelu zadania albo zaznaczając kilka na kanwie.</span>}</div> : null}
      </div>
    );
  };

  return (
    <div className="listview" aria-label="Projekty">
      <div className="arch-head">
        <div className="arch-tabs"><b>Projekty</b><span className="n-num">{projects.length}</span><span className="sp" /><button className="btn primary" type="button" onClick={onNew}>Nowy projekt</button></div>
        <p>Projekt to etykieta zadania: przypiszesz go w panelu zadania albo kilku zaznaczonym naraz. Ważność projektu podnosi albo obniża priorytet jego zadań; w jego języku agent pisze teksty.</p>
      </div>
      <div className="stage-grp">
        {projects.map((pr) => card(pr))}
        {loose.length ? card(null) : null}
        {!projects.length && !loose.length ? <p className="sub">Jeszcze nie ma projektów ani zadań.</p> : null}
      </div>
    </div>
  );
}
