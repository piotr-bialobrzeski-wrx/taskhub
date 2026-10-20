"use client";
// Praca na żywo: trzy kropki, co mostek robi teraz („czyta plik · intake.js”) i od ilu minut. Minuty liczone po stronie przeglądarki
// dopiero po zamontowaniu (ten sam HTML z serwera i z klienta).
import { useEffect, useState } from "react";

// ile minut od chwili since: null przed zamontowaniem, potem odświeżane co pół minuty
export function useMinutes(since: string): number | null {
  const [min, setMin] = useState<number | null>(null);
  useEffect(() => {
    const calc = () => setMin(Math.max(0, Math.round((Date.now() - new Date(since).getTime()) / 60000)));
    calc();
    const t = setInterval(calc, 30000);
    return () => clearInterval(t);
  }, [since]);
  return min;
}

export function Activity({ text, detail, since, who, big }: { text: string; detail: string | null; since: string; who?: string; big?: boolean }) {
  const min = useMinutes(since);
  return (
    <span className={"act" + (big ? " big" : "")} title={`${who ? who + " " : ""}${text}${detail ? ": " + detail : ""}`}>
      <span className="dots" aria-hidden="true"><i /><i /><i /></span>
      <span className="act-t">{who ? `${who} ` : ""}{text}{detail ? <span className="act-d"> · {detail}</span> : null}</span>
      {min !== null && min >= 1 ? <span className="act-m">{min} min</span> : null}
    </span>
  );
}
