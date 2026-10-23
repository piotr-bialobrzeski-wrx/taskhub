"use client";
import { useState } from "react";

export function CopyButton({ text, label = "Kopiuj", className = "pill", title }: { text: string; label?: string; className?: string; title?: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button type="button" className={className} title={title} onClick={async () => { try { await navigator.clipboard.writeText(text); setOk(true); setTimeout(() => setOk(false), 1500); } catch { /* brak schowka */ } }}>
      {ok ? "Skopiowano" : label}
    </button>
  );
}
