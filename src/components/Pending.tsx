"use client";
// Przycisk akcji serwera z etykietą „trwa”, żeby było widać, że coś się dzieje.
import { useFormStatus } from "react-dom";

export function PendingButton({ children, busy, className = "pill", title }: { children: React.ReactNode; busy?: string; className?: string; title?: string }) {
  const { pending } = useFormStatus();
  return <button className={className} type="submit" disabled={pending} title={title}>{pending ? (busy ?? "Trwa…") : children}</button>;
}
