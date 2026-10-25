"use client";
// Kolejka agenta (paczka 18, wariant A „Panel w rogu”): wskaźnik w lewym dolnym rogu, pod dymkami, rozwija nad sobą panel
// z pracą „Teraz” i pozycjami w kolejności, w jakiej Claude je weźmie. Przeciąganie i „Następne” zapisują kolejność, którą lista pracy agenta daje na początek.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { queueNext, reorderQueue } from "@/app/actions";
import type { AgentQueue, QueueEntry } from "@/lib/agent/work";
import { useMinutes } from "@/components/Activity";
import { Icon } from "./ui";

const OPEN_KEY = "th-queue-open";
const hrefOf = (x: { taskId: string | null; stepId?: string | null }) => (x.taskId ? `/tasks/${x.taskId}${x.stepId ? `?step=${x.stepId}` : ""}` : null);

export function QueuePanel({ queue, taskId = null, onToast }: { queue: AgentQueue; taskId?: string | null; onToast: (msg: string) => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<QueueEntry[]>(queue.items);
  const [drag, setDrag] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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
  return (
    <>
      {open ? (
        <div className="q-panel glass" role="region" aria-label="Kolejka Claude" onPointerDown={(e) => e.stopPropagation()}>
          {now ? (
            <div className="q-now">
              <div className="q-lbl"><span className="dots" aria-hidden="true"><i /><i /><i /></span>Teraz{min !== null && min >= 1 ? ` · od ${min} min` : ""}</div>
              <button type="button" className="q-row now" onClick={() => go(now)} disabled={!now.taskId}>
                <span className="q-t">{now.taskTitle}{now.taskId === taskId ? <span className="q-here">to zadanie</span> : null}</span>
                {now.label ? <span className="q-s">{now.label}</span> : null}
              </button>
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
      <button type="button" className={"q-ind glass" + (open ? " on" : "")} aria-expanded={open} title={open ? "Zwiń kolejkę Claude" : "Pokaż kolejkę Claude"} onClick={toggle} onPointerDown={(e) => e.stopPropagation()}>
        <span className={"dots" + (now ? "" : " still")} aria-hidden="true"><i /><i /><i /></span>
        <span className="q-ind-t">{now ? <><b>Claude:</b> {now.taskTitle}</> : <b>Kolejka Claude</b>}</span>
        <span className="q-ind-n">{now ? (items.length ? `w kolejce jeszcze ${items.length}` : "kolejka pusta") : `w kolejce ${items.length}`}</span>
        <Icon k="chev" size={12} sw={2} />
      </button>
    </>
  );
}
