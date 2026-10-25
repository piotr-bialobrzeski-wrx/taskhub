// PROTOTYP (paczka 19, krok „Zleć w projekcie: prototyp karty zrobionego kroku” zadania „Grupy, kafelki, kolejka”): karta zrobionego kroku,
// na której zostaje oryginalne zlecenie oznaczone jako zrobione, a obok wynik; warianty A, B i C na tych samych dwóch przykładach.
// Same dane pokazowe, bez bazy i bez logowania; strona do oceny na podglądzie gałęzi, nie wchodzi na produkcję (usunąć przed wdrożeniem).
import type { Metadata } from "next";
import type { Block } from "@/lib/schema";
import { BlocksView } from "@/components/BlockRenderer";
import { Icon } from "@/components/canvas/ui";
import { PROTO_CSS } from "./proto-css";

export const metadata: Metadata = { title: "Prototyp: karta zrobionego kroku", robots: { index: false } };

type Example = {
  num: string; title: string; who: string; at: string; took: string;
  order: Block[];          // klocki kartki sprzed zamknięcia (zlecenie)
  sources: Block[];        // „Skąd”: materiał z pochodzeniem, zwinięty
  result: Block[];         // wynik: blok zmian albo nic (decyzja)
  report: string;          // podsumowanie wyniku
  links: { label: string; url: string }[];
  tech: string;
};

const REPO = "https://github.com/piotr-bialobrzeski-wrx/taskhub";
const EXAMPLES: Example[] = [
  {
    num: "01", title: "Zleć w projekcie: naprawa tworzenia grupy", who: "Claude w chmurze", at: "12:14", took: "Claude 9 min",
    order: [
      { type: "text", title: "Co ma powstać", body: "Tworzenie grupy działa ręcznie (przycisk „Grupa”, „Zgrupuj”) i poleceniem w czacie, także przy powiększeniu innym niż 100%. Dziś wyskakuje „Nie udało się: Minified React error #441”. Znaleźć przyczynę, poprawić i dodać test." },
      { type: "free", title: "Co widać na zrzucie", markdown: "- Po kliknięciu „Zgrupuj” przy dwóch zaznaczonych kafelkach pojawia się czerwony komunikat.\n- Ten sam błąd po poleceniu w czacie „zgrupuj kroki 03 i 04”.", source: { app: "taskhub", ref: "załącznik image.png, wiadomość Piotra 2026-10-25 10:40" } },
    ],
    sources: [{ type: "link", links: [{ title: "Zrzut błędu w załączniku zadania", url: "https://taskhub-lac.vercel.app/" }] }],
    result: [{
      type: "changes", title: "Zmiany w kodzie", repo: "piotr-bialobrzeski-wrx/taskhub", branch: "claude/project-thread-oswsq9",
      summary: "Położenie nowej grupy jest zaokrąglane do liczb całkowitych, bo baza nie przyjmowała ułamków z kanwy.",
      files: [
        { path: "src/lib/repo.ts", status: "modified", note: "createGroup i updateGroup zaokrąglają prostokąt", diff: "-  const r0 = rect ?? { x: 0, y: 0, w: 0, h: 0 };\n+  const r0 = rect ? roundRect(rect) : { x: 0, y: 0, w: 0, h: 0 };" },
        { path: "tests/repo.test.ts", status: "modified", note: "test grupy z ułamkowym prostokątem" },
      ],
    }],
    report: "Tworzenie grupy psuło się, bo kanwa podawała położenie grupy w ułamkach, a baza przyjmuje tylko liczby całkowite. Teraz położenie jest zaokrąglane; „Grupa”, „Zgrupuj” i grupa przy oddalonej kanwie działają. Poprawka czeka w paczce na wdrożenie.",
    links: [{ label: "Otwórz commit", url: `${REPO}/commit/dc3f233` }],
    tech: "Ty · ~10 min · bez zgody",
  },
  {
    num: "06", title: "Wybierz wariant ramek po obejrzeniu prototypu", who: "Ty", at: "18:31", took: "5 min",
    order: [
      { type: "text", body: "Prototyp z 5 stanami jest gotowy pod linkiem poniżej. Obejrzyj warianty A, B i C i wybierz jeden. Wdrożenie ruszy dopiero po Twoim wyborze." },
      { type: "question", text: "Który wariant ramek i etykiet wdrożyć?", options: [{ label: "A. Sama ramka" }, { label: "B. Ramka i pasek z etykietą" }, { label: "C. Ramka i znaczek w rogu" }], recommended: 1, answer: "B. Ramka i pasek z etykietą" },
    ],
    sources: [{ type: "link", links: [{ title: "Prototyp kafelków z 5 stanami", url: "https://taskhub-1cnxkh4j1-piotrbsecondary-4121.vercel.app/prototyp/kafelki" }] }],
    result: [],
    report: "Decyzja: B. Ramka i pasek z etykietą",
    links: [],
    tech: "Ty · ~5 min / 5 min · bez zgody",
  },
];

const Tick = () => <span className="pc-tick" aria-hidden="true"><Icon k="check" size={11} sw={2.6} /></span>;
const DoneMark = ({ e }: { e: Example }) => <span className="pc-done"><Tick />Zrobione, {e.who}, {e.at}</span>;

// zielona ramka „Teraz” z wynikiem: nagłówek, raport, blok zmian, przyciski (jak dziś)
function Result({ e }: { e: Example }) {
  return (
    <div className="zone ans now done">
      <div className="now-h"><span>Zrobione {e.at}</span><small>· {e.who} · {e.took}</small></div>
      <div className="note">{e.report}</div>
      {e.result.length ? <BlocksView blocks={e.result} /> : null}
      <div className="actions">
        {e.links.map((l, i) => <a key={l.url} className={"btn ico" + (i === 0 ? " primary" : "")} href={l.url} target="_blank" rel="noopener">{l.label}<Icon k="ext" size={13} sw={1.6} /></a>)}
        <button type="button" className="btn"><Icon k="undo" size={13} sw={1.9} /> {e.result.length ? "Przywróć do zrobienia" : "Zmień odpowiedź"}</button>
      </div>
    </div>
  );
}
// sekcja „Zlecenie”: oryginalne klocki bez zmian treści, każdy z ptaszkiem; mark = znaczek „Zrobione, kto, godzina” przy nagłówku
function Order({ e, mark = true }: { e: Example; mark?: boolean }) {
  return (
    <div className="zone pc-order">
      <div className="lbl">Zlecenie{mark ? <DoneMark e={e} /> : null}</div>
      {e.order.map((b, i) => <div key={i} className="pc-b"><Tick /><BlocksView blocks={[b]} /></div>)}
    </div>
  );
}
function Bottom({ e }: { e: Example }) {
  return (<>
    <details className="fold"><summary><span className="k">Skąd</span><span className="t">link</span><Icon k="chev" size={10} sw={2.2} /></summary><BlocksView blocks={e.sources} /></details>
    <details className="edit tech"><summary><span className="k">Szczegóły techniczne</span> · {e.tech}</summary><div className="stack"><div className="pctx"><span>Zadanie <b>Grupy, kafelki, kolejka</b> · Task Hub · prywatne</span></div></div></details>
  </>);
}

function Card({ e, v }: { e: Example; v: string }) {
  const id = `${v}-${e.num}`;
  return (
    <div className={`pc-panel v-${v}`}>
      <div className="d-bar"><span className="n-num">{e.num}</span><span className="ttl">{e.title}</span><button className="icobtn" type="button" aria-label="Zamknij"><Icon k="x" size={12} sw={2} /></button></div>
      <div className="d-body">
        {v === "a" ? <><Result e={e} /><Order e={e} /></> : null}
        {v === "b" ? <><Order e={e} /><Result e={e} /></> : null}
        {v === "c" ? (
          <div className="pc-c">
            <input type="radio" name={id} id={`${id}-r`} className="t-res" defaultChecked />
            <input type="radio" name={id} id={`${id}-o`} className="t-ord" />
            <div className="pc-tabs"><label htmlFor={`${id}-r`} className="res">Wynik</label><label htmlFor={`${id}-o`} className="ord">Zlecenie <Tick /></label></div>
            <div className="pc-pane res"><Result e={e} /></div>
            <div className="pc-pane ord"><Order e={e} /></div>
          </div>
        ) : null}
        <Bottom e={e} />
      </div>
    </div>
  );
}

const VARIANTS = [
  { v: "a", name: "A. Wynik na górze, zlecenie pod nim", note: "Zalecany. U góry zielona ramka „Zrobione” z wynikiem i zmianami, pod nią sekcja „Zlecenie” z oryginalnymi klockami, każdy z ptaszkiem. Najpierw widać, co wyszło, zaraz pod tym, co było do zrobienia." },
  { v: "b", name: "B. Zlecenie na górze, wynik pod nim", note: "Karta wygląda jak przed zamknięciem: klocki zlecenia dostają zieloną ramkę i ptaszek, wynik dochodzi na końcu. Kolejność jak w czasie pracy." },
  { v: "c", name: "C. Dwie zakładki", note: "„Wynik” i „Zlecenie” u góry karty, domyślnie otwarta „Wynik”. Krócej na ekranie, ale zlecenie jest o jedno kliknięcie dalej." },
];

export default function Page() {
  return (
    <main className="proto">
      <style dangerouslySetInnerHTML={{ __html: PROTO_CSS }} />
      <header className="pc-head">
        <h1>Prototyp: karta zrobionego kroku</h1>
        <p>Po zamknięciu kroku oryginalne zlecenie zostaje na karcie, oznaczone jako zrobione, a wynik dochodzi obok. Dwa przykłady w każdym wariancie: krok z kodem i decyzja z pytaniem. Ramka „Teraz” z pracą w toku znika, „Skąd” i „Szczegóły techniczne” zostają na dole. Dane są pokazowe.</p>
        <nav>{VARIANTS.map((x) => <a key={x.v} className="btn" href={`#w-${x.v}`}>{x.name}</a>)}</nav>
      </header>
      {VARIANTS.map((x) => (
        <section key={x.v} id={`w-${x.v}`} className="pc-sec">
          <h2>{x.name}</h2>
          <p className="pc-note">{x.note}</p>
          <div className="pc-grid">{EXAMPLES.map((e) => <Card key={e.num} e={e} v={x.v} />)}</div>
        </section>
      ))}
    </main>
  );
}
