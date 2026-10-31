"use client";
// Kolejka agenta (paczka 18, wariant A „Panel w rogu”): wskaźnik w lewym dolnym rogu, pod dymkami, rozwija nad sobą panel
// z pozycjami w kolejności, w jakiej Claude je weźmie. Paczka 31 (wariant A „Jedna pigułka”): bieżącą pracę pokazuje tylko pigułka
// (gdzie, co robi, od ilu minut, „Zatrzymaj”, liczba w kolejce); panel nie ma już sekcji „Teraz”, a dymek pracy w zadaniu zniknął. Przeciąganie i „Następne” zapisują kolejność, którą lista pracy agenta daje na początek.
import { useEffect, useState, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import { queueNext, reorderQueue } from "@/app/actions";
import type { AgentQueue, QueueEntry } from "@/lib/agent/work";
import { useMinutes } from "@/components/Activity";
import { Icon } from "./ui";

const OPEN_KEY = "th-queue-open";
const hrefOf = (x: { taskId: string | null; stepId?: string | null }) => (x.taskId ? `/tasks/${x.taskId}${x.stepId ? `?step=${x.stepId}` : ""}` : null);

export function QueuePanel({ queue, taskId = null, onToast, onStop }: { queue: AgentQueue; taskId?: string | null; onToast: (msg: string) => void; onStop?: (runId: string) => Promise<unknown> | void }) {
  const router = useRouter();
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
  if (!queue.now && !items.length) return null;

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
        <span className="q-badge" title="W kolejce">{items.length}</span>
        <Icon k="chev" size={12} sw={2} />
      </div>
    </>
  );
}
