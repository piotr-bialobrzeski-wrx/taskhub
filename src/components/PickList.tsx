"use client";
// Paczka 69 (zadanie „Czytelna kartka kroku decyzji”, wersja B „Wybór na liście”): pytanie, w którym Piotr zaznacza pozycje listy
// (tickety, maile, wpisy). Każda pozycja ma zdanie od agenta i jego propozycję zaznaczenia; przycisk zgody mówi czynność i liczbę
// zaznaczonych, więc Piotr zatwierdza dokładnie to, co widzi. Drugi przycisk to odpowiedź „nic z listy”. Pola leżą w formularzu pytania
// (BlockRenderer), więc wysyłka idzie tą samą akcją co zwykłe opcje.
import { useState } from "react";

export type PickOption = { label: string; note?: string; on?: boolean; flag?: string };

export function PickList({ options, initial, submit, none, why }: { options: PickOption[]; initial?: string[] | null; submit?: string; none?: string; why?: string | null }) {
  const [on, setOn] = useState<boolean[]>(() => options.map((o) => (initial ? initial.includes(o.label) : !!o.on)));
  const n = on.filter(Boolean).length;
  const flip = (i: number) => setOn((a) => a.map((v, j) => (j === i ? !v : v)));
  return (
    <>
      <ul className="pick-list">
        {options.map((o, i) => (
          <li key={i} className={on[i] ? "on" : undefined}>
            <label>
              <input type="checkbox" name="pick" value={o.label} checked={on[i]} onChange={() => flip(i)} />
              <span className="pick-b">
                <span className="pick-t">{o.label}{o.flag ? <span className="pick-flag">{o.flag}</span> : null}</span>
                {o.note ? <span className="pick-n">{o.note}</span> : null}
              </span>
            </label>
          </li>
        ))}
      </ul>
      <div className="pick-go">
        <button type="submit" name="go" value="pick" className="btn primary" disabled={!n}>{(submit?.trim() || "Zatwierdź zaznaczone") + ` (${n})`}</button>
        <button type="submit" name="option" value={none?.trim() || "Nic z listy"} className="btn">{none?.trim() || "Nic z listy"}</button>
      </div>
      {why?.trim() ? <p className="pick-why">{why}</p> : null}
    </>
  );
}
