// PROTOTYP (paczka 18, kroki 03 i 04 zadania „Grupy, kafelki, kolejka”): stany kafelka w wariantach A, B i C, w powiększeniu 100% i 40%.
// Same dane pokazowe, bez bazy i bez logowania; strona do oceny na podglądzie gałęzi, nie wchodzi na produkcję (usunąć przed wdrożeniem).
import type { Metadata } from "next";
import { Lvl, ToolChip, ToolIcon, toolColor } from "@/components/canvas/ui";
import { PROTO_CSS } from "./proto-css";

export const metadata: Metadata = { title: "Prototyp: stany kafelka", robots: { index: false } };

type State = { key: string; name: string; when: string; label: string; ico: string; tool: string; toolName: string; title: string; meta: string };
// 5 stanów z kartki kroku 04; kilka kafelków na stan, żeby było widać różne etykiety i oba kolory „Zaplanowane”.
const STATES: State[] = [
  { key: "live", name: "Agent pracuje", when: "Agent robi krok teraz na Macu", label: "Agent pracuje", ico: "spin", tool: "claude", toolName: "Dokument", title: "Przygotuj szkic odpowiedzi", meta: "Teraz: czyta wątek w Slacku" },
  { key: "live", name: "Agent pracuje", when: "Agent robi krok w chmurze po „Uruchom w chmurze”", label: "Agent pracuje", ico: "spin", tool: "manual", toolName: "Ty", title: "Zleć w projekcie: naprawa grupy", meta: "W chmurze od 11:08" },
  { key: "mine", name: "Twoja kolej", when: "Szkic czeka na Twoją zgodę", label: "Zatwierdź szkic", ico: "check", tool: "slack", toolName: "Slack", title: "Odpowiedz Kindze w wątku copy", meta: "Slack · #shiftwow-design" },
  { key: "mine", name: "Twoja kolej", when: "Decyzja albo czynność po Twojej stronie", label: "Zdecyduj", ico: "you", tool: "manual", toolName: "Ty", title: "Zdecyduj, które tickety wracają", meta: "~10 min" },
  { key: "mine", name: "Twoja kolej", when: "Czynność po Twojej stronie poza aplikacją", label: "Zrób", ico: "you", tool: "manual", toolName: "Ty", title: "Nagraj wideo z zachowaniem piesków", meta: "~15 min" },
  { key: "help", name: "Agent oddał", when: "Agent nie dał rady i podał powód", label: "Potrzebna pomoc", ico: "alert", tool: "gmail", toolName: "Gmail", title: "Wyślij behawiorystce link do wideo", meta: "Brak dostępu do Dysku Google" },
  { key: "plan-ag", name: "Zaplanowane (agent)", when: "Czeka na wcześniejsze kroki, agent weźmie go sam", label: "Zaplanowane", ico: "plan", tool: "clickup", toolName: "ClickUp", title: "Sprawdź duplikaty w BA&UX TODO", meta: "Po kroku 02" },
  { key: "plan-me", name: "Zaplanowane (Ty)", when: "Czeka na wcześniejsze kroki, potem Twój ruch", label: "Zaplanowane", ico: "plan", tool: "manual", toolName: "Ty", title: "Zatwierdź tematy na retrospektywę", meta: "Po kroku 03 · ~5 min" },
  { key: "done", name: "Zrobione", when: "Krok zamknięty", label: "Zrobione", ico: "check", tool: "claude", toolName: "Dokument", title: "Przygotuj propozycję kolejki", meta: "Zrobione 10:59" },
];
const LEGEND = STATES.filter((s, i) => STATES.findIndex((x) => x.key === s.key) === i);
const TASKS = ["Analiza odrzuconych ticketów", "Grupy, kafelki, kolejka", "Duplikaty w BA&UX TODO", "Zabezpieczenia dla Task Hub", "Story akceptacji danych", "Kartka porównania", "Wideo dla behawiorystki", "Tematy na retrospektywę", "Paczki czekające na wdrożenie"];
const PROJ = [["Shiftwow", "var(--p3)"], ["Task Hub", "var(--accent)"], ["Shiftwow", "var(--p3)"], ["Task Hub", "var(--accent)"], ["Shiftwow", "var(--p3)"], ["Task Hub", "var(--accent)"], ["", ""], ["Shiftwow", "var(--p3)"], ["Task Hub", "var(--accent)"]];

const ICO: Record<string, string> = {
  spin: '<path d="M8 2.5a5.5 5.5 0 1 1-5.5 5.5" />',
  cloud: '<path d="M4.5 12.5a3 3 0 0 1-.3-6 4 4 0 0 1 7.7 1A2.5 2.5 0 0 1 11.5 12.5z"/>',
  plan: '<circle cx="8" cy="8" r="5.5"/><path d="M8 5v3l2 1.5"/>',
  check: '<path d="M4 8.5l2.6 2.5L12 5.5"/>',
  you: '<circle cx="8" cy="5.5" r="2.5"/><path d="M3.5 13.5a4.5 4.5 0 0 1 9 0"/>',
  alert: '<path d="M8 4v5M8 11.8h.01"/>',
};
const SIco = ({ k, size = 14 }: { k: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={k === "spin" ? "pt-spin" : undefined} dangerouslySetInnerHTML={{ __html: ICO[k] }} />
);

// etykieta stanu; „Agent pracuje” ma obracający się spinner
const Label = ({ s }: { s: State }) => <span className="st pt-st">{s.key === "live" ? <SIco k="spin" size={11} /> : null}{s.label}</span>;

function StepTile({ s, i, v }: { s: State; i: number; v: string }) {
  return (
    <div className={`node pt s-${s.key} v-${v}`}>
      {v === "b" ? <span className="pt-bar"><SIco k={s.ico} /><span>{s.label}</span></span> : null}
      {v === "c" ? <span className="pt-badge" title={s.label}><SIco k={s.ico} /></span> : null}
      <span className="n-top"><span className="n-num">{String(i + 1).padStart(2, "0")}</span><ToolChip tool={s.tool} label={s.toolName} />{v !== "b" ? <Label s={s} /> : null}</span>
      <span className="n-title">{s.title}</span>
      <span className="n-meta">{s.meta}</span>
    </div>
  );
}
function TaskTile({ s, i, v }: { s: State; i: number; v: string }) {
  const [pn, pc] = PROJ[i];
  return (
    <div className={`node task pt s-${s.key} v-${v}`}>
      {v === "b" ? <span className="pt-bar"><SIco k={s.ico} /><span>{s.label}</span></span> : null}
      {v === "c" ? <span className="pt-badge" title={s.label}><SIco k={s.ico} /></span> : null}
      <span className="t-head">
        <span className="t-ico" style={{ ["--c" as string]: toolColor(s.tool) }}><ToolIcon tool={s.tool} /></span>
        <span className="t-main">
          {pn ? <span className="proj-tag" style={{ ["--c" as string]: pc }}>{pn}</span> : null}
          <span className="n-title">{TASKS[i]}</span>
          <span className="t-sum">{s.when}.</span>
        </span>
      </span>
      <span className="t-row" style={{ marginTop: "auto" }}>
        <Lvl base={3} eff={3} />
        {v !== "b" ? <Label s={s} /> : null}
      </span>
      <span className="t-row"><span className="bar"><b style={{ width: `${(i * 13) % 100}%` }} /></span><span className="cnt">{(i % 4) + 1}/6 · ~{10 + i * 5} min</span></span>
    </div>
  );
}

function Row({ v, z, kind }: { v: string; z: number; kind: "step" | "task" }) {
  const w = (kind === "task" ? 260 : 236) + 24;
  return (
    <div className={"pt-zone" + (z < 1 ? " far" : "")} style={{ ["--z" as string]: z }}>
      <div className="pt-row" style={{ zoom: z, width: `${(100 / z).toFixed(2)}%`, ["--tw" as string]: w + "px" }}>
        {STATES.map((s, i) => kind === "task" ? <TaskTile key={i} s={s} i={i} v={v} /> : <StepTile key={i} s={s} i={i} v={v} />)}
      </div>
    </div>
  );
}

const VARIANTS = [
  { v: "a", name: "A. Sama ramka", note: "Grubsza ramka w kolorze stanu, lekko zabarwione tło i etykieta w obecnym miejscu." },
  { v: "b", name: "B. Ramka i pasek", note: "Ramka plus kolorowy pasek u góry z etykietą; przy oddaleniu zostaje pasek z dużą ikoną." },
  { v: "c", name: "C. Ramka i znaczek", note: "Ramka plus okrągły znaczek stanu w rogu, który przy oddaleniu rośnie; etykieta jak w A." },
];

export default function Page() {
  return (
    <main className="proto">
      <style dangerouslySetInnerHTML={{ __html: PROTO_CSS }} />
      <header className="pt-head">
        <h1>Prototyp: stany kafelka</h1>
        <p>Kafelki kroków i zadań w 5 stanach, w trzech wariantach, w powiększeniu 100% i 40%. Kolory z jednej palety: pomarańczowy, niebieski, fioletowy, czerwony i szary. Ramka ma stałą grubość na ekranie, więc przy oddaleniu nie chudnie. Dane są pokazowe.</p>
        <nav>{VARIANTS.map((x) => <a key={x.v} className="btn" href={`#w-${x.v}`}>{x.name}</a>)}<a className="btn" href="#legenda">Legenda</a></nav>
      </header>
      {VARIANTS.map((x) => (
        <section key={x.v} id={`w-${x.v}`} className="pt-sec">
          <h2>{x.name}</h2>
          <p className="pt-note">{x.note}</p>
          <h3>Kroki · 100%</h3><Row v={x.v} z={1} kind="step" />
          <h3>Kroki · 40%</h3><Row v={x.v} z={0.4} kind="step" />
          <h3>Zadania · 100%</h3><Row v={x.v} z={1} kind="task" />
          <h3>Zadania · 40%</h3><Row v={x.v} z={0.4} kind="task" />
        </section>
      ))}
      <section id="legenda" className="pt-sec">
        <h2>Legenda stanów</h2>
        <div className="pt-legend">
          {LEGEND.map((s) => <div key={s.key} className={`pt-lg s-${s.key}`}><i /><b>{s.name}</b><span>{s.when}</span></div>)}
        </div>
        <p className="pt-note">Stanu „W kolejce” nie ma: kolejność widać z ułożenia kafelków i strzałek. Kafelek zadania bierze stan najważniejszego kroku w kolejności: Twoja kolej, Agent oddał, Agent pracuje, Zaplanowane.</p>
      </section>
    </main>
  );
}
