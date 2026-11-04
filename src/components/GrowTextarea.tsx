"use client";
// Pole tekstowe, które rośnie razem z treścią (bez uchwytu zmiany rozmiaru): zasady, cel zadania, szczegóły kroku, raport i wynik.
import { useEffect, useRef, type TextareaHTMLAttributes } from "react";

// Dopasowuje wysokość pola do treści. Mierzy bez paska przewijania (pasek zabiera szerokość i tekst zawijałby się węziej
// niż po pomiarze); pasek wraca dopiero, gdy pole doszło do max-height z CSS. Tekst zawsze zaczyna się od lewej krawędzi
// (paczka 49: w WebKit pole potrafiło zostać przewinięte w bok i ucinać początki linii).
export function fitTextarea(el: HTMLTextAreaElement, extra = 0) {
  el.style.overflowY = "hidden";
  el.style.height = "0";
  el.style.height = el.scrollHeight + extra + "px";
  el.style.overflowY = el.scrollHeight > el.clientHeight + 1 ? "auto" : "hidden";
  el.scrollLeft = 0;
}

// Ponowne dopasowanie po zmianie szerokości pola (okno, panel), bo wtedy zmienia się zawijanie; zwraca sprzątanie.
export function refitOnWidth(el: HTMLTextAreaElement, fit: () => void) {
  let w = el.clientWidth;
  const ro = new ResizeObserver(() => { if (el.clientWidth !== w) { w = el.clientWidth; fit(); } });
  ro.observe(el);
  return () => ro.disconnect();
}

// submitOnModEnter: ⌘/Ctrl+Enter wysyła formularz (Enter zostaje nową linią)
export function GrowTextarea({ className = "in", minRows = 2, submitOnModEnter, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { minRows?: number; submitOnModEnter?: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const grow = (el: HTMLTextAreaElement) => fitTextarea(el, 2);
  useEffect(() => { const el = ref.current; if (!el) return; grow(el); return refitOnWidth(el, () => grow(el)); }, []);
  return <textarea ref={ref} className={className + " grow"} rows={minRows} {...rest} onInput={(e) => { grow(e.currentTarget); rest.onInput?.(e); }}
    onKeyDown={(e) => { if (submitOnModEnter && e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } rest.onKeyDown?.(e); }} />;
}
