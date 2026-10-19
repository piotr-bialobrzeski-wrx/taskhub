"use client";
// Pole tekstowe, które rośnie razem z treścią (bez uchwytu zmiany rozmiaru): zasady, cel zadania, szczegóły kroku, raport i wynik.
import { useEffect, useRef, type TextareaHTMLAttributes } from "react";

// submitOnModEnter: ⌘/Ctrl+Enter wysyła formularz (Enter zostaje nową linią)
export function GrowTextarea({ className = "in", minRows = 2, submitOnModEnter, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { minRows?: number; submitOnModEnter?: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const grow = (el: HTMLTextAreaElement) => { el.style.height = "0"; el.style.height = el.scrollHeight + 2 + "px"; };
  useEffect(() => { if (ref.current) grow(ref.current); }, []);
  return <textarea ref={ref} className={className + " grow"} rows={minRows} {...rest} onInput={(e) => { grow(e.currentTarget); rest.onInput?.(e); }}
    onKeyDown={(e) => { if (submitOnModEnter && e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } rest.onKeyDown?.(e); }} />;
}
