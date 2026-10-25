"use client";
// Prototyp kolejki agenta: wskaźnik w lewym dolnym rogu rozwija listę (A: panel nad wskaźnikiem, B: boczny panel z prawej),
// pozycje można przeciągać albo przesunąć na pierwsze miejsce przyciskiem „Następne”; bieżąca praca zostaje na górze.
import { useEffect, useState } from "react";
import { Icon } from "@/components/canvas/ui";

type Kind = "rozpisanie" | "odpowiedź na Twoją wiadomość" | "krok do zrobienia" | "szkic";
type Item = { id: string; task: string; step: string; kind: Kind; here?: boolean };
const NOW = { task: "Dobór modelu i wysiłku do kroku", step: "Krok 07: Sprawdź limity modeli", kind: "krok do zrobienia" as Kind, min: 12 };
const START: Item[] = [
  { id: "a", task: "Duplikaty w BA&UX TODO ShiftWow", step: "Krok 03: Sprawdź duplikaty w statusie", kind: "krok do zrobienia" },
  { id: "b", task: "Grupy, kafelki, kolejka", step: "Twoja wiadomość: „dodaj krok z testem grup”", kind: "odpowiedź na Twoją wiadomość", here: true },
  { id: "c", task: "Wyślij behawiorystce wideo z zachowaniem piesków", step: "Rozpisanie na kroki", kind: "rozpisanie" },
  { id: "d", task: "Story akceptacji danych employees", step: "Krok 05: Popraw szkic story", kind: "szkic" },
];
const STEPS = [
  { n: "01", t: "Zleć w projekcie: naprawa tworzenia grupy", x: 40, y: 150 },
  { n: "03", t: "Zleć w projekcie: prototyp ramek i etykiet", x: 320, y: 150 },
  { n: "07", t: "Zleć w projekcie: prototyp kolejki agenta", x: 600, y: 150 },
  { n: "11", t: "Wdróż na produkcję", x: 320, y: 320 },
];

export function QueueProto() {
  const [variant, setVariant] = useState<"a" | "b">("a");
  const [open, setOpen] = useState(true);
  const [here, setHere] = useState(false);            // dymek: Claude pracuje w tym zadaniu albo wiadomość czeka w kolejce
  const [items, setItems] = useState<Item[]>(START);
  const [drag, setDrag] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 2600); return () => clearTimeout(t); }, [toast]);

  const pos = items.findIndex((x) => x.here) + 1;
  const toFront = (id: string) => { setItems((l) => [l.find((x) => x.id === id)!, ...l.filter((x) => x.id !== id)]); setToast("Przesunięte na pierwsze miejsce. Bieżąca praca nie jest przerywana."); };
  const withdraw = (id: string) => { setItems((l) => l.filter((x) => x.id !== id)); setToast("Wiadomość wycofana z kolejki."); };
  const dropOn = (target: string) => {
    if (!drag || drag === target) return;
    setItems((l) => { const from = l.findIndex((x) => x.id === drag), to = l.findIndex((x) => x.id === target); const n = [...l]; const [m] = n.splice(from, 1); n.splice(to, 0, m); return n; });
    setDrag(null);
  };

  const list = (
    <div className="q-list">
      <div className="q-now">
        <div className="q-lbl"><span className="dots" aria-hidden="true"><i /><i /><i /></span>Teraz · od {NOW.min} min</div>
        <button type="button" className="q-row now" onClick={() => setToast(`Otworzy kanwę zadania „${NOW.task}” i podświetli krok.`)}>
          <span className="q-t">{NOW.task}</span><span className="q-s">{NOW.step}</span>
        </button>
      </div>
      <div className="q-lbl">W kolejce ({items.length})</div>
      <ol className="q-ol">
        {items.map((it, i) => (
          <li key={it.id} className={"q-item" + (drag === it.id ? " dragging" : "") + (it.here ? " here" : "")} draggable
            onDragStart={() => setDrag(it.id)} onDragEnd={() => setDrag(null)} onDragOver={(e) => e.preventDefault()} onDrop={() => dropOn(it.id)}>
            <span className="q-grip" title="Przeciągnij, aby zmienić kolejność" aria-hidden="true">⋮⋮</span>
            <span className="q-n">{i + 1}.</span>
            <button type="button" className="q-row" onClick={() => setToast(`Otworzy kanwę zadania „${it.task}” i podświetli krok.`)}>
              <span className="q-t">{it.task}{it.here ? <span className="q-here">to zadanie</span> : null}</span>
              <span className="q-s">{it.step}</span>
              <span className="q-k">{it.kind}</span>
            </button>
            {i > 0 ? <button type="button" className="btn sm" title="Przesuwa na pierwsze miejsce, po bieżącej pracy" onClick={() => toFront(it.id)}>Następne</button> : <span className="q-first">następne</span>}
          </li>
        ))}
      </ol>
      <p className="q-foot">Kolejność ustawiona tutaj wygrywa z kolejnością, w jakiej Claude sam bierze pracę, aż pozycja zostanie zrobiona.</p>
    </div>
  );

  return (
    <div className="qp">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="qp-bar glass gpill">
        <span className="qp-l">Wariant</span>
        <button type="button" className={"seg" + (variant === "a" ? " on" : "")} onClick={() => setVariant("a")}>A. Panel w rogu</button>
        <button type="button" className={"seg" + (variant === "b" ? " on" : "")} onClick={() => setVariant("b")}>B. Boczny panel</button>
        <span className="qp-sep" />
        <span className="qp-l">Dymek</span>
        <button type="button" className={"seg" + (!here ? " on" : "")} onClick={() => setHere(false)}>Czeka w kolejce</button>
        <button type="button" className={"seg" + (here ? " on" : "")} onClick={() => setHere(true)}>Pracuje tutaj</button>
      </div>
      <div className="qp-title">Zadanie „Grupy, kafelki, kolejka” · prototyp kolejki agenta (dane pokazowe)</div>
      <div className="qp-canvas">
        {STEPS.map((s) => (
          <div key={s.n} className="node ready" style={{ left: s.x, top: s.y }}>
            <span className="n-top"><span className="n-num">{s.n}</span><span className="chip tool" style={{ ["--c" as string]: "var(--t-manual)" }}><span>Ty</span></span></span>
            <span className="n-title">{s.t}</span><span className="n-meta">~10 min</span>
          </div>
        ))}
      </div>

      {/* lewy dolny róg: dymek nad czatem zadania, pod nim wskaźnik kolejki (wariant A rozwija listę nad wskaźnikiem) */}
      <div className="qp-left">
        {variant === "a" && open ? <div className="q-panel glass">{list}</div> : null}
        {here ? (
          <div className="fb glass work on q-bubble">
            <div className="wk-h"><span className="dots" aria-hidden="true"><i /><i /><i /></span><span className="wk-t">Claude pracuje w tym zadaniu</span><span className="act-m">3 min</span>
              <button className="btn sm ico" type="button" onClick={() => setToast("Zatrzyma pracę Claude na Macu.")}><Icon k="stop" size={12} sw={1.6} />Zatrzymaj</button></div>
            <div className="wk-q">dodaj krok z testem grup</div>
            <div className="wk-now">Teraz: czyta zadanie</div>
          </div>
        ) : pos ? (
          <div className="fb glass work q-bubble wait">
            <div className="wk-h"><span className="dots still" aria-hidden="true"><i /><i /><i /></span><span className="wk-t">W kolejce: {pos}. z {items.length}</span></div>
            <div className="wk-q">dodaj krok z testem grup</div>
            <div className="wk-line">Claude kończy zadanie <a href="#" onClick={(e) => { e.preventDefault(); setToast(`Otworzy zadanie „${NOW.task}”.`); }}>„{NOW.task}”</a></div>
            <div className="ans-row">
              {pos > 1 ? <button className="btn sm" type="button" onClick={() => toFront("b")}>Następne</button> : <span className="q-first">następne w kolejce</span>}
              <button className="btn sm" type="button" onClick={() => withdraw("b")}>Wycofaj</button>
            </div>
          </div>
        ) : null}
        <button type="button" className={"q-ind glass" + (open ? " on" : "")} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <span className="dots" aria-hidden="true"><i /><i /><i /></span>
          <span className="q-ind-t"><b>Claude:</b> {NOW.task}</span>
          <span className="q-ind-n">w kolejce jeszcze {items.length}</span>
          <Icon k="chev" size={12} sw={2} />
        </button>
      </div>

      {variant === "b" && open ? (
        <aside className="q-side glass" aria-label="Kolejka Claude">
          <div className="q-side-h"><b>Kolejka Claude</b><button className="icobtn" type="button" aria-label="Zamknij" onClick={() => setOpen(false)}><Icon k="x" size={12} sw={2} /></button></div>
          {list}
        </aside>
      ) : null}

      <form className="dock glass qp-dock" onSubmit={(e) => e.preventDefault()}><input placeholder="Napisz do Claude w tym zadaniu…" aria-label="Wiadomość" /></form>
      {toast ? <div className="toast glass qp-toast" role="status">{toast}</div> : null}
    </div>
  );
}

const CSS = `
.qp { position: fixed; inset: 0; overflow: hidden; background: radial-gradient(var(--dot) 1px, transparent 1px) 0 0 / 22px 22px, var(--bg); }
.qp-bar { position: absolute; top: 16px; left: 50%; transform: translateX(-50%); z-index: 6; flex-wrap: nowrap; }
.qp-l { font-size: 12px; color: var(--sub); padding: 0 6px 0 10px; }
.qp-sep { width: 1px; height: 22px; background: var(--line); margin: 0 6px; }
.qp-title { position: absolute; top: 76px; left: 24px; font-weight: 650; color: var(--sub); font-size: 12.5px; }
.qp-canvas { position: absolute; inset: 0; }
.qp-canvas .node { cursor: default; }
.qp-left { position: fixed; left: 16px; bottom: 16px; width: 380px; z-index: 8; display: flex; flex-direction: column; gap: 8px; }
.q-ind { display: flex; align-items: center; gap: 8px; height: 40px; padding: 0 14px; border-radius: 999px; border: 0; cursor: pointer; color: var(--text); font: inherit; font-size: 12.5px; text-align: left; box-shadow: 0 4px 18px var(--shadow); min-width: 0; }
.q-ind .dots { color: var(--t-claude); }
.q-ind-t { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1 1 auto; }
.q-ind-n { flex: none; color: var(--sub); }
.q-ind svg { flex: none; transition: transform .15s; transform: rotate(180deg); }
.q-ind.on svg { transform: none; }
.q-panel { border-radius: var(--r-lg); padding: 16px; box-shadow: 0 10px 34px var(--shadow); max-height: 56vh; overflow: auto; }
.q-bubble { position: relative; display: flex; flex-direction: column; gap: 8px; padding: 12px 16px; border-radius: var(--r-md) var(--r-md) var(--r-md) 6px; box-shadow: 0 4px 18px var(--shadow); }
.q-bubble.on::after { content: ""; position: absolute; inset: -3px; border-radius: calc(var(--r-md) + 3px) calc(var(--r-md) + 3px) calc(var(--r-md) + 3px) 9px; padding: 3px; pointer-events: none;
  background: conic-gradient(from var(--a), transparent 0 70%, color-mix(in srgb, var(--t-claude) 30%, white) 88%, var(--t-claude) 100%);
  mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); mask-composite: exclude; animation: run-light 1.6s linear infinite; }
.q-bubble.wait .wk-h { color: var(--sub); }
.dots.still i { animation: none; opacity: .7; }
.q-list { display: flex; flex-direction: column; gap: 8px; }
.q-lbl { display: flex; align-items: center; gap: 8px; font-size: 11.5px; font-weight: 650; color: var(--sub); }
.q-now .q-lbl .dots { color: var(--t-claude); }
.q-row { display: flex; flex-direction: column; gap: 2px; align-items: flex-start; border: 0; background: transparent; padding: 0; font: inherit; color: inherit; text-align: left; cursor: pointer; min-width: 0; flex: 1 1 auto; }
.q-row.now { margin-top: 6px; padding: 10px 12px; border-radius: 12px; width: 100%; background: color-mix(in srgb, var(--t-claude) 10%, var(--surface)); box-shadow: inset 0 0 0 1.5px var(--t-claude); }
.q-t { font-weight: 600; font-size: 13px; line-height: 1.3; display: flex; gap: 6px; align-items: center; max-width: 100%; }
.q-s { font-size: 12px; color: var(--sub); max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.q-k { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; font-size: 11px; color: var(--sub); padding: 1px 8px; border-radius: 999px; box-shadow: inset 0 0 0 1px var(--line); margin-top: 2px; }
.q-here { font-size: 11px; font-weight: 600; color: var(--accent); background: var(--accent-soft); padding: 1px 7px; border-radius: 999px; flex: none; }
.q-ol { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.q-item { display: flex; align-items: center; gap: 8px; padding: 8px 10px 8px 6px; border-radius: 12px; background: var(--surface); box-shadow: 0 0 0 1px var(--line); }
.q-item.here { box-shadow: 0 0 0 1.5px var(--accent); }
.q-item.dragging { opacity: .5; }
.q-item .btn { flex: none; }
.q-grip { cursor: grab; color: var(--sub); letter-spacing: -3px; font-size: 13px; padding: 0 4px; user-select: none; }
.q-n { font: 600 12px/1 var(--font-mono); color: var(--sub); width: 18px; flex: none; }
.q-first { font-size: 11px; color: var(--sub); flex: none; }
.q-foot { margin: 4px 0 0; font-size: 11.5px; color: var(--sub); }
.q-side { position: fixed; right: 16px; top: 76px; bottom: 16px; width: 400px; z-index: 7; border-radius: var(--r-lg); padding: 16px; box-shadow: 0 10px 34px var(--shadow); overflow: auto; display: flex; flex-direction: column; gap: 12px; }
.q-side-h { display: flex; align-items: center; justify-content: space-between; }
.qp-dock { position: fixed; left: 50%; transform: translateX(-50%); bottom: 16px; width: min(560px, calc(100% - 860px)); min-width: 280px; padding: 6px 16px; border-radius: 999px; z-index: 5; }
.qp-dock input { width: 100%; border: 0; background: transparent; font: inherit; color: var(--text); height: 34px; outline: none; }
.qp-toast { position: fixed; left: 50%; transform: translateX(-50%); bottom: 76px; padding: 10px 16px; border-radius: 999px; z-index: 20; font-size: 12.5px; box-shadow: 0 6px 20px var(--shadow); }
@media (max-width: 860px) {
  .qp-bar { left: 16px; right: 16px; transform: none; overflow-x: auto; }
  .qp-left { right: 16px; width: auto; bottom: 70px; }
  .qp-dock { left: 16px; right: 16px; transform: none; width: auto; }
  .q-side { left: 16px; right: 16px; width: auto; }
}
`;
