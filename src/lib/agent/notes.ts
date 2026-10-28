// Krótkie, jednorazowe zadania agenta: notatka końcowa, odbiór raportu, szkic kroku w aplikacji.
import { z } from "zod";
import { Ai } from "../ai";
import * as repo from "../repo";
import { Fact, type Rule, type Step, type Task, toolLabel } from "../schema";
import { capText, rulesText } from "./context";

const LINK_RE = /https?:\/\/[^\s<>"')\]]+/g;
export const linksIn = (txt: string | null | undefined) => [...new Set(String(txt ?? "").match(LINK_RE) ?? [])].slice(0, 8);

// po ukończeniu zadania: podsumowanie dla Piotra + notatka faktów dla agentów
export async function closingNote(ai: Ai, ownerId: string, task: Task): Promise<void> {
  const r = await ai.json({
    system: "Piszesz po polsku, tylko fakty z danych, bez wstępów. Odpowiadasz JSON.",
    prompt: `Zadanie w Task Hub zostało ukończone. Napisz dwie rzeczy:
1. "summary": PODSUMOWANIE DLA PIOTRA, 1-2 zdania prostym językiem: co jest zrobione i gdzie to znaleźć. Bez żargonu, bez identyfikatorów.
2. "note": NOTATKA KOŃCOWA dla agentów, 2-4 zdania samych faktów: co zrobiono, wynik, z kim, decyzje, linki.
Zadanie: ${task.title}
Cel: ${task.summary || "-"}
Jak wpadło: ${capText(task.source) || "-"}
Kroki:
${task.steps.map((s, i) => `${i + 1}. ${s.title} (${toolLabel(s.tool)})${s.detail ? ": " + s.detail.slice(0, 200) : ""}${s.output ? " | wynik: " + s.output.slice(0, 500) : ""}${s.link ? " | link: " + s.link : ""}`).join("\n")}`,
    schema: z.object({ summary: z.string(), note: z.string() }), effort: "low",
  });
  await repo.updateTask(ownerId, task.id, { noteText: r.note.slice(0, 1200), noteSummary: r.summary.slice(0, 400) });
}

// odbiór raportu wklejonego po pracy w Claude: jedno zdanie, linki, ostrzeżenie gdy nie pasuje
export const Review = z.object({ summary: z.string(), links: z.array(z.string()), fits: z.boolean(), warning: z.string() });
export async function reviewReport(ai: Ai, task: Task, step: Step): Promise<void> {
  const links = linksIn(step.report);
  await repo.updateStep(step.id, { review: { pending: true, links, at: new Date().toISOString() } });
  const r = await ai.json({
    system: "Robisz odbiór raportu po polsku, prostym językiem, tylko na podstawie tekstu. Odpowiadasz JSON.",
    prompt: `Zadanie: ${task.title}\nCel: ${task.summary || "-"}\nKrok: ${step.title}${step.detail ? " (" + step.detail.slice(0, 300) + ")" : ""}\nRAPORT:\n${(step.report ?? "").slice(0, 3000)}\n\nPola: summary (jedno zdanie do Piotra: co według raportu jest zrobione i gdzie), links (wszystkie adresy http), fits (czy raport dotyczy tego kroku i mówi o wyniku), warning (jedno zdanie, gdy fits=false albo raport mówi o problemie; inaczej pusty tekst).`,
    schema: Review, effort: "low",
  });
  const all = [...new Set([...links, ...r.links.filter((u) => /^https?:\/\//.test(u))])].slice(0, 8);
  await repo.updateStep(step.id, { review: { summary: r.summary.slice(0, 400), links: all, fits: r.fits, warning: r.warning.slice(0, 300), at: new Date().toISOString() }, link: step.link ?? all[0] ?? null });
}

// szkic kroku robionego w aplikacji (Slack, mail, ClickUp...): fakty + treść; w tej wersji nic nie jest wysyłane
export const Draft = z.object({ fields: z.array(Fact).max(6), output: z.string(), link: z.string().optional() });
export async function draftStep(ai: Ai, task: Task, step: Step, rules: Rule[], projectName?: string | null, companyId: string | null = null): Promise<void> {
  const prev = task.steps.filter((s) => step.dependsOn.includes(s.id)).map((d) => `- ${d.title}: ${(d.output || "(brak)").slice(0, 1500)}`).join("\n");
  const all = await repo.listAttachments({ taskId: task.id });
  const attachments = repo.stepAttachments(step, all) ?? all;   // tylko grafiki kroku (paczka 27); krok sprzed przypisywania: wszystkie
  const r = await ai.json({
    system: `Jesteś agentem wykonującym jeden krok zadania w aplikacji Task Hub. Przygotuj gotowy szkic tego, co agent zrobiłby lub wysłał. Odpowiadasz JSON: fields (2-5 najważniejszych informacji dla tego narzędzia, każda z source.app; gdy czegoś nie wiesz, rozsądne założenie z dopiskiem "(założenie)"), output (gotowa treść: wiadomość, mail, dokument w punktach albo lista zadań; konkretnie, maks. 220 słów), link (gdy w danych jest adres tego miejsca).
${rulesText(rules, task.projectId, [step.tool], { text: `${step.title} ${step.detail}`, companyId })}`,
    prompt: `Zadanie: ${task.title}${projectName ? ` (projekt ${projectName})` : ""}\nCel: ${task.summary}\nOpis od Piotra: ${task.source}\n${attachments.filter((a) => a.analysis).map((a, i) => `Grafika ${i + 1} (${a.caption ?? ""}): ${a.analysis}`).join("\n")}\nKrok (${toolLabel(step.tool)}): ${step.title}\nSzczegóły: ${step.detail}\nWyniki wcześniejszych kroków:\n${prev || "(brak)"}`,
    schema: Draft, effort: "medium",
  });
  const link = r.link && /^https?:\/\//.test(r.link) ? r.link : linksIn(r.fields.map((f) => f.value).join(" ") + " " + r.output)[0];
  await repo.updateStep(step.id, { output: r.output, status: step.needsApproval ? "draft" : "done", link: step.link ?? link ?? null });
  await repo.replaceFacts({ stepId: step.id }, r.fields.map((f) => ({ ...f, source: f.source ?? { app: step.tool } })));
}
