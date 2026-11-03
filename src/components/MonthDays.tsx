"use client";
// Paczka 42 (wpisy czasu, krok 07): kalendarz dni w panelu zadania miesiąca. Każdy dzień to krok ze szkicem wierszy; kafelek dnia mówi, czy
// wpisy są wysłane, zatwierdzone (czekają na wysyłkę przez aplikację na Macu), czy to szkic do zatwierdzenia, a dzień roboczy bez kroku jest
// obrysowany. Dziś i dzień bez kroku wysyłają w zadaniu prośbę o zebranie wpisów (robi to agent).
// Paczka 44 (prototyp 2026-11-03, zgoda Piotra): jeden ekran. Klik w dzień z krokiem pokazuje pod kalendarzem kartę tego dnia (tę samą co w kroku),
// klik w inny dzień podmienia ją w tym samym miejscu. Domyślnie najnowszy szkic, inaczej dziś, inaczej ostatni dzień z krokiem.
import { useState, type ReactNode } from "react";
import { chat } from "@/app/actions";
import { fmtDuration, longDuration, type DayCell, type MonthView } from "@/lib/sheet-month";

const WD = ["pn", "wt", "śr", "cz", "pt", "sb", "nd"];
const plural = (n: number, one: string, few: string, many: string) =>
  n === 1 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many;
const short = (iso: string) => `${Number(iso.slice(8, 10))}.${iso.slice(5, 7)}`;
const DLONG = ["poniedziałek", "wtorek", "środa", "czwartek", "piątek", "sobota", "niedziela"];
const MON = ["stycznia", "lutego", "marca", "kwietnia", "maja", "czerwca", "lipca", "sierpnia", "września", "października", "listopada", "grudnia"];
const STATE: Partial<Record<DayCell["kind"], string>> = { draft: "Szkic, czeka na Ciebie", approved: "Zatwierdzony, czeka na wysyłkę", sent: "Wysłany", closed: "Zamknięty bez wysyłki" };
const LABEL: Record<DayCell["kind"], string> = {
  sent: "wysłany", approved: "zatwierdzony", draft: "szkic", closed: "zamknięty bez wysyłki", missing: "brak kroku", today: "dziś: dodaj", free: "", future: "",
};

function Ask({ taskId, text, cell, label, hint }: { taskId: string; text: string; cell: DayCell; label: string; hint: string }) {
  return (
    <form action={chat} className="md-form">
      <input type="hidden" name="taskId" value={taskId} /><input type="hidden" name="text" value={text} />
      <button type="submit" className={`md-day ${cell.kind}`} title={text}>
        <span className="md-n">{cell.day}</span>
        <b>{label}</b>
        <span className="md-s">{hint}</span>
      </button>
    </form>
  );
}

export function MonthDays({ taskId, view, cards }: { taskId: string; view: MonthView; cards?: Record<string, ReactNode> }) {
  const lead = view.cells[0]?.weekday ?? 0;
  const c = view.count;
  const withStep = view.cells.filter((x) => x.step);
  const first = [...withStep].reverse().find((x) => x.kind === "draft") ?? withStep.find((x) => x.kind === "today") ?? withStep[withStep.length - 1] ?? null;
  const [sel, setSel] = useState<string | null>(first?.date ?? null);
  const cur = withStep.find((x) => x.date === sel) ?? first;
  const card = cur?.step && cards ? cards[cur.step.id] : null;
  return (
    <div className="md">
      <div className="lbl">Dni miesiąca · {view.label}</div>
      <div className="md-sum">
        {c.sent ? <span className="chip md-c sent">Wysłane: {c.sent} {plural(c.sent, "dzień", "dni", "dni")}</span> : null}
        {c.approved ? <span className="chip md-c approved" title="Aplikacja na Macu wysyła zatwierdzone wpisy przez konektor">Zatwierdzone, czekają na wysyłkę: {c.approved}</span> : null}
        {c.draft ? <span className="chip md-c draft">Szkice do zatwierdzenia: {c.draft}</span> : null}
        {view.missing.length ? <span className="chip md-c missing" title={view.missing.map(short).join(", ")}>Brak kroku: {view.missing.length > 3 ? `${view.missing.length} ${plural(view.missing.length, "dzień", "dni", "dni")}` : view.missing.map(short).join(", ")}</span> : null}
        <span className="chip">Razem w miesiącu: {longDuration(view.minutes)}</span>
      </div>
      <div className="md-grid" role="grid" aria-label={`Dni miesiąca: ${view.label}`}>
        {WD.map((d) => <div key={d} className="md-wd">{d}</div>)}
        {Array.from({ length: lead }, (_, i) => <div key={"e" + i} />)}
        {view.cells.map((cell) => {
          if (cell.step) {
            const s = cell.step;
            return (
              <button type="button" key={cell.date} className={`md-day ${cell.kind}${cur?.date === cell.date ? " on" : ""}`} aria-pressed={cur?.date === cell.date} onClick={() => setSel(cell.date)}
                title={`${s.title}${cell.more ? ` (i jeszcze ${cell.more} ${plural(cell.more, "krok", "kroki", "kroków")} tego dnia)` : ""}`}>
                <span className="md-n">{cell.day} <i>· {String(s.no).padStart(2, "0")}</i>{cell.more ? <i> +{cell.more}</i> : null}</span>
                <b>{LABEL[cell.kind]}</b>
                <span className="md-s">{cell.rows} {plural(cell.rows, "wpis", "wpisy", "wpisów")} · {fmtDuration(cell.minutes)}</span>
              </button>
            );
          }
          if (cell.kind === "today") return <Ask key={cell.date} taskId={taskId} cell={cell} text="Dodaj dzisiejszy dzień." label={LABEL.today} hint="zbierz wpisy" />;
          if (cell.kind === "missing") return <Ask key={cell.date} taskId={taskId} cell={cell} text={`Zrób wpisy z ${short(cell.date)}.`} label={LABEL.missing} hint="kliknij, żeby zebrać" />;
          return (
            <div key={cell.date} className={`md-day ${cell.kind}`}>
              <span className="md-n">{cell.day}</span>
              <span className="md-s">{cell.holiday ?? (cell.weekday >= 5 ? "weekend" : "")}</span>
            </div>
          );
        })}
      </div>
      <div className="md-leg">
        <span><i className="sent" />wysłany</span><span><i className="approved" />zatwierdzony, czeka na wysyłkę</span>
        <span><i className="draft" />szkic do zatwierdzenia</span><span><i className="missing" />dzień roboczy bez kroku</span>
      </div>
      {cur?.step && card ? (
        <div className="md-dayc">
          <div className="md-dh">
            <div className="sub">{view.label} · krok {String(cur.step.no).padStart(2, "0")} · {DLONG[cur.weekday]}</div>
            <div className="md-dt">
              <h3>{cur.step.title || `Wpisy z ${cur.day} ${MON[Number(cur.date.slice(5, 7)) - 1]}`}</h3>
              {STATE[cur.kind] ? <span className={`chip md-c ${cur.kind}`}>{STATE[cur.kind]}</span> : null}
              <span className="sp" />
              <a className="btn sm" href={`/tasks/${taskId}?step=${cur.step.id}`}>Otwórz krok</a>
            </div>
          </div>
          {card}
        </div>
      ) : null}
    </div>
  );
}
