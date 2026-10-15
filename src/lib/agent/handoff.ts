// Hand-off do Claude / Claude Code: gotowy prompt z celem, kontekstem, zasadami i wynikami wcześniejszych kroków.
// Zasada: Task Hub prowadzi, Claude wykonuje. Wynik wraca przez MCP (complete_step) albo wklejony raport.
import type { Rule, Step, Task } from "../schema";
import { toolLabel } from "../schema";
import { rulesText } from "./context";

export function handoffPrompt(task: Task, step: Step, rules: Rule[], opts: { appUrl?: string; attachments?: { caption: string | null; analysis: string | null }[] } = {}): string {
  const i = task.steps.indexOf(step) + 1;
  const prev = task.steps.filter((s) => step.dependsOn.includes(s.id)).map((d) => `- ${d.title}: ${(d.report || d.output || "(brak treści)").slice(0, 1200)}`).join("\n");
  const done = task.steps.filter((x) => x !== step && x.status === "done" && !step.dependsOn.includes(x.id)).map((x) => `- ${x.title}`).join("\n");
  const rt = rulesText(rules, task.projectId, [step.tool]);
  return `Pracujemy nad krokiem ${i} zadania „${task.title}” z mojej aplikacji Task Hub.

CEL ZADANIA: ${task.summary || "-"}
JAK TO WPADŁO: ${(task.source || "-").slice(0, 1500)}
${(opts.attachments ?? []).length ? `GRAFIKI (analiza):\n${opts.attachments!.map((a, k) => `- ${k + 1}. ${a.caption ?? ""}: ${(a.analysis ?? "").slice(0, 1200)}`).join("\n")}\n` : ""}${task.noteText ? `NOTATKA: ${task.noteText}\n` : ""}${rt ? rt + "\n" : ""}
TEN KROK (${toolLabel(step.tool)}): ${step.title}
${step.detail ? `SZCZEGÓŁY: ${step.detail}\n` : ""}${prev ? `WYNIKI WCZEŚNIEJSZYCH KROKÓW:\n${prev}\n` : ""}${done ? `INNE ZROBIONE KROKI:\n${done}\n` : ""}
Na końcu zgłoś wynik do Task Hub: jeśli masz podłączony konektor Task Hub, wywołaj complete_step dla kroku ${step.id} z krótkim podsumowaniem i linkiem do wyniku. Jeśli nie, napisz na końcu RAPORT (3-6 zdań: co powstało, gdzie jest, link, co zostało do zrobienia), który wkleję w Task Hub.${opts.appUrl ? `\nKrok w Task Hub: ${opts.appUrl}/tasks/${task.id}?step=${step.id}` : ""}`;
}

export const claudeUrl = (prompt: string) => "https://claude.ai/new?q=" + encodeURIComponent(prompt);
export const codeCommand = (prompt: string) => `claude "${prompt.replace(/(["\\$`])/g, "\\$1")}"`;
