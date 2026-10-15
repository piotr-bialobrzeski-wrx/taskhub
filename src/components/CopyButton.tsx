"use client";
import { useState } from "react";

export function CopyButton({ text, label = "Kopiuj" }: { text: string; label?: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button type="button" className="pill" onClick={async () => { try { await navigator.clipboard.writeText(text); setOk(true); setTimeout(() => setOk(false), 1500); } catch { /* brak schowka */ } }}>
      {ok ? "Skopiowano" : label}
    </button>
  );
}
