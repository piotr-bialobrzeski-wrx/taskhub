// Projekt z treści zadania: nazwa projektu wymieniona w tytule, celu albo źródle (także odmieniona: „z projektu Shiftwow”, „w Task Hubie”,
// „dla Velozy”) daje projekt już przy przyjęciu zadania (dok na kanwie, szybkie zadanie z Maca, konektor, rozmowa), zanim agent cokolwiek
// rozpisze, więc działa też, gdy mostek stoi. Fraza „projekt <nazwa>” wygrywa z samą wzmianką, wcześniejsza wzmianka z późniejszą,
// dłuższa nazwa z krótszą. Nazwy krótsze niż 3 znaki pomijamy (za dużo przypadkowych trafień); projekt zawsze można zmienić w panelu zadania.
import type { Project } from "./schema";

const L = "a-z0-9ąćęłńóśźż";   // litera słowa (\b w JS nie zna polskich liter)
// końcówki odmiany doklejane do tematu nazwy („Shiftwowie”, „Task Hubem”, „Velozy”); dłuższe pierwsze
const ENDINGS = ["owie", "ami", "ach", "owi", "ów", "om", "em", "ie", "a", "u", "e", "y", "o", "i", "ę", "ą"];
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// formy nazwy do dopasowania: cała nazwa i nazwa bez nawiasu („Call Companion (hackathon Pirxey)” → „Call Companion”)
export function nameForms(name: string): string[] {
  const full = name.trim().replace(/\s+/g, " ");
  const bare = full.replace(/\s*\(.*\)\s*$/, "").trim();
  return [...new Set([full, bare])].filter((f) => f.length >= 3);
}

// temat formy: bez końcowej samogłoski, gdy nazwa ją ma i jest dłuższa niż 3 znaki („Veloza” → „Veloz”, bo „Velozy”, „Velozie”)
function stem(form: string): string {
  const low = form.toLowerCase();
  return low.length > 3 && /[aeoy]$/.test(low) ? low.slice(0, -1) : low;
}

// wzorzec jednej formy: opcjonalne „projekt/projektu/projekcie …” (grupa 1), temat z końcówką, granice słowa; spacje w nazwie = dowolne białe znaki
function pattern(form: string): RegExp {
  const s = esc(stem(form)).replace(/ /g, "\\s+");
  return new RegExp(`(projek[${L}]{1,4}\\s+)?(?<![${L}])${s}(?:${ENDINGS.join("|")})?(?![${L}])`, "iu");
}

type Named = Pick<Project, "id" | "name">;

export function guessProject<P extends Named>(text: string, projects: P[]): P | null {
  const t = (text ?? "").trim();
  if (!t) return null;
  let best: { p: P; phrase: boolean; at: number; len: number } | null = null;
  for (const p of projects) {
    for (const f of nameForms(p.name)) {
      const m = pattern(f).exec(t);
      if (!m) continue;
      const c = { p, phrase: !!m[1], at: m.index, len: f.length };
      if (!best || (c.phrase && !best.phrase) || (c.phrase === best.phrase && (c.at < best.at || (c.at === best.at && c.len > best.len)))) best = c;
    }
  }
  return best?.p ?? null;
}
