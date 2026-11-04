// Wzmianka osoby w treści szkicu: jeden zapis niezależny od aplikacji, `<@aplikacja:id|Imię Nazwisko>`, np. `<@slack:U09HEQ6BFE3|Piotr Białobrzeski>`,
// `<@clickup:81234567|Kinga Nowak>`. id = identyfikator osoby w aplikacji docelowej (Slack U…, ClickUp id użytkownika, WhatsApp numer).
// Na kartce szkicu wzmianka to znacznik osoby (@Imię Nazwisko); przy wysyłce każda aplikacja dostaje swój format (zamiana w osobnym kroku).
// Wzmianka bez id zostaje zwykłym tekstem „@Imię Nazwisko”: nic nie blokuje wysyłki, zapis szkicu tylko o tym ostrzega.
// Zapis zaczyna się od „<@”, jak natywna wzmianka Slacka `<@U…>`, ale dwukropek po nazwie aplikacji odróżnia go od niej (tamta zostaje, jaka jest).
import { outsideCode } from "./format";

export type Mention = { app: string; id: string; name: string };

// aplikacja: mała litera, potem litery, cyfry i myślnik; id bez spacji, „|” i „>”; nazwa bez „|”, „>” i końca linii.
// Edytor dostaje treść z „<” zamienionym na „&lt;” (toEditorMd), więc ten sam zapis bywa też w tej postaci.
const BODY = String.raw`@([a-z][a-z0-9-]{0,30}):([^\s|>]{1,120})\|([^|>\n]{1,120})>`;
export const MENTION_SRC = String.raw`(?:<|&lt;)` + BODY;
const one = () => new RegExp(MENTION_SRC, "g");

const cleanName = (s: string) => s.replace(/[|>\n]/g, " ").replace(/\s+/g, " ").trim();
export const mentionToken = (m: Mention) => `<@${m.app.toLowerCase()}:${m.id}|${cleanName(m.name)}>`;

// wzmianka na początku tekstu (do tokenizera edytora); null, gdy tekst nie zaczyna się od niej
export function mentionAt(src: string): (Mention & { raw: string }) | null {
  const m = new RegExp("^" + MENTION_SRC).exec(src);
  return m ? { raw: m[0], app: m[1], id: m[2], name: m[3].trim() } : null;
}

// wszystkie wzmianki z id w treści (poza kodem), w kolejności wystąpienia
export function parseMentions(md: string): Mention[] {
  const out: Mention[] = [];
  outsideCode(md, (t) => { for (const m of t.matchAll(one())) out.push({ app: m[1], id: m[2], name: m[3].trim() }); return t; });
  return out;
}

// każda wzmianka z id jako zwykłe „@Imię Nazwisko” (np. dla aplikacji, która nie umie oznaczać osób); kod zostaje bez zmian
export const mentionsToPlain = (md: string) => outsideCode(md, (t) => t.replace(one(), (_, _a, _i, name: string) => `@${name.trim()}`));

// zamiana każdej wzmianki z id według aplikacji: fn zwraca tekst w formacie aplikacji docelowej (null = zwykłe „@Imię Nazwisko”)
export const replaceMentions = (md: string, fn: (m: Mention) => string | null) =>
  outsideCode(md, (t) => t.replace(one(), (_, app: string, id: string, name: string) => fn({ app, id, name: name.trim() }) ?? `@${name.trim()}`));

// wzmianki bez id: „@Imię” albo „@Imię Nazwisko” (wielka litera, poza kodem, nie w adresie mailowym i nie w zapisie z id)
const BARE = /(?<![\p{L}\p{N}_.@<&;/-])@(\p{Lu}[\p{Ll}\p{M}'’-]+(?:[  ]\p{Lu}[\p{Ll}\p{M}'’-]+){0,2})/gu;
export function bareMentions(md: string): string[] {
  const out = new Set<string>();
  outsideCode(md, (t) => {
    const rest = t.replace(one(), " ");
    for (const m of rest.matchAll(BARE)) out.add("@" + m[1].replace(/ /g, " "));
    return t;
  });
  return [...out];
}

// ostrzeżenie przy zapisie szkicu: jedno zdanie dla agenta, gdy szkic ma wzmianki bez id; null, gdy wszystkie mają id
export function mentionWarning(bodies: (string | undefined)[]): string | null {
  const bare = [...new Set(bodies.flatMap((b) => (b ? bareMentions(b) : [])))];
  if (!bare.length) return null;
  const list = bare.slice(0, 6).map((b) => `„${b}”`).join(", ") + (bare.length > 6 ? ` i ${bare.length - 6} innych` : "");
  return `Uwaga: wzmianka bez id (${list}) poleci jako zwykły tekst, bez oznaczenia osoby. Jeśli to osoba w aplikacji docelowej, znajdź jej id konektorem tej aplikacji i zapisz wzmiankę jako <@aplikacja:id|Imię Nazwisko> (np. <@slack:U0123ABC|Jan Kowalski>), potem zapisz kartkę ponownie.`;
}
