// Paczka 42 (wpisy czasu, krok 07): kalendarz dni w panelu zadania miesiąca. Każdy dzień to krok ze szkicem wierszy; kafelek dnia mówi, czy
// wpisy są wysłane, zatwierdzone (czekają na wysyłkę przez aplikację na Macu), czy to szkic do zatwierdzenia, a dzień roboczy bez kroku jest
// obrysowany. Klik w dzień z krokiem otwiera ten krok; dziś i dzień bez kroku wysyłają w zadaniu prośbę o zebranie wpisów (robi to agent).
// Komponent serwerowy: formularze idą wprost do akcji czatu, bez stanu w przeglądarce.
import { chat } from "@/app/actions";
import { fmtDuration, longDuration, type DayCell, type MonthView } from "@/lib/sheet-month";

const WD = ["pn", "wt", "śr", "cz", "pt", "sb", "nd"];
const plural = (n: number, one: string, few: string, many: string) =>
  n === 1 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many;
const short = (iso: string) => `${Number(iso.slice(8, 10))}.${iso.slice(5, 7)}`;
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

export function MonthDays({ taskId, view }: { taskId: string; view: MonthView }) {
  const lead = view.cells[0]?.weekday ?? 0;
  const c = view.count;
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
              <a key={cell.date} className={`md-day ${cell.kind}`} href={`/tasks/${taskId}?step=${s.id}`} title={`${s.title}${cell.more ? ` (i jeszcze ${cell.more} ${plural(cell.more, "krok", "kroki", "kroków")} tego dnia)` : ""}`}>
                <span className="md-n">{cell.day} <i>· {String(s.no).padStart(2, "0")}</i>{cell.more ? <i> +{cell.more}</i> : null}</span>
                <b>{LABEL[cell.kind]}</b>
                <span className="md-s">{cell.rows} {plural(cell.rows, "wpis", "wpisy", "wpisów")} · {fmtDuration(cell.minutes)}</span>
              </a>
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
    </div>
  );
}
