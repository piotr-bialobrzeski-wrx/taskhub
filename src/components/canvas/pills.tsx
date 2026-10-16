"use client";
// Pigułki górnego paska wspólne dla wszystkich ekranów: logo-menu, wstecz, Kafelek/Grupa, widok, agent.
import { useEffect, useState, type ReactNode } from "react";
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

// logo z nazwą jest przyciskiem menu (menu rozwija się pod spodem)
export function BrandButton({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <button className="brand" type="button" aria-label="Menu" aria-haspopup="menu" aria-expanded={open} onClick={onClick}>
      <span className="logo"><Icon k="logo" size={12} sw={2} /></span><span className="ct">Task Hub</span><Icon k="chev" size={11} sw={2.2} />
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

// Kafelek i Grupa: osobna pigułka, bo to narzędzia kanwy, nie część menu
export function MakePill({ tileTitle, groupTitle, onTile, onGroup }: { tileTitle: string; groupTitle: string; onTile: () => void; onGroup: () => void }) {
  return (
    <div className="gpill glass" role="toolbar" aria-label="Nowe na kanwie">
      <button className="icobtn mk" type="button" title={tileTitle} onClick={onTile}><Icon k="tile" size={18} />Kafelek</button>
      <button className="icobtn mk" type="button" title={groupTitle} onClick={onGroup}><Icon k="group" size={18} />Grupa</button>
    </div>
  );
}
