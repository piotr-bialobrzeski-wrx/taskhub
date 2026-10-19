// Hand-off do Claude / Claude Code: gotowy prompt z celem, kontekstem, zasadami i wynikami wcześniejszych kroków.
// Zasada: Task Hub prowadzi, Claude wykonuje. Wynik wraca przez MCP (complete_step) albo wklejony raport.
import type { Rule, Step, Task } from "../schema";
import { toolLabel } from "../schema";
import { capText, rulesText } from "./context";

export function handoffPrompt(task: Task, step: Step, rules: Rule[], opts: { appUrl?: string; companyId?: string | null; attachments?: { caption: string | null; analysis: string | null }[] } = {}): string {
  const i = task.steps.indexOf(step) + 1;
  const prev = task.steps.filter((s) => step.dependsOn.includes(s.id)).map((d) => `- ${d.title}: ${(d.report || d.output || "(brak treści)").slice(0, 1200)}`).join("\n");
  const done = task.steps.filter((x) => x !== step && x.status === "done" && !step.dependsOn.includes(x.id)).map((x) => `- ${x.title}`).join("\n");
  const rt = rulesText(rules, task.projectId, [step.tool], { text: `${step.title} ${step.detail}`, companyId: opts.companyId ?? null });
  return `Pracujemy nad krokiem ${i} zadania „${task.title}” z mojej aplikacji Task Hub.

CEL ZADANIA: ${task.summary || "-"}
JAK TO WPADŁO: ${capText(task.source) || "-"}
${(opts.attachments ?? []).length ? `GRAFIKI (analiza):\n${opts.attachments!.map((a, k) => `- ${k + 1}. ${a.caption ?? ""}: ${(a.analysis ?? "").slice(0, 1200)}`).join("\n")}\n` : ""}${task.noteText ? `NOTATKA: ${task.noteText}\n` : ""}${rt ? rt + "\n" : ""}
TEN KROK (${toolLabel(step.tool)}): ${step.title}
${step.detail ? `SZCZEGÓŁY: ${step.detail}\n` : ""}${prev ? `WYNIKI WCZEŚNIEJSZYCH KROKÓW:\n${prev}\n` : ""}${done ? `INNE ZROBIONE KROKI:\n${done}\n` : ""}
Jeśli masz podłączony konektor Task Hub: nie pytaj mnie w czacie; gdy czegoś brakuje, przyjmij rozsądne założenie, a jeśli naprawdę nie da się bez mojej decyzji, zadaj pytanie przez ask_question (odpowiem w aplikacji). Istotne informacje zebrane po drodze (z ClickUp, Slacka, poczty) zapisz przez add_facts przy kroku ${step.id}, szkic do zatwierdzenia ułóż przez set_blocks (blok draft), a link do utworzonego elementu (wydarzenie, ticket, mail) podaj w complete_step. Na końcu zgłoś wynik przez complete_step dla kroku ${step.id} z krótkim podsumowaniem i linkiem do wyniku. Jeśli nie, napisz na końcu RAPORT (3-6 zdań: co powstało, gdzie jest, link, co zostało do zrobienia), który wkleję w Task Hub.${opts.appUrl ? `\nKrok w Task Hub: ${opts.appUrl}/tasks/${task.id}?step=${step.id}` : ""}`;
}

export const claudeUrl = (prompt: string) => "https://claude.ai/new?q=" + encodeURIComponent(prompt);
export const codeCommand = (prompt: string) => `claude "${prompt.replace(/(["\\$`])/g, "\\$1")}"`;

// Rozłożenie zadania na kroki w Claude z subskrypcji (bez klucza API w aplikacji): Claude zapisuje kroki przez add_steps.
export function breakdownPrompt(task: Task, rules: Rule[], opts: { appUrl?: string; projectName?: string; companyId?: string | null } = {}): string {
  const rt = rulesText(rules, task.projectId, [], { topic: ["rozpisanie"], text: `${task.title} ${task.summary}`, companyId: opts.companyId ?? null });
  return `Rozłóż na kroki zadanie „${task.title}” z mojej aplikacji Task Hub (id zadania: ${task.id}).

CEL: ${task.summary || "-"}
JAK TO WPADŁO: ${capText(task.source) || "-"}
${opts.projectName ? `PROJEKT: ${opts.projectName}\n` : ""}${task.due ? `TERMIN: ${task.due}\n` : ""}${rt ? rt + "\n" : ""}
Jeśli masz podłączony konektor Task Hub: wywołaj get_task dla tego zadania (pełny kontekst) i get_rules z topic ["rozpisanie"], a potem od razu zapisz kroki przez add_steps, bez pytania mnie o zgodę. Nie dopytuj: przyjmij rozsądne założenia i wpisz je w detail kroku. Gdy bez jakiejś informacji nie da się ułożyć kroków, zapisz kroki, które się da, i zadaj jedno pytanie przez ask_question (odpowiem w aplikacji). Gdy w treści jest termin, ustaw go przez update_task(due: YYYY-MM-DD). Każdy krok: title (co zrobić, od czasownika), tool (slack, gmail, clickup, calendar, claude, claudeapp, code, manual albo inna aplikacja), detail (co dokładnie, gdzie, dla kogo), est w minutach (wielokrotność 5), needsApproval true, gdy krok wysyła coś na zewnątrz, dependsOn jako n1, n2 dla kroków, które muszą poczekać na wcześniejsze; link tylko gdy krok ma swój element w zewnętrznej aplikacji (nigdy adres Task Hub). 2-7 kroków, bez kroków pustych. Jeśli konektora nie masz, wypisz kroki w tym układzie jako listę, a ja wkleję je do Task Hub.${opts.appUrl ? `\nZadanie w Task Hub: ${opts.appUrl}/tasks/${task.id}` : ""}`;
}
