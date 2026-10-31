"use client";
// Paczka 31, krok 13 (decyzja w kroku 09: A „Okienko z prototypem”): działający prototyp w ramce pod pytaniem na kartce decyzji,
// przycisk na pełny ekran i zawsze „Otwórz prototyp”. Gdy strony nie da się osadzić (znany adres, nagłówki strony albo brak
// załadowania w kilka sekund), zostaje krótka informacja i link, bez zrzutów. Task Hub trzyma tylko adres.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/canvas/ui";
import type { EmbedMode } from "@/lib/embed";

export const FRAME_TIMEOUT_MS = 8000;
type State = "loading" | "ok" | "no";

const hostOf = (url: string) => { try { return new URL(url, "https://x").hostname.replace(/^www\./, ""); } catch { return ""; } };

export function ProtoFrame({ url, mode, own }: { url: string; mode: EmbedMode; own: boolean }) {
  const [state, setState] = useState<State>(mode === "link" ? "no" : "loading");
  // ramka dopiero po zamontowaniu (inaczej załadowanie przed hydratacją umyka onLoad) i, w trybie check, po sprawdzeniu nagłówków
  const [show, setShow] = useState(false);
  const [full, setFull] = useState(false);
  const loaded = useRef(false);
  useEffect(() => {
    if (mode === "frame") { setShow(true); return; }
    if (mode !== "check") return;
    let live = true;
    fetch("/api/embed-check?u=" + encodeURIComponent(url)).then((r) => r.json()).then((j: { ok?: boolean }) => {
      if (!live) return;
      if (j.ok) setShow(true); else setState("no");
    }).catch(() => { if (live) setState("no"); });
    return () => { live = false; };
  }, [mode, url]);
  // przeglądarka nie zgłasza blokady ramki: bez załadowania w kilka sekund ramka uchodzi za niedostępną
  useEffect(() => {
    if (!show) return;
    const t = setTimeout(() => { if (!loaded.current) setState("no"); }, FRAME_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [show]);
  useEffect(() => {
    if (!full) return;
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setFull(false); } };
    document.addEventListener("keydown", key, true);
    return () => document.removeEventListener("keydown", key, true);
  }, [full]);
  // własny podgląd (add_preview) ma CSP z piaskownicą bez allow-same-origin; obcej stronie zostaje jej własny origin
  const sandbox = "allow-scripts allow-modals allow-popups allow-forms" + (own ? "" : " allow-same-origin allow-popups-to-escape-sandbox");
  const host = own ? "Task Hub" : hostOf(url);
  const open = <a className="btn ico primary" href={url} target="_blank" rel="noopener" title={`Otwiera prototyp w nowej karcie: ${url}`}>Otwórz prototyp<Icon k="ext" size={13} sw={1.6} /></a>;
  const frame = (cls: string) => <iframe className={cls} title="Prototyp" src={url} sandbox={sandbox} referrerPolicy="no-referrer" allow="fullscreen" />;
  return (
    <div className={"pframe" + (state === "no" ? " no" : "")}>
      <div className="pf-h">
        <b>Prototyp</b>{host ? <small>{host}</small> : null}
        <span className="sp" />
        {state === "ok" ? <button type="button" className="icobtn" aria-label="Prototyp na pełny ekran" title="Pełny ekran" onClick={() => setFull(true)}><Icon k="full" size={14} sw={1.7} /></button> : null}
        {open}
      </div>
      {state === "no" ? (
        <div className="pf-no">{host === "claude.ai" ? "Strona claude.ai nie pozwala pokazać prototypu na kartce." : "Tego prototypu nie da się pokazać na kartce."} Otworzysz go przyciskiem „Otwórz prototyp”.</div>
      ) : (
        <div className="pf-b">
          {show ? <iframe className="pf-f" title="Prototyp" src={url} sandbox={sandbox} referrerPolicy="no-referrer" allow="fullscreen"
            onLoad={() => { loaded.current = true; setState((s) => (s === "loading" ? "ok" : s)); }} /> : null}
          {state === "loading" ? <div className="pf-load"><span className="pf-spin" aria-hidden="true" />Wczytuję prototyp…</div> : null}
        </div>
      )}
      {full ? createPortal(
        <div className="imgview protoview" role="dialog" aria-modal="true" aria-label="Prototyp na pełnym ekranie" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { if (e.target === e.currentTarget) setFull(false); }}>
          <div className="iv-bar glass">
            <span className="iv-name">Prototyp{host ? ` · ${host}` : ""}</span>
            {open}
            <button className="icobtn" type="button" aria-label="Zamknij pełny ekran" title="Zamknij (Esc)" onClick={() => setFull(false)}><Icon k="x" size={13} sw={2} /></button>
          </div>
          {frame("pv-full")}
        </div>, document.body) : null}
    </div>
  );
}
