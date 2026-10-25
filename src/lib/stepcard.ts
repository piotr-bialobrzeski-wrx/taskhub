// Karta kroku „Teraz · Co · Skąd” (paczka 2, punkt 8): stały porządek sekcji, wynik na wierzchu, nic nie pokazuje się dwa razy.
// Czysta logika bez React, żeby dało się ją testować; składanie w JSX jest w src/app/tasks/[id]/page.tsx.
import { appName, doneByOf, EXTERNAL_TOOLS, inApp, isAppCodeStep, isOwnerStep, normalizeTool, openLabel, TOOL_LABELS, toolLabel, type Block, type Step, type Task } from "./schema";
import { draftOf, draftsOf, isExternalApp, isGitDraft, isLocalFile, isPromptDraft, type Draft } from "./agent/approval";
import { fileName, isHttpUrl, safeHref } from "./safeurl";
import { fmtTime } from "./clock";
import { shortTitle } from "./auto";

export const KIND_LABEL: Record<string, string> = {
  text: "notatka", facts: "fakty", thread: "wątek", list: "lista", media: "pliki", link: "linki", mail: "mail", comment: "komentarz", table: "tabela",
  free: "treść", question: "pytanie", changes: "zmiany w kodzie", draft: "szkic",
};

export type Changes = Extract<Block, { type: "changes" }>;
export type CardState = "ready" | "blocked" | "handoff" | "draft" | "done";
export type ReportLine = { text: string; confirm: boolean };

// wynik kroku (blok zmian w kodzie) osobno od materiałów, z których agent korzystał; szkic obsługuje karta publikacji
export function splitBlocks(blocks: Block[]): { result: Changes[]; material: Block[] } {
  return { result: blocks.filter((b): b is Changes => b.type === "changes"), material: blocks.filter((b) => b.type !== "changes" && b.type !== "draft") };
}
export const kindsOf = (blocks: Block[]) => [...new Set(blocks.map((b) => KIND_LABEL[b.type] ?? b.type))].join(", ");

// paczka 17, punkt 1: otwarty krok Piotra pokazuje kartki zrobionych kroków Claude'a, od których zależy (np. „Przygotuj test” → „Rozwiąż test”),
// bo materiał, na którym Piotr pracuje, leży na kartce kroku przed nim; bez szkiców i pytań (to sprawy tamtego kroku), bez faktów kroku (ukryte)
export type DepCard = { id: string; idx: number; title: string; blocks: Block[] };
export function depCardsFor(steps: Pick<Step, "id" | "title" | "status" | "tool" | "doneBy" | "blocks">[], s: Pick<Step, "dependsOn" | "status" | "tool">): DepCard[] {
  if (s.status === "done" || !isOwnerStep(s)) return [];
  return steps.flatMap((x, i) => {
    if (!s.dependsOn.includes(x.id) || x.status !== "done" || doneByOf(x) !== "agent") return [];
    const blocks = splitBlocks(x.blocks ?? []).material.filter((b) => b.type !== "question");
    return blocks.length ? [{ id: x.id, idx: i + 1, title: x.title, blocks }] : [];
  });
}

// co jest rozwinięte: brief („Co”) i materiały („Skąd”) zwijają się po zrobieniu; przy szkicu brief ustępuje karcie publikacji;
// zrobiony odczyt Claude'a (reading) trzyma materiały rozwinięte, bo one są jego wynikiem (treść ticketu, wątku), nie tłem
export function foldsFor(state: CardState, mode: string | null, reading = false): { brief: boolean; material: boolean } {
  const done = state === "done";
  return { brief: !done && !mode, material: !done || reading };
}
// główna treść a „Skąd” (paczka 15, punkty 8–9): „Skąd” to materiał z pochodzeniem (wątek, mail, komentarz, wszystko ze źródłem, także fakty
// z przypisem), główna treść to to, co agent złożył sam (tabela, lista, notatka, treść bez źródła, odpowiedzi na pytania). Główna stoi zaraz
// pod „Teraz”; „Skąd” idzie pod nią, domyślnie zwinięte, chyba że karta nie ma nic innego (wtedy materiał jest treścią)
type WithSource = { source?: { app?: string; ref?: string; url?: string } | null };
const hasSrc = (x: WithSource | undefined) => !!(x?.source && (x.source.app || x.source.ref || x.source.url));
export function isSourced(b: Block): boolean {
  if (b.type === "thread" || b.type === "mail" || b.type === "comment" || b.type === "media" || b.type === "link") return true;
  if (b.type === "facts") return b.facts.some((f) => hasSrc(f as WithSource));
  if (b.type === "list") return hasSrc(b as WithSource) || b.items.some((i) => hasSrc(i as WithSource));
  return hasSrc(b as WithSource);
}
export function splitMain(material: Block[]): { main: Block[]; sources: Block[] } {
  const main = material.filter((b) => !isSourced(b));
  return main.length ? { main, sources: material.filter(isSourced) } : { main: [], sources: material };
}

// zrobiony odczyt: krok zamknięty przez Claude'a bez szkicu i bez zmian w kodzie, którego kartka niesie treść (paczka 9, punkt 1:
// do tej pory treść ticketu leżała pod zwiniętą linią „Skąd” i Piotr widział tylko link)
const CONTENT_KINDS = new Set(["free", "facts", "thread", "table", "list", "mail", "comment", "text", "media"]);
export function readingResult(s: Pick<Step, "status" | "tool" | "doneBy" | "blocks">, material: Block[]): boolean {
  if (s.status !== "done" || doneByOf(s) !== "agent") return false;
  if (s.blocks?.some((b) => b.type === "draft" || b.type === "changes")) return false;
  return material.some((b) => CONTENT_KINDS.has(b.type));
}
// kartka porównania (paczka 10, punkt 1): 2+ kolejne klocki źródłowe (ticket, wątek, mail, komentarz, tabela z adresem http(s)) stoją obok siebie
// w siatce .cmp; pytanie albo notatka między nimi przerywa ciąg (celowo: agent stawia pytanie przed porównywanymi elementami). Czysta logika, bez React
export const COMPARE_TYPES = new Set(["free", "comment", "thread", "mail", "table"]);
export const isSourceBlock = (b: Block): boolean => COMPARE_TYPES.has(b.type) && isHttpUrl((b as { source?: { url?: string } }).source?.url);
export function groupBlocks(blocks: Block[]): (Block | Block[])[] {
  const out: (Block | Block[])[] = [];
  let run: Block[] = [];
  const flush = () => { if (run.length > 1) out.push(run); else out.push(...run); run = []; };
  for (const b of blocks) { if (isSourceBlock(b)) run.push(b); else { flush(); out.push(b); } }
  flush();
  return out;
}
export const hasComparison = (blocks: Block[]): boolean => groupBlocks(blocks).some(Array.isArray);

const norm = (x: string) => x.replace(/\s+/g, " ").trim();
// raport bez powtórki: to, co już stoi w streszczeniu bloku zmian albo w treści szkicu, nie pokazuje się drugi raz; „Do potwierdzenia: …” wychodzi jako osobna linia
export function reportLines(report: string | null | undefined, known: (string | null | undefined)[]): ReportLine[] {
  const ks = known.map((k) => norm(k ?? "")).filter(Boolean);
  const out: ReportLine[] = [];
  for (const raw of (report ?? "").split(/\n+/)) {
    let line = norm(raw);
    for (const k of ks) if (line.includes(k)) line = norm(line.replace(k, " "));
    for (const part of line.split(/(?=do potwierdzenia:)/i).map(norm).filter(Boolean)) out.push({ text: part, confirm: /^do potwierdzenia:/i.test(part) });
  }
  return out;
}

// linki do wyniku bez dublowania: podgląd http z bloku zmian, potem link kroku (repozytorium, ticket, wydarzenie); ten sam adres nigdy dwa razy
export function resultLinks(s: Pick<Step, "tool">, changes: Pick<Changes, "preview"> | null, link: string | null): { label: string; url: string }[] {
  const out: { label: string; url: string }[] = [];
  const preview = changes?.preview && /^https?:\/\//.test(changes.preview) ? changes.preview : null;
  if (preview) out.push({ label: "Otwórz podgląd", url: preview });
  if (link && link !== preview) {
    const label = changes && /github\.com/.test(link) ? "Repozytorium" : EXTERNAL_TOOLS.has(s.tool) ? "Otwórz wynik" : s.tool === "manual" || s.tool === "claude" ? "Otwórz link" : openLabel(normalizeTool(s.tool));
    out.push({ label, url: link });
  }
  return out;
}
// rząd akcji strony kroku: po wysyłce bez linków (karta publikacji ma link do wyniku); zrobiony krok z blokiem zmian pod kartą nie powtarza
// „Otwórz podgląd”, bo ten przycisk niesie już blok zmian (jeden przycisk, nie dwa w tej samej strefie); „Repozytorium” i inne linki zostają
export function pageLinks(s: Pick<Step, "tool">, changes: Pick<Changes, "preview"> | null, link: string | null, mode: string | null, done: boolean): { label: string; url: string }[] {
  if (mode === "sent") return [];
  return resultLinks(s, changes, link).filter((l) => !(done && changes && l.label === "Otwórz podgląd"));
}

// ---------- dokąd idzie szkic: jedno źródło dla przycisku, linii pod nim, nagłówka po wysyłce, kafelka, listy i rozmowy ----------
export type DestKind = "send" | "file" | "commit" | "push" | "prompt" | "internal";
export type Dest = { kind: DestKind; app: string; name: string; in: string; where: string | null; action: string; subject: string | null };
export const ACTION: Record<string, string> = { send: "wyśle", reply: "odpowie", create: "utworzy", update: "zaktualizuje", comment: "skomentuje", commit: "zapisze commit", push: "wypchnie", other: "wykona" };
// czasownik na przycisku: mówi, co się stanie po zatwierdzeniu
export const VERB: Record<string, string> = { send: "wyślij", reply: "wyślij", create: "utwórz", update: "zaktualizuj", comment: "dodaj komentarz", commit: "zapisz commit", push: "opublikuj", other: "wykonaj" };
const PAST: Record<string, string> = { send: "Wysłałem", reply: "Wysłałem", create: "Utworzyłem", update: "Zaktualizowałem", comment: "Dodałem komentarz" };
// z tych samych pól szkicu, które wchodzą do podpisu zgody; bez szkicu tylko plik na Macu ma cel
export function destOf(s: Pick<Step, "tool" | "blocks"> & { filePath?: string | null }): Dest | null {
  const d = draftOf(s);
  if (!d) return s.tool === "file" || s.filePath ? { kind: "file", app: "file", name: toolLabel("file"), in: inApp("file"), where: null, action: "create", subject: null } : null;
  const app = normalizeTool(d.target.app, s.tool), action = d.target.action ?? "send";
  const kind: DestKind = isGitDraft(d, s.blocks) ? (action === "push" ? "push" : "commit") : isLocalFile(app) ? "file" : isPromptDraft(d, s.blocks) ? "prompt" : isExternalApp(app) ? "send" : "internal";
  const name = appName(d.target.app) || toolLabel(app);
  return { kind, app, name, in: TOOL_LABELS[app] ? inApp(app) : `· ${name}`, where: d.target.where?.trim() || null, action, subject: d.subject?.trim() || null };
}
export function approveLabel(d: Dest | null, o: { stays: boolean; rows: boolean }): string {
  if (o.stays || !d || d.kind === "internal" || d.kind === "file") return "Zatwierdź";
  if (d.kind === "prompt") return "Zatwierdź i uruchom";
  if (d.kind === "commit") return "Zatwierdź i zapisz commit";
  if (d.kind === "push") return "Zatwierdź i opublikuj na GitHubie";
  return `Zatwierdź i ${o.rows && d.action !== "create" ? "dopisz" : VERB[d.action] ?? "wyślij"} ${d.in}`;
}
// linia pod przyciskiem: miejsce i co dokładnie się stanie
export function destHint(d: Dest | null): string | null {
  if (!d || d.kind === "internal" || d.kind === "file") return null;
  const hint = d.kind === "commit" ? "commit na Macu, bez pusha" : d.kind === "push" ? "commit i push gałęzi" : d.kind === "prompt" ? "uruchomi ten prompt na Macu"
    : d.action === "create" ? (d.app === "clickup" ? "utworzy nowy ticket" : d.app === "calendar" ? "utworzy wydarzenie" : "utworzy")
    : d.action === "update" ? (d.app === "clickup" ? "zmieni ticket" : "zaktualizuje")
    : d.action === "comment" ? "doda komentarz" : d.action === "reply" ? "odpowie w wątku"
    : d.action === "send" ? (d.app === "gmail" ? "wyśle maila" : d.app === "slack" ? "wyśle wiadomość" : "wyśle") : "wykona";
  return `${d.where ?? d.name} · ${hint}`;
}
// nagłówek „Teraz” po wysyłce
export function sentWord(d: Dest): string {
  switch (d.kind) {
    case "send": return d.action === "create" ? "Utworzono" : d.action === "update" ? "Zaktualizowano" : d.action === "comment" ? "Dodano komentarz" : d.action === "send" || d.action === "reply" ? "Wysłano" : "Wykonano";
    case "file": return "Zapisano na Macu";
    case "commit": return "Zapisano commit na Macu";
    case "push": return "Wypchnięto na GitHub";
    case "prompt": return "Wykonano";
    default: return "Zatwierdzone";
  }
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const lastSeg = (w: string) => w.split("/").map((x) => x.trim()).filter(Boolean).pop() ?? w;
// dolna linia kafelka: przed zgodą dokąd pójdzie, po wysyłce dokąd poszło i o której (czas polski)
export function tileDest(d: Dest | null, s: Pick<Step, "status" | "doneAt" | "blocks"> & { filePath?: string | null }): string | null {
  if (!d) return null;
  const draft = draftOf(s);
  if (s.status === "done") {
    if (d.kind === "file") return `Plik na Macu${s.filePath ? " · " + fileName(s.filePath) : ""}`;
    if (draft?.status !== "sent") return null;
    const t = s.doneAt ? fmtTime(s.doneAt) : null;
    if (d.kind === "send") return [cap(d.in), d.where ? lastSeg(d.where) : null, t].filter(Boolean).join(" · ");
    if (d.kind === "commit") return ["Commit na Macu", t].filter(Boolean).join(" · ");
    if (d.kind === "push") return ["Na GitHubie", d.where, t].filter(Boolean).join(" · ");
    return null;
  }
  if (draft?.status !== "proposed") return null;
  // 2+ opcje bez wyboru: ile ich jest, nie dokąd idzie pierwsza (każda może iść gdzie indziej); wybór pokazuje karta
  const n = draftsOf(s).length, what = d.kind === "commit" ? "Commit" : d.name;
  if (n > 1) return `${what} · ${n} ${n <= 4 ? "opcje" : "opcji"}`;
  return `${what}${d.where ? " · " + d.where : ""}`;
}
// adres do kliknięcia z dolnej linii: tylko po wysyłce do aplikacji, tylko http(s)
export const tileDestHref = (d: Dest | null, s: Pick<Step, "status" | "link">): string | null => (d?.kind === "send" && s.status === "done" ? safeHref(s.link) ?? null : null);
// kto zamknął krok: Piotr („Ty”) albo Claude; kroki sprzed paczki 7 wg narzędzia
export const whoDid = (s: Pick<Step, "tool" | "doneBy">): "Ty" | "Claude" => (doneByOf(s) === "owner" ? "Ty" : "Claude");

// ---------- rodzaj kroku: jeden zestaw przycisków na rodzaj (paczka 7, punkt 1) ----------
// approval = szkic do zatwierdzenia (karta publikacji); agent = krok Claude'a (Przygotuj / Uruchom); decision = krok Piotra z pytaniem na kartce
// (odpowiedź zamyka krok); reading = „Przeczytaj …” (jeden przycisk „Przeczytane”); offline = krok Piotra poza aplikacją („Zrobione” z pytaniem o czas)
export type StepKind = "approval" | "agent" | "decision" | "reading" | "offline";
export const READ_RE = /^(przeczytaj|przejrzyj|zapoznaj się)(?=\s|$)/i;   // (?=\s|$), nie \b: po „ę” granica słowa nie działa
type QuestionB = Extract<Block, { type: "question" }>;
export function stepKind(s: Pick<Step, "tool" | "title" | "blocks">): StepKind {
  if (draftOf(s)) return "approval";
  if (!isOwnerStep(s)) return "agent";
  if (s.blocks?.some((b) => b.type === "question")) return "decision";
  return READ_RE.test(s.title.trim()) ? "reading" : "offline";
}
// krok Piotra „Zleć w projekcie: …” (paczka 12, punkt 3) i „Wdróż na produkcję” (paczka 13): pracę robi wątek projektu Claude w chmurze (zmiany w kodzie
// Task Hub; zasada w bazie). Mostek i automat go nie robią, bo to krok Piotra; karta ma „Uruchom w chmurze” (paczka 13, punkt 3: mostek odpala
// zaplanowane zadanie w chmurze) i awaryjnie polecenie do skopiowania
export const PROJECT_RE = /^zleć w projekcie(?=[\s,:;]|$)/i;
export const DEPLOY_RE = /^wdróż na produkcj[ęe](?=[\s,:;.]|$)/i;
// project: nazwa projektu zadania; krok z kodem w projekcie Task Hub też idzie do chmury (paczka 14, punkt 1)
export const isProjectStep = (s: Pick<Step, "tool" | "title">, project?: string | null) =>
  (isOwnerStep(s) && (PROJECT_RE.test(s.title.trim()) || DEPLOY_RE.test(s.title.trim()))) || isAppCodeStep(s, project);
export const isDeployStep = (s: Pick<Step, "tool" | "title">) => isOwnerStep(s) && DEPLOY_RE.test(s.title.trim());
// polecenie dla wątku projektu: co zrobić, brief kroku i skąd wziąć resztę (wątek ma konektor Task Hub, więc czyta zadanie sam i zamyka krok)
export function projectPrompt(t: Pick<Task, "id" | "title" | "steps">, s: Pick<Step, "id" | "title" | "detail">, appUrl: string): string {
  if (DEPLOY_RE.test(s.title.trim())) {
    const n = String(t.steps.findIndex((x) => x.id === s.id) + 1).padStart(2, "0");
    return [
      "Wdróż na produkcję bieżącą paczkę zmian Task Hub (to zgoda Piotra: „wypchnij paczkę”), według zasad wdrożenia z pamięci projektu.",
      s.detail.trim(),
      `Zadanie „${t.title}” (${appUrl}/tasks/${t.id}), krok ${n}. Po wdrożeniu zamknij ten krok (complete_step) z wynikiem: co weszło, commit na main i czy produkcja działa.`,
    ].filter(Boolean).join("\n\n");
  }
  const what = s.title.trim().replace(PROJECT_RE, "").replace(/^[\s,:;]+/, "") || s.title.trim();
  const n = String(t.steps.findIndex((x) => x.id === s.id) + 1).padStart(2, "0");
  return [
    `Zrób krok z Task Hub: ${what}.`,
    s.detail.trim(),
    `Zadanie „${t.title}” (${appUrl}/tasks/${t.id}), krok ${n}. Pełną treść, wcześniejsze kroki i decyzje przeczytaj przez get_task. Po skończeniu zamknij ten krok (complete_step) z wynikiem: co zmieniłeś i gdzie to jest.`,
  ].filter(Boolean).join("\n\n");
}
export const openQuestions = (s: Pick<Step, "blocks">): QuestionB[] => (s.blocks ?? []).filter((b): b is QuestionB => b.type === "question" && !b.answer);
// wynik kroku-decyzji zapisany w output: jedna odpowiedź wprost, kilka z treścią pytań
export function decisionText(s: Pick<Step, "blocks">): string {
  const qs = (s.blocks ?? []).filter((b): b is QuestionB => b.type === "question" && !!b.answer);
  if (!qs.length) return "";
  return qs.length === 1 ? `Decyzja: ${qs[0].answer}` : `Decyzje: ${qs.map((q) => `„${q.text}”: ${q.answer}`).join("; ")}`;
}
// odpowiedzi na kartce pochodzą tylko od Piotra: agent zapisujący kartkę (set_blocks) nie może ich dopisać ani zdjąć. Pytanie o tej samej treści
// zachowuje zapisaną odpowiedź (i poprzednią po zmianie decyzji); pytanie o innej treści wchodzi bez odpowiedzi
export function keepOwnerAnswers(was: Block[] | null | undefined, incoming: Block[]): Block[] {
  const stored = (was ?? []).filter((b): b is QuestionB => b.type === "question");
  return incoming.map((b): Block => {
    if (b.type !== "question") return b;
    const { answer: _a, prev: _p, ...rest } = b;
    const m = stored.find((q) => q.text === b.text);
    return { ...rest, ...(m?.answer ? { answer: m.answer } : {}), ...(m?.prev ? { prev: m.prev } : {}) };
  });
}
// linia w rozmowie zadania po zamknięciu kroku
export function doneChat(s: Pick<Step, "title" | "tool" | "blocks"> & { filePath?: string | null }, closed: boolean): string {
  const d = destOf(s), tail = closed ? " Zadanie ukończone." : "";
  const q = (x: string) => `„${shortTitle(x, 70)}”`;
  if (d?.kind === "send") return `${PAST[d.action] ?? "Zrobiłem"} ${d.in}: ${q(d.subject ?? s.title)}${d.where ? ` · ${d.where}` : ""}.${tail}`;
  if (d?.kind === "file") return `Zapisałem plik na Macu: ${s.filePath ? fileName(s.filePath) : q(s.title)}.${tail}`;
  if (d?.kind === "commit") return `Zapisałem commit na Macu: ${q(s.title)}.${tail}`;
  if (d?.kind === "push") return `Wypchnąłem na GitHub: ${q(s.title)}.${tail}`;
  return `Zrobione: ${q(s.title)}.${tail}`;
}

// dymek po oddaniu kroku (paczka 15, punkt 1): jedno zdanie o stanie i o tym, czego trzeba od Piotra; powód idzie osobno (actions.why)
export const CLOUD_WAIT_RE = /^[\s„"'(]*do zrobienia w projekcie w chmurze/i;
export function leaveChat(title: string, reason: string, waits: boolean): string {
  const q = `„${shortTitle(title, 70)}”`;
  if (CLOUD_WAIT_RE.test(reason)) return `Krok ${q} czeka, aż uruchomisz go w chmurze.`;
  if (waits || /^[\s„"'(]*czeka(m|my|ją)?(?=[\s,:;.]|$)/i.test(reason)) return `Krok ${q} czeka na inny krok. Nic nie musisz robić.`;
  return `Nie zrobiłem kroku ${q}. Potrzebuję, abyś coś zrobił.`;
}
// pełny powód przy krótkim dymku (zapisany w actions wpisu rozmowy)
export const whyOf = (m: { actions?: unknown }): string | null => {
  const w = (m.actions as { why?: unknown } | null | undefined)?.why;
  return typeof w === "string" && w.trim() ? w.trim() : null;
};

const steps = (n: number) => (n === 1 ? "1 krok" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? `${n} kroki` : `${n} kroków`);
// nagłówek sekcji „Teraz”: stan słowami i kolor bloku; po wysyłce słowo z celu („Utworzono”, „Wysłano”), strona dokłada godzinę;
// options = liczba szkiców w kroku: przy kilku Piotr wybiera opcję (każda karta pod nagłówkiem ma własne „Do zatwierdzenia”);
// sentAlready = wybrana opcja już poszła, a krok wrócił do zrobienia: nic nie czeka na zgodę, więc „Już wysłano” zamiast „Odłożony szkic” albo „Wybierz opcję”
export function nowHeading(state: CardState, mode: string | null, deps: number, waits: boolean, dest?: Dest | null, options = 1, sentAlready = false): { title: string; cls: string } {
  if (mode === "sent" && dest) return { title: sentWord(dest), cls: "done" };
  if (sentAlready && (mode === "proposed" || mode === "parked")) return { title: "Już wysłano", cls: "done" };
  if (mode === "proposed") return { title: options > 1 ? "Wybierz opcję" : "Do zatwierdzenia", cls: "draft" };
  if (mode === "sending") return { title: "W toku", cls: "handoff" };
  if (mode === "parked") return { title: "Odłożony szkic", cls: "draft" };
  if (mode === "unsent") return { title: "Zamknięty bez wysyłki", cls: "blocked" };
  if (state === "done") return { title: "Zrobione", cls: "done" };
  if (state === "handoff") return { title: "W pracy", cls: "handoff" };
  if (state === "blocked") return { title: waits ? "Czeka na inne zadanie" : `Czeka na ${steps(deps)}`, cls: "blocked" };
  return { title: "Do zrobienia", cls: "ready" };
}

// dokąd prowadzi krok jeszcze przed wysyłką: ticket, wątek albo dokument, w którym coś się zmieni. Kolejność: adres podany przez agenta w szkicu,
// adres albo id ClickUp w polu „dokąd”, potem źródło z kartki z tej samej aplikacji (ticket, wątek, komentarz, z którego krok wyrósł).
// option: konkretna opcja (karta opcji); bez niej szkic kroku (wybrany albo pierwszy)
const NO_TARGET = new Set(["manual", "claude", "claudeapp", "code", "file"]);
const HTTP = /https?:\/\/[^\s)>\]]+/;
export function targetLink(s: Pick<Step, "tool" | "title">, blocks: Block[] | null | undefined, option?: Draft): { label: string; url: string } | null {
  const draft = option ?? draftOf({ blocks: blocks ?? null });
  const app = normalizeTool(draft?.target.app ?? s.tool, s.tool);
  const label = openLabel(app);
  const given = draft?.target.url?.trim();
  if (given && /^https?:\/\//.test(given)) return { label, url: given };
  if (NO_TARGET.has(app)) return null;   // prompt dla agenta, zmiany w kodzie, krok ręczny: miejscem jest podgląd albo repozytorium z bloku zmian
  const where = draft?.target.where ?? "";
  const inWhere = HTTP.exec(where)?.[0];
  if (inWhere) return { label, url: inWhere };
  if (app === "clickup") {
    const id = [where, s.title].map((x) => /\b(?=[0-9a-z]*[a-z])(?=[0-9a-z]*\d)([0-9][0-9a-z]{6,10})\b/.exec(x)?.[1]).find(Boolean);
    if (id) return { label, url: `https://app.clickup.com/t/${id}` };
  }
  // zapas z kartki: jedno źródło tej aplikacji to miejsce kroku; dwa różne adresy (porównanie dwóch ticketów) to brak przycisku, bez zgadywania
  let url: string | null = null;
  for (const b of blocks ?? []) {
    const src = (b as { source?: { app?: string; url?: string } }).source;
    if (!(src?.url && /^https?:\/\//.test(src.url) && src.app?.toLowerCase() === app.toLowerCase())) continue;
    if (url && url !== src.url) return null;
    url = src.url;
  }
  return url ? { label, url } : null;
}

// to samo miejsce i ta sama czynność (np. komentarz w tickecie 869dxk3h9): po tym rozpoznajemy dwa kroki, które wysłałyby to samo dwa razy
const COMMENTISH = new Set(["figma", "github", "clickup"]);
export function draftPlace(s: Pick<Step, "tool" | "title">, blocks: Block[] | null | undefined): string | null {
  const draft = draftOf({ blocks: blocks ?? null });
  if (!draft) return null;
  const url = targetLink(s, blocks, draft)?.url;
  if (!url) return null;
  const app = draft.target.app.toLowerCase(), act = draft.target.action ?? "send";
  const kind = COMMENTISH.has(app) && (act === "reply" || act === "send") ? "comment" : act;
  // kilka nowych ticketów na jednej liście to różne rzeczy: przy tworzeniu miejsce rozróżnia tytuł
  const subject = act === "create" ? " " + (draft.subject ?? s.title).replace(/\s+/g, " ").trim().toLowerCase() : "";
  return `${url.replace(/[?#].*$/, "").replace(/\/+$/, "").toLowerCase()} ${kind}${subject}`;
}
// inne kroki zadania z szkicem do tego samego miejsca: otwarte (dwa szkice tego samego) i już wysłane (to samo poszło wcześniej)
export function sameTarget(steps: Step[], stepId: string, blocks: Block[] | null | undefined): { open: Step[]; sent: Step[] } {
  const me = steps.find((x) => x.id === stepId);
  const key = me ? draftPlace(me, blocks) : null;
  if (!key) return { open: [], sent: [] };
  const others = steps.filter((x) => x.id !== stepId && draftPlace(x, x.blocks) === key);
  return {
    open: others.filter((x) => x.status !== "done"),
    sent: others.filter((x) => x.status === "done" && x.blocks?.some((b) => b.type === "draft" && b.status === "sent")),
  };
}
