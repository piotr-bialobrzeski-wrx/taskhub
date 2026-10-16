"use client";
// Pole tekstowe, które rośnie razem z treścią (bez uchwytu zmiany rozmiaru): zasady, cel zadania, szczegóły kroku, raport i wynik.
import { useEffect, useRef, type TextareaHTMLAttributes } from "react";

export function GrowTextarea({ className = "in", minRows = 2, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { minRows?: number }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const grow = (el: HTMLTextAreaElement) => { el.style.height = "0"; el.style.height = el.scrollHeight + 2 + "px"; };
  useEffect(() => { if (ref.current) grow(ref.current); }, []);
  return <textarea ref={ref} className={className + " grow"} rows={minRows} {...rest} onInput={(e) => { grow(e.currentTarget); rest.onInput?.(e); }} />;
}
