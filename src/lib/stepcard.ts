// Karta kroku „Teraz · Co · Skąd” (paczka 2, punkt 8): stały porządek sekcji, wynik na wierzchu, nic nie pokazuje się dwa razy.
// Czysta logika bez React, żeby dało się ją testować; składanie w JSX jest w src/app/tasks/[id]/page.tsx.
import { EXTERNAL_TOOLS, toolLabel, type Block, type Step } from "./schema";

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

// co jest rozwinięte: brief („Co”) i materiały („Skąd”) zwijają się po zrobieniu; przy szkicu brief ustępuje karcie publikacji
export function foldsFor(state: CardState, mode: string | null): { brief: boolean; material: boolean } {
  const done = state === "done";
  return { brief: !done && !mode, material: !done };
}

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
    const label = changes && /github\.com/.test(link) ? "Repozytorium" : EXTERNAL_TOOLS.has(s.tool) ? "Otwórz wynik" : s.tool === "manual" || s.tool === "claude" ? "Otwórz link" : `Otwórz w ${toolLabel(s.tool)}`;
    out.push({ label, url: link });
  }
  return out;
}

const steps = (n: number) => (n === 1 ? "1 krok" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? `${n} kroki` : `${n} kroków`);
// nagłówek sekcji „Teraz”: stan słowami i kolor bloku
export function nowHeading(state: CardState, mode: string | null, deps: number, waits: boolean): { title: string; cls: string } {
  if (mode === "proposed") return { title: "Do zatwierdzenia", cls: "draft" };
  if (mode === "sending") return { title: "W toku", cls: "handoff" };
  if (mode === "parked") return { title: "Odłożony szkic", cls: "draft" };
  if (mode === "unsent") return { title: "Zamknięty bez wysyłki", cls: "blocked" };
  if (state === "done") return { title: "Zrobione", cls: "done" };
  if (state === "handoff") return { title: "W pracy", cls: "handoff" };
  if (state === "blocked") return { title: waits ? "Czeka na inne zadanie" : `Czeka na ${steps(deps)}`, cls: "blocked" };
  return { title: "Do zrobienia", cls: "ready" };
}

// dokąd prowadzi krok jeszcze przed wysyłką: ticket, wątek albo dokument, w którym coś się zmieni. Kolejność: adres podany przez agenta w szkicu,
// adres albo id ClickUp w polu „dokąd”, potem źródło z kartki z tej samej aplikacji (ticket, wątek, komentarz, z którego krok wyrósł)
const NO_TARGET = new Set(["manual", "claude", "claudeapp", "code"]);
const HTTP = /https?:\/\/[^\s)>\]]+/;
export function targetLink(s: Pick<Step, "tool" | "title">, blocks: Block[] | null | undefined): { label: string; url: string } | null {
  const draft = blocks?.find((b) => b.type === "draft") as Extract<Block, { type: "draft" }> | undefined;
  const app = draft?.target.app ?? s.tool;
  const label = `Otwórz w ${toolLabel(app)}`;
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
  for (const b of blocks ?? []) {
    const src = (b as { source?: { app?: string; url?: string } }).source;
    if (src?.url && /^https?:\/\//.test(src.url) && src.app?.toLowerCase() === app.toLowerCase()) return { label, url: src.url };
  }
  return null;
}

// to samo miejsce i ta sama czynność (np. komentarz w tickecie 869dxk3h9): po tym rozpoznajemy dwa kroki, które wysłałyby to samo dwa razy
const COMMENTISH = new Set(["figma", "github", "clickup"]);
export function draftPlace(s: Pick<Step, "tool" | "title">, blocks: Block[] | null | undefined): string | null {
  const draft = blocks?.find((b) => b.type === "draft") as Extract<Block, { type: "draft" }> | undefined;
  if (!draft) return null;
  const url = targetLink(s, blocks)?.url;
  if (!url) return null;
  const app = draft.target.app.toLowerCase(), act = draft.target.action ?? "send";
  const kind = COMMENTISH.has(app) && (act === "reply" || act === "send") ? "comment" : act;
  return `${url.replace(/[?#].*$/, "").replace(/\/+$/, "").toLowerCase()} ${kind}`;
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
