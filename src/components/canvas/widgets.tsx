"use client";
// Drobne kontrolki kanwy: wybór priorytetu/projektu w menu, termin, dok czatu, pole nazwy, toast.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { LEVELS } from "@/lib/priority";
import { Icon, Lvl, projColor, type ProjectVM } from "./ui";

// ---------- menu wyboru przy przycisku ----------
export type PickOption = { key: string; node: ReactNode; on?: boolean };
export function Picker({ cls, trigger, options, onPick, title }: { cls: string; trigger: ReactNode; options: PickOption[]; onPick: (key: string) => void; title: string }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 });
  useEffect(() => {
    if (!open) return;
    const r = btn.current!.getBoundingClientRect();
    setPos({ left: Math.min(r.left, window.innerWidth - 230), top: r.bottom + 6 });
    const close = (e: Event) => { if (!(e.target as HTMLElement).closest?.(".ppmenu")) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", close); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", key); };
  }, [open]);
  return (
    <>
      <button ref={btn} type="button" className={"pp " + cls} aria-haspopup="listbox" aria-expanded={open} title={title} aria-label={title} onPointerDown={(e) => e.stopPropagation()} onClick={() => setOpen((o) => !o)}>
        {trigger}<Icon k="chev" size={10} sw={2.2} />
      </button>
      {open ? (
        <div className="ppmenu glass" role="listbox" aria-label={title} style={{ position: "fixed", left: pos.left, top: pos.top }} onPointerDown={(e) => e.stopPropagation()}>
          {options.map((o) => (
            <button key={o.key} type="button" role="option" aria-selected={!!o.on} className={"pp-opt" + (o.on ? " on" : "")} onClick={() => { setOpen(false); onPick(o.key); }}>
              {o.node}{o.on ? <span className="ck"><Icon k="check" size={14} sw={2.2} /></span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </>
  );
}

export function PrioPicker({ base, eff, why, cls, label, onPick }: { base: number; eff?: number; why?: string; cls: "head" | "btn" | "boxed"; label?: boolean; onPick: (level: number) => void }) {
  const e = eff ?? base;
  const title = e !== base ? `Priorytet ${base}/5, pokazany ${e}/5. Kliknij, aby zmienić` : `Priorytet ${base}/5: ${LEVELS[base]}`;
  return (
    <Picker cls={cls} title={title} onPick={(k) => onPick(Number(k))}
      trigger={cls === "btn" && !label ? <>Priorytet</> : <Lvl base={base} eff={e} why={why} label={label ?? cls !== "btn"} />}
      options={[5, 4, 3, 2, 1].map((l) => ({ key: String(l), on: l === base, node: <><span className="lv-n">{l}</span><Lvl base={l} eff={l} /><span>{LEVELS[l]}</span></> }))} />
  );
}

export function ProjectPicker({ projects, value, cls, onPick }: { projects: ProjectVM[]; value: string | null; cls: "btn" | "boxed"; onPick: (id: string | null) => void }) {
  const cur = projects.find((p) => p.id === value) ?? null;
  return (
    <Picker cls={cls} title="Projekt" onPick={(k) => onPick(k === "" ? null : k)}
      trigger={cls === "btn" ? <>Projekt</> : cur ? <><span className="pdot" style={{ ["--c" as string]: projColor(cur.color) }} />{cur.name}</> : <>Bez projektu</>}
      options={[{ key: "", on: !cur, node: <span>Bez projektu</span> }, ...projects.map((p) => ({ key: p.id, on: p.id === value, node: <><span className="pdot" style={{ ["--c" as string]: projColor(p.color) }} />{p.name}</> }))]} />
  );
}

export function InlineDate({ value, onChange, min }: { value: string | null; onChange: (v: string | null) => void; min?: string }) {
  return <input className="date-in" type="date" defaultValue={value ?? ""} min={min} aria-label="Termin zadania" onChange={(e) => onChange(e.currentTarget.value || null)} />;
}

// ---------- dok: jedno pole, rośnie do 6 linii, Enter wysyła ----------
function DockInner({ placeholder, busyText }: { placeholder: string; busyText: string }) {
  const { pending } = useFormStatus();
  const ta = useRef<HTMLTextAreaElement>(null);
  const grow = () => { const el = ta.current; if (!el) return; el.style.height = "34px"; el.style.height = Math.min(168, el.scrollHeight) + "px"; };
  useEffect(() => { if (!pending && ta.current) { ta.current.value = ""; grow(); } }, [pending]);
  return (
    <div className="dock-row">
      <textarea ref={ta} name="text" rows={1} placeholder={pending ? busyText : placeholder} aria-label="Wiadomość" disabled={pending} onInput={grow}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (e.currentTarget.value.trim()) e.currentTarget.form?.requestSubmit(); } }} />
      <button className="send" type="submit" aria-label="Wyślij" disabled={pending}><Icon k="send" size={14} sw={1.9} /></button>
    </div>
  );
}
export function Dock({ action, taskId, placeholder, busyText, context }: { action: (fd: FormData) => Promise<void>; taskId: string | null; placeholder: string; busyText: string; context?: ReactNode }) {
  // wysokość doku trafia do --dock-h, żeby pasek zaznaczenia, toast i karta odpowiedzi leżały nad nim
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const el = form.current; if (!el) return;
    const app = el.closest<HTMLElement>(".app");
    const set = () => app?.style.setProperty("--dock-h", el.offsetHeight + "px");
    set();
    const ro = new ResizeObserver(set); ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div className="dockwrap">
      <form ref={form} className="dock glass" action={action} autoComplete="off">
        <input type="hidden" name="taskId" value={taskId ?? ""} />
        {context ? <div className="ctxrow">{context}</div> : null}
        <DockInner placeholder={placeholder} busyText={busyText} />
      </form>
    </div>
  );
}

// ---------- pole nazwy nowego kafelka / grupy ----------
export function Namer({ label, placeholder, onSubmit, onClose }: { label: string; placeholder: string; onSubmit: (name: string) => void; onClose: () => void }) {
  return (
    <form className="namer glass" autoComplete="off" onPointerDown={(e) => e.stopPropagation()}
      onSubmit={(e) => { e.preventDefault(); const v = (new FormData(e.currentTarget).get("name") as string).trim(); if (v) onSubmit(v); }}>
      <input name="name" type="text" aria-label={label} placeholder={placeholder} autoFocus onKeyDown={(e) => { if (e.key === "Escape") onClose(); }} />
      <button className="btn primary" type="submit">Dodaj</button>
      <button className="icobtn" type="button" aria-label="Anuluj" onClick={onClose}><Icon k="x" size={12} sw={2} /></button>
    </form>
  );
}

// ---------- toast i wywołanie akcji z obsługą błędu ----------
export function useToast() {
  const [toast, setToast] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = (msg: string, ms = 2600) => { setToast(msg); if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => setToast(null), ms); };
  const run = async (fn: () => Promise<unknown>, ok?: string) => { try { await fn(); if (ok) show(ok); } catch (e) { show("Nie udało się: " + (e instanceof Error ? e.message : String(e)), 4000); } };
  return { toast, show, run };
}
export const Toast = ({ text }: { text: string | null }) => (text ? <div className="toast glass" role="status">{text}</div> : null);
