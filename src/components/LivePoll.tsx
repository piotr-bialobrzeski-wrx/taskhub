"use client";
// Puls strony: co kilka sekund pyta /api/pulse o klucz zmian; gdy się zmieni (mostek dopisał kroki, zamknął krok, odpowiedział),
// odświeża dane z serwera bez przeładowania. Szybciej, gdy mostek pracuje; wcale, gdy karta jest w tle.
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

const FAST = 3000, SLOW = 15000;
// Każde odświeżenie strony czyta z bazy całą listę zadań z krokami (transfer z Supabase). Zmiana w bazie odświeża najwyżej co DB_GAP,
// a sama notatka biegu („czyta plik”, zmienia się przy każdym narzędziu agenta) najwyżej co RUN_GAP; zaległa zmiana czeka na swoją kolej.
const DB_GAP = 10_000, RUN_GAP = 60_000;
const stampOf = (k: string) => k.split("|")[0];
// paczka 60: przy działającym sygnale z bazy (Supabase Realtime) strona nie pyta co kilka sekund; pyta po sygnale i poza tym co SAFE
// (stan Maca, rzeczy zależne od czasu). Gdy pytanie co SAFE znajdzie zmianę, o której nie było sygnału, sygnał uznajemy za zepsuty
// i strona wraca do zwykłego pytania co FAST / SLOW.
const SAFE = 120_000, SIGNAL_GAP = 1500;
export type LiveSignal = { socket: string; topic: string } | null;

// minimalny klient kanału Realtime (protokół Phoenix 1.0): dołącz, bij serce co 25 s, wołaj onSignal przy każdym sygnale „change”
export function listen(live: NonNullable<LiveSignal>, onSignal: () => void, onState: (ok: boolean) => void): () => void {
  let ws: WebSocket | null = null, beat: ReturnType<typeof setInterval> | null = null, retry: ReturnType<typeof setTimeout> | null = null;
  let closed = false, ref = 0, wait = 2000;
  const send = (topic: string, event: string, payload: unknown) => { try { ws?.send(JSON.stringify({ topic, event, payload, ref: String(++ref) })); } catch { /* zamknięte */ } };
  const open = () => {
    if (closed) return;
    try { ws = new WebSocket(live.socket); } catch { onState(false); return; }
    ws.onopen = () => {
      wait = 2000;
      send(`realtime:${live.topic}`, "phx_join", { config: { broadcast: { self: false, ack: false }, presence: { key: "" }, private: false } });
      beat = setInterval(() => send("phoenix", "heartbeat", {}), 25_000);
    };
    ws.onmessage = (m) => {
      try {
        const j = JSON.parse(String(m.data)) as { event?: string; topic?: string; payload?: { status?: string; event?: string } };
        if (j.event === "phx_reply" && j.topic === `realtime:${live.topic}`) onState(j.payload?.status === "ok");
        else if (j.event === "broadcast" && j.payload?.event === "change") onSignal();
      } catch { /* nie JSON */ }
    };
    ws.onclose = () => {
      if (beat) clearInterval(beat);
      beat = null; onState(false);
      if (!closed) { retry = setTimeout(open, wait); wait = Math.min(wait * 2, 60_000); }
    };
  };
  open();
  return () => { closed = true; if (beat) clearInterval(beat); if (retry) clearTimeout(retry); try { ws?.close(); } catch { /* już zamknięte */ } };
}

export function LivePoll({ taskId, liveKey, active, refreshAt = null, live = null }: { taskId: string | null; liveKey: string; active: boolean; refreshAt?: number | null; live?: LiveSignal }) {
  const router = useRouter();
  // o tej chwili coś na stronie zmienia się samo z upływem czasu (ukończone zadanie schodzi do archiwum): odśwież, choć w bazie nic nowego
  useEffect(() => {
    if (!refreshAt) return;
    const t = setTimeout(() => router.refresh(), Math.max(1000, refreshAt - Date.now() + 1000));
    return () => clearTimeout(t);
  }, [refreshAt, router]);
  const key = useRef(liveKey);
  const lastAt = useRef(Date.now());
  useEffect(() => { key.current = liveKey; lastAt.current = Date.now(); }, [liveKey]);
  const socket = live?.socket ?? "", topic = live?.topic ?? "";
  useEffect(() => {
    let stop = false, fast = active, timer: ReturnType<typeof setTimeout> | null = null, busy = false, again = false;
    let joined = false, broken = false, signalAt = 0, lastTick = 0;
    const listening = () => joined && !broken;
    const every = () => (listening() ? SAFE : fast ? FAST : SLOW);
    const due = (next: string) => Date.now() - lastAt.current >= (stampOf(next) !== stampOf(key.current) ? DB_GAP : RUN_GAP);
    const tick = async (bySignal = false) => {
      if (stop) return;
      if (busy) { again = true; return; }
      if (timer) clearTimeout(timer);
      busy = true;
      const prevTick = lastTick;
      lastTick = Date.now();
      if (document.visibilityState === "visible") {
        try {
          const r = await fetch(`/api/pulse${taskId ? `?task=${encodeURIComponent(taskId)}` : ""}`, { cache: "no-store" });
          if (r.ok) {
            const j = (await r.json()) as { key: string; active: boolean };
            fast = j.active;
            // zmiana w bazie znaleziona bez sygnału od poprzedniego pytania: sygnał nie dochodzi, wracamy do zwykłego pytania
            if (!bySignal && listening() && stampOf(j.key) !== stampOf(key.current) && signalAt < prevTick) broken = true;
            if (j.key !== key.current) {
              if (due(j.key)) { key.current = j.key; lastAt.current = Date.now(); router.refresh(); }
              else if (listening()) { const left = (stampOf(j.key) !== stampOf(key.current) ? DB_GAP : RUN_GAP) - (Date.now() - lastAt.current); again = false; busy = false; if (!stop) timer = setTimeout(() => void tick(true), Math.max(500, left)); return; }
            }
          }
        } catch { /* chwilowy brak sieci: następny puls spróbuje ponownie */ }
      }
      busy = false;
      if (again) { again = false; if (!stop) timer = setTimeout(() => void tick(true), SIGNAL_GAP); return; }
      if (!stop) timer = setTimeout(() => void tick(), every());
    };
    timer = setTimeout(() => void tick(), every());
    const vis = () => { if (document.visibilityState === "visible") { if (timer) clearTimeout(timer); void tick(true); } };
    document.addEventListener("visibilitychange", vis);
    let pending: ReturnType<typeof setTimeout> | null = null;
    const quit = socket && topic ? listen({ socket, topic }, () => {
      signalAt = Date.now();
      if (document.visibilityState !== "visible" || pending) return;
      pending = setTimeout(() => { pending = null; void tick(true); }, 300);   // kilka sygnałów naraz = jedno pytanie
    }, (ok) => {
      const was = listening();
      joined = ok;
      // po zerwaniu kanału od razu wracamy do zwykłego rytmu; po dołączeniu następne pytanie dopiero za SAFE
      if (was !== listening() && !busy && !stop) { if (timer) clearTimeout(timer); timer = setTimeout(() => void tick(), every()); }
    }) : null;
    return () => { stop = true; quit?.(); if (pending) clearTimeout(pending); if (timer) clearTimeout(timer); document.removeEventListener("visibilitychange", vis); };
  }, [taskId, active, router, socket, topic]);
  return null;
}
