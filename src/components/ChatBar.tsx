"use client";
// Pasek czatu z agentem: jeden formularz, stan „wysyłam” bez przeładowania strony.
import { useFormStatus } from "react-dom";

function Send({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return <button className="pill primary" type="submit" disabled={pending}>{pending ? pendingLabel : label}</button>;
}

// agent: tekst idzie do agenta wbudowanego; plain (bez klucza modelu): tekst staje się zadaniem albo notatką
export function ChatBar({ action, taskId, placeholder, mode = "agent" }: { action: (fd: FormData) => Promise<void>; taskId?: string | null; placeholder: string; mode?: "agent" | "plain" }) {
  const label = mode === "agent" ? "Wyślij" : taskId ? "Zapisz" : "Dodaj zadanie";
  return (
    <form className="chat" action={action}>
      <input type="hidden" name="taskId" value={taskId ?? ""} />
      <input name="text" placeholder={placeholder} autoComplete="off" required />
      <Send label={label} pendingLabel={mode === "agent" ? "Agent pracuje…" : "Zapisuję…"} />
    </form>
  );
}
