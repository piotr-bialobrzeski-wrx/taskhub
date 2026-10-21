// Kontekst dla agenta: to samo dla agenta w aplikacji, dla klientów MCP i dla promptów hand-off.
import { publishFormat } from "../format";
import { type Company, type Connection, type Project, type Rule, type Sphere, type Step, type Task, type TimeSample, CONNECTION_PROVIDER_LABELS, CONNECTION_STATE_LABELS, doneByOf, isOwnerStep, sphereOf, toolLabel } from "../schema";
import { LEVELS, scoreOf, whyText, type Score } from "../priority";
import { agentMinOf, calibrationText, fmtMin, remainEst, taskAgent, taskSpent, todayISO } from "../time";
import { rulesFor } from "../repo";
import { isPromptDraft, isSendable, type Approvable } from "./approval";

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
  if (t.steps.some((s) => s.status === "handoff")) return "w toku";
  if (t.steps.some((s) => s.status === "draft")) return "do zatwierdzenia";
  if (t.steps.some((s) => s.status === "done")) return "w toku";
  return "nowe";
};

export function brief(s: Scored): string {
  const t = s.task, p = t.steps.filter((x) => x.status === "done").length;
  return `- [${t.id}] ${t.title} | priorytet ${t.level}/5${s.score.eff !== t.level ? ` (efektywny ${s.score.eff}: ${whyText(s.score)})` : ""} | ${taskState(t)} | kroki ${p}/${t.steps.length} | Piotrowi zostało ~${fmtMin(remainEst(t))}${taskSpent(t) ? ` | czas Piotra ${fmtMin(taskSpent(t))}` : ""}${taskAgent(t) ? ` | czas Claude'a ${fmtMin(taskAgent(t))}` : ""}${t.due ? ` | termin ${t.due}` : ""}${s.project ? ` | projekt: ${s.project.name}` : " | bez projektu"}${t.summary ? " | " + t.summary.slice(0, 140) : ""}`;
}

// Zasady w prompcie w trzech sekcjach: PROFIL (dane o projekcie i narzędziach), ZASADY (zawsze) i PROCEDURY (pełna treść tylko tych, które
// pasują do kroku; reszta w spisie samym skrótem). Bloki: linia z zakresem i tytułem, pod nią treść z zachowanymi punktami.
export type RulesOpts = { topic?: string[]; text?: string; companyId?: string | null };
export const companyOf = (projectId: string | null | undefined, projects: Pick<Project, "id" | "companyId">[]): string | null => (projectId ? projects.find((p) => p.id === projectId)?.companyId ?? null : null);
const fold = (s: string) => s.toLowerCase().replace(/ł/g, "l").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
export const triggerTokens = (trigger: string | null | undefined): string[] => (trigger ?? "").split(/[,;\n]/).map((t) => fold(t.trim())).filter(Boolean);
// procedura pasuje, gdy słowo wyzwalacza to narzędzie kroku, podany temat albo fragment tekstu kroku; temat zawarty w tytule też ją włącza
export function procedureMatches(r: Rule, tools: string[], opts: RulesOpts = {}): boolean {
  const topics = (opts.topic ?? []).map(fold).filter(Boolean), text = fold(opts.text ?? ""), title = fold(r.title);
  const toolSet = new Set(tools.flatMap((t) => [fold(t), fold(toolLabel(t))]));
  if (topics.some((t) => title.includes(t))) return true;
  return triggerTokens(r.trigger).some((k) => toolSet.has(k) || topics.some((t) => t === k || t.includes(k)) || (text.length > 0 && text.includes(k)));
}
export function rulesText(rules: Rule[], projectId: string | null, tools: string[], opts: RulesOpts = {}): string {
  const list = rulesFor(rules, projectId, tools, opts.companyId ?? null);
  if (!list.length) return "";
  const scopeOf = (r: Rule) => r.scope === "global" ? "ogólna" : r.scope === "company" ? "firma" : r.scope === "project" ? "projekt" : `narzędzie ${toolLabel(r.tool ?? "")}`;
  const block = (r: Rule) => `[${scopeOf(r)}] ${r.title}\n${r.body.trim()}`;
  const profiles = list.filter((r) => r.kind === "profile"), always = list.filter((r) => r.kind === "rule"), procs = list.filter((r) => r.kind === "procedure");
  const out: string[] = [];
  if (profiles.length) out.push("PROFIL (fakty o firmie, projekcie i narzędziach; stosuj je jak dane):\n\n" + profiles.map(block).join("\n\n"));
  if (always.length) out.push("ZASADY PRACY (stosuj je zawsze):\n\n" + always.map(block).join("\n\n"));
  if (procs.length) {
    const on = procs.filter((r) => procedureMatches(r, tools, opts)), off = procs.filter((r) => !on.includes(r));
    const listed = off.map((r) => `- ${r.title}: ${(r.summary ?? "").trim() || r.body.trim().slice(0, 120)}${r.trigger ? ` [gdy: ${r.trigger}]` : ""}`).join("\n");
    const hint = "tylko spis; pełną treść pobierzesz przez get_rules z polem topic, gdy któraś pasuje do pracy";
    if (!on.length) out.push(`PROCEDURY (${hint}):\n${listed}`);
    else out.push("PROCEDURY (pełna treść tych, które pasują do tej pracy):\n\n" + on.map(block).join("\n\n") + (off.length ? `\n\nPozostałe procedury (${hint}):\n${listed}` : ""));
  }
  return out.join("\n\n");
}

// Połączenia: do czego agent ma dostęp i przez co. W zadaniu pokazujemy tylko połączenia z jego sfery (prywatne zadanie nie widzi Slacka firmy),
// żeby agent nie wysłał czegoś z niewłaściwego konta. Wygasłe i wyłączone są w spisie, bo agent ma wiedzieć, czego nie zrobi.
export function connectionsText(connections: Connection[], companies: Company[], sphere: Sphere | null): string {
  const list = sphere ? connections.filter((c) => c.sphere === sphere || c.provider === "taskhub") : connections;
  if (!list.length) return "";
  const cname = (id: string | null) => (id ? companies.find((x) => x.id === id)?.name ?? null : null);
  const named = (c: Connection) => { const l = c.label.toLowerCase(); return l.includes(c.app) || l.includes(toolLabel(c.app).toLowerCase()); };   // „Slack Pirxey” nie potrzebuje dopisku (Slack)
  const line = (c: Connection) => `${c.label}${named(c) ? "" : ` (${toolLabel(c.app)})`}${c.account ? ` ${c.account}` : ""} | ${cname(c.companyId) ?? (c.sphere === "private" ? "prywatne" : "zawodowe")} | ${CONNECTION_PROVIDER_LABELS[c.provider]}${c.state !== "active" ? ` | ${CONNECTION_STATE_LABELS[c.state].toUpperCase()}` : ""}`;
  return `POŁĄCZENIA (do czego masz dostęp, na jakim koncie, przez co${sphere ? `; tylko sfera ${sphere === "private" ? "prywatna" : "zawodowa"}` : ""}; krok z polem „połączenie” rób tym połączeniem, inaczej wybierz pasujące do firmy zadania):\n${list.map((c) => "- " + line(c)).join("\n")}`;
}
const connLabel = (id: string | null, connections?: Connection[]) => { const c = id ? connections?.find((x) => x.id === id) : null; return c ? ` | połączenie: ${c.label}${c.account ? ` (${c.account})` : ""}` : ""; };

export function notesText(tasks: Task[]): string {
  const done = tasks.filter((x) => !x.deletedAt && x.doneAt && x.noteText).sort((a, b) => (b.doneAt ?? "").localeCompare(a.doneAt ?? "")).slice(0, 20);
  return done.length ? `\nUKOŃCZONE WCZEŚNIEJ, notatki końcowe (sięgaj po nie tylko, gdy wiadomość ich dotyczy):\n${done.map((x) => `- [${x.id}] ${x.title} (${(x.doneAt ?? "").slice(0, 10)}): ${(x.noteText ?? "").slice(0, 240)}`).join("\n")}` : "";
}

export type ContextInput = {
  tasks: Task[]; projects: Project[]; rules: Rule[]; samples: TimeSample[]; companies?: Company[]; connections?: Connection[];
  factPrefs?: string; currentTaskId?: string | null; now?: number;
};

// tekst kontekstu: główna kanwa albo wnętrze zadania
// krok w kontekście: klucz narzędzia i etykieta, żeby agent kopiował klucz („code”), nie etykietę („Claude Code”)
const toolKey = (t: string) => (toolLabel(t) === t ? t : `${t} (${toolLabel(t)})`);

// Pełna treść zadania i wiadomości w kontekście (Piotr 2026-10-18: bez limitu 800 znaków, który ciął długie prompty i dawał połowiczne rozpisanie).
// Sufit bezpieczeństwa 50 tys. znaków = próg, od którego Claude Code zapisuje wynik narzędzia do pliku; ucięcie zawsze z jawnym dopiskiem.
export const TEXT_CAP = 50_000;
export function capText(text: string | null | undefined, cap = TEXT_CAP): string {
  const t = text ?? "";
  return t.length <= cap ? t : `${t.slice(0, cap)}\n[ucięto po ${cap} znakach; całość ma ${t.length} znaków]`;
}

export function contextText(c: ContextInput): string {
  const scored = scoreAll(c.tasks, c.projects, c.samples, c.now);
  const open = scored.filter((s) => !s.task.doneAt || (s.task.doneAt && new Date(s.task.doneAt).getTime() > new Date().setHours(0, 0, 0, 0)));
  const companies = c.companies ?? [];
  const cname = (p: Project) => p.companyId ? companies.find((x) => x.id === p.companyId)?.name ?? null : null;
  const cur = c.currentTaskId ? scored.find((s) => s.task.id === c.currentTaskId) : null;
  const head = `DZIŚ: ${todayISO(new Date(c.now ?? Date.now()))}. PROJEKTY (nazwa, ważność 1-5, firma albo prywatny): ${c.projects.map((p) => `${p.name} ${p.weight}/5 (${cname(p) ?? "prywatny"})`).join(", ") || "(brak)"}.
${connectionsText(c.connections ?? [], companies, cur ? sphereOf(cur.project, companies) : null)}
${calibrationText(c.samples)}
${c.factPrefs ?? ""}`.replace(/\n{2,}/g, "\n").trim();
  if (!cur) {
    return `${head}
${rulesText(c.rules, null, [], { topic: ["czat"] })}
MIEJSCE: główna kanwa, kontekst = wszystkie zadania.
ZADANIA (${open.length}):
${open.slice(0, 60).map(brief).join("\n") || "(brak zadań)"}${notesText(c.tasks)}`;
  }
  const t = cur.task, others = open.filter((s) => s.task.id !== t.id);
  return `${head}
${rulesText(c.rules, t.projectId, t.steps.map((s) => s.tool), { topic: ["czat"], text: `${t.title} ${t.summary}`, companyId: cur.project?.companyId ?? null })}
MIEJSCE: wnętrze zadania [${t.id}] "${t.title}". To jest domyślny kontekst wiadomości.
OBECNE ZADANIE: priorytet ${t.level}/5 (${LEVELS[cur.score.eff]}${cur.score.why.length ? ", efektywny " + cur.score.eff + ": " + whyText(cur.score) : ""}), stan: ${taskState(t)}${t.due ? `, termin ${t.due}` : ""}${cur.project ? `, projekt ${cur.project.name}${cname(cur.project) ? ` (firma ${cname(cur.project)})` : ""}, sfera ${sphereOf(cur.project, companies) === "private" ? "prywatna" : "zawodowa"}` : ""}
Podsumowanie: ${t.summary || "-"}
Jak wpadło: ${capText(t.source) || "-"}
Kroki:
${t.steps.map((s) => `- [${s.id}] ${s.title} | ${toolKey(s.tool)} | stan: ${s.status} | po: ${s.dependsOn.join(", ") || "-"}${isOwnerStep(s) ? ` | szacunek ${s.estMin} min` : agentMinOf(s) ? ` | czas Claude'a ${agentMinOf(s)} min` : ""}${s.status === "done" ? ` | zrobił: ${doneByOf(s) === "owner" ? "Piotr" : "Claude"}` : ""}${connLabel(s.connectionId, c.connections)}${s.detail ? " | " + s.detail.slice(0, 160) : ""}${s.link ? " | link: " + s.link : ""}${s.output ? " | wynik: " + s.output.slice(0, 300) : ""}`).join("\n") || "(brak kroków)"}
INNE ZADANIA NA GŁÓWNEJ KANWIE (${others.length}):
${others.slice(0, 40).map(brief).join("\n") || "(brak)"}${notesText(c.tasks)}`;
}

// get_task: kartka każdego niezrobionego kroku (bez szkiców, te idą w draftsText), żeby agent mógł ją poprawić po odpowiedzi Piotra.
// Klocki w kolejności z kartki, numerowane jak w set_blocks; zmiany zapisuje się pełnym zestawem klocków.
export function cardText(steps: Pick<Step, "id" | "title" | "status" | "blocks">[], max = 6000): string {
  const one = (b: NonNullable<Step["blocks"]>[number], i: number): string => {
    const h = `[${i}] ${b.type}${"title" in b && b.title ? ` „${b.title}”` : ""}`;
    switch (b.type) {
      case "text": return `${h}: ${b.body}`;
      case "facts": return `${h}: ${b.facts.map((f) => `${f.label} = ${f.value}`).join("; ")}`;
      case "table": return `${h} (${b.columns.join(" | ")}):\n${b.rows.map((r) => `  ${r.join(" | ")}`).join("\n")}`;
      case "list": return `${h}:\n${b.items.map((x) => `  - ${x.title}${x.note ? `: ${x.note}` : ""}${x.done ? " (zrobione)" : ""}`).join("\n")}`;
      case "question": return `${h}: ${b.text} | opcje: ${b.options.map((o) => o.label).join(" / ")}${b.answer ? ` | ODPOWIEDŹ PIOTRA: ${b.answer}` : ` | bez odpowiedzi${b.prev ? ` | WCZEŚNIEJ: ${b.prev}` : ""}`}`;
      case "free": return `${h}:\n${b.markdown}`;
      case "thread": return `${h}: ${b.messages.map((m) => `${m.author}: ${m.text}`).join(" / ")}`;
      case "mail": return `${h}: ${b.messages.map((m) => `${m.from}: ${m.text}`).join(" / ")}`;
      case "comment": return `${h}: ${b.author}: ${b.text}`;
      case "link": return `${h}: ${b.links.map((l) => l.title ?? l.url).join("; ")}`;
      case "media": return `${h}: ${b.items.map((m) => m.caption ?? m.name ?? m.url).join("; ")}`;
      case "changes": return `${h}: ${b.summary ?? ""} (${b.files.length} plików)`;
      default: return h;
    }
  };
  const out: string[] = [];
  for (const s of steps) {
    if (s.status === "done" || !s.blocks?.length) continue;
    const body = s.blocks.map((b, i) => (b.type === "draft" ? `[${i}] draft (pełna treść w SZKIC KROKU)` : one(b, i))).join("\n");
    out.push(`KARTKA KROKU ${s.id} „${s.title}”:\n${body.length > max ? body.slice(0, max) + "…" : body}`);
  }
  return out.join("\n");
}

// get_task: szkice kroków w pełnym brzmieniu. Zatwierdzony szkic (ZATWIERDZONE SZKICE DO WYSŁANIA w list_work) agent wysyła dokładnie w tej treści,
// więc body, temat, pola i wiersze idą bez skracania; odłożony szkic (krok wrócił do todo) i nieaktualny są oznaczone, żeby ich nie wysłać.
// send: czy ten, kto pyta, wysyła szkic tego kroku (stary mostek: ważna zgoda; bieg wysyłki: tylko jego krok; konektor i bieg pracy: nikt).
// Bez danych o zgodzie (same pola kroku) liczy się stan szkicu i kroku.
type DraftStep = Pick<Step, "id" | "title" | "status" | "blocks"> & Partial<Pick<Step, "approvedAt" | "approvedSig" | "sendStartedAt">>;
const legacySend = (s: DraftStep) => !("approvedSig" in s) || isSendable(s as Approvable);
export function draftsText(steps: DraftStep[], opts: { send?: (s: DraftStep) => boolean } = {}): string {
  const send = opts.send ?? legacySend;
  const out: string[] = [];
  for (const s of steps) {
    for (const b of s.blocks ?? []) {
      if (b.type !== "draft") continue;
      const state = b.stale ? "NIEAKTUALNY: przygotuj od nowa, nie wysyłaj"
        : b.status === "sent" ? "wysłany"
        : b.status === "approved" && s.status === "handoff" ? (send(s) ? (isPromptDraft(b, s.blocks) ? "ZATWIERDZONY PROMPT: wykonaj dokładnie to polecenie, potem complete_step" : "ZATWIERDZONY: wyślij dokładnie tę treść") : "zatwierdzony przez Piotra: wyśle go mostek Task Hub w osobnym biegu wysyłki; nie wysyłaj")
        : b.status === "approved" ? "zatwierdzony, ale krok nie czeka na wysyłkę: nie wysyłaj"
        : s.status === "draft" ? "czeka na zatwierdzenie Piotra: nie wysyłaj"
        : "odłożony: nie wysyłaj";
      const t = b.target;
      const lines = [`SZKIC KROKU ${s.id} „${s.title}” (${state})`, `- dokąd: ${t.app}${t.where ? ` · ${t.where}` : ""}${t.url ? ` · ${t.url}` : ""} · akcja ${t.action}`];
      if (b.subject) lines.push(`- temat: ${b.subject}`);
      if (b.fields?.length) lines.push(`- pola: ${b.fields.map((f) => `${f.label} = ${f.value}`).join("; ")}`);
      if (b.columns?.length) lines.push(`- wiersze (${b.columns.join(" | ")}):\n${(b.rows ?? []).map((r) => `  ${r.join(" | ")}`).join("\n")}`);
      if (b.body) {
        lines.push(`- treść w Markdown (dokładnie, między liniami ---):\n---\n${b.body}\n---`);
        // formatowanie: każda aplikacja dostaje swój format, inaczej gwiazdki i krzyżyki lecą dosłownie
        const f = publishFormat(t.app, b.body);
        if (f) lines.push(`- formatowanie: ${f.how}`);
        if (f?.text) lines.push(`- treść jako ${f.label} (wyślij tę wersję):\n---\n${f.text}\n---`);
      }
      out.push(lines.join("\n"));
    }
  }
  return out.join("\n");
}
