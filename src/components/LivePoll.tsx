"use client";
// Puls strony: co kilka sekund pyta /api/pulse o klucz zmian; gdy się zmieni (mostek dopisał kroki, zamknął krok, odpowiedział),
// odświeża dane z serwera bez przeładowania. Szybciej, gdy mostek pracuje; wcale, gdy karta jest w tle.
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

const FAST = 3000, SLOW = 15000;

export function LivePoll({ taskId, liveKey, active }: { taskId: string | null; liveKey: string; active: boolean }) {
  const router = useRouter();
  const key = useRef(liveKey);
  useEffect(() => { key.current = liveKey; }, [liveKey]);
  useEffect(() => {
    let stop = false, fast = active, timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      if (stop) return;
      if (document.visibilityState === "visible") {
        try {
          const r = await fetch(`/api/pulse${taskId ? `?task=${encodeURIComponent(taskId)}` : ""}`, { cache: "no-store" });
          if (r.ok) {
            const j = (await r.json()) as { key: string; active: boolean };
            fast = j.active;
            if (j.key !== key.current) { key.current = j.key; router.refresh(); }
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
