"use client";
// Kolejka agenta (paczka 18, wariant A „Panel w rogu”): wskaźnik w lewym dolnym rogu, pod dymkami, rozwija nad sobą panel
// z pozycjami w kolejności, w jakiej Claude je weźmie. Paczka 31 (wariant A „Jedna pigułka”): bieżącą pracę pokazuje tylko pigułka
// (gdzie, co robi, od ilu minut, „Zatrzymaj”, liczba w kolejce); panel nie ma już sekcji „Teraz”, a dymek pracy w zadaniu zniknął. Przeciąganie i „Następne” zapisują kolejność, którą lista pracy agenta daje na początek.
// Paczka 31 (wariant C dymków „po uwagach”): zdarzenia agenta nie stoją już stosem dymków nad pigułką. Pigułka ma licznik „N nowe”
// (kolorowy, gdy coś czeka na Piotra; na chwilę pulsuje przy nowym), a rozwinięty panel ma na górze listę „Co się stało” z „Wyczyść”,
// pod nią kolejkę. „Wyczyść” chowa zwykłe informacje; to, co czeka na Piotra, zostaje do załatwienia kroku. „Otwórz” chowa swoje zdarzenie.
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import { queueNext, reorderQueue } from "@/app/actions";
import type { AgentQueue, QueueEntry } from "@/lib/agent/work";
import type { FeedItem } from "@/lib/feed";
import { useMinutes } from "@/components/Activity";
import { Icon } from "./ui";

const OPEN_KEY = "th-queue-open";
export const FEED_OFF_KEY = "th-feed-off";   // zdarzenia schowane w tej przeglądarce („Wyczyść”, „Otwórz”, dawniej X na dymku)
const PING_MS = 6000;

// schowane zdarzenia (localStorage): null do montażu, żeby serwer i pierwsze narysowanie się zgadzały
export function useFeedOff() {
  const [off, setOff] = useState<Set<string> | null>(null);
  useEffect(() => { try { setOff(new Set(JSON.parse(localStorage.getItem(FEED_OFF_KEY) ?? "[]") as string[])); } catch { setOff(new Set()); } }, []);
  const hide = (ids: string[]) => setOff((s) => {
    const n = new Set(s); ids.forEach((id) => n.add(id));
    try { localStorage.setItem(FEED_OFF_KEY, JSON.stringify([...n].slice(-200))); } catch { /* brak storage */ }
    return n;
  });
  return { off, hide };
}
// lista „Co się stało”: najpierw to, co czeka na Piotra, potem najnowsze
export const eventOrder = (list: FeedItem[]) => list.map((e, i) => ({ e, i })).sort((a, b) => Number(!!b.e.need) - Number(!!a.e.need) || b.i - a.i).map((x) => x.e);
// po „Wyczyść” zostaje tylko to, co czeka na Piotra
export const afterClear = (list: FeedItem[]) => list.filter((e) => e.need).map((e) => e.id);
const hrefOf = (x: { taskId: string | null; stepId?: string | null }) => (x.taskId ? `/tasks/${x.taskId}${x.stepId ? `?step=${x.stepId}` : ""}` : null);

export function QueuePanel({ queue, taskId = null, onToast, onStop, events = [], onStep }: {
  queue: AgentQueue; taskId?: string | null; onToast: (msg: string) => void; onStop?: (runId: string) => Promise<unknown> | void;
  events?: FeedItem[]; onStep?: (stepId: string) => void;
}) {
  const router = useRouter();
  const { off, hide } = useFeedOff();
  const shown = off ? eventOrder(events.filter((e) => !off.has(e.id))) : [];
  const need = shown.some((e) => e.need);
  // nowe zdarzenie od ostatniego narysowania: licznik pulsuje przez chwilę (pierwsze narysowanie nie pulsuje)
  const seen = useRef<Set<string> | null>(null);
  const [ping, setPing] = useState(false);
  const evSig = events.map((e) => e.id).join(",");
  useEffect(() => {
    const ids = new Set(events.map((e) => e.id));
    const fresh = seen.current && [...ids].some((id) => !seen.current!.has(id));
    seen.current = ids;
    if (!fresh) return;
    setPing(true); const t = setTimeout(() => setPing(false), PING_MS); return () => clearTimeout(t);
  }, [evSig]);   // eslint-disable-line react-hooks/exhaustive-deps
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<QueueEntry[]>(queue.items);
  const [drag, setDrag] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState(false);
  const min = useMinutes(queue.now?.since ?? "");
  // nowe dane z serwera (odświeżenie po zmianie) zastępują lokalną kolejność
  const sig = queue.items.map((x) => x.key).join(",");
  useEffect(() => { setItems(queue.items); }, [sig]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { try { setOpen(localStorage.getItem(OPEN_KEY) === "1"); } catch { /* brak storage */ } }, []);
  const toggle = () => setOpen((o) => { try { localStorage.setItem(OPEN_KEY, o ? "0" : "1"); } catch { /* brak storage */ } return !o; });
  if (!queue.now && !items.length && !shown.length) return null;
  const openEvent = (e: FeedItem) => {
    hide([e.id]);
    if (e.stepId && onStep) onStep(e.stepId);
    else if (e.open) router.push(e.open.href);
    else if (e.link) window.open(e.link, "_blank", "noopener");
  };
  const canOpen = (e: FeedItem) => !!((e.stepId && onStep) || e.open || e.link);

  const save = async (fn: () => Promise<string>) => { setBusy(true); try { onToast(await fn()); } catch (e) { onToast("Nie udało się: " + (e instanceof Error ? e.message : String(e))); } finally { setBusy(false); } };
  const toFront = (key: string) => { setItems((l) => [l.find((x) => x.key === key)!, ...l.filter((x) => x.key !== key)]); void save(() => queueNext(key, taskId)); };
  const dropOn = (target: string) => {
    if (!drag || drag === target) return setDrag(null);
    const from = items.findIndex((x) => x.key === drag), to = items.findIndex((x) => x.key === target);
    const next = [...items]; const [m] = next.splice(from, 1); next.splice(to, 0, m);
    setItems(next); setDrag(null);
    void save(() => reorderQueue(next.map((x) => x.key), taskId));
  };
  const go = (x: { taskId: string | null; stepId?: string | null }) => { const h = hrefOf(x); if (h) router.push(h); };

  const now = queue.now;
  const here = !!now && !!taskId && now.taskId === taskId;
  const stop = async (e: MouseEvent) => {
    e.stopPropagation();
    if (!now?.runId || !onStop) return;
    setStopping(true); try { await onStop(now.runId); } finally { setStopping(false); }
  };
  return (
    <>
      {open ? (
        <div className="q-panel glass" role="region" aria-label="Kolejka Claude" onPointerDown={(e) => e.stopPropagation()}>
          {events.length ? (
            <div className="q-ev" role="log" aria-label="Co się stało">
              <div className="q-lbl"><span className="grow">Co się stało ({shown.length})</span>
                {shown.some((e) => !e.need) ? <button type="button" className="lnk" title="Chowa informacje; to, co czeka na Ciebie, zostaje do załatwienia" onClick={() => hide(shown.filter((e) => !e.need).map((e) => e.id))}>Wyczyść</button> : null}
              </div>
              {shown.length ? shown.map((e) => (
                <div key={e.id} className={"q-ev-row" + (e.need ? " need" : "")} title={e.text}>
                  <i className="q-ev-dot" aria-hidden="true" />
                  <span className="q-ev-tx">{e.text}</span>
                  <span className="q-ev-tm">{e.at}</span>
                  {canOpen(e) ? <button type="button" className="lnk" onClick={() => openEvent(e)}>Otwórz</button> : null}
                </div>
              )) : <div className="q-ev-row"><span className="q-ev-tx">Nic nowego</span></div>}
            </div>
          ) : null}
          <div className="q-lbl">{items.length ? `W kolejce (${items.length})` : "Kolejka jest pusta"}</div>
          {items.length ? (
            <ol className="q-ol">
              {items.map((it, i) => (
                <li key={it.key} className={"q-item" + (drag === it.key ? " dragging" : "") + (it.taskId === taskId ? " here" : "")} draggable={!busy}
                  onDragStart={(e) => { setDrag(it.key); e.dataTransfer.effectAllowed = "move"; }} onDragEnd={() => setDrag(null)} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); dropOn(it.key); }}>
                  <span className="q-grip" title="Przeciągnij, aby zmienić kolejność" aria-hidden="true">⋮⋮</span>
                  <span className="q-n">{i + 1}.</span>
                  <button type="button" className="q-row" onClick={() => go(it)} title={`Otwórz zadanie „${it.taskTitle}”`}>
                    <span className="q-t"><span className="q-tt">{it.taskTitle}</span>{it.taskId === taskId ? <span className="q-here">to zadanie</span> : null}</span>
                    <span className="q-s">{it.label}</span>
                    <span className="q-k">{it.kind}</span>
                  </button>
                  {i > 0 ? <button type="button" className="btn sm" disabled={busy} title="Przesuwa na pierwsze miejsce, po bieżącej pracy" onClick={() => toFront(it.key)}>Następne</button> : <span className="q-first">następne</span>}
                </li>
              ))}
            </ol>
          ) : null}
          {items.length > 1 ? <p className="q-foot">Kolejność ustawiona tutaj wygrywa z kolejnością, w jakiej Claude sam bierze pracę.</p> : null}
        </div>
      ) : null}
      {/* pigułka: jedyne miejsce z bieżącą pracą; klik rozwija kolejkę, nazwa innego zadania prowadzi do niego */}
      <div role="button" tabIndex={0} className={"q-ind glass" + (open ? " on" : "") + (now ? " live" : "")} aria-expanded={open} title={open ? "Zwiń kolejkę Claude" : "Pokaż kolejkę Claude"}
        onClick={toggle} onKeyDown={(e) => { if (e.target !== e.currentTarget) return; if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } }} onPointerDown={(e) => e.stopPropagation()}>
        {now ? <>
          <span className="dots" aria-hidden="true"><i /><i /><i /></span>
          <span className="q-ind-two">
            {here || !now.taskId ? <b>{here ? "W tym zadaniu" : now.taskTitle}</b>
              : <a className="q-ind-a" href={hrefOf(now) ?? undefined} title={`Otwórz zadanie „${now.taskTitle}”`} onClick={(e) => { e.preventDefault(); e.stopPropagation(); go(now); }}>{now.taskTitle}</a>}
            <span className="q-ind-sub"><span className="q-ind-w">Claude {now.what}</span>{min !== null && min >= 1 ? <span className="q-ind-m">· {min} min</span> : null}</span>
          </span>
          {now.stoppable && now.runId && onStop ? (
            <button type="button" className="btn ico q-stop" disabled={stopping} aria-label="Zatrzymaj" title="Przerywa bieżącą pracę Claude na Macu. Wróci za 10 minut albo od razu, gdy napiszesz." onClick={stop}><Icon k="stop" size={12} sw={1.6} /></button>
          ) : null}
        </> : <span className="q-ind-t"><b>Kolejka Claude</b></span>}
        {shown.length ? <span className={"q-new" + (need ? "" : " soft") + (ping ? " ping" : "")} title={need ? "Coś czeka na Ciebie: rozwiń listę „Co się stało”" : "Nowe informacje: rozwiń listę „Co się stało”"}>{shown.length} nowe</span> : null}
        <span className="q-badge" title="W kolejce">{items.length}</span>
        <Icon k="chev" size={12} sw={2} />
      </div>
    </>
  );
}
