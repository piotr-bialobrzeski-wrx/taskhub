"use client";
// Drobne kontrolki kanwy: wybór priorytetu/projektu w menu, termin, dok czatu, pole nazwy, toast.
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { dayKey, fmtDateLong, fmtTime } from "@/lib/clock";
import { createPortal, useFormStatus } from "react-dom";
import { LEVELS } from "@/lib/priority";
import { loadChat, type ChatVM } from "@/app/actions";
import type { Queue } from "@/lib/auto";
import { workFoot, type FeedItem, type WorkBubble } from "@/lib/feed";
import { Activity, useMinutes } from "@/components/Activity";
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

// termin jest opcjonalny: puste pole mówi „Bez terminu” (samo <input type="date"> w Safari pokazuje wtedy dzisiejszą datę, jakby była ustawiona),
// klik otwiera kalendarz przeglądarki, × czyści termin
export function InlineDate({ value, onChange, min }: { value: string | null; onChange: (v: string | null) => void; min?: string }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const inp = useRef<HTMLInputElement>(null);
  const set = (nv: string | null) => { setV(nv); onChange(nv); };
  const open = () => {
    const e = inp.current; if (!e) return;
    try { e.showPicker(); } catch { e.focus(); }
  };
  return (
    <span className={"date-in" + (v ? "" : " empty")}>
      <button type="button" className="date-pick" aria-label={v ? "Zmień termin zadania" : "Ustaw termin zadania"} title="Najpóźniejsza data wykonania" onClick={open}>
        {v ? fmtDateLong(v + "T12:00") : "Bez terminu"}
      </button>
      {v ? <button type="button" className="date-clear" aria-label="Usuń termin" title="Bez terminu" onClick={() => set(null)}><Icon k="x" size={12} /></button> : null}
      <input ref={inp} type="date" tabIndex={-1} aria-hidden="true" value={v ?? ""} min={min} onChange={(e) => set(e.currentTarget.value || null)} />
    </span>
  );
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
// Każda wiadomość Piotra ma pod dymkiem linię stanu liczoną na bieżąco: czeka (kto ją weźmie i kiedy), w pracy (kropki i minuty), „Odpowiedź 12:52” (klik przewija do odpowiedzi).
// Przy kilku wiadomościach w kolejce jedna wspólna linia pod ostatnią, wcześniejsze dostają znacznik „w kolejce”.
type Msg = ChatVM;
const CHAT_PAGE = 50;   // tyle wpisów na stronę zwraca loadChat
// dni i godziny w czasie polskim (zegar w src/lib/clock), żeby „Dziś” i „11:26” zgadzały się z tym, co Piotr widzi na komputerze
const dayOf = (iso: string) => dayKey(iso);
const dayLabel = (iso: string) => {
  const now = new Date(), d = dayOf(iso);
  return d === dayKey(now) ? "Dziś" : d === dayKey(new Date(now.getTime() - 864e5)) ? "Wczoraj" : fmtDateLong(iso);
};
const timeOf = (iso: string) => fmtTime(iso);

// zamykanie: X u góry, ikona w doku (ta sama, która otworzyła), klik obok kolumny, Esc.
// version: zmienia się, gdy serwer ma nową odpowiedź albo inny stan kolejki (puls strony) → historia dociąga najnowsze wpisy bez zamykania
export function ChatHistory({ taskId, title, onClose, queue = null, version = "" }: { taskId: string | null; title: string; onClose: () => void; queue?: Queue | null; version?: string }) {
  const [msgs, setMsgs] = useState<Msg[] | null>(null);
  const [q, setQ] = useState<Queue | null>(queue);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  // przewinięcie po wczytaniu: na sam dół (pierwsze otwarcie) albo tak, żeby starsze wpisy nie przesunęły tego, co było widać;
  // ustawiane w useLayoutEffect, zanim przeglądarka pokaże nową listę (requestAnimationFrame bywało za późno i historia otwierała się na górze)
  const pend = useRef<{ keep: number | null } | null>(null);
  useLayoutEffect(() => {
    const p = pend.current, e = list.current; if (!p || !e) return;
    pend.current = null;
    e.scrollTop = p.keep != null ? e.scrollHeight - p.keep : e.scrollHeight;
  }, [msgs]);
  const load = async (before: string | null) => {
    setBusy(true);
    try {
      const el = list.current, keep = before && el ? el.scrollHeight - el.scrollTop : null;
      const r = await loadChat(taskId, before);
      pend.current = { keep };
      setMsgs((m) => (before ? [...r.msgs, ...(m ?? [])] : r.msgs)); setMore(r.msgs.length >= CHAT_PAGE); setQ(r.queue);
    } finally { setBusy(false); }
  };
  // nowe wpisy bez zamykania historii: najnowsza strona zastępuje końcówkę listy; przewinięcie zostaje, chyba że Piotr był na dole
  const refresh = async () => {
    const el = list.current;
    const atBottom = !el || el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    const keep = el && !atBottom ? el.scrollHeight - el.scrollTop : null;
    const r = await loadChat(taskId, null);
    pend.current = { keep };
    setMsgs((m) => { const first = r.msgs[0]?.createdAt ?? ""; return [...(m ?? []).filter((x) => x.createdAt < first), ...r.msgs]; }); setQ(r.queue);
  };
  const first = useRef(true);
  useEffect(() => { void load(null); }, [taskId]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (first.current) { first.current = false; return; } void refresh(); }, [version]);   // eslint-disable-line react-hooks/exhaustive-deps
  const flash = (id: string) => { const el = document.getElementById("hm-" + id); if (!el) return; el.scrollIntoView({ block: "center", behavior: "smooth" }); el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash"); };
  // odpowiedź na wiadomość Piotra: ta, która ją wymienia w swoich answers, inaczej pierwsza odpowiedź agenta po chwili załatwienia
  const answerOf = (m: Msg, all: Msg[]) => all.find((a) => a.role === "agent" && a.answers?.includes(m.id)) ?? (m.answeredAt ? all.find((a) => a.role === "agent" && a.createdAt >= m.answeredAt!) ?? null : null);
  const stateLine = (m: Msg, all: Msg[], lastPending: string | null) => {
    if (m.role !== "user") return null;
    if (m.withdrawn) return <span className="hm-s">Wycofana z kolejki {timeOf(m.answeredAt!)}</span>;
    if (m.answeredAt) {
      const a = answerOf(m, all);
      return a ? <button type="button" className="hm-s ok" onClick={() => flash(a.id)} title="Pokaż odpowiedź">Odpowiedź {timeOf(a.createdAt)}</button> : <span className="hm-s ok">Odpowiedź {timeOf(m.answeredAt)}</span>;
    }
    if (m.id !== lastPending) return <span className="hm-s wait"><i className="pulse" aria-hidden="true" />w kolejce</span>;
    if (!q) return <span className="hm-s wait"><i className="pulse" aria-hidden="true" />Czeka na odpowiedź</span>;
    const label = q.n === 1 ? q.short : q.text;
    return q.activity ? <span className="hm-s wait"><Activity text={q.activity.text} detail={q.activity.detail} since={q.activity.since} who={label + " ·"} /></span> : <span className="hm-s wait"><i className="pulse" aria-hidden="true" />{label}</span>;
  };
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
                {(() => { const pendingIds = msgs.filter((m) => m.role === "user" && !m.answeredAt).map((m) => m.id); const lastPending = pendingIds[pendingIds.length - 1] ?? null; return msgs.map((m, i) => (
                  <Fragment key={m.id}>
                    {i === 0 || dayOf(m.createdAt) !== dayOf(msgs[i - 1].createdAt) ? <div className="hm-day">{dayLabel(m.createdAt)}</div> : null}
                    <div id={"hm-" + m.id} className={"hm " + m.role + (m.role === "user" && !m.answeredAt ? " q" : "")}>
                      <div className="hm-b">{m.text}{m.why ? <span className="hm-why">{m.why}</span> : null}</div>
                      <span className="hm-t">{m.role === "agent" ? "Claude · " : ""}{timeOf(m.createdAt)}</span>
                      {stateLine(m, msgs, lastPending)}
                    </div>
                  </Fragment>
                )); })()}
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
export function Dock({ action, taskId, stepId = null, placeholder, busyText, context, historyTitle, queue = null, version = "" }: { action: (fd: FormData) => Promise<void>; taskId: string | null; stepId?: string | null; placeholder: string; busyText: string; context?: ReactNode; historyTitle?: string; queue?: Queue | null; version?: string }) {
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
      {hist ? <ChatHistory taskId={taskId} title={historyTitle ?? (taskId ? "Rozmowa w tym zadaniu" : "Rozmowa o wszystkich zadaniach")} onClose={() => setHist(false)} queue={queue} version={version} /> : null}
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

// ---------- menu „⋮” w nagłówku karty (paczka 15, punkt 10): rzadkie akcje schowane, wyrównane do prawej; akcja z pytaniem pyta w tym samym dymku ----------
export type MoreItem = { label: string; danger?: boolean; confirm?: string; yes?: string; onPick: () => void };
export function MoreMenu({ label, items }: { label: string; items: MoreItem[] }) {
  const [open, setOpen] = useState(false);
  const [ask, setAsk] = useState<MoreItem | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  useEffect(() => {
    if (!open) { setAsk(null); return; }
    const r = btn.current!.getBoundingClientRect();
    setPos({ left: Math.max(8, Math.min(r.right - 220, window.innerWidth - 228)), top: r.bottom + 6 });
    const close = (e: Event) => { if (!(e.target as HTMLElement).closest?.(".ppmenu") && !btn.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", close); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", key); };
  }, [open]);
  return (
    <>
      <button ref={btn} className="icobtn" type="button" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}><Icon k="more" size={14} sw={2.6} /></button>
      {open ? createPortal(
        ask ? (
          <div className="ppmenu glass pop" role="dialog" aria-label={ask.label} style={{ position: "fixed", left: pos.left, top: pos.top, width: 220 }} onPointerDown={(e) => e.stopPropagation()}>
            <span className="sub">{ask.confirm}</span>
            <div className="row" style={{ gap: "var(--s-2)", justifyContent: "flex-end" }}>
              <button className="btn" type="button" onClick={() => setOpen(false)}>Anuluj</button>
              <button className="btn danger" type="button" onClick={() => { setOpen(false); ask.onPick(); }}>{ask.yes ?? "Tak"}</button>
            </div>
          </div>
        ) : (
          <div className="ppmenu glass tmenu" role="menu" style={{ position: "fixed", left: pos.left, top: pos.top, minWidth: 180 }} onPointerDown={(e) => e.stopPropagation()}>
            {items.map((it, i) => <button key={i} type="button" role="menuitem" className={"pp-opt" + (it.danger ? " danger" : "")} onClick={() => { if (it.confirm) setAsk(it); else { setOpen(false); it.onPick(); } }}>{it.label}</button>)}
          </div>
        ), document.body) : null}
    </>
  );
}

// ---------- menu kafelka na prawy klik: te same akcje co pasek zaznaczenia, w miejscu kliknięcia (paczka 2, punkt 2) ----------
export type MenuItem = { label: string; danger?: boolean; onPick: () => void };
export function TileMenu({ at, items, onClose }: { at: { x: number; y: number }; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: at.x, top: at.y });
  useEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    const w = r?.width ?? 200, h = r?.height ?? 220;
    setPos({ left: Math.max(8, Math.min(at.x, window.innerWidth - w - 8)), top: Math.max(8, Math.min(at.y, window.innerHeight - h - 8)) });
    const close = (e: Event) => { if (!(e.target as HTMLElement).closest?.(".tmenu")) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("pointerdown", close); document.addEventListener("keydown", key); window.addEventListener("resize", onClose);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", key); window.removeEventListener("resize", onClose); };
  }, [at, onClose]);
  return createPortal(
    <div ref={ref} className="ppmenu glass tmenu" role="menu" style={{ position: "fixed", left: pos.left, top: pos.top }} onPointerDown={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}>
      {items.map((it, i) => <button key={i} type="button" role="menuitem" className={"pp-opt" + (it.danger ? " danger" : "")} onClick={() => { onClose(); it.onPick(); }}>{it.label}</button>)}
    </div>, document.body);
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

// Dymki agenta w lewym dolnym rogu: najnowszy na samym dole, starsze wyżej; każdy zamyka się X (zapamiętane w tej przeglądarce)
// work: dymek pracy (ostatni, nad polem czatu): Claude pracuje nad tym zadaniem albo wysłana wiadomość czeka; onStop: „Zatrzymaj” bieg pracy v2
// queue: wskaźnik kolejki agenta pod dymkami (paczka 18); onQueueNext / onWithdraw: „Następne” i „Wycofaj” w dymku wiadomości czekającej w kolejce
export function AgentFeed({ items, work = null, onStop, stepLabel, onStep, queue = null, onQueueNext, onWithdraw, className = "", style }: {
  items: FeedItem[]; work?: WorkBubble | null; onStop?: (runId: string) => Promise<unknown> | void; stepLabel?: (stepId: string) => string | null; onStep?: (stepId: string) => void;
  queue?: ReactNode; onQueueNext?: (key: string) => Promise<unknown> | void; onWithdraw?: () => Promise<unknown> | void; className?: string; style?: React.CSSProperties;
}) {
  const KEY = "th-feed-off";
  const [off, setOff] = useState<Set<string> | null>(null);   // null do montażu: serwer nie zna zamkniętych, więc nic nie miga
  useEffect(() => { try { setOff(new Set(JSON.parse(localStorage.getItem(KEY) ?? "[]") as string[])); } catch { setOff(new Set()); } }, []);
  const close = (id: string) => setOff((s) => {
    const n = new Set(s); n.add(id);
    try { localStorage.setItem(KEY, JSON.stringify([...n].slice(-100))); } catch { /* brak storage */ }
    return n;
  });
  const shown = off ? items.filter((m) => !off.has(m.id)) : [];
  // dymek „wysłane” zamyka się jak odpowiedź (klucz po wiadomości); dymek „Claude pracuje” nie ma X, znika z końcem pracy
  const card = work && off && !(work.kind === "sent" && off.has("w:" + work.id)) ? work : null;
  if (!shown.length && !card && !queue) return null;
  return (
    <div className={"feed " + className} style={style} role="log" aria-live="polite" aria-label="Odpowiedzi Claude">
      {shown.map((m) => {
        const step = m.stepId && stepLabel ? stepLabel(m.stepId) : null;
        // paczka 15: bez „Otwórz wynik” (wynik jest na karcie kroku); inne kroki dotknięte w tym biegu jako małe przyciski z numerem
        const more = stepLabel && onStep ? m.steps.map((id) => ({ id, label: stepLabel(id) })).filter((x): x is { id: string; label: string } => !!x.label) : [];
        return (
          <div key={m.id} className="fb glass">
            <div className="ans-text">{m.text}</div>
            {/* jeden rząd na dole: przyciski z lewej, godzina z prawej */}
            <div className="ans-row">
              {step && onStep ? <button className="btn" type="button" onClick={() => onStep(m.stepId!)}>Otwórz krok {step}</button> : null}
              {more.map((x) => <button key={x.id} className="btn sm" type="button" title={`Otwórz krok ${x.label}`} onClick={() => onStep!(x.id)}>{x.label}</button>)}
              <span className="ans-t">Claude · {m.at}</span>
            </div>
            <button className="icobtn ans-x" type="button" aria-label="Zamknij odpowiedź" title="Zamknij" onClick={() => close(m.id)}><Icon k="x" size={12} sw={2} /></button>
          </div>
        );
      })}
      {card ? <WorkCard b={card} onStop={onStop} onStep={onStep} onQueueNext={onQueueNext} onWithdraw={onWithdraw} onClose={() => { if (card.kind === "sent") close("w:" + card.id); }} /> : null}
      {queue}
    </div>
  );
}
// dymek pracy: „wysłane” (kropka, tytuł, cytat, „Ty · 19:41”, X) albo „Claude pracuje” (kropki, minuty, „Zatrzymaj”, cytat, co teraz, chipy kroków)
function WorkCard({ b, onStop, onStep, onQueueNext, onWithdraw, onClose }: { b: WorkBubble; onStop?: (runId: string) => Promise<unknown> | void; onStep?: (stepId: string) => void; onQueueNext?: (key: string) => Promise<unknown> | void; onWithdraw?: () => Promise<unknown> | void; onClose: () => void }) {
  const min = useMinutes(b.kind === "working" ? b.since : "");
  const [busy, setBusy] = useState(false);
  const act = async (fn?: () => Promise<unknown> | void) => { if (!fn) return; setBusy(true); try { await fn(); } finally { setBusy(false); } };
  // paczka 18: wiadomość czeka w kolejce agenta: „W kolejce: 2. z 4”, cytat, kto teraz pracuje (link), „Następne” i „Wycofaj”
  if (b.kind === "sent" && b.queue) {
    const q = b.queue;
    return (
      <div className="fb glass work wait">
        <div className="wk-h"><span className="dots still" aria-hidden="true"><i /><i /><i /></span><span className="wk-t">{b.title}</span></div>
        <div className="wk-q">{b.quote}</div>
        {q.nowTask ? <div className="wk-line">Claude kończy zadanie <a href={`/tasks/${q.nowTask.id}`}>„{q.nowTask.title}”</a></div> : null}
        <div className="ans-row">
          {q.pos > 1 && onQueueNext ? <button className="btn sm" type="button" disabled={busy} title="Przesuwa na pierwsze miejsce, po bieżącej pracy" onClick={() => act(() => onQueueNext(q.key))}>Następne</button> : <span className="q-first">następne w kolejce</span>}
          {onWithdraw ? <button className="btn sm" type="button" disabled={busy} title="Zabiera wiadomość z kolejki; zostaje w historii rozmowy" onClick={() => act(onWithdraw)}>Wycofaj</button> : null}
          <span className="ans-t">Ty · {b.at}</span>
        </div>
      </div>
    );
  }
  if (b.kind === "sent") return (
    <div className="fb glass work sent">
      <div className="wk-h"><i className="wk-dot" aria-hidden="true" />{b.title}</div>
      {b.line ? <div className="wk-line">{b.line}</div> : null}
      <div className="wk-q">{b.quote}</div>
      <div className="ans-row"><span className="ans-t">Ty · {b.at}</span></div>
      <button className="icobtn ans-x" type="button" aria-label="Zamknij" title="Zamknij" onClick={onClose}><Icon k="x" size={12} sw={2} /></button>
    </div>
  );
  return (
    <div className="fb glass work on">
      {/* paczka 15: bez stopki z urządzeniem i godziną (zostaje w podpowiedzi); „Zatrzymaj” w rzędzie nagłówka, po prawej */}
      <div className="wk-h" title={workFoot(b)}>
        <span className="dots" aria-hidden="true"><i /><i /><i /></span><span className="wk-t">Claude pracuje w tym zadaniu</span>{min !== null && min >= 1 ? <span className="act-m">{min} min</span> : null}
        {b.stoppable && onStop ? (
          <button className="btn sm ico" type="button" disabled={busy} title="Przerywa bieżącą pracę Claude na Macu. Wróci za 10 minut albo od razu, gdy napiszesz."
            onClick={async () => { setBusy(true); try { await onStop(b.runId); } finally { setBusy(false); } }}><Icon k="stop" size={12} sw={1.6} />{busy ? "Zatrzymuję…" : "Zatrzymaj"}</button>
        ) : null}
      </div>
      {b.quote ? <div className="wk-q">{b.quote}</div> : null}
      <div className="wk-now" aria-live="off">Teraz: {b.now}{b.detail ? <span className="act-d"> · {b.detail}</span> : null}</div>
      {b.chips.length ? (
        <div className="wk-chips">
          <span className="lbl">W tej pracy:</span>
          {b.chips.map((c) => <button key={c.id} type="button" className={"chip" + (c.now ? " now" : "")} title={`Otwórz krok ${c.label}`} onClick={() => onStep?.(c.id)}>{c.now ? <i className="d" style={{ ["--c" as string]: "var(--t-claude)" }} /> : null}<span>Krok {c.label}</span></button>)}
          {b.more ? <span className="chip">+{b.more}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
