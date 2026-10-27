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

export function LivePoll({ taskId, liveKey, active, refreshAt = null }: { taskId: string | null; liveKey: string; active: boolean; refreshAt?: number | null }) {
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
  useEffect(() => {
    let stop = false, fast = active, timer: ReturnType<typeof setTimeout> | null = null;
    const due = (next: string) => Date.now() - lastAt.current >= (stampOf(next) !== stampOf(key.current) ? DB_GAP : RUN_GAP);
    const tick = async () => {
      if (stop) return;
      if (document.visibilityState === "visible") {
        try {
          const r = await fetch(`/api/pulse${taskId ? `?task=${encodeURIComponent(taskId)}` : ""}`, { cache: "no-store" });
          if (r.ok) {
            const j = (await r.json()) as { key: string; active: boolean };
            fast = j.active;
            if (j.key !== key.current && due(j.key)) { key.current = j.key; lastAt.current = Date.now(); router.refresh(); }
          }
        } catch { /* chwilowy brak sieci: następny puls spróbuje ponownie */ }
      }
      if (!stop) timer = setTimeout(tick, fast ? FAST : SLOW);
    };
    timer = setTimeout(tick, fast ? FAST : SLOW);
    const vis = () => { if (document.visibilityState === "visible") { if (timer) clearTimeout(timer); void tick(); } };
    document.addEventListener("visibilitychange", vis);
    return () => { stop = true; if (timer) clearTimeout(timer); document.removeEventListener("visibilitychange", vis); };
  }, [taskId, active, router]);
  return null;
}
