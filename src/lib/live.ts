// Praca na żywo: co mostek robi w tej chwili (z notatki biegu „narzędzie: argument”, którą aplikacja na Macu wysyła przy każdym użyciu
// narzędzia), z czym to powiązać (zadanie, krok: zapisuje serwer MCP przy każdym wywołaniu) i jeden stempel zmian, po którym przeglądarka wie,
// że ma się odświeżyć.
import type { BridgeRun, RunStep } from "./repo";

export type Activity = { text: string; detail: string | null };

// narzędzia konektora Task Hub: zdanie po polsku, od czasownika
const MCP: Record<string, string> = {
  list_work: "sprawdza, co czeka", get_task: "czyta zadanie", get_rules: "czyta zasady pracy", list_rules: "czyta zasady pracy", add_steps: "rozpisuje kroki",
  start_step: "zaczyna krok", complete_step: "zamyka krok", leave_step: "oddaje krok", skip_step: "zamyka zbędny krok", reopen_step: "otwiera krok ponownie", set_blocks: "układa kartkę kroku", add_facts: "zapisuje fakty",
  add_snapshot: "zapisuje migawkę", ask_question: "zadaje Ci pytanie", reply_chat: "odpowiada w rozmowie", update_task: "poprawia zadanie", update_step: "poprawia krok",
  create_task: "zakłada zadanie", get_attachment: "ogląda załącznik", describe_attachment: "opisuje załącznik", list_connections: "sprawdza połączenia",
  list_tasks: "przegląda zadania", list_projects: "przegląda projekty", list_companies: "przegląda firmy", create_project: "zakłada projekt", add_rule: "zapisuje zasadę", update_rule: "poprawia zasadę",
};
// narzędzia Claude Code
const CODE: Record<string, string> = {
  Read: "czyta plik", Edit: "zmienia plik", MultiEdit: "zmienia pliki", Write: "zapisuje plik", NotebookEdit: "zmienia notatnik", Bash: "uruchamia polecenie",
  Grep: "szuka w kodzie", Glob: "szuka plików", LS: "przegląda pliki", WebSearch: "szuka w sieci", WebFetch: "czyta stronę", Task: "deleguje pracę", Agent: "deleguje pracę",
  TodoWrite: "planuje", AskUserQuestion: "pyta", KillShell: "zamyka proces", BashOutput: "czyta wynik polecenia", ExitPlanMode: "kończy plan", EnterPlanMode: "planuje",
};
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function activityText(note: string | null | undefined): Activity | null {
  const n = (note ?? "").replace(/\s+/g, " ").trim();
  if (!n) return null;
  if (n === "start") return { text: "zaczyna", detail: null };
  const m = /^([A-Za-z][A-Za-z0-9_.-]*)(?::\s*(.*))?$/.exec(n);
  if (!m) return { text: n.slice(0, 80), detail: null };
  const tool = m[1], arg = (m[2] ?? "").trim();
  const detail = arg && !UUID.test(arg) ? arg.slice(0, 80) : null;
  if (MCP[tool]) return { text: MCP[tool], detail };
  if (CODE[tool]) return { text: CODE[tool], detail };
  // konektor innej aplikacji („slack_search_messages” po zdjęciu przedrostka mcp): nazwa narzędzia jako słowa
  return { text: `używa: ${tool.replace(/[_-]+/g, " ").toLowerCase()}`, detail };
}

// to, co mostek robi teraz, w kształcie dla kafelka i panelu; null, gdy nie ma otwartego biegu.
// steps: kroki, których bieg dotknął (świecą na kanwie); stoppable: bieg pracy v2, który Piotr może zatrzymać w Task Hub
export type LiveActivity = { text: string; detail: string | null; since: string; stepId: string | null; taskId: string | null; bridge: string; runId?: string; kind?: "work" | "send"; steps?: Record<string, RunStep>; stoppable?: boolean };
// bieg zatrzymany w Task Hub (stopAt) już nie pracuje, choć aplikacja na Macu jeszcze nie zgłosiła końca
export function liveActivity(run: BridgeRun | null | undefined): LiveActivity | null {
  if (!run || run.endedAt || run.stopAt) return null;
  const a = activityText(run.note) ?? { text: "pracuje", detail: null };
  return { text: a.text, detail: a.detail, since: run.startedAt, stepId: run.stepId, taskId: run.taskId, bridge: run.bridge, runId: run.id, kind: run.kind ?? "work", steps: run.steps ?? {}, stoppable: !!run.stoppable };
}
// czynność z numerem kroku, nad którym trwa („układa kartkę kroku 03”); na kafelku tego kroku słowo „kroku” odpada
export const nowText = (a: Pick<LiveActivity, "text">, idx: number | null) => (idx && / kroku$/.test(a.text) ? `${a.text} ${String(idx).padStart(2, "0")}` : a.text);
export const onTileText = (text: string) => text.replace(/ kroku$/, "");

// klucz odświeżania: stempel zmian w bazie + bieg mostka (id, ostatnia notatka, krok „teraz”, dotknięte kroki) + czy mostek żyje; inny klucz = przeglądarka ma odświeżyć stronę
export const liveKey = (stamp: string, run: BridgeRun | null | undefined, alive: boolean) => {
  const steps = run?.steps ? Object.values(run.steps) : [];
  const newest = steps.reduce((m, s) => (s.at > m ? s.at : m), "");
  return `${stamp}|${run && !run.endedAt && !run.stopAt ? `${run.id}:${run.note ?? ""}:${run.stepId ?? ""}:${steps.length}:${newest}` : ""}|${alive ? 1 : 0}`;
};
