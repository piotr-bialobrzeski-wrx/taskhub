"use client";
// Widok „Przegląd” na głównej kanwie (wariant A „Kawałki i duże przyciski” z zadania „Losowanie zadań w Task Hub”):
// jedno zadanie na ekranie, u góry pasek z kawałkiem na zadanie (zrobione w kolorze odpowiedzi) i strzałki wstecz i dalej,
// pod zadaniem sześć dużych przycisków w dwóch rzędach, na komputerze z klawiszami 1-6. Lista zadań ustala się przy wejściu,
// więc zadanie, któremu właśnie ustawiono termin, nie znika spod strzałki wstecz.
// Pod przyciskami „Usuń” (klawisz Delete): zadanie, które przestało być istotne, idzie do kosza (miękkie usunięcie,
// to samo co „Do kosza” w zadaniu), znika z kanwy i z pracy agenta, a w widoku Kosz można je przywrócić.
import { useEffect, useRef, useState } from "react";
import { batchTasks, setTaskField } from "@/app/actions";
import { dayKey } from "@/lib/clock";
import { REVIEW_ANSWERS, answerTip, fmtDay, reviewPatch, reviewQueue, type ReviewAnswer } from "@/lib/canvas/review";
import { Icon, Lvl, type TaskTile } from "./ui";

const NEXT_MS = 420;   // po tylu ms od kliknięcia przychodzi następne zadanie (najpierw widać kolorowe zaznaczenie)

type Item = { t: TaskTile; level0: number; due0: string | null };
type Dec = { k: ReviewAnswer | "trash"; custom: string };

export function Review({ tasks, onOpen, onDone, onToast }: { tasks: TaskTile[]; onOpen: (id: string) => void; onDone: () => void; onToast: (t: string) => void }) {
  const [today] = useState(() => dayKey(new Date()));
  const [items, setItems] = useState<Item[]>(() => reviewQueue(tasks, dayKey(new Date())).map((t) => ({ t, level0: t.base, due0: t.due?.iso ?? null })));
  const [pos, setPos] = useState(0);
  const [dec, setDec] = useState<Record<string, Dec>>({});
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const timer = useRef<number | null>(null);
  const dateRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  // świeże dane kafelka (tytuł, priorytet po zmianie), kolejność i skład listy z wejścia
  const live = (it: Item) => tasks.find((x) => x.id === it.t.id) ?? it.t;
  const cur = items[pos] ?? null;

  const nextPos = (from: number, d: Record<string, Dec>) => {
    for (let i = from + 1; i < items.length; i++) if (!d[items[i].t.id]) return i;
    for (let i = 0; i < items.length; i++) if (!d[items[i].t.id]) return i;
    return items.length;
  };

  const decide = (k: ReviewAnswer, picked?: string) => {
    if (!cur || busy || dec[cur.t.id]?.k === "trash") return;
    const id = cur.t.id, day = picked ?? custom[id] ?? "";
    if (k === "date" && !day) {
      const inp = dateRef.current;
      if (inp) { inp.focus(); try { inp.showPicker(); } catch { /* przeglądarka bez showPicker */ } }
      onToast("Wybierz dzień w kalendarzu.");
      return;
    }
    const before = dec[id];
    const d = { ...dec, [id]: { k, custom: day } };
    setDec(d); setBusy(true);
    setTaskField(id, reviewPatch(k, cur.level0, today, day)).catch((e) => {
      setDec((x) => { const n = { ...x }; if (before) n[id] = before; else delete n[id]; return n; });
      onToast("Nie udało się zapisać: " + (e instanceof Error ? e.message : String(e)));
    });
    timer.current = window.setTimeout(() => { setBusy(false); setPos((p) => (items[p]?.t.id === id ? nextPos(p, d) : p)); }, NEXT_MS);
  };
  // do kosza: kawałek paska robi się czerwony, po chwili następne zadanie (jak po odpowiedzi)
  const remove = () => {
    if (!cur || busy || dec[cur.t.id]?.k === "trash") return;
    const id = cur.t.id, before = dec[id];
    const d = { ...dec, [id]: { k: "trash" as const, custom: "" } };
    setDec(d); setBusy(true);
    batchTasks([id], { trash: true }).then(() => onToast("Zadanie w koszu.")).catch((e) => {
      setDec((x) => { const n = { ...x }; if (before) n[id] = before; else delete n[id]; return n; });
      onToast("Nie udało się usunąć: " + (e instanceof Error ? e.message : String(e)));
    });
    timer.current = window.setTimeout(() => { setBusy(false); setPos((p) => (items[p]?.t.id === id ? nextPos(p, d) : p)); }, NEXT_MS);
  };
  const back = () => { if (!busy && pos > 0) setPos(pos - 1); };
  const fwd = () => { if (!busy && pos < items.length) setPos(pos + 1); };
  const restart = () => { setItems(reviewQueue(tasks, today).map((t) => ({ t, level0: t.base, due0: t.due?.iso ?? null }))); setDec({}); setCustom({}); setPos(0); };

  // klawisze: strzałki jak strzałki w pasku, 1-6 = przyciski (nie w polu tekstowym, np. w doku)
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e: KeyboardEvent) => {
    const el = e.target as HTMLElement | null;
    if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "ArrowLeft") { e.preventDefault(); back(); return; }
    if (e.key === "ArrowRight") { e.preventDefault(); fwd(); return; }
    if (e.key === "Delete" && cur) { e.preventDefault(); remove(); return; }
    const i = Number(e.key);
    if (i >= 1 && i <= REVIEW_ANSWERS.length && cur) { e.preventDefault(); decide(REVIEW_ANSWERS[i - 1].k); }
  };
  useEffect(() => { const h = (e: KeyboardEvent) => keys.current(e); document.addEventListener("keydown", h); return () => document.removeEventListener("keydown", h); }, []);

  if (!items.length) return (
    <div className="revv">
      <div className="rv-end glass">
        <h2>Nic do przeglądu</h2>
        <p>Każde otwarte zadanie ma termin od dziś w górę.</p>
        <button type="button" className="btn primary" onClick={onDone}>Wróć na kanwę</button>
      </div>
    </div>
  );

  const done = Object.keys(dec).length;
  const n = Math.min(pos + 1, items.length);
  const nav = (
    <div className="rv-nav">
      <button type="button" className="rv-arr glass" title="Poprzednie zadanie (←)" aria-label="Poprzednie zadanie" disabled={pos === 0 || busy} onClick={back}><Icon k="chevL" size={16} /></button>
      <div className="rv-bar" role="progressbar" aria-valuemin={0} aria-valuemax={items.length} aria-valuenow={done} aria-label={`Przejrzane ${done} z ${items.length}`}>
        {items.map((it, i) => {
          const a = dec[it.t.id];
          return <button key={it.t.id} type="button" tabIndex={-1} className={"rv-seg" + (i === pos ? " cur" : "") + (a ? " a-" + a.k : "")} title={live(it).title} onClick={() => { if (!busy) setPos(i); }} />;
        })}
      </div>
      <span className="rv-num">{n} z {items.length}</span>
      <button type="button" className="rv-arr glass" title="Następne zadanie (→)" aria-label="Następne zadanie" disabled={pos >= items.length || busy} onClick={fwd}><Icon k="chevR" size={16} /></button>
    </div>
  );

  if (!cur) return (
    <div className="revv">
      {nav}
      <div className="rv-end glass">
        <h2>Przejrzane wszystkie {items.length}</h2>
        <p>{done < items.length ? `Odpowiedź ma ${done} z ${items.length}; resztę zostawiłeś bez zmian.` : "Terminy są już ustawione."} Strzałką wstecz możesz jeszcze coś zmienić.</p>
        <div className="rv-endb">
          <button type="button" className="btn primary" onClick={onDone}>Wróć na kanwę</button>
          <button type="button" className="btn" onClick={restart}>Przejrzyj od nowa</button>
        </div>
      </div>
    </div>
  );

  const t = live(cur), a = dec[t.id];
  const late = cur.due0 && cur.due0 < today;
  const gone = a?.k === "trash";
  return (
    <div className="revv">
      {nav}
      <button key={t.id} type="button" className="rv-card" onClick={() => onOpen(t.id)} title="Otwórz zadanie">
        <span className="rv-hd">{t.project?.name ?? "Bez projektu"}</span>
        <span className="rv-bd">
          <span className="rv-tt">{t.title}</span>
          {t.summary ? <span className="rv-sm">{t.summary}</span> : null}
          <span className="rv-mt">
            <span className="rv-lv">Priorytet <Lvl base={t.base} eff={t.eff} why={t.why} /></span>
            {late ? <span className="rv-late">Po terminie: {fmtDay(cur.due0!)}</span> : <span>Bez terminu</span>}
            {gone ? <span className="rv-gone">W koszu</span> : null}
          </span>
        </span>
      </button>
      <div className={"rv-opts" + (gone ? " off" : "")}>
        {REVIEW_ANSWERS.map((o, i) => (
          <button key={o.k} type="button" disabled={gone} className={"rv-opt a-" + o.k + (a?.k === o.k ? " sel" : "")} title={answerTip(o.k, today)} aria-pressed={a?.k === o.k}
            onClick={(e) => { if ((e.target as HTMLElement).closest("input")) return; decide(o.k); }}>
            <kbd>{i + 1}</kbd>
            {o.label}
            {o.k === "date" ? (
              <input ref={dateRef} type="date" disabled={gone} min={today} value={custom[t.id] ?? a?.custom ?? ""} aria-label="Dzień"
                onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}
                onChange={(e) => { const v = e.target.value; setCustom((c) => ({ ...c, [t.id]: v })); if (v) decide("date", v); }} />
            ) : null}
          </button>
        ))}
      </div>
      <div className="rv-del">
        {gone ? <span>Zadanie jest w koszu. Przywrócisz je w widoku Kosz.</span> : (
          <button type="button" className="btn danger" title="Do kosza: znika z kanwy i z pracy agenta, w Koszu można je przywrócić (Delete)" disabled={busy} onClick={remove}>
            <Icon k="trash" size={14} /> Usuń
          </button>
        )}
      </div>
    </div>
  );
}
