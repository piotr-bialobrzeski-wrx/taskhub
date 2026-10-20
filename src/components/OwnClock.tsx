"use client";
// Zegar kroku Piotra (paczka 7, punkt 1): liczy jego czas na otwartej karcie bez „Start”. Tyka co 5 s tylko, gdy karta jest widoczna
// i Piotr czegoś w niej dotknął w ostatnich 2 minutach (klik, klawisz, przewinięcie); zapisuje porcjami (co 5 min, przy ukryciu karty,
// zmianie kroku i zamknięciu panelu). Czas wpisany ręcznie („Twój czas” w technikaliach) ma pierwszeństwo: serwer nie dolicza do niego.
import { useEffect, useRef, type RefObject } from "react";
import { addOwnTime } from "@/app/actions";

const TICK = 5, IDLE = 120, FLUSH = 300;
const EVENTS = ["pointerdown", "pointermove", "keydown", "input", "wheel", "touchstart", "scroll"];

export function useOwnClock(taskId: string, stepId: string | null, aside: RefObject<HTMLElement | null>) {
  const acc = useRef(0), last = useRef(0);
  useEffect(() => {
    const el = aside.current;
    if (!stepId || !el) return;
    acc.current = 0; last.current = Date.now();   // otwarcie kroku to już praca nad nim
    const touch = () => { last.current = Date.now(); };
    for (const e of EVENTS) el.addEventListener(e, touch, { passive: true, capture: true });
    const flush = () => { const s = acc.current; acc.current = 0; if (s > 0) addOwnTime(taskId, stepId, s).catch(() => undefined); };
    const tick = setInterval(() => {
      if (document.visibilityState !== "visible" || Date.now() - last.current > IDLE * 1000) return;
      acc.current += TICK;
      if (acc.current >= FLUSH) flush();
    }, TICK * 1000);
    const vis = () => { if (document.visibilityState !== "visible") flush(); };
    document.addEventListener("visibilitychange", vis);
    return () => {
      clearInterval(tick); document.removeEventListener("visibilitychange", vis);
      for (const e of EVENTS) el.removeEventListener(e, touch, { capture: true });
      flush();
    };
  }, [taskId, stepId, aside]);
}
