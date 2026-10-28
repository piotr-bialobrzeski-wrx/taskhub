// Składanie panelu kroku z uniwersalnych bloków.
// Bez AI, gdy nie ma czego interpretować (zwykły krok bez danych z zewnątrz); z AI, gdy są migawki, fakty do wyboru albo szkic do przygotowania.
import { z } from "zod";
import { Blocks, Fact, type Block, type Rule, type Step, type Task, toolLabel, EXTERNAL_TOOLS } from "../schema";
import { Ai } from "../ai";
import * as repo from "../repo";
import { capText, rulesText } from "./context";
import { coerceAgentDrafts, dedupeOptions } from "./approval";

export const ComposeResult = z.object({
  blocks: Blocks,
  facts: z.array(Fact).max(12),          // fakty, które agent uznał za istotne (zapisujemy z pochodzeniem)
  note: z.string().optional(),           // jedno zdanie do Piotra, co jest w tym kroku
});
export type ComposeResult = z.infer<typeof ComposeResult>;

const SYSTEM = `Jesteś agentem w aplikacji Task Hub (zadania jednej osoby, Piotra). Składasz panel jednego kroku z uniwersalnych bloków, jak na kartce papieru: pokazujesz tylko to, co jest potrzebne do zrobienia tego kroku, nic więcej.
Klocki kontekstu (to, na czym Piotr pracuje; każdy ma source {app, ref = miejsce, url}): "thread" (wątek wiadomości jako dymki: author, at, text, mine; Slack, WhatsApp, komentarze), "mail" (koperta: messages [{from, to, at, subject, text, mine}] od najstarszego; wątek maili), "comment" (jeden komentarz z miejscem: author, at, text; Figma, ClickUp, GitHub), "facts" (label, value, source), "table" (columns, rows, highlightFrom; wiersze arkusza albo listy), "list" (title, note, url, done), "media" (grafiki i pliki: kind image|file|link, url, name, caption, analysis), "link", "free" (markdown z nagłówkami, listami, linkami i obrazkami http/https; tylko gdy żaden inny klocek nie pasuje; meta = status, lista, osoba i daty w jednej linii), "text" (krótka notatka).
Odpowiedź: "draft" (to, co powstaje: target {app, where, action send|reply|create|update|comment|other}, subject, body, fields; dla wierszy arkusza columns + rows zamiast body; dla promptu dla agenta target.app "code" albo "claudeapp" i body = prompt), "question" (pytanie do Piotra z opcjami).
Kartka ma dwie strefy: najpierw klocki kontekstu w kolejności czytania (najważniejsze źródło pierwsze; długi wątek daj cały, aplikacja sama pokaże ostatnie 3), potem jeden "draft" (albo kilka jako opcje A, B, każdy z title). Dobierz rodzaj klocka do danych: rozmowa = thread, mail = mail, pojedynczy komentarz = comment, liczby i daty = facts, wiersze = table, zrzut ekranu = media z opisem w analysis.
Porównanie: każdy porównywany element to własny klocek "free", "thread", "mail" albo "comment" z source.url, "question" przed nimi, różnica w jednym "text"; ticket do odczytu: "free" z source.url, title, meta i samą treścią; warianty odpowiedzi: osobny "draft" na każdą opcję z title i target.url (Piotr wybierze jedną).
Zasady:
- Każdy fakt i każda akcja mają pochodzenie (source.app), bo Piotr musi wiedzieć, skąd jest liczba i gdzie poleci wysyłka.
- Z migawki (surowe dane z aplikacji) wybierz tylko pola istotne dla tego kroku; pomijaj szum (watchers, identyfikatory, puste pola). Preferencje pól Piotra są ważniejsze od Twojej oceny.
- Krok, który coś wysyła na zewnątrz, zawsze ma blok "draft" ze wskazaniem, gdzie i jak poleci; nic nie jest wysyłane bez zatwierdzenia.
- Grafiki i pliki z zadania pokaż w bloku "media" tylko, gdy pomagają w tym kroku.
- Maksymalnie 8 bloków. Pierwszy blok to to, na co Piotr ma spojrzeć najpierw. Bez bloku "text" powtarzającego tytuł kroku.
- Pisz po polsku, chyba że zasady projektu każą inaczej (np. treść szkicu po angielsku).
Odpowiadasz wyłącznie JSON zgodnym ze schematem.`;

// szybka wersja bez modelu: szczegóły, fakty, szkic lub wynik, załączniki (link kroku jest przyciskiem w akcjach)
export function composeStatic(step: Step, facts: Fact[], attachments: repo.Attachment[]): Block[] {
  const blocks: Block[] = [];
  const shown = facts.filter((f) => !f.hidden);
  if (step.detail) blocks.push({ type: "text", body: step.detail });
  if (shown.length) blocks.push({ type: "facts", facts: shown });
  if (step.output) blocks.push(step.needsApproval && step.status !== "done"
    ? { type: "draft", target: { app: step.tool, action: "send" }, body: step.output, status: "proposed" }
    : { type: "text", title: step.status === "done" ? "Wynik" : "Szkic", body: step.output });
  // SVG (także zapisane dawniej jako obrazek) to plik do pobrania: /api/files nie pokazuje go w przeglądarce
  const svg = (a: repo.Attachment) => a.mime === "image/svg+xml" || /\.svg$/i.test(a.name ?? "");
  const media = attachments.filter((a) => a.url).map((a) => ({ kind: svg(a) && a.kind === "image" ? "file" as const : a.kind, url: a.url!, name: a.name ?? undefined, caption: a.caption ?? undefined, analysis: a.analysis ?? undefined, mime: a.mime ?? undefined }));
  if (media.length) blocks.push({ type: "media", items: media });
  return blocks;
}

export type ComposeDeps = { ai: Ai; rules: Rule[]; factPrefs: string; projectName?: string | null; companyId?: string | null };

// pełna wersja: agent wybiera fakty z migawek i układa bloki; pamięta układ per źródło
export async function composeStep(ownerId: string, task: Task, step: Step, deps: ComposeDeps): Promise<{ blocks: Block[]; usedAi: boolean }> {
  const [facts, snapshots, all, memory] = await Promise.all([
    repo.listFacts({ stepId: step.id }), repo.latestSnapshots({ stepId: step.id }), repo.listAttachments({ taskId: task.id }), repo.getLayoutMemory(ownerId, step.tool),
  ]);
  const attachments = repo.stepAttachments(step, all) ?? all;   // krok sprzed przypisywania grafik (paczka 27): wszystkie, agent sam wybiera
  const needsAi = deps.ai.enabled && (snapshots.length > 0 || (step.needsApproval && !step.output && !EXTERNAL_TOOLS.has(step.tool) && step.tool !== "manual"));
  if (!needsAi) {
    const blocks = composeStatic(step, facts, attachments);
    await repo.updateStep(step.id, { blocks });
    return { blocks, usedAi: false };
  }
  const prev = task.steps.filter((s) => step.dependsOn.includes(s.id)).map((s) => `- ${s.title}: ${(s.report || s.output || "(brak)").slice(0, 1200)}`).join("\n");
  const prompt = `${rulesText(deps.rules, task.projectId, [step.tool], { text: `${step.title} ${step.detail}`, companyId: deps.companyId ?? null })}
${deps.factPrefs}
ZADANIE: ${task.title}${deps.projectName ? ` (projekt ${deps.projectName})` : ""}
CEL: ${task.summary || "-"}
JAK WPADŁO: ${capText(task.source) || "-"}
KROK (${toolLabel(step.tool)}): ${step.title}
SZCZEGÓŁY: ${step.detail || "-"}
${step.needsApproval ? "Ten krok wysyła coś na zewnątrz: przygotuj blok draft.\n" : ""}${prev ? `WYNIKI WCZEŚNIEJSZYCH KROKÓW:\n${prev}\n` : ""}${facts.length ? `FAKTY ZAPISANE WCZEŚNIEJ (pinned = zawsze pokazuj, hidden = nie pokazuj):\n${JSON.stringify(facts).slice(0, 4000)}\n` : ""}${snapshots.map((s) => `MIGAWKA z ${s.app} (${s.fetchedAt}${s.url ? ", " + s.url : ""}):\n${JSON.stringify(s.raw).slice(0, 12000)}`).join("\n")}
${attachments.length ? `ZAŁĄCZNIKI ZADANIA:\n${attachments.map((a) => `- ${a.kind} ${a.name ?? ""} ${a.url ?? "(bez adresu)"}${a.analysis ? ": " + a.analysis.slice(0, 300) : ""}`).join("\n")}\n` : ""}${memory ? `OSTATNI UKŁAD DLA ${toolLabel(step.tool)} (zachowaj kolejność i rodzaje bloków, jeśli pasują):\n${JSON.stringify(memory.map((b) => b.type))}\n` : ""}
Złóż panel tego kroku.`;
  const r = await deps.ai.json({ system: SYSTEM, prompt, schema: ComposeResult, effort: "medium" });
  // szkic z modelu jest zawsze propozycją (migawki z zewnątrz mogą podsunąć „approved”); zgodę daje tylko Piotr.
  // Opcje: ta sama treść drugi raz albo inna aplikacja niż pierwsza wypada (set_blocks takie odmawia; tu nie ma komu odmówić)
  const blocks = dedupeOptions(step.id, coerceAgentDrafts(step, r.blocks.slice(0, 8)));
  await Promise.all([
    repo.updateStep(step.id, { blocks }),
    repo.replaceFacts({ stepId: step.id }, r.facts.map((f) => ({ ...f, source: f.source ?? { app: step.tool } }))),
    repo.setLayoutMemory(ownerId, step.tool, blocks),
  ]);
  return { blocks, usedAi: true };
}
