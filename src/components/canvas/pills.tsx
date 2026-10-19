"use client";
// Pigułki górnego paska wspólne dla wszystkich ekranów: logo-menu, wstecz, Kafelek/Grupa, widok, agent.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Icon } from "./ui";

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

// Kafelek i Grupa: narzędzia kanwy w prawym dolnym rogu (lewy należy do odpowiedzi agenta), nie część górnego paska
export function MakePill({ tileTitle, groupTitle, onTile, onGroup }: { tileTitle: string; groupTitle: string; onTile: () => void; onGroup: () => void }) {
  return (
    <div className="gpill glass mkpill" role="toolbar" aria-label="Nowe na kanwie">
      <button className="icobtn mk" type="button" title={tileTitle} onClick={onTile}><Icon k="tile" size={18} />Kafelek</button>
      <button className="icobtn mk" type="button" title={groupTitle} onClick={onGroup}><Icon k="group" size={18} />Grupa</button>
    </div>
  );
}

// telefon: zamiast pigułki Kafelek/Grupa na dole jeden „+” w górnym pasku, rozwijany w dwie pozycje
export function AddButton({ tileLabel, groupLabel, onTile, onGroup }: { tileLabel: string; groupLabel: string; onTile: () => void; onGroup: () => void }) {
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
        </div>, document.body) : null}
    </div>
  );
}
