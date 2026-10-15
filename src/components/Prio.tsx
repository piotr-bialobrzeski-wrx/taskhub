import { LEVELS, whyText, type Score } from "@/lib/priority";

export function Prio({ score, label }: { score: Score; label?: boolean }) {
  const b = score.eff - score.base;
  const tip = b ? `Priorytet ${score.base}/5, pokazany ${score.eff}/5: ${whyText(score)}` : `Priorytet ${score.eff}/5: ${LEVELS[score.eff]}`;
  return (
    <span className="row" style={{ gap: 8 }}>
      <span className="lvl" title={tip} aria-label={tip} style={{ ["--lv" as string]: score.eff >= 3 ? "var(--p3)" : "var(--p4)" }}>
        {[1, 2, 3, 4, 5].map((i) => <i key={i} className={i <= score.eff ? "on" : ""} />)}
        {b ? <b className={"boost" + (b < 0 ? " down" : "")}>{b < 0 ? "↓" : "↑"}</b> : null}
      </span>
      {label ? <span className="sub">{LEVELS[score.eff]}</span> : null}
    </span>
  );
}

export function Why({ score }: { score: Score }) {
  if (!score.why.length) return null;
  return (
    <div>
      <div className="lbl">Priorytet {score.eff}/5, bo</div>
      <div className="note why">
        <span><b>{score.base}</b>ustawiony przez Ciebie</span>
        {score.why.map((w, i) => <span key={i}><b className={w.v < 0 ? "down" : ""}>{w.v > 0 ? "+" : ""}{String(w.v).replace(".", ",")}</b>{w.txt}</span>)}
      </div>
    </div>
  );
}
