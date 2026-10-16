"use client";
// Pola formularza edycji kroku, które są wyborem z listy (narzędzie, krok poprzedzający): własne listy aplikacji zamiast systemowych.
import { useState } from "react";
import { Picker } from "@/components/canvas/widgets";
import { TOOL_LABELS } from "@/lib/schema";

export function StepEditFields({ tool, after, steps }: { tool: string; after: string; steps: { id: string; title: string }[] }) {
  const [t, setT] = useState(tool);
  const [a, setA] = useState(after);
  const name = (id: string) => steps.find((s) => s.id === id)?.title ?? "bez zależności";
  return (
    <>
      <input type="hidden" name="tool" value={t} />
      <input type="hidden" name="after" value={a} />
      <div className="field"><span>Narzędzie</span>
        <Picker cls="boxed" title="Narzędzie kroku" trigger={<span className="pp-t">{TOOL_LABELS[t] ?? t}</span>} onPick={setT}
          options={[...Object.entries(TOOL_LABELS), ...(TOOL_LABELS[tool] ? [] : [[tool, tool] as [string, string]])].map(([k, v]) => ({ key: k, on: k === t, node: <span>{v}</span> }))} /></div>
      <div className="field"><span>Po kroku</span>
        <Picker cls="boxed" title="Krok, po którym ten ma się zacząć" trigger={<span className="pp-t">{a ? name(a) : "bez zależności"}</span>} onPick={setA}
          options={[{ key: "", on: !a, node: <span>bez zależności</span> }, ...steps.map((s) => ({ key: s.id, on: s.id === a, node: <span>{s.title}</span> }))]} /></div>
    </>
  );
}
