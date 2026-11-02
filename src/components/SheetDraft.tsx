"use client";
// Paczka 42: arkusz szkicu do edycji w miejscu (wariant C „Wpisy czasu”, jeden szkic na dzień). Uniwersalny klocek: rodzaje kolumn i słowniki
// (projekty, kategorie, tagi) przynosi agent z aplikacji docelowej w polu sheet szkicu, więc nic tu nie zna Pirxey Time.
// Klik w komórkę zamienia ją w pole (tekst, godzina, czas trwania) albo otwiera listę (wybór z wyszukiwarką i „Ostatnio używane”, kilka z listy,
// kalendarz z „Dziś” i „Wczoraj”); przełącznik zmienia się jednym kliknięciem. Każda zmiana zapisuje się od razu, a formularz „Zatwierdź” niesie
// wiersze, które Piotr widzi (zgoda obejmuje dokładnie je). Szybki wpis nad tabelą ma ten sam układ kolumn; „Kolumny” chowa i pokazuje kolumny
// nieobowiązkowe w obu naraz (wybór zostaje w przeglądarce).
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { SheetColumn, SheetPart } from "@/lib/schema";
import { dayKey } from "@/lib/clock";
import { fmtDuration, longDuration, parseDuration } from "@/lib/sheet-month";
import { Icon } from "@/components/canvas/ui";

type Row = { k: number; c: string[]; p: SheetPart[] | null };
type Col = { i: number; label: string; spec: SheetColumn };
type Edit = { row: number | "q"; col: number } | null;

// ---------- wartości komórek ----------
const MULTI_SEP = ", ";
export { fmtDuration, longDuration, parseDuration };
export const splitMulti = (v: string) => v.split(",").map((x) => x.trim()).filter(Boolean);
export const isOn = (v: string) => /^(tak|true|yes|1|on)$/i.test(v.trim());
// godzina: 9, 930, 9:30, 9.30 → „09:30”
export function parseTime(s: string): string | null {
  const v = s.trim().replace(".", ":");
  const m = /^(\d{1,2})(?::?(\d{2}))?$/.exec(v);
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2] ?? 0);
  return h < 24 && mi < 60 ? `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}` : null;
}
const minsOf = (t: string) => { const m = /^(\d{2}):(\d{2})$/.exec(t); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const isoAdd = (iso: string, n: number) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const shortDate = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}` : iso);
const MONTHS = ["styczeń", "luty", "marzec", "kwiecień", "maj", "czerwiec", "lipiec", "sierpień", "wrzesień", "październik", "listopad", "grudzień"];
// szerokość kolumny według rodzaju; pierwsza kolumna wyboru (projekt) szersza, tekst bierze resztę
const widthOf = (c: Col, first: boolean): number | null =>
  c.spec.kind === "text" ? null : c.spec.kind === "choice" ? (first ? 200 : 128) : c.spec.kind === "multi" ? 160 : c.spec.kind === "date" ? 112
  : c.spec.kind === "time" ? 80 : c.spec.kind === "duration" ? 116 : 144;
const LAST_W = 96;

const colorOf = (c: Col, v: string) => c.spec.options?.find((o) => o.value === v)?.color ?? null;
const Dot = ({ c }: { c: string | null }) => <span className="sh-dot" style={c ? { background: c } : undefined} />;

// ---------- lista przy komórce (portal: kartka ma backdrop-filter, więc byłaby blokiem zawierającym dla position: fixed) ----------
function Pop({ anchor, width, onClose, children, label }: { anchor: HTMLElement; width: number; onClose: () => void; children: ReactNode; label: string }) {
  const [pos, setPos] = useState<{ left: number; top: number; maxH: number }>({ left: 0, top: 0, maxH: 320 });
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const r = anchor.getBoundingClientRect(), w = Math.max(width, r.width);
    const below = window.innerHeight - r.bottom - 16, above = r.top - 16;
    const up = below < 260 && above > below;
    setPos({ left: Math.max(16, Math.min(r.left, window.innerWidth - w - 16)), top: up ? Math.max(16, r.top - 6 - Math.min(380, above)) : r.bottom + 6, maxH: Math.min(380, up ? above : below) });
    const close = (e: Event) => { const t = e.target as Node; if (!ref.current?.contains(t) && !anchor.contains(t)) onClose(); };
    // Esc zamyka tylko listę, nie całą kartę kroku (kanwa też słucha Esc): przechwycone przed innymi słuchaczami
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopImmediatePropagation(); e.preventDefault(); onClose(); } };
    document.addEventListener("pointerdown", close); window.addEventListener("keydown", key, true);
    return () => { document.removeEventListener("pointerdown", close); window.removeEventListener("keydown", key, true); };
  }, [anchor, width, onClose]);
  return createPortal(
    <div ref={ref} className="ppmenu glass sh-pop" role="dialog" aria-label={label} style={{ position: "fixed", left: pos.left, top: pos.top, width: Math.max(width, anchor.getBoundingClientRect().width), maxHeight: pos.maxH }}
      onPointerDown={(e) => e.stopPropagation()}>{children}</div>, document.body);
}

// wybór jednej albo kilku wartości: wyszukiwarka, „Ostatnio używane”, „Wszystkie”
function OptionList({ col, value, multi, onPick }: { col: Col; value: string; multi: boolean; onPick: (v: string, close: boolean) => void }) {
  const [q, setQ] = useState("");
  const opts = col.spec.options ?? [];
  const sel = new Set(multi ? splitMulti(value) : value ? [value] : []);
  const hits = opts.filter((o) => !q || o.value.toLowerCase().includes(q.trim().toLowerCase()));
  const recent = q ? [] : hits.filter((o) => o.recent);
  const rest = q ? hits : hits.filter((o) => !o.recent);
  const toggle = (v: string) => {
    if (!multi) { onPick(v, true); return; }
    const next = new Set(sel); if (next.has(v)) next.delete(v); else next.add(v);
    onPick(opts.map((o) => o.value).filter((x) => next.has(x)).join(MULTI_SEP), false);
  };
  const item = (o: (typeof opts)[number]) => (
    <button key={o.value} type="button" role="option" aria-selected={sel.has(o.value)} className={"pp-opt" + (sel.has(o.value) ? " on" : "")} onClick={() => toggle(o.value)}>
      {multi ? <span className={"sh-box" + (sel.has(o.value) ? " on" : "")}>{sel.has(o.value) ? <Icon k="check" size={10} sw={2.4} /> : null}</span> : null}
      {o.color ? <Dot c={o.color} /> : null}<span className="sh-ell">{o.value}</span>
      {!multi && sel.has(o.value) ? <span className="ck"><Icon k="check" size={12} sw={2.2} /></span> : null}
    </button>
  );
  return (
    <>
      {opts.length > 8 ? (
        <label className="sh-srch"><Icon k="search" size={13} sw={1.8} /><input autoFocus placeholder={`Szukaj: ${col.label.toLowerCase()}`} value={q} onChange={(e) => setQ(e.currentTarget.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && hits[0]) { e.preventDefault(); toggle(hits[0].value); } }} /></label>
      ) : null}
      <div className="sh-list" role="listbox" aria-multiselectable={multi || undefined}>
        {recent.length ? <><div className="sh-sec">Ostatnio używane</div>{recent.map(item)}<div className="sh-sec">Wszystkie</div></> : null}
        {rest.map(item)}
        {!hits.length ? <div className="sh-sec">Nic nie pasuje.</div> : null}
        {!multi && !col.spec.required && value ? <button type="button" className="pp-opt" onClick={() => onPick("", true)}>Bez wartości</button> : null}
      </div>
    </>
  );
}

// kalendarz: „Dziś” i „Wczoraj” na górze, pod nimi miesiąc (tydzień od poniedziałku)
function DatePick({ value, onPick }: { value: string; onPick: (iso: string) => void }) {
  const today = dayKey(new Date());
  const [m, setM] = useState((/^\d{4}-\d{2}/.test(value) ? value : today).slice(0, 7));
  const [y, mo] = m.split("-").map(Number);
  const first = new Date(Date.UTC(y, mo - 1, 1)), lead = (first.getUTCDay() + 6) % 7, days = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const shift = (n: number) => { const d = new Date(Date.UTC(y, mo - 1 + n, 1)); setM(d.toISOString().slice(0, 7)); };
  return (
    <div className="sh-dp">
      <div className="sh-dpq">
        {[{ l: "Dziś", iso: today }, { l: "Wczoraj", iso: isoAdd(today, -1) }].map((x) => (
          <button key={x.l} type="button" className={"chip" + (value === x.iso ? " on" : "")} onClick={() => onPick(x.iso)}>{x.l}</button>
        ))}
      </div>
      <div className="sh-dph">
        <button type="button" className="sh-nav" aria-label="Poprzedni miesiąc" onClick={() => shift(-1)}>‹</button>
        <span>{MONTHS[mo - 1]} {y}</span>
        <button type="button" className="sh-nav" aria-label="Następny miesiąc" onClick={() => shift(1)}>›</button>
      </div>
      <div className="sh-dpg">
        {["pn", "wt", "śr", "cz", "pt", "sb", "nd"].map((w) => <span key={w} className="sh-wd">{w}</span>)}
        {Array.from({ length: lead }, (_, k) => <span key={"b" + k} />)}
        {Array.from({ length: days }, (_, k) => {
          const iso = `${m}-${String(k + 1).padStart(2, "0")}`, wd = (lead + k) % 7;
          return <button key={iso} type="button" className={[iso === value ? "sel" : "", iso === today ? "td" : "", wd >= 5 ? "we" : ""].join(" ").trim() || undefined} onClick={() => onPick(iso)}>{k + 1}</button>;
        })}
      </div>
    </div>
  );
}

// ---------- arkusz ----------
export function SheetDraft({ columns, sheet, rows, parts, editable, formId, seenRows, onSave, cols0 }: {
  columns: string[]; sheet: SheetColumn[]; rows: string[][]; parts?: (SheetPart[] | null)[] | null;
  editable: boolean; formId?: string; seenRows?: string | null; onSave?: (rowsJson: string) => Promise<boolean>; cols0?: string;
}) {
  const cols: Col[] = useMemo(() => columns.map((label, i) => ({ i, label, spec: sheet[i] ?? { kind: "text" } })), [columns, sheet]);
  const n = columns.length;
  const fromProps = (): Row[] => rows.map((c, k) => ({ k, c: Array.from({ length: n }, (_, j) => c[j] ?? ""), p: parts?.[k] ?? null }));
  const propSig = JSON.stringify([rows, parts ?? null]);
  const [list, setList] = useState<Row[]>(fromProps);
  const [saving, setSaving] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const seq = useRef(rows.length);
  // nowa wersja z serwera (zapis komórki, agent przepisał szkic): bierzemy ją, gdy nic się właśnie nie zapisuje
  useEffect(() => { if (!saving) { setList(fromProps()); seq.current = Math.max(seq.current, rows.length); } }, [propSig]);   // eslint-disable-line react-hooks/exhaustive-deps

  // kolumny schowane: wybór Piotra w przeglądarce, inaczej hidden z szkicu; obowiązkowych schować się nie da
  const storeKey = "th-sheet-cols:" + (cols0 ?? columns.join("|"));
  const [hide, setHide] = useState<Set<number>>(() => new Set(cols.filter((c) => c.spec.hidden && !c.spec.required).map((c) => c.i)));
  useEffect(() => {
    try { const v = localStorage.getItem(storeKey); if (v) setHide(new Set((JSON.parse(v) as string[]).map((l) => columns.indexOf(l)).filter((i) => i >= 0 && !sheet[i]?.required))); } catch { /* bez pamięci przeglądarki: domyślne */ }
  }, [storeKey]);   // eslint-disable-line react-hooks/exhaustive-deps
  const setHidden = (next: Set<number>) => { setHide(next); try { localStorage.setItem(storeKey, JSON.stringify([...next].map((i) => columns[i]))); } catch { /* ignoruj */ } };
  const vis = cols.filter((c) => !hide.has(c.i));

  const durCol = cols.find((c) => c.spec.kind === "duration") ?? null;
  const timeCols = cols.filter((c) => c.spec.kind === "time");
  const dateCol = cols.find((c) => c.spec.kind === "date") ?? null;
  // od i do (dwie kolumny godzin) liczą czas trwania, gdy obie są wpisane
  const withDerived = (c: string[]): string[] => {
    if (!durCol || timeCols.length !== 2) return c;
    const a = minsOf(c[timeCols[0].i]), b = minsOf(c[timeCols[1].i]);
    if (a == null || b == null || b <= a) return c;
    const out = [...c]; out[durCol.i] = fmtDuration(b - a); return out;
  };

  const persist = async (next: Row[]) => {
    setList(next); setErr(null);
    if (!onSave) return;
    setSaving((x) => x + 1);
    try { if (!(await onSave(JSON.stringify(next.map((r) => (r.p?.length ? { c: r.c, p: r.p } : r.c)))))) setErr("Nie zapisałem zmiany: szkic jest już wysłany albo w wysyłce."); }
    catch { setErr("Nie zapisałem zmiany. Sprawdź połączenie i spróbuj jeszcze raz."); }
    finally { setSaving((x) => x - 1); }
  };
  const setCell = (k: number, col: number, v: string) => {
    const next = list.map((r) => (r.k === k ? { ...r, c: (() => { const c = [...r.c]; c[col] = v; return withDerived(c); })() } : r));
    if (JSON.stringify(next) !== JSON.stringify(list)) void persist(next);
  };
  const removeRow = (k: number) => void persist(list.filter((r) => r.k !== k));

  // szybki wpis: domyślnie pierwsza ostatnio używana opcja w obowiązkowym wyborze, najczęstsza data z tabeli (albo dziś), przełącznik włączony
  const blank = (): string[] => cols.map((c) => {
    if (c.spec.kind === "choice" && c.spec.required) return (c.spec.options?.find((o) => o.recent) ?? c.spec.options?.[0])?.value ?? "";
    if (c.spec.kind === "date") {
      const cnt = new Map<string, number>(); list.forEach((r) => { const d = r.c[c.i]; if (d) cnt.set(d, (cnt.get(d) ?? 0) + 1); });
      return [...cnt.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? dayKey(new Date());
    }
    if (c.spec.kind === "toggle") return "tak";
    return "";
  });
  const [qa, setQa] = useState<string[]>(blank);
  const [qaErr, setQaErr] = useState<string | null>(null);
  const addQuick = () => {
    const c = withDerived(qa.map((v, i) => (cols[i].spec.kind === "duration" ? (parseDuration(v) != null ? fmtDuration(parseDuration(v)!) : v) : v)));
    const miss = cols.filter((x) => x.spec.required && !c[x.i]?.trim()).map((x) => x.label.toLowerCase());
    if (durCol && c[durCol.i] && parseDuration(c[durCol.i]) == null) { setQaErr("Czas trwania wpisz jak 1:15, 45 min albo 1,5 h."); return; }
    if (miss.length) { setQaErr(`Uzupełnij: ${miss.join(", ")}.`); return; }
    setQaErr(null);
    const k = ++seq.current;
    void persist([...list, { k, c, p: null }]);
    setFresh(k);
    setQa((old) => cols.map((x) => (x.spec.kind === "text" || x.spec.kind === "duration" || x.spec.kind === "time" ? "" : old[x.i])));
  };
  const [fresh, setFresh] = useState<number | null>(null);
  useEffect(() => { if (fresh == null) return; const t = setTimeout(() => setFresh(null), 1600); return () => clearTimeout(t); }, [fresh]);

  // edycja w miejscu i listy
  const [edit, setEdit] = useState<Edit>(null);
  const cancel = useRef(false);
  const [pop, setPop] = useState<{ el: HTMLElement; row: number | "q"; col: number; what: "pick" | "date" | "cols" | "parts" } | null>(null);
  const valOf = (row: number | "q", col: number) => (row === "q" ? qa[col] : list.find((r) => r.k === row)?.c[col] ?? "");
  const put = (row: number | "q", col: number, v: string) => {
    if (row === "q") { setQa((q) => { const c = [...q]; c[col] = v; return withDerived(c); }); return; }
    setCell(row, col, v);
  };

  const total = durCol ? list.reduce((a, r) => a + (parseDuration(r.c[durCol.i]) ?? 0), 0) : null;

  const cell = (row: number | "q", c: Col, ro: boolean): ReactNode => {
    const v = valOf(row, c.i), quick = row === "q";
    const isEd = edit && edit.row === row && edit.col === c.i;
    const kind = c.spec.kind;
    if (kind === "toggle") {
      const on = isOn(v);
      return <button type="button" className={"sh-bill" + (on ? " on" : "")} disabled={ro} aria-pressed={on} title={ro ? undefined : `${c.label}: kliknij, aby zmienić`}
        onClick={() => put(row, c.i, on ? "nie" : "tak")}><Icon k="check" size={12} sw={on ? 2.4 : 1.4} />{on ? c.spec.on ?? "Tak" : "Nie"}</button>;
    }
    // pola tekstu, godziny i czasu: w szybkim wpisie zawsze pole, w tabeli po kliknięciu
    if ((kind === "text" || kind === "time" || kind === "duration") && (quick || isEd) && !ro) {
      const commit = (raw: string) => {
        if (cancel.current) { cancel.current = false; return; }
        const val = kind === "time" ? (raw.trim() ? parseTime(raw) ?? raw.trim() : "") : kind === "duration" ? (raw.trim() ? (parseDuration(raw) != null ? fmtDuration(parseDuration(raw)!) : raw.trim()) : "") : raw;
        if (!quick) setEdit(null);
        if (val !== v) put(row, c.i, val);
      };
      return (
        <label className={"sh-cell inp" + (kind !== "text" ? " num" : "")}>
          <input defaultValue={quick ? undefined : v} value={quick ? v : undefined} autoFocus={!quick}
            placeholder={quick ? (kind === "text" ? c.label : kind === "time" ? "9:00" : "1:00") : undefined} aria-label={c.label}
            onChange={quick ? (e) => { const nv = e.currentTarget.value; setQa((q) => { const x = [...q]; x[c.i] = nv; return x; }); } : undefined}
            onBlur={(e) => commit(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); if (quick) { commit(e.currentTarget.value); addQuick(); } else e.currentTarget.blur(); }
              if (e.key === "Escape" && !quick) { e.preventDefault(); e.stopPropagation(); cancel.current = true; setEdit(null); }
            }} />
        </label>
      );
    }
    const open = (e: React.MouseEvent<HTMLElement>) => {
      if (ro) return;
      if (kind === "choice" || kind === "multi") setPop({ el: e.currentTarget, row, col: c.i, what: "pick" });
      else if (kind === "date") setPop({ el: e.currentTarget, row, col: c.i, what: "date" });
      else setEdit({ row, col: c.i });
    };
    const content = kind === "choice" ? (v ? <><Dot c={colorOf(c, v)} /><span className="sh-ell">{v}</span></> : null)
      : kind === "multi" ? (v ? <span className="sh-ell">{splitMulti(v).map((t) => <span key={t} className="sh-tag"><Dot c={colorOf(c, t)} />{t}</span>)}</span> : null)
      : kind === "date" ? (v ? shortDate(v) : null)
      : v ? <span className={kind === "text" ? "sh-wrap" : "sh-ell"}>{v}</span> : null;
    const p = !quick && kind === "duration" ? list.find((r) => r.k === row)?.p : null;
    return (
      <span className={"sh-cell" + (kind === "text" ? "" : " num") + (kind === "duration" ? " dur" : "") + (v ? "" : " sh-empty") + (quick ? " inp" : "") + (ro ? "" : kind === "choice" || kind === "multi" || kind === "date" ? " pick" : " txt")}
        role={ro ? undefined : "button"} tabIndex={ro ? undefined : 0} title={ro ? undefined : `${c.label}: kliknij, aby zmienić`}
        onClick={open} onKeyDown={(e) => { if (!ro && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); open(e as unknown as React.MouseEvent<HTMLElement>); } }}>
        {content ?? (ro ? "" : quick ? c.label : "dodaj")}
        {p?.length ? <button type="button" className="sh-sum" title="Z czego zebrano ten wpis" onClick={(e) => { e.stopPropagation(); setPop({ el: e.currentTarget, row, col: c.i, what: "parts" }); }}>Σ {p.length}</button> : null}
      </span>
    );
  };

  const table = (body: Row[] | "q", ro: boolean) => {
    const minW = vis.reduce((a, c, k) => a + (widthOf(c, k === 0) ?? 240), 0) + (ro ? 0 : LAST_W);
    return (
      <div className="tbwrap sh-wrap0">
        <table className={"tb sh" + (ro ? " ro" : "")} style={{ minWidth: minW }}>
          <colgroup>{vis.map((c, k) => { const w = widthOf(c, k === 0); return <col key={c.i} style={w ? { width: w } : undefined} />; })}{ro ? null : <col style={{ width: LAST_W }} />}</colgroup>
          <thead><tr>{vis.map((c) => <th key={c.i}>{c.label}</th>)}{ro ? null : <th aria-label="Akcje" />}</tr></thead>
          <tbody>
            {body === "q" ? (
              <tr>{vis.map((c) => <td key={c.i}>{cell("q", c, false)}</td>)}<td className="sh-last"><button type="button" className="btn primary sm" onClick={addQuick}><Icon k="plus" size={12} sw={2} />Dodaj</button></td></tr>
            ) : body.length ? body.map((r) => (
              <tr key={r.k} className={fresh === r.k ? "fresh" : undefined}>
                {vis.map((c) => <td key={c.i}>{cell(r.k, c, ro)}</td>)}
                {ro ? null : <td className="sh-last"><button type="button" className="sh-x" title="Usuń wiersz ze szkicu" aria-label="Usuń wiersz ze szkicu" onClick={() => removeRow(r.k)}><Icon k="x" size={12} sw={2} /></button></td>}
              </tr>
            )) : <tr><td colSpan={vis.length + (ro ? 0 : 1)}><p className="sub sh-none">{ro ? "Brak wierszy." : "Brak wierszy. Dopisz pierwszy szybkim wpisem."}</p></td></tr>}
          </tbody>
        </table>
      </div>
    );
  };

  const optional = cols.filter((c) => !c.spec.required);
  const hiddenN = optional.filter((c) => hide.has(c.i)).length;
  const dirty = JSON.stringify(list.map((r) => [r.c, r.p])) !== JSON.stringify(fromProps().map((r) => [r.c, r.p]));
  const popRow = pop && pop.row !== "q" ? list.find((r) => r.k === pop.row) : null;
  const popCol = pop ? cols[pop.col] : null;

  return (
    <div className="sheet">
      {editable ? (
        <div className="sh-quick">
          <div className="sh-qh">
            <b>Szybki wpis{dateCol ? " do dowolnego dnia" : ""}</b><span className="sp" />
            {optional.length ? <button type="button" className="btn sm" onClick={(e) => setPop({ el: e.currentTarget, row: "q", col: 0, what: "cols" })} aria-haspopup="dialog">
              Kolumny{hiddenN ? ` · ukryte ${hiddenN}` : ""}</button> : null}
          </div>
          {table("q", false)}
          {qaErr ? <p className="note warn">{qaErr}</p> : null}
        </div>
      ) : null}
      {table(list, !editable)}
      <div className="sh-foot">
        {!editable && optional.length ? <button type="button" className="btn sm" onClick={(e) => setPop({ el: e.currentTarget, row: "q", col: 0, what: "cols" })}>Kolumny{hiddenN ? ` · ukryte ${hiddenN}` : ""}</button> : null}
        {saving ? <span className="sub">Zapisuję…</span> : err ? <span className="note warn">{err}</span> : null}
        <span className="sp" />
        {total != null ? <><span className="sub">Razem</span><b className="sh-total">{longDuration(total)}</b></> : null}
      </div>
      {/* zgoda obejmuje wiersze z tej karty: poprawione idą w formularzu „Zatwierdź”, a podpis karty liczy się wtedy bez nich */}
      {editable && formId ? <>{dirty ? <input type="hidden" name="rows" form={formId} value={JSON.stringify(list.map((r) => (r.p?.length ? { c: r.c, p: r.p } : r.c)))} /> : null}
        {seenRows ? <input type="hidden" name="seenRows" form={formId} value={seenRows} /> : null}</> : null}

      {pop && popCol && pop.what === "pick" ? (
        <Pop anchor={pop.el} width={popCol.spec.kind === "multi" ? 240 : 280} label={popCol.label} onClose={() => setPop(null)}>
          <OptionList col={popCol} value={valOf(pop.row, pop.col)} multi={popCol.spec.kind === "multi"} onPick={(v, close) => { put(pop.row, pop.col, v); if (close) setPop(null); }} />
        </Pop>
      ) : null}
      {pop && popCol && pop.what === "date" ? (
        <Pop anchor={pop.el} width={260} label={popCol.label} onClose={() => setPop(null)}>
          <DatePick value={valOf(pop.row, pop.col)} onPick={(iso) => { put(pop.row, pop.col, iso); setPop(null); }} />
        </Pop>
      ) : null}
      {pop && pop.what === "cols" ? (
        <Pop anchor={pop.el} width={220} label="Kolumny" onClose={() => setPop(null)}>
          <div className="sh-list">
            {cols.map((c) => {
              const on = !hide.has(c.i);
              return (
                <button key={c.i} type="button" className={"pp-opt" + (c.spec.required ? " locked" : "")} disabled={c.spec.required} aria-pressed={on}
                  onClick={() => { const nx = new Set(hide); if (on) nx.add(c.i); else nx.delete(c.i); setHidden(nx); }}>
                  <span className={"sh-box" + (on ? " on" : "")}>{on ? <Icon k="check" size={10} sw={2.4} /> : null}</span>{c.label}
                  {c.spec.required ? <span className="sh-req">wymagana</span> : null}
                </button>
              );
            })}
          </div>
        </Pop>
      ) : null}
      {pop && pop.what === "parts" && popRow?.p ? (
        <Pop anchor={pop.el} width={320} label="Z czego zebrano wpis" onClose={() => setPop(null)}>
          <div className="sh-parts">
            <b>Zebrane w jeden wpis</b>
            <ul>{popRow.p.map((x, k) => <li key={k}><span>{x.what}{x.app ? <span className="sub">{x.app}</span> : null}</span>{x.min != null ? <b>{x.min} min</b> : null}</li>)}</ul>
            {popRow.p.some((x) => x.min != null) ? <p className="sub">Razem {popRow.p.reduce((a, x) => a + (x.min ?? 0), 0)} min, we wpisie {durCol ? popRow.c[durCol.i] || "bez czasu" : ""}.</p> : null}
          </div>
        </Pop>
      ) : null}
    </div>
  );
}
