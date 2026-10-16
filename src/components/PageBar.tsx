"use client";
// Pasek-pigułka ekranów stron (Ustawienia, Zasady pracy): wstecz z tytułem po lewej, szukajka i agent po prawej, w tych samych miejscach co na kanwie.
// HashOpener: wynik szukania prowadzi do kotwicy (#token); rozwija zwiniętą sekcję, przewija i podświetla ją na chwilę.
import { useEffect } from "react";
import { AgentPill, BackPill } from "./canvas/pills";
import { SearchPill } from "./canvas/SearchPill";
import type { Screen, SearchItem } from "@/lib/search-core";

export function PageBar({ title, index, screen, agent, aiOn }: { title: string; index: SearchItem[]; screen: Screen; agent: string; aiOn: boolean }) {
  return (
    <div className="pillbar fixed">
      <div className="pl"><BackPill title={title} /></div>
      <span className="sp" />
      <SearchPill index={index} screen={screen} />
      <AgentPill agent={agent} aiOn={aiOn} />
    </div>
  );
}

export function HashOpener() {
  useEffect(() => {
    let timer: number | undefined;
    const go = () => {
      const id = decodeURIComponent(location.hash.slice(1)); if (!id) return;
      const el = document.getElementById(id); if (!el) return;
      const d = el instanceof HTMLDetailsElement ? el : el.closest("details"); if (d) d.open = true;
      requestAnimationFrame(() => { el.scrollIntoView({ block: "start", behavior: "smooth" }); el.classList.add("hl"); clearTimeout(timer); timer = window.setTimeout(() => el.classList.remove("hl"), 3000); });
    };
    go(); window.addEventListener("hashchange", go);
    return () => { window.removeEventListener("hashchange", go); clearTimeout(timer); };
  }, []);
  return null;
}
