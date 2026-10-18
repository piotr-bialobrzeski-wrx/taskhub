// Praca na żywo: co mostek robi w tej chwili (z notatki biegu „narzędzie: argument”, którą aplikacja na Macu wysyła przy każdym użyciu
// narzędzia), z czym to powiązać (zadanie, krok) i jeden stempel zmian, po którym przeglądarka wie, że ma się odświeżyć.
import type { BridgeRun } from "./repo";

export type Activity = { text: string; detail: string | null };

// narzędzia konektora Task Hub: zdanie po polsku, od czasownika
const MCP: Record<string, string> = {
  list_work: "sprawdza, co czeka", get_task: "czyta zadanie", get_rules: "czyta zasady pracy", list_rules: "czyta zasady pracy", add_steps: "rozpisuje kroki",
  start_step: "zaczyna krok", complete_step: "zamyka krok", leave_step: "oddaje krok", set_blocks: "układa kartkę kroku", add_facts: "zapisuje fakty",
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
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

// „start_step: <id>” wiąże bieg z krokiem, „get_task: <id>” albo „add_steps: <id>” z zadaniem
const STEP_TOOLS = new Set(["start_step", "set_blocks", "complete_step", "leave_step", "add_facts", "add_snapshot", "update_step"]);
const TASK_TOOLS = new Set(["get_task", "add_steps", "update_task", "reply_chat", "ask_question"]);
export function linkOfNote(note: string | null | undefined): { stepId?: string; taskId?: string } | null {
  const m = /^([a-z_]+):\s*([0-9a-f-]{36})\s*$/i.exec((note ?? "").trim());
  if (!m) return null;
  if (STEP_TOOLS.has(m[1])) return { stepId: m[2] };
  if (TASK_TOOLS.has(m[1])) return { taskId: m[2] };
  return null;
}

// to, co mostek robi teraz, w kształcie dla kafelka i panelu; null, gdy nie ma otwartego biegu
export type LiveActivity = { text: string; detail: string | null; since: string; stepId: string | null; taskId: string | null; bridge: string };
export function liveActivity(run: BridgeRun | null | undefined): LiveActivity | null {
  if (!run || run.endedAt) return null;
  const a = activityText(run.note) ?? { text: "pracuje", detail: null };
  return { text: a.text, detail: a.detail, since: run.startedAt, stepId: run.stepId, taskId: run.taskId, bridge: run.bridge };
}

// klucz odświeżania: stempel zmian w bazie + bieg mostka (id i ostatnia notatka) + czy mostek żyje; inny klucz = przeglądarka ma odświeżyć stronę
export const liveKey = (stamp: string, run: BridgeRun | null | undefined, alive: boolean) => `${stamp}|${run && !run.endedAt ? `${run.id}:${run.note ?? ""}` : ""}|${alive ? 1 : 0}`;
