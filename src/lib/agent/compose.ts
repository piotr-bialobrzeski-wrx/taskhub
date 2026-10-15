// Składanie panelu kroku z uniwersalnych bloków.
// Bez AI, gdy nie ma czego interpretować (zwykły krok bez danych z zewnątrz); z AI, gdy są migawki, fakty do wyboru albo szkic do przygotowania.
import { z } from "zod";
import { Blocks, Fact, type Block, type Rule, type Step, type Task, toolLabel, EXTERNAL_TOOLS } from "../schema";
import { Ai } from "../ai";
import * as repo from "../repo";
import { rulesText } from "./context";

export const ComposeResult = z.object({
  blocks: Blocks,
  facts: z.array(Fact).max(12),          // fakty, które agent uznał za istotne (zapisujemy z pochodzeniem)
  note: z.string().optional(),           // jedno zdanie do Piotra, co jest w tym kroku
});
export type ComposeResult = z.infer<typeof ComposeResult>;

const SYSTEM = `Jesteś agentem w aplikacji Task Hub (zadania jednej osoby, Piotra). Składasz panel jednego kroku z uniwersalnych bloków, jak na kartce papieru: pokazujesz tylko to, co jest potrzebne do zrobienia tego kroku, nic więcej.
Bloki (pole "type"): "text" (tytuł, treść), "facts" (lista faktów: label, value, source {app, ref, url}), "thread" (wątek wiadomości: author, at, text, mine), "draft" (szkic do zatwierdzenia: target {app, where, action}, subject, body, fields), "list" (lista rzeczy: title, note, url, done), "media" (grafiki i pliki: kind image|file|link, url, name, caption, analysis), "link" (linki), "question" (pytanie do Piotra z opcjami).
Zasady:
- Każdy fakt i każda akcja mają pochodzenie (source.app), bo Piotr musi wiedzieć, skąd jest liczba i gdzie poleci wysyłka.
- Z migawki (surowe dane z aplikacji) wybierz tylko pola istotne dla tego kroku; pomijaj szum (watchers, identyfikatory, puste pola). Preferencje pól Piotra są ważniejsze od Twojej oceny.
- Krok, który coś wysyła na zewnątrz, zawsze ma blok "draft" ze wskazaniem, gdzie i jak poleci; nic nie jest wysyłane bez zatwierdzenia.
- Grafiki i pliki z zadania pokaż w bloku "media" tylko, gdy pomagają w tym kroku.
- Maksymalnie 6 bloków. Pierwszy blok to to, na co Piotr ma spojrzeć najpierw. Bez bloku "text" powtarzającego tytuł kroku.
- Pisz po polsku, chyba że zasady projektu każą inaczej (np. treść szkicu po angielsku).
Odpowiadasz wyłącznie JSON zgodnym ze schematem.`;

// szybka wersja bez modelu: fakty przypięte, załączniki, link
export function composeStatic(step: Step, facts: Fact[], attachments: repo.Attachment[]): Block[] {
  const blocks: Block[] = [];
  const shown = facts.filter((f) => !f.hidden);
  if (step.detail) blocks.push({ type: "text", body: step.detail });
  if (shown.length) blocks.push({ type: "facts", facts: shown });
  if (step.output) blocks.push(step.needsApproval && step.status !== "done"
    ? { type: "draft", target: { app: step.tool, action: "send" }, body: step.output, status: "proposed" }
    : { type: "text", title: step.status === "done" ? "Wynik" : "Szkic", body: step.output });
  const media = attachments.filter((a) => a.url).map((a) => ({ kind: a.kind, url: a.url!, name: a.name ?? undefined, caption: a.caption ?? undefined, analysis: a.analysis ?? undefined, mime: a.mime ?? undefined }));
  if (media.length) blocks.push({ type: "media", items: media });
  if (step.link) blocks.push({ type: "link", links: [{ url: step.link, title: `Otwórz w ${toolLabel(step.tool)}`, source: { app: step.tool } }] });
  return blocks;
}

export type ComposeDeps = { ai: Ai; rules: Rule[]; factPrefs: string; projectName?: string | null };

// pełna wersja: agent wybiera fakty z migawek i układa bloki; pamięta układ per źródło
export async function composeStep(ownerId: string, task: Task, step: Step, deps: ComposeDeps): Promise<{ blocks: Block[]; usedAi: boolean }> {
  const [facts, snapshots, attachments, memory] = await Promise.all([
    repo.listFacts({ stepId: step.id }), repo.latestSnapshots({ stepId: step.id }), repo.listAttachments({ taskId: task.id }), repo.getLayoutMemory(ownerId, step.tool),
  ]);
  const needsAi = deps.ai.enabled && (snapshots.length > 0 || (step.needsApproval && !step.output && !EXTERNAL_TOOLS.has(step.tool) && step.tool !== "manual"));
  if (!needsAi) {
    const blocks = composeStatic(step, facts, attachments);
    await repo.updateStep(step.id, { blocks });
    return { blocks, usedAi: false };
  }
  const prev = task.steps.filter((s) => step.dependsOn.includes(s.id)).map((s) => `- ${s.title}: ${(s.report || s.output || "(brak)").slice(0, 1200)}`).join("\n");
  const prompt = `${rulesText(deps.rules, task.projectId, [step.tool])}
${deps.factPrefs}
ZADANIE: ${task.title}${deps.projectName ? ` (projekt ${deps.projectName})` : ""}
CEL: ${task.summary || "-"}
JAK WPADŁO: ${(task.source || "-").slice(0, 1500)}
KROK (${toolLabel(step.tool)}): ${step.title}
SZCZEGÓŁY: ${step.detail || "-"}
${step.needsApproval ? "Ten krok wysyła coś na zewnątrz: przygotuj blok draft.\n" : ""}${prev ? `WYNIKI WCZEŚNIEJSZYCH KROKÓW:\n${prev}\n` : ""}${facts.length ? `FAKTY ZAPISANE WCZEŚNIEJ (pinned = zawsze pokazuj, hidden = nie pokazuj):\n${JSON.stringify(facts).slice(0, 4000)}\n` : ""}${snapshots.map((s) => `MIGAWKA z ${s.app} (${s.fetchedAt}${s.url ? ", " + s.url : ""}):\n${JSON.stringify(s.raw).slice(0, 12000)}`).join("\n")}
${attachments.length ? `ZAŁĄCZNIKI ZADANIA:\n${attachments.map((a) => `- ${a.kind} ${a.name ?? ""} ${a.url ?? "(bez adresu)"}${a.analysis ? ": " + a.analysis.slice(0, 300) : ""}`).join("\n")}\n` : ""}${memory ? `OSTATNI UKŁAD DLA ${toolLabel(step.tool)} (zachowaj kolejność i rodzaje bloków, jeśli pasują):\n${JSON.stringify(memory.map((b) => b.type))}\n` : ""}
Złóż panel tego kroku.`;
  const r = await deps.ai.json({ system: SYSTEM, prompt, schema: ComposeResult, effort: "medium" });
  const blocks = r.blocks.slice(0, 6);
  await Promise.all([
    repo.updateStep(step.id, { blocks }),
    repo.replaceFacts({ stepId: step.id }, r.facts.map((f) => ({ ...f, source: f.source ?? { app: step.tool } }))),
    repo.setLayoutMemory(ownerId, step.tool, blocks),
  ]);
  return { blocks, usedAi: true };
}
