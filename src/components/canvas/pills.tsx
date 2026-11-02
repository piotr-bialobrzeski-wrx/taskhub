"use client";
// Pigułki górnego paska wspólne dla wszystkich ekranów: logo-menu, wstecz, Kafelek/Grupa, widok, agent.
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Icon } from "./ui";
import { PRESETS, type PresetKey } from "@/lib/canvas/presets";
import { setAgentRunner } from "@/app/actions";
import { RUNNERS, RUNNER_LABELS, type CodexState, type Runner } from "@/lib/agent/runner";

// Agent: przełącznik Claude | GPT (paczka 40). Kieruje pracę mostka na Macu do Claude Code albo do Codex; obaj zostają zalogowani,
// więc przełączenie nie wymaga logowania. Gdy Codex na Macu nie jest gotowy, pracuje Claude, a podpowiedź mówi dlaczego
const CODEX_HINT: Record<string, string> = {
  auth: "Codex na Macu jest wylogowany (w Terminalu: codex login), więc do tego czasu pracuje Claude",
  missing: "Na Macu nie ma Codex CLI albo aplikacja Task Hub jest za stara, więc do tego czasu pracuje Claude",
  unknown: "Mac nie zgłosił jeszcze stanu Codex (zaktualizuj aplikację Task Hub na Macu), więc do tego czasu pracuje Claude",
};
export function AgentPill({ agent, codex, aiOn }: { agent: Runner; codex?: CodexState; aiOn: boolean }) {
  const [cur, setCur] = useState<Runner>(agent);
  const [pending, start] = useTransition();
  useEffect(() => setCur(agent), [agent]);
  const pick = (r: Runner) => {
    if (r === cur || pending) return;
    setCur(r);
    start(async () => { try { await setAgentRunner(r); } catch { setCur(agent); } });
  };
  const waiting = cur === "gpt" && codex && codex !== "ready" ? CODEX_HINT[codex] : null;
  const title = aiOn ? "Agent wbudowany w aplikację" : waiting ?? (cur === "gpt" ? "Pracę na Macu robi GPT (Codex na Twoim koncie ChatGPT); kroki z aplikacjami z konta Claude, kodem i plikami robi dalej Claude" : "Pracę na Macu robi Claude (Claude Code na Twojej subskrypcji)");
  return (
    <div className={"gpill glass" + (waiting ? " agent-wait" : "")} role="radiogroup" aria-label="Agent" title={title}>
      <span className="agent-label">Agent</span>
      {RUNNERS.map((r) => <button key={r} type="button" role="radio" aria-checked={cur === r} className={"seg" + (cur === r ? " on" : "")} onClick={() => pick(r)}>{RUNNER_LABELS[r]}</button>)}
    </div>
  );
}

export type View = "canvas" | "list" | "draw" | "review";
// draw: trzecia pozycja „Losowanie” i czwarta „Przegląd” (przegląd zaległości) tylko na głównej kanwie (paczka 32 i 38); na telefonie pigułka pokazuje same ikony
export const ViewPill = ({ view, onView, draw }: { view: View; onView: (v: View) => void; draw?: boolean }) => (
  <div className={"gpill glass center" + (draw ? " vp3" : "")} role="tablist" aria-label="Widok">
    <button className={"seg" + (view === "canvas" ? " on" : "")} role="tab" aria-selected={view === "canvas"} aria-label="Kanwa" onClick={() => onView("canvas")}><Icon k="canvas" size={14} /><span className="vl">Kanwa</span></button>
    <button className={"seg" + (view === "list" ? " on" : "")} role="tab" aria-selected={view === "list"} aria-label="Lista" onClick={() => onView("list")}><Icon k="list" size={14} /><span className="vl">Lista</span></button>
    {draw ? <button className={"seg" + (view === "draw" ? " on" : "")} role="tab" aria-selected={view === "draw"} aria-label="Losowanie" onClick={() => onView("draw")}><Icon k="dice" size={14} /><span className="vl">Losowanie</span></button> : null}
    {draw ? <button className={"seg" + (view === "review" ? " on" : "")} role="tab" aria-selected={view === "review"} aria-label="Przegląd" onClick={() => onView("review")}><Icon k="review" size={14} /><span className="vl">Przegląd</span></button> : null}
  </div>
);

export function useView(key: string) {
  const [view, setView] = useState<View>("canvas");
  useEffect(() => { try { const v = localStorage.getItem("th-view-" + key); if (v === "list" || ((v === "draw" || v === "review") && key === "board")) setView(v); } catch { /* brak storage */ } }, [key]);
  const onView = (v: View) => { setView(v); try { localStorage.setItem("th-view-" + key, v); } catch { /* brak storage */ } };
  return { view, onView };
}

// logo z nazwą jest przyciskiem menu (menu rozwija się pod spodem; bez ptaszka, rozwinięte menu samo to pokazuje)
export function BrandButton({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <button className="brand" type="button" aria-label="Menu" aria-haspopup="menu" aria-expanded={open} onClick={onClick}>
      <span className="logo"><Icon k="logo" size={12} sw={2} /></span><span className="ct">Task Hub</span>
    </button>
  );
}

// wstecz + tytuł ekranu: ten sam róg na każdym ekranie podrzędnym; bez onBack wraca do poprzedniej strony (albo na kanwę)
export function BackPill({ title, onBack, children }: { title?: string; onBack?: () => void; children?: ReactNode }) {
  const router = useRouter();
  const back = onBack ?? (() => { if (window.history.length > 1) router.back(); else router.push("/"); });
  return (
    <div className="gpill glass">
      <button className="icobtn" type="button" aria-label="Wstecz" title="Wstecz" onClick={back}><Icon k="back" size={15} sw={1.8} /></button>
      <span className="crumb">{children ?? <span className="ct">{title}</span>}</span>
    </div>
  );
}

// Kafelek i Grupa: narzędzia kanwy w górnym pasku, zaraz za pigułką powiększenia (paczka 30: róg zakryłaby karta na całą wysokość)
// paczka 40: na głównej kanwie obok nich „Ułóż” z listą gotowych układów (LayoutMenu)
export function MakePill({ tileTitle, groupTitle, onTile, onGroup, layout }: { tileTitle: string; groupTitle: string; onTile: () => void; onGroup: () => void; layout?: LayoutProps }) {
  return (
    <div className="gpill glass mkpill" role="toolbar" aria-label="Nowe na kanwie">
      <button className="icobtn mk" type="button" title={tileTitle} onClick={onTile}><Icon k="tile" size={18} />Kafelek</button>
      <button className="icobtn mk" type="button" title={groupTitle} onClick={onGroup}><Icon k="group" size={18} />Grupa</button>
      {layout ? <><span className="mksep" aria-hidden="true" /><LayoutMenu {...layout} /></> : null}
    </div>
  );
}

// „Ułóż” (paczka 40, wersja A „Lista z opisem”): przycisk rozwija listę gotowych układów; każdy ma krótki opis, ostatnio użyty ma ptaszek.
// Wybór od razu układa kanwę (bez agenta), poprzednie grupy znikają, a „Cofnij” przez chwilę przywraca stary układ.
type LayoutProps = { current: PresetKey | null; onPick: (key: PresetKey) => void };
export function LayoutItems({ current, onPick }: LayoutProps) {
  return (
    <>
      {PRESETS.map((l) => (
        <button key={l.key} className={"mi lay" + (l.key === current ? " cur" : "")} role="menuitemradio" aria-checked={l.key === current} type="button" onClick={() => onPick(l.key)}>
          <span><b>{l.name}</b><small>{l.desc}</small></span>{l.key === current ? <Icon k="check" size={14} sw={2} /> : null}
        </button>
      ))}
    </>
  );
}
function LayoutMenu({ current, onPick }: LayoutProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const r = btn.current?.getBoundingClientRect();
    if (r) setPos({ left: Math.max(16, Math.min(r.left - 6, window.innerWidth - 316)), top: r.bottom + 10 });
    const close = (e: Event) => { if (!(e.target as HTMLElement).closest?.(".laymenu, .laybtn")) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", close); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", key); };
  }, [open]);
  return (
    <>
      <button ref={btn} className={"icobtn mk laybtn" + (open ? " on" : "")} type="button" title="Ułóż kafelki gotowym układem" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Icon k="layout" size={16} />Ułóż<span className="laychev"><Icon k="chev" size={10} sw={2.2} /></span>
      </button>
      {open ? createPortal(
        <div className="zmenu laymenu glass" role="menu" aria-label="Układy kanwy" style={{ position: "fixed", left: pos.left, top: pos.top }} onPointerDown={(e) => e.stopPropagation()}>
          <LayoutItems current={current} onPick={(k) => { setOpen(false); onPick(k); }} />
          <hr />
          <p className="layhint">Poprzednie grupy znikną. „Cofnij” przywróci stary układ.</p>
        </div>, document.body) : null}
    </>
  );
}

// telefon: zamiast pigułki Kafelek/Grupa na dole jeden „+” w górnym pasku, rozwijany w dwie pozycje
export function AddButton({ tileLabel, groupLabel, onTile, onGroup, layout }: { tileLabel: string; groupLabel: string; onTile: () => void; onGroup: () => void; layout?: LayoutProps }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ right: 16, top: 0 });
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const r = btn.current?.getBoundingClientRect();
    if (r) setPos({ right: Math.max(16, window.innerWidth - r.right), top: r.bottom + 6 });
    const close = (e: Event) => { if (!(e.target as HTMLElement).closest?.(".addmenu, .addbtn")) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", close); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", key); };
  }, [open]);
  const pick = (f: () => void) => { setOpen(false); f(); };
  return (
    <div className="gpill glass addbtn">
      <button ref={btn} className="icobtn" type="button" aria-label="Dodaj" title="Dodaj" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}><Icon k="plus" size={16} sw={1.9} /></button>
      {open ? createPortal(
        <div className="addmenu zmenu glass" role="menu" style={{ position: "fixed", right: pos.right, top: pos.top }} onPointerDown={(e) => e.stopPropagation()}>
          <button className="mi" role="menuitem" type="button" onClick={() => pick(onTile)}><Icon k="tile" size={16} />{tileLabel}</button>
          <button className="mi" role="menuitem" type="button" onClick={() => pick(onGroup)}><Icon k="group" size={16} />{groupLabel}</button>
          {layout ? <><hr /><p className="layhead">Ułóż</p><LayoutItems current={layout.current} onPick={(k) => pick(() => layout.onPick(k))} /></> : null}
        </div>, document.body) : null}
    </div>
  );
}
