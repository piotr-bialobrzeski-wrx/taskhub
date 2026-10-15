"use client";
// Pasek czatu z agentem: jeden formularz, stan „wysyłam” bez przeładowania strony.
import { useFormStatus } from "react-dom";

function Send() {
  const { pending } = useFormStatus();
  return <button className="pill primary" type="submit" disabled={pending}>{pending ? "Agent pracuje…" : "Wyślij"}</button>;
}

export function ChatBar({ action, taskId, placeholder }: { action: (fd: FormData) => Promise<void>; taskId?: string | null; placeholder: string }) {
  return (
    <form className="chat" action={action}>
      <input type="hidden" name="taskId" value={taskId ?? ""} />
      <input name="text" placeholder={placeholder} autoComplete="off" required />
      <Send />
    </form>
  );
}
