"use client";
// Przycisk akcji serwera z etykietą „trwa”, żeby było widać, że coś się dzieje. disabled: akcja nie ma sensu (np. szkic, którego mostek nie wyśle).
import { useFormStatus } from "react-dom";

export function PendingButton({ children, busy, className = "pill", title, disabled = false }: { children: React.ReactNode; busy?: string; className?: string; title?: string; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return <button className={className} type="submit" disabled={pending || disabled} title={title}>{pending ? (busy ?? "Trwa…") : children}</button>;
}
