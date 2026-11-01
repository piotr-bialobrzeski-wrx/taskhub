"use client";
// Widok „Losowanie” na głównej kanwie (paczka 32, wariant A „Bęben”): cztery kafelki czasu, bęben z przelatującymi tytułami,
// błysk i jeden kafelek wyniku. Jedno ponowne losowanie; wynik zostaje (także po wyjściu z zadania i zamknięciu aplikacji),
// dopóki zadanie czeka na Piotra.
import { useEffect, useMemo, useRef, useState } from "react";
import { fmtMin } from "@/lib/time";
import { DRAW_KEY, DRAW_TIMES, drawPick, drawPool, drawRestore, type DrawSaved } from "@/lib/canvas/draw";
import type { TaskTile } from "./ui";

const ROW = 76;            // wysokość wiersza bębna
const SPIN_MS = 2200;      // czas obrotu bębna
const LAND_MS = 2500;      // po tylu ms pokazuje się kafelek wyniku
const SPARKS = 22;

type Phase = { k: "pick" } | { k: "roll"; limit: number; reel: TaskTile[]; res: TaskTile; rerolled: boolean } | { k: "result"; limit: number; id: string; rerolled: boolean };

const save = (s: DrawSaved | null) => { try { if (s) localStorage.setItem(DRAW_KEY, JSON.stringify(s)); else localStorage.removeItem(DRAW_KEY); } catch { /* brak storage */ } };

export function Draw({ tasks, onOpen, onToast }: { tasks: TaskTile[]; onOpen: (id: string) => void; onToast: (t: string) => void }) {
  const [ph, setPh] = useState<Phase>({ k: "pick" });
  const [ready, setReady] = useState(false);
  const [spin, setSpin] = useState(false);
  const [burst, setBurst] = useState(0);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // po wejściu: zapamiętany wynik wraca na ekran, o ile zadanie dalej czeka na Piotra; inaczej pamięć się czyści
  useEffect(() => {
    let raw: string | null = null;
    try { raw = localStorage.getItem(DRAW_KEY); } catch { /* brak storage */ }
    const r = drawRestore(raw, tasks);
    if (r) setPh({ k: "result", limit: r.limit, id: r.id, rerolled: r.rerolled });
    else if (raw) save(null);
    setReady(true);
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  // zadanie z wyniku zostało zrobione (albo przestało czekać na Piotra): ekran znowu pusty
  useEffect(() => {
    if (ph.k !== "result") return;
    const t = tasks.find((x) => x.id === ph.id);
    if (!t || t.state === "done" || !t.draw) { save(null); setPh({ k: "pick" }); }
  }, [tasks, ph]);

  const counts = useMemo(() => Object.fromEntries(DRAW_TIMES.map((m) => [m, drawPool(tasks, m).length])), [tasks]);

  const roll = (limit: number, except: string | null, rerolled: boolean) => {
    const pool = drawPool(tasks, limit, except);
    const res = drawPick(pool, Math.random());
    if (!res) { onToast(except ? "Nic innego nie mieści się w tym czasie." : "Nic nie mieści się w tym czasie."); return; }
    const all = drawPool(tasks, limit);
    const reel: TaskTile[] = [];
    for (let i = 0; i < 26; i++) reel.push(all[Math.floor(Math.random() * all.length)]);
    reel.push(res);
    const calm = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    setSpin(false);
    setPh({ k: "roll", limit, reel, res, rerolled });
    timers.current.push(window.setTimeout(() => setSpin(true), 30));
    timers.current.push(window.setTimeout(() => {
      setPh({ k: "result", limit, id: res.id, rerolled });
      save({ id: res.id, limit, rerolled });
      if (!calm) { setBurst((b) => b + 1); timers.current.push(window.setTimeout(() => setBurst(0), 1200)); }
    }, calm ? 300 : LAND_MS));
  };

  if (!ready) return <div className="drawv" />;

  if (ph.k === "pick") return (
    <div className="drawv">
      <h2>Ile masz czasu?</h2>
      <p className="sub">Wylosuję jedno zadanie, które się w nim zmieści.</p>
      <div className="dtimes">
        {DRAW_TIMES.map((m) => (
          <button key={m} type="button" className="dtime" disabled={!counts[m]} title={counts[m] ? undefined : "Nic się nie mieści w tym czasie"} onClick={() => roll(m, null, false)}><b>{fmtMin(m)}</b></button>
        ))}
      </div>
    </div>
  );

  if (ph.k === "roll") {
    const end = -(ph.reel.length - 1) * ROW;
    return (
      <div className="drawv">
        <h2>Losuję na {fmtMin(ph.limit)}…</h2>
        <div className="reelbox" aria-live="polite" aria-label="Losowanie">
          <div className="win" />
          <div className={"reel" + (spin ? " go" : "")} style={{ transform: spin ? `translateY(${end}px)` : undefined, transitionDuration: SPIN_MS + "ms" }}>
            {ph.reel.map((t, i) => <div key={i}>{t.title}<small>{t.project?.name ?? "Bez projektu"} · {fmtMin(t.draw?.min ?? 0)}</small></div>)}
          </div>
        </div>
      </div>
    );
  }

  const t = tasks.find((x) => x.id === ph.id);
  if (!t || !t.draw) return <div className="drawv" />;
  return (
    <div className="drawv">
      <p className="sub">Na {fmtMin(ph.limit)} wylosowane:</p>
      <div className="dwrap">
        <button type="button" className={"dpick lk-" + t.look.key} onClick={() => onOpen(t.id)}>
          <span className="dp-hd"><span>{t.project?.name ?? "Bez projektu"}</span><span>ok. {fmtMin(t.draw.min)}</span></span>
          <span className="dp-bd">
            <span className="dp-tt">{t.title}</span>
            <span className="dp-nx"><b>Twój krok:</b> {t.draw.step}</span>
            <span className="dp-open">Otwórz zadanie</span>
          </span>
        </button>
        {burst ? <Burst key={burst} /> : null}
      </div>
      {ph.rerolled ? <div className="dused">Ponowne losowanie wykorzystane. To zadanie zostaje tutaj, dopóki go nie zrobisz.</div> : (
        <>
          <button type="button" className="btn" onClick={() => roll(ph.limit, ph.id, true)}>Losuj jeszcze raz</button>
          <div className="dused">Możesz losować ponownie tylko raz.</div>
        </>
      )}
    </div>
  );
}

// błysk i iskry wokół kafelka wyniku
function Burst() {
  const parts = useMemo(() => Array.from({ length: SPARKS }, (_, i) => {
    const a = Math.random() * Math.PI * 2, d = 90 + Math.random() * 120;
    return { i, dx: Math.cos(a) * d, dy: Math.sin(a) * d, delay: Math.random() * 0.1 };
  }), []);
  return (
    <>
      <span className="dflash" aria-hidden="true" />
      {parts.map((p) => <i key={p.i} className={"dspark c" + (p.i % 5)} aria-hidden="true" style={{ ["--dx" as string]: p.dx + "px", ["--dy" as string]: p.dy + "px", animationDelay: p.delay + "s" }} />)}
    </>
  );
}
