// Kontekst dla agenta: to samo dla agenta w aplikacji, dla klientów MCP i dla promptów hand-off.
import { type Project, type Rule, type Task, type TimeSample, toolLabel } from "../schema";
import { LEVELS, scoreOf, whyText, type Score } from "../priority";
import { calibrationText, fmtMin, remainEst, taskSpent, todayISO } from "../time";
import { rulesFor } from "../repo";

export type Scored = { task: Task; score: Score; project: Project | null };

export function scoreAll(tasks: Task[], projects: Project[], samples: TimeSample[], now = Date.now()): Scored[] {
  const byId = new Map(projects.map((p) => [p.id, p]));
  const open = tasks.filter((t) => !t.deletedAt);
  return open.map((t) => {
    const blockedCount = open.filter((x) => x.id !== t.id && !(x.steps.length && x.steps.every((s) => s.status === "done")) && x.dependsOn.includes(t.id)).length;
    const project = t.projectId ? byId.get(t.projectId) ?? null : null;
    return { task: t, project, score: scoreOf({ task: t, project, blockedCount, samples, now }) };
  });
}

export const taskState = (t: Task): string => {
  if (t.deletedAt) return "w koszu";
  if (t.steps.length && t.steps.every((s) => s.status === "done")) return "ukończone";
  if (t.steps.some((s) => s.status === "handoff")) return "w Claude";
  if (t.steps.some((s) => s.status === "draft")) return "do zatwierdzenia";
  if (t.steps.some((s) => s.status === "done")) return "w toku";
  return "nowe";
};

export function brief(s: Scored): string {
  const t = s.task, p = t.steps.filter((x) => x.status === "done").length;
  return `- [${t.id}] ${t.title} | priorytet ${t.level}/5${s.score.eff !== t.level ? ` (efektywny ${s.score.eff}: ${whyText(s.score)})` : ""} | ${taskState(t)} | kroki ${p}/${t.steps.length} | zostało ~${fmtMin(remainEst(t))}${taskSpent(t) ? ` | zrobione ${fmtMin(taskSpent(t))}` : ""}${t.due ? ` | termin ${t.due}` : ""}${s.project ? ` | projekt: ${s.project.name}` : ""}${t.summary ? " | " + t.summary.slice(0, 140) : ""}`;
}

export function rulesText(rules: Rule[], projectId: string | null, tools: string[]): string {
  const list = rulesFor(rules, projectId, tools);
  if (!list.length) return "";
  return "ZASADY PRACY (stosuj je zawsze):\n" + list.map((r) => `- [${r.scope === "global" ? "ogólna" : r.scope === "project" ? "projekt" : toolLabel(r.tool ?? "")}] ${r.title}: ${r.body}`).join("\n");
}

export function notesText(tasks: Task[]): string {
  const done = tasks.filter((x) => !x.deletedAt && x.doneAt && x.noteText).sort((a, b) => (b.doneAt ?? "").localeCompare(a.doneAt ?? "")).slice(0, 20);
  return done.length ? `\nUKOŃCZONE WCZEŚNIEJ, notatki końcowe (sięgaj po nie tylko, gdy wiadomość ich dotyczy):\n${done.map((x) => `- [${x.id}] ${x.title} (${(x.doneAt ?? "").slice(0, 10)}): ${(x.noteText ?? "").slice(0, 240)}`).join("\n")}` : "";
}

export type ContextInput = {
  tasks: Task[]; projects: Project[]; rules: Rule[]; samples: TimeSample[];
  factPrefs?: string; currentTaskId?: string | null; now?: number;
};

// tekst kontekstu: główna kanwa albo wnętrze zadania
export function contextText(c: ContextInput): string {
  const scored = scoreAll(c.tasks, c.projects, c.samples, c.now);
  const open = scored.filter((s) => !s.task.doneAt || (s.task.doneAt && new Date(s.task.doneAt).getTime() > new Date().setHours(0, 0, 0, 0)));
  const head = `DZIŚ: ${todayISO(new Date(c.now ?? Date.now()))}. PROJEKTY (nazwa, ważność 1-5): ${c.projects.map((p) => `${p.name} ${p.weight}/5`).join(", ") || "(brak)"}.
${calibrationText(c.samples, toolLabel)}
${c.factPrefs ?? ""}`.trim();
  const cur = c.currentTaskId ? scored.find((s) => s.task.id === c.currentTaskId) : null;
  if (!cur) {
    return `${head}
${rulesText(c.rules, null, [])}
MIEJSCE: główna kanwa, kontekst = wszystkie zadania.
ZADANIA (${open.length}):
${open.slice(0, 60).map(brief).join("\n") || "(brak zadań)"}${notesText(c.tasks)}`;
  }
  const t = cur.task, others = open.filter((s) => s.task.id !== t.id);
  return `${head}
${rulesText(c.rules, t.projectId, t.steps.map((s) => s.tool))}
MIEJSCE: wnętrze zadania [${t.id}] "${t.title}". To jest domyślny kontekst wiadomości.
OBECNE ZADANIE: priorytet ${t.level}/5 (${LEVELS[cur.score.eff]}${cur.score.why.length ? ", efektywny " + cur.score.eff + ": " + whyText(cur.score) : ""}), stan: ${taskState(t)}${t.due ? `, termin ${t.due}` : ""}${cur.project ? `, projekt ${cur.project.name}` : ""}
Podsumowanie: ${t.summary || "-"}
Jak wpadło: ${(t.source || "-").slice(0, 800)}
Kroki:
${t.steps.map((s) => `- [${s.id}] ${s.title} | ${toolLabel(s.tool)} | stan: ${s.status} | po: ${s.dependsOn.join(", ") || "-"} | szacunek ${s.estMin} min${s.detail ? " | " + s.detail.slice(0, 160) : ""}${s.link ? " | link: " + s.link : ""}${s.output ? " | wynik: " + s.output.slice(0, 300) : ""}`).join("\n") || "(brak kroków)"}
INNE ZADANIA NA GŁÓWNEJ KANWIE (${others.length}):
${others.slice(0, 40).map(brief).join("\n") || "(brak)"}${notesText(c.tasks)}`;
}
