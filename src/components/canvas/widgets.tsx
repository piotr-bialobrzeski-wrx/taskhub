"use client";
// Drobne kontrolki kanwy: wybór priorytetu/projektu w menu, termin, dok czatu, pole nazwy, toast.
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal, useFormStatus } from "react-dom";
import { LEVELS } from "@/lib/priority";
import { loadChat } from "@/app/actions";
import { Icon, Lvl, projColor, type ProjectVM } from "./ui";

// ---------- menu wyboru przy przycisku ----------
export type PickOption = { key: string; node: ReactNode; on?: boolean };
export function Picker({ cls, menuCls, trigger, options, onPick, title }: { cls: string; menuCls?: string; trigger: ReactNode; options: PickOption[]; onPick: (key: string) => void; title: string }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; width: number }>({ left: 0, top: 0, width: 0 });
  useEffect(() => {
    if (!open) return;
    const r = btn.current!.getBoundingClientRect();
    setPos({ left: Math.min(r.left, window.innerWidth - Math.max(r.width, 160) - 16), top: r.bottom + 6, width: r.width });
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
      {open ? createPortal(
        // w portalu: panel szczegółów ma backdrop-filter, więc byłby blokiem zawierającym dla position: fixed
        <div className={"ppmenu glass" + (menuCls ? " " + menuCls : "")} role="listbox" aria-label={title} style={{ position: "fixed", left: pos.left, top: pos.top, minWidth: menuCls ? undefined : pos.width }} onPointerDown={(e) => e.stopPropagation()}>
          {options.map((o) => (
            <button key={o.key} type="button" role="option" aria-selected={!!o.on} className={"pp-opt" + (o.on ? " on" : "")} onClick={() => { setOpen(false); onPick(o.key); }}>
              {o.node}{o.on ? <span className="ck"><Icon k="check" size={12} sw={2.2} /></span> : null}
            </button>
          ))}
        </div>, document.body) : null}
    </>
  );
}

export function PrioPicker({ base, eff, why, cls, label, onPick }: { base: number; eff?: number; why?: string; cls: "head" | "btn" | "boxed"; label?: boolean; onPick: (level: number) => void }) {
  const e = eff ?? base;
  const title = e !== base ? `Priorytet ${base}/5, pokazany ${e}/5. Kliknij, aby zmienić` : `Priorytet ${base}/5: ${LEVELS[base]}`;
  return (
    <Picker cls={cls} title={title} onPick={(k) => onPick(Number(k))}
      trigger={cls === "btn" && !label ? <>Priorytet</> : <Lvl base={base} eff={e} why={why} label={label ?? cls !== "btn"} />}
      options={[5, 4, 3, 2, 1].map((l) => ({ key: String(l), on: l === base, node: <Lvl base={l} eff={l} label /> }))} />
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

// ---------- dok: jedno pole, rośnie do 6 linii, Enter wysyła; załączniki z dysku, ze schowka (Ctrl+V) i przeciągnięte ----------
const MAX_FILE = 4 * 1024 * 1024;   // limit treści żądania na Vercelu (4,5 MB)
type Att = { key: string; file: File; preview: string | null };
const extOf = (name: string) => (name.includes(".") ? name.split(".").pop()!.slice(0, 4).toUpperCase() : "PLIK");

// duże grafiki (zrzuty ekranu bywają po kilka MB) zmniejszamy w przeglądarce: mieszczą się w limicie i są tańsze dla agenta
async function shrinkImage(file: File): Promise<File> {
  if (!/^image\/(png|jpeg|webp|bmp|tiff)$/.test(file.type) || file.size < 700_000) return file;
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
    const cv = document.createElement("canvas"); cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
    cv.getContext("2d")!.drawImage(bmp, 0, 0, cv.width, cv.height); bmp.close();
    let blob = await new Promise<Blob | null>((res) => cv.toBlob(res, "image/webp", 0.86));
    if (!blob || blob.type !== "image/webp") blob = await new Promise<Blob | null>((res) => cv.toBlob(res, "image/jpeg", 0.88));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[a-z0-9]+$/i, "") + (blob.type === "image/webp" ? ".webp" : ".jpg"), { type: blob.type });
  } catch { return file; }
}

// ---------- historia rozmowy: szkło nad kanwą, dok zostaje widoczny i działa; wpisy dosunięte do dołu (najnowsze przy polu), starsze wyżej ----------
type Msg = { id: string; role: "user" | "agent"; text: string; createdAt: string };
const CHAT_PAGE = 50;   // tyle wpisów na stronę zwraca loadChat
const dayOf = (iso: string) => new Date(iso).toLocaleDateString("pl-PL", { day: "numeric", month: "long", year: "numeric" });
const dayLabel = (iso: string) => {
  const d = new Date(iso), t = new Date(); const y = new Date(t); y.setDate(t.getDate() - 1);
  return d.toDateString() === t.toDateString() ? "Dziś" : d.toDateString() === y.toDateString() ? "Wczoraj" : dayOf(iso);
};
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });

// zamykanie: X u góry, ikona w doku (ta sama, która otworzyła), klik obok kolumny, Esc
export function ChatHistory({ taskId, title, onClose }: { taskId: string | null; title: string; onClose: () => void }) {
  const [msgs, setMsgs] = useState<Msg[] | null>(null);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const load = async (before: string | null) => {
    setBusy(true);
    try {
      const el = list.current, keep = el ? el.scrollHeight - el.scrollTop : 0;
      const r = await loadChat(taskId, before); setMsgs((m) => (before ? [...r, ...(m ?? [])] : r)); setMore(r.length >= CHAT_PAGE);
      requestAnimationFrame(() => { const e = list.current; if (!e) return; e.scrollTop = before ? e.scrollHeight - keep : e.scrollHeight; });
    } finally { setBusy(false); }
  };
  useEffect(() => { void load(null); }, [taskId]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; document.addEventListener("keydown", key); return () => document.removeEventListener("keydown", key); }, [onClose]);
  return (
    <div className="hist glass" role="dialog" aria-label={title} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="hist-col">
        <div className="hist-h"><b>{title}</b><span className="sp" /><button className="icobtn" type="button" aria-label="Zamknij historię" title="Zamknij (Esc)" onClick={onClose}><Icon k="x" size={13} sw={2} /></button></div>
        <div ref={list} className="hist-b">
          <div className="hist-list">
            {msgs === null ? <p className="sub" style={{ textAlign: "center" }}>Wczytuję…</p> : !msgs.length ? <p className="sub" style={{ textAlign: "center" }}>Jeszcze nie było tu rozmowy.</p> : (
              <>
                {more ? <button className="btn" type="button" style={{ alignSelf: "center" }} disabled={busy} onClick={() => load(msgs[0].createdAt)}>{busy ? "Wczytuję…" : "Starsze wpisy"}</button> : null}
                {msgs.map((m, i) => (
                  <Fragment key={m.id}>
                    {i === 0 || dayOf(m.createdAt) !== dayOf(msgs[i - 1].createdAt) ? <div className="hm-day">{dayLabel(m.createdAt)}</div> : null}
                    <div className={"hm " + m.role}><div className="hm-b">{m.text}</div><span className="hm-t">{m.role === "agent" ? "Claude · " : ""}{timeOf(m.createdAt)}</span></div>
                  </Fragment>
                ))}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function DockInner({ placeholder, busyText, atts, err, onFiles, onRemove, onDone, hist, onHistory }: { placeholder: string; busyText: string; atts: Att[]; err: string | null; onFiles: (files: File[]) => void; onRemove: (key: string) => void; onDone: () => void; hist: boolean; onHistory: () => void }) {
  const { pending } = useFormStatus();
  const ta = useRef<HTMLTextAreaElement>(null);
  const pick = useRef<HTMLInputElement>(null);
  const grow = () => { const el = ta.current; if (!el) return; el.style.height = "34px"; el.style.height = Math.min(168, el.scrollHeight) + "px"; };
  useEffect(() => { if (!pending && ta.current) { ta.current.value = ""; grow(); onDone(); } }, [pending]);   // eslint-disable-line react-hooks/exhaustive-deps
  const canSend = () => !!ta.current?.value.trim() || atts.length > 0;
  return (
    <>
      {atts.length ? (
        <div className="att">{atts.map((a) => (
          <span key={a.key} className="att-item" title={a.file.name}>
            {a.preview ? <img src={a.preview} alt="" /> : <span className="ph">{extOf(a.file.name)}</span>}<span>{a.file.name}</span>
            <button type="button" aria-label={"Usuń " + a.file.name} onClick={() => onRemove(a.key)}><Icon k="x" size={10} sw={2.2} /></button>
          </span>
        ))}</div>
      ) : null}
      {err ? <div className="att-err">{err}</div> : null}
      <div className="dock-row">
        <button className="icobtn" type="button" aria-label="Dodaj plik lub grafikę" title="Dodaj plik lub grafikę (albo wklej Ctrl+V / przeciągnij tutaj)" disabled={pending} onClick={() => pick.current?.click()}><Icon k="clip" size={15} sw={1.7} /></button>
        <input ref={pick} type="file" multiple onChange={(e) => { onFiles([...(e.currentTarget.files ?? [])]); e.currentTarget.value = ""; }} />
        <textarea ref={ta} name="text" rows={1} placeholder={pending ? busyText : placeholder} aria-label="Wiadomość" disabled={pending} onInput={grow}
          onPaste={(e) => { const files = [...e.clipboardData.files]; if (!files.length) return; if (!e.clipboardData.getData("text/plain")) e.preventDefault(); onFiles(files); }}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (canSend()) e.currentTarget.form?.requestSubmit(); } }} />
        <button className={"icobtn" + (hist ? " on" : "")} type="button" aria-label={hist ? "Zamknij historię" : "Historia rozmowy"} title={hist ? "Zamknij historię" : "Historia rozmowy"} aria-pressed={hist} onClick={onHistory}><Icon k={hist ? "x" : "history"} size={hist ? 13 : 15} sw={hist ? 2 : 1.7} /></button>
        <button className="send" type="submit" aria-label="Wyślij" disabled={pending}><Icon k="send" size={14} sw={1.9} /></button>
      </div>
    </>
  );
}
export function Dock({ action, taskId, stepId = null, placeholder, busyText, context, historyTitle }: { action: (fd: FormData) => Promise<void>; taskId: string | null; stepId?: string | null; placeholder: string; busyText: string; context?: ReactNode; historyTitle?: string }) {
  const form = useRef<HTMLFormElement>(null);
  const [hist, setHist] = useState(false);
  const filesIn = useRef<HTMLInputElement>(null);
  const [atts, setAtts] = useState<Att[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  // wysokość doku trafia do --dock-h, żeby pasek zaznaczenia, toast i karta odpowiedzi leżały nad nim
  useEffect(() => {
    const el = form.current; if (!el) return;
    const app = el.closest<HTMLElement>(".app");
    const set = () => app?.style.setProperty("--dock-h", el.offsetHeight + "px");
    set();
    const ro = new ResizeObserver(set); ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // ukryte pole formularza dostaje aktualną listę plików; tak trafiają do akcji serwera razem z tekstem
  useEffect(() => { const dt = new DataTransfer(); atts.forEach((a) => dt.items.add(a.file)); if (filesIn.current) filesIn.current.files = dt.files; }, [atts]);
  useEffect(() => { if (!err) return; const t = setTimeout(() => setErr(null), 4500); return () => clearTimeout(t); }, [err]);
  const addFiles = async (files: File[]) => {
    const out: Att[] = [];
    for (const f0 of files.slice(0, 8)) {
      const f = await shrinkImage(f0);
      if (f.size > MAX_FILE) { setErr(`„${f.name}” jest za duży (maks. 4 MB).`); continue; }
      out.push({ key: crypto.randomUUID(), file: f, preview: f.type.startsWith("image/") ? URL.createObjectURL(f) : null });
    }
    if (out.length) setAtts((prev) => [...prev, ...out].slice(0, 8));
  };
  const remove = (key: string) => setAtts((prev) => { prev.filter((a) => a.key === key).forEach((a) => { if (a.preview) URL.revokeObjectURL(a.preview); }); return prev.filter((a) => a.key !== key); });
  const clear = () => setAtts((prev) => { if (!prev.length) return prev; prev.forEach((a) => { if (a.preview) URL.revokeObjectURL(a.preview); }); return []; });
  // historia jest rodzeństwem formularza w tym samym kontekście warstw: szkło pod dokiem, dok nad nim (pole dalej działa)
  return (
    <div className={"dockwrap" + (hist ? " hist-on" : "")}>
      {hist ? <ChatHistory taskId={taskId} title={historyTitle ?? (taskId ? "Rozmowa w tym zadaniu" : "Rozmowa o wszystkich zadaniach")} onClose={() => setHist(false)} /> : null}
      <form ref={form} className={"dock glass" + (over ? " drop" : "")} action={action} autoComplete="off"
        onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setOver(true); } }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); void addFiles([...e.dataTransfer.files]); }}>
        <input type="hidden" name="taskId" value={taskId ?? ""} /><input type="hidden" name="stepId" value={stepId ?? ""} />
        <input ref={filesIn} type="file" name="files" multiple tabIndex={-1} aria-hidden="true" />
        {context ? <div className="ctxrow">{context}</div> : null}
        <DockInner placeholder={placeholder} busyText={busyText} atts={atts} err={err} onFiles={(f) => void addFiles(f)} onRemove={remove} onDone={clear} hist={hist} onHistory={() => setHist((h) => !h)} />
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

// ---------- usuwanie z pytaniem w dymku pod ikoną kosza (wiersz się nie rozjeżdża, bez okna systemowego) ----------
// potwierdzenie usunięcia w dymku pod ikoną kosza (portal: lista ma własny scroll)
export function RemovePop({ label, question, onYes }: { label: string; question: string; onYes: () => void }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  useEffect(() => {
    if (!open) return;
    const r = btn.current!.getBoundingClientRect();
    setPos({ left: Math.min(r.right - 260, window.innerWidth - 276), top: r.bottom + 6 });
    const close = (e: Event) => { if (!(e.target as HTMLElement).closest?.(".ppmenu")) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", close); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", key); };
  }, [open]);
  return (
    <>
      <button ref={btn} className="icobtn" type="button" aria-label={label} title={label} aria-expanded={open} onClick={() => setOpen((o) => !o)}><Icon k="trash" size={14} sw={1.7} /></button>
      {open ? createPortal(
        <div className="ppmenu glass pop" role="dialog" aria-label={label} style={{ position: "fixed", left: pos.left, top: pos.top, width: 260 }} onPointerDown={(e) => e.stopPropagation()}>
          <span className="sub">{question}</span>
          <div className="row" style={{ gap: "var(--s-2)", justifyContent: "flex-end" }}>
            <button className="btn" type="button" onClick={() => setOpen(false)}>Anuluj</button>
            <button className="btn danger" type="button" onClick={() => { setOpen(false); onYes(); }}>Tak, usuń</button>
          </div>
        </div>, document.body) : null}
    </>
  );
}

// ---------- nazwa w wierszu: klik → pole w tym samym miejscu (Enter zapisuje, Esc cofa) ----------
export function InlineName({ name, label, onRename }: { name: string; label: string; onRename: (n: string) => void }) {
  const [edit, setEdit] = useState(false);
  if (!edit) return <button type="button" className="a-title p-name" title="Kliknij, aby zmienić nazwę" onClick={() => setEdit(true)}><span className="ct">{name}</span><Icon k="pen" size={12} sw={1.8} /></button>;
  const done = (v: string) => { setEdit(false); const n = v.trim(); if (n && n !== name) onRename(n); };
  // pole zajmuje dokładnie miejsce nazwy (ta sama szerokość i wysokość), więc reszta nagłówka stoi w miejscu
  return (
    <span className="a-title p-name edit">
      <input className="p-input" defaultValue={name} aria-label={label} autoFocus onFocus={(e) => e.currentTarget.select()}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); done(e.currentTarget.value); } else if (e.key === "Escape") { e.preventDefault(); setEdit(false); } }}
        onBlur={(e) => done(e.currentTarget.value)} />
    </span>
  );
}
