"use client";
// Stoper kroku: start w przeglądarce (localStorage), stop zapisuje sekundy na serwerze.
import { useEffect, useState } from "react";

const key = (id: string) => "th_timer_" + id;
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export function Timer({ stepId, onStop }: { stepId: string; onStop: (sec: number) => Promise<void> }) {
  const [start, setStart] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { try { const v = localStorage.getItem(key(stepId)); if (v) setStart(Number(v)); } catch { /* brak storage */ } }, [stepId]);
  useEffect(() => { if (start == null) return; const i = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(i); }, [start]);
  if (start == null) {
    return <button type="button" className="pill" onClick={() => { const t = Date.now(); try { localStorage.setItem(key(stepId), String(t)); } catch { /* brak storage */ } setStart(t); }}>Start</button>;
  }
  const sec = Math.max(0, Math.round((now - start) / 1000));
  return (
    <button type="button" className="pill" style={{ color: "var(--warn)" }} onClick={async () => { try { localStorage.removeItem(key(stepId)); } catch { /* brak storage */ } setStart(null); await onStop(sec); }}>
      Stop {fmt(sec)}
    </button>
  );
}
