// Projekt z treści zadania: nazwa projektu wymieniona w tytule, celu albo źródle (także odmieniona: „z projektu Shiftwow”, „w Task Hubie”,
// „dla Velozy”) daje projekt już przy przyjęciu zadania (dok na kanwie, szybkie zadanie z Maca, konektor, rozmowa), zanim agent cokolwiek
// rozpisze, więc działa też, gdy mostek stoi. Fraza „projekt <nazwa>” wygrywa z samą wzmianką (gdziekolwiek w tekście), wcześniejsza wzmianka
// z późniejszą, dłuższa nazwa z krótszą. Nazwy krótsze niż 3 znaki pomijamy (za dużo przypadkowych trafień); projekt zawsze można zmienić w panelu.
// Nazwa jako argument narzędzia (konektor, czat) musi pasować w całości: „Shiftwow Mobile” to nie Shiftwow, tylko nieznany projekt.
import type { Project } from "./schema";

const L = "a-z0-9ąćęłńóśźż";   // litera słowa (\b w JS nie zna polskich liter)
// końcówki odmiany doklejane do tematu nazwy („Shiftwowie”, „Task Hubem”, „Velozy”); dłuższe pierwsze
const ENDINGS = ["owie", "ami", "ach", "owi", "ów", "om", "em", "ie", "a", "u", "e", "y", "o", "i", "ę", "ą"];
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const nfc = (s: string) => (s ?? "").normalize("NFC");   // „ą” zapisane jako a + ogonek (NFD, np. z Maca) ma pasować do „ą”

// formy nazwy do dopasowania: cała nazwa i nazwa bez nawiasu („Call Companion (hackathon Pirxey)” → „Call Companion”)
export function nameForms(name: string): string[] {
  const full = nfc(name).trim().replace(/\s+/g, " ");
  const bare = full.replace(/\s*\(.*\)\s*$/, "").trim();
  return [...new Set([full, bare])].filter((f) => f.length >= 3);
}

// temat formy: bez końcowej samogłoski a/e/o, gdy stoi po literze („Veloza” → „Veloz”, bo „Velozy”, „Velozie”); „y” zostaje
// („Pirxey” → „Pirxeya”, „Pirxeyem”), samotna litera na końcu też („Plan A” to nie „Plan ”)
function stem(form: string): string {
  const low = form.toLowerCase();
  return /[a-ząćęłńóśźż][aeo]$/u.test(low) ? low.slice(0, -1) : low;
}

// wzorzec jednej formy: opcjonalne „projekt/projektu/projekcie …” (grupa 1, także z otwierającym cudzysłowem), temat z końcówką;
// w tekście granice słowa, jako cała nazwa początek i koniec napisu; spacje w nazwie = dowolne białe znaki
function pattern(form: string, whole = false): RegExp {
  const s = esc(stem(form)).replace(/ /g, "\\s+");
  const body = `(projek[${L}]{1,4}\\s+[„"'«]?)?${whole ? "" : `(?<![${L}])`}${s}(?:${ENDINGS.join("|")})?${whole ? "" : `(?![${L}])`}`;
  return whole ? new RegExp(`^${body}$`, "iu") : new RegExp(body, "giu");
}

type Named = Pick<Project, "id" | "name">;

export function guessProject<P extends Named>(text: string, projects: P[]): P | null {
  const t = nfc(text).trim();
  if (!t) return null;
  let best: { p: P; phrase: boolean; at: number; len: number } | null = null;
  for (const p of projects) {
    for (const f of nameForms(p.name)) {
      let first = -1, phraseAt = -1;
      for (const m of t.matchAll(pattern(f))) {
        if (first < 0) first = m.index;
        if (m[1] && phraseAt < 0) phraseAt = m.index;
      }
      if (first < 0) continue;
      const c = { p, phrase: phraseAt >= 0, at: phraseAt >= 0 ? phraseAt : first, len: f.length };
      if (!best || (c.phrase && !best.phrase) || (c.phrase === best.phrase && (c.at < best.at || (c.at === best.at && c.len > best.len)))) best = c;
    }
  }
  return best?.p ?? null;
}

// nazwa podana jako argument („Shiftwowa”, „projekt Shiftwow”, „Task Hubie”, w cudzysłowie): musi pasować w całości; „Shiftwow Mobile” → null
export function matchProjectName<P extends Named>(name: string, projects: P[]): P | null {
  const n = nfc(name).trim().replace(/^[„"'«]+|[”"'»]+$/g, "").trim();
  if (!n) return null;
  let best: { p: P; len: number } | null = null;
  for (const p of projects) for (const f of nameForms(p.name)) if (pattern(f, true).test(n) && (!best || f.length > best.len)) best = { p, len: f.length };
  return best?.p ?? null;
}
