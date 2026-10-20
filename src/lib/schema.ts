// Typy domenowe i schematy bloków. Jedno źródło prawdy dla UI, agenta, API i MCP.
import { z } from "zod";

// ---------- pochodzenie: skąd jest fakt, wiadomość, akcja ----------
export const Provenance = z.object({
  app: z.string().min(1),                 // 'clickup', 'slack', 'gmail', 'calendar', 'claude', 'manual', ...
  ref: z.string().optional(),             // nazwa pola / id wiadomości / identyfikator
  url: z.string().url().optional(),
  fetchedAt: z.string().optional(),       // ISO
});
export type Provenance = z.infer<typeof Provenance>;

// ---------- fakt: jedna istotna informacja ----------
export const Fact = z.object({
  id: z.string().optional(),
  label: z.string().min(1),
  value: z.string(),
  source: Provenance.optional(),
  pinned: z.boolean().optional(),
  hidden: z.boolean().optional(),
});
export type Fact = z.infer<typeof Fact>;

// ---------- bloki: uniwersalne klocki UI, z których agent składa panel ----------
export const TextBlock = z.object({
  type: z.literal("text"),
  title: z.string().optional(),
  body: z.string(),
});
export const FactsBlock = z.object({
  type: z.literal("facts"),
  title: z.string().optional(),
  facts: z.array(Fact).max(12),
});
export const ThreadMessage = z.object({
  author: z.string(),
  at: z.string().optional(),
  text: z.string(),
  mine: z.boolean().optional(),           // wiadomość Piotra
  source: Provenance.optional(),
});
export const ThreadBlock = z.object({
  type: z.literal("thread"),
  title: z.string().optional(),
  source: Provenance.optional(),
  messages: z.array(ThreadMessage).max(30),
});
export const DraftTarget = z.object({
  app: z.string(),                         // gdzie poleci
  where: z.string().optional(),            // '#dev', 'anna@firma.pl', 'lista Backlog'
  url: z.string().max(2000).optional(),    // adres miejsca docelowego (ticket, wątek, kanał, dokument): przycisk „Otwórz w …” jeszcze przed wysyłką
  action: z.enum(["send", "reply", "create", "update", "comment", "commit", "push", "other"]).default("send"),   // commit/push: zmiany w kodzie do opublikowania
});
export const DraftBlock = z.object({
  type: z.literal("draft"),
  title: z.string().optional(),
  target: DraftTarget,
  subject: z.string().optional(),
  body: z.string(),
  fields: z.array(Fact).max(12).optional(), // pola, które agent ustawi przy wysyłce (priorytet, lista, sprint)
  columns: z.array(z.string()).max(12).optional(), // wiersze do dopisania (arkusz, tabela): nagłówki i wiersze zamiast body
  rows: z.array(z.array(z.string())).max(50).optional(),
  status: z.enum(["proposed", "approved", "sent"]).default("proposed"),
  stale: z.boolean().optional(),           // zakres pracy zmienił się po napisaniu szkicu (nowe kroki przed publikacją); agent przygotuje go od nowa
});
// zmiany w kodzie (krok Claude Code): pliki z diffem do rozwinięcia, podgląd (adres albo plik), repozytorium i gałąź
export const ChangedFile = z.object({
  path: z.string().max(400),
  status: z.enum(["added", "modified", "deleted", "renamed"]).optional(),
  diff: z.string().max(30000).optional(),  // unified diff tego pliku
  note: z.string().max(300).optional(),    // jedno zdanie, co się zmieniło
});
export const ChangesBlock = z.object({
  type: z.literal("changes"),
  title: z.string().optional(),
  repo: z.string().optional(),             // „wlrx/custom-cookies”
  branch: z.string().optional(),
  preview: z.string().optional(),          // adres podglądu: http(s) albo file://
  summary: z.string().max(2000).optional(), // co zostało zrobione i jak sprawdzone
  files: z.array(ChangedFile).max(60),
});
// ---------- klocki kontekstu: mail (koperta), komentarz (dymek z miejscem), tabela (wiersze), wolna treść (markdown) ----------
export const MailMessage = z.object({
  from: z.string(),
  to: z.string().optional(),
  at: z.string().optional(),
  subject: z.string().optional(),
  text: z.string(),
  mine: z.boolean().optional(),
});
export const MailBlock = z.object({
  type: z.literal("mail"),
  title: z.string().optional(),
  source: Provenance.optional(),
  messages: z.array(MailMessage).min(1).max(20), // od najstarszego; ostatni jest tym, na który Piotr odpowiada
});
export const CommentBlock = z.object({
  type: z.literal("comment"),
  source: Provenance.optional(),            // app + ref = miejsce (frame w Figmie, zadanie w ClickUp, wiersz arkusza)
  author: z.string(),
  at: z.string().optional(),
  text: z.string(),
});
export const TableBlock = z.object({
  type: z.literal("table"),
  title: z.string().optional(),
  source: Provenance.optional(),
  columns: z.array(z.string()).min(1).max(12),
  rows: z.array(z.array(z.string())).max(100),
  highlightFrom: z.number().int().min(0).optional(), // od którego wiersza zaznaczyć jako nowe
});
export const FreeBlock = z.object({
  type: z.literal("free"),
  title: z.string().optional(),
  source: Provenance.optional(),
  markdown: z.string().max(20000),         // gdy żaden inny klocek nie pasuje: nagłówki, akapity, listy, linki, obrazki (http/https)
});
export const ListItem = z.object({
  title: z.string(),
  note: z.string().optional(),
  url: z.string().url().optional(),
  done: z.boolean().optional(),
  source: Provenance.optional(),
});
export const ListBlock = z.object({
  type: z.literal("list"),
  title: z.string().optional(),
  items: z.array(ListItem).max(50),
});
export const MediaItem = z.object({
  kind: z.enum(["image", "file", "link"]),
  url: z.string(),
  name: z.string().optional(),
  caption: z.string().optional(),
  analysis: z.string().optional(),
  mime: z.string().optional(),
  source: Provenance.optional(),
});
export const MediaBlock = z.object({
  type: z.literal("media"),
  title: z.string().optional(),
  items: z.array(MediaItem).max(20),
});
export const LinkBlock = z.object({
  type: z.literal("link"),
  links: z.array(z.object({ url: z.string(), title: z.string().optional(), source: Provenance.optional() })).max(12),
});
export const QuestionBlock = z.object({
  type: z.literal("question"),
  text: z.string(),
  options: z.array(z.object({ label: z.string(), note: z.string().optional() })).min(2).max(6),
  recommended: z.number().int().min(0).optional(),
  answer: z.string().optional(),
});
export const Block = z.discriminatedUnion("type", [
  TextBlock, FactsBlock, ThreadBlock, DraftBlock, ListBlock, MediaBlock, LinkBlock, QuestionBlock, MailBlock, CommentBlock, TableBlock, FreeBlock, ChangesBlock,
]);
export type Block = z.infer<typeof Block>;
export const Blocks = z.array(Block).max(12);
// klocki kontekstu (to, na czym Piotr pracuje) kontra odpowiedź (blok draft) i pytanie
export const CONTEXT_BLOCK_TYPES = new Set(["text", "facts", "thread", "list", "media", "link", "mail", "comment", "table", "free", "changes"]);

// ---------- rekordy z bazy (kształt używany w aplikacji) ----------
export const StepStatus = z.enum(["todo", "draft", "done", "handoff"]);
export type StepStatus = z.infer<typeof StepStatus>;

export const Step = z.object({
  id: z.string(),
  taskId: z.string(),
  position: z.number().int(),
  title: z.string(),
  detail: z.string(),
  tool: z.string(),
  status: StepStatus,
  prevStatus: z.string().nullable(),
  needsApproval: z.boolean(),
  estMin: z.number().int(),
  spentSec: z.number().int(),
  spentManual: z.boolean(),
  link: z.string().nullable(),
  handoffAt: z.string().nullable(),
  doneAt: z.string().nullable(),   // kiedy krok został zrobiony (nagłówek „Zrobione HH:MM” na karcie)
  report: z.string().nullable(),
  output: z.string(),
  review: z.record(z.string(), z.unknown()).nullable(),
  blocks: Blocks.nullable(),
  blocksAt: z.string().nullable(),
  hasPrevBlocks: z.boolean().optional(),   // jest poprzednia wersja kartki (cofnięcie zmiany agenta)
  logged: z.boolean(),
  pos: z.object({ x: z.number(), y: z.number() }).nullable(),
  dependsOn: z.array(z.string()),
  connectionId: z.string().nullable(),   // przez które połączenie (konto, firma) zrobić ten krok; null = agent wybiera
  filePath: z.string().nullable().optional(),   // krok „Plik na Macu”: ścieżka zapisanego pliku (tekst do skopiowania, nigdy link)
  approvedAt: z.string().nullable().optional(),     // zgoda Piotra na szkic (tylko jego kliknięcie „Zatwierdź”)
  approvedSig: z.string().nullable().optional(),    // podpis zatwierdzonej treści; inna treść = brak zgody
  sendStartedAt: z.string().nullable().optional(),  // bieg wysyłki wziął szkic (najwyżej raz)
});
export type Step = z.infer<typeof Step>;

// pytanie agenta zadane w aplikacji; Piotr odpowiada w Task Hub, agent czyta odpowiedź przez konektor
export const Question = z.object({
  id: z.string(),
  taskId: z.string(),
  stepId: z.string().nullable(),
  text: z.string(),
  options: z.array(z.object({ label: z.string(), note: z.string().optional() })),
  recommended: z.number().int().nullable(),
  answer: z.string().nullable(),
  askedAt: z.string(),
  answeredAt: z.string().nullable(),
  seenAt: z.string().nullable(),
});
export type Question = z.infer<typeof Question>;

// Firma nad projektem: sfera zawodowa albo prywatna; projekt bez firmy jest prywatny. Firma po zakończeniu współpracy zostaje w archiwum (endedAt).
export const SPHERES = ["work", "private"] as const;
export type Sphere = (typeof SPHERES)[number];
export const SPHERE_LABELS: Record<Sphere, string> = { work: "zawodowa", private: "prywatna" };
export const Company = z.object({
  id: z.string(),
  name: z.string(),
  sphere: z.enum(SPHERES),
  note: z.string().nullable(),
  endedAt: z.string().nullable(),
});
export type Company = z.infer<typeof Company>;
export const Project = z.object({
  id: z.string(),
  name: z.string(),
  color: z.number().int(),
  weight: z.number().int().min(1).max(5),
  language: z.string(),
  companyId: z.string().nullable(),
});
export type Project = z.infer<typeof Project>;
// sfera projektu: z firmy; bez firmy = prywatna
export const sphereOf = (project: Pick<Project, "companyId"> | null | undefined, companies: Company[]): Sphere =>
  project?.companyId ? companies.find((c) => c.id === project.companyId)?.sphere ?? "work" : "private";

// Połączenie: aplikacja, do której agent ma dostęp, przez co (Claude w chmurze, Claude Code na komputerze, sam Task Hub),
// na jakim koncie i dla której firmy. Rura, nie klucz: bez tokenów cudzych usług. Mostek zgłasza swoje konektory sam (source bridge).
export const CONNECTION_PROVIDERS = ["claude", "claude-code", "taskhub"] as const;
export type ConnectionProvider = (typeof CONNECTION_PROVIDERS)[number];
export const CONNECTION_PROVIDER_LABELS: Record<ConnectionProvider, string> = { claude: "Claude", "claude-code": "Claude Code na komputerze", taskhub: "Task Hub" };
export const CONNECTION_KINDS = ["app", "mcp", "ical", "imap"] as const;
export type ConnectionKind = (typeof CONNECTION_KINDS)[number];
export const CONNECTION_KIND_LABELS: Record<ConnectionKind, string> = { app: "aplikacja", mcp: "konektor MCP", ical: "kalendarz iCal", imap: "skrzynka IMAP" };
export const CONNECTION_STATES = ["active", "expired", "off"] as const;
export type ConnectionState = (typeof CONNECTION_STATES)[number];
export const CONNECTION_STATE_LABELS: Record<ConnectionState, string> = { active: "działa", expired: "wygasło", off: "wyłączone" };
export const Connection = z.object({
  id: z.string(),
  app: z.string(),
  label: z.string(),
  account: z.string().nullable(),
  companyId: z.string().nullable(),
  sphere: z.enum(SPHERES),
  provider: z.enum(CONNECTION_PROVIDERS),
  kind: z.enum(CONNECTION_KINDS),
  state: z.enum(CONNECTION_STATES),
  source: z.enum(["manual", "bridge"]),
  host: z.string().nullable(),
  url: z.string().nullable(),
  meta: z.record(z.string(), z.unknown()),
  seenAt: z.string().nullable(),
});
export type Connection = z.infer<typeof Connection>;
// aplikacja z nazwy konektora: "slack" → slack, "gmail-pirxey" → gmail, "Mail" → gmail, "clickup" → clickup; nieznana → nazwa w małych literach
const APP_ALIASES: [RegExp, string][] = [
  [/slack/i, "slack"], [/gmail|\bmail|poczta|outlook/i, "gmail"], [/clickup/i, "clickup"], [/calendar|kalendarz/i, "calendar"],
  [/figma/i, "figma"], [/github/i, "github"], [/notion/i, "notion"], [/hubspot/i, "hubspot"], [/clockify/i, "clockify"],
  [/fireflies/i, "fireflies"], [/drive/i, "drive"], [/linkedin/i, "linkedin"], [/jira/i, "jira"], [/task[-_ ]?hub/i, "taskhub"], [/google|workspace/i, "google"],
];
export const appOfLabel = (label: string) => APP_ALIASES.find(([re]) => re.test(label))?.[1] ?? label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 30);

export const Task = z.object({
  id: z.string(),
  ownerId: z.string(),
  projectId: z.string().nullable(),
  title: z.string(),
  titleOriginal: z.string().nullable(),  // tytuł sprzed przepisania przez agenta; null = tytuł jest Piotra
  summary: z.string(),
  source: z.string(),
  level: z.number().int().min(1).max(5),
  due: z.string().nullable(),            // YYYY-MM-DD
  doneAt: z.string().nullable(),
  deletedAt: z.string().nullable(),
  noteText: z.string().nullable(),
  noteSummary: z.string().nullable(),
  noteAt: z.string().nullable(),
  pos: z.object({ x: z.number(), y: z.number() }).nullable(),
  createdAt: z.string(),
  dependsOn: z.array(z.string()),
  steps: z.array(Step),
});
export type Task = z.infer<typeof Task>;

// Trzy rodzaje zasad: profil = dane o projekcie albo narzędziu (język, klient, kanały), zasada = krótka reguła zawsze w prompcie,
// procedura = dłuższa instrukcja podawana w całości tylko, gdy pasuje wyzwalacz (narzędzie, temat, słowo z kroku); inaczej tylko skrót w spisie.
export const RULE_KINDS = ["profile", "rule", "procedure"] as const;
export type RuleKind = (typeof RULE_KINDS)[number];
export const RULE_KIND_LABELS: Record<RuleKind, string> = { profile: "Profil", rule: "Zasada", procedure: "Procedura" };
export const Rule = z.object({
  id: z.string(),
  kind: z.enum(RULE_KINDS),
  scope: z.enum(["global", "company", "project", "tool"]),
  companyId: z.string().nullable(),         // zakres „firma”
  projectId: z.string().nullable(),
  tool: z.string().nullable(),
  originCompanyId: z.string().nullable(),   // gdzie wypracowana; null = moja
  title: z.string(),
  body: z.string(),
  trigger: z.string().nullable(),   // procedura: słowa wyzwalające po przecinku (slack, story, bug, przegląd)
  summary: z.string().nullable(),   // procedura: jedno zdanie do spisu, gdy pełna treść nie jest podawana
  visibility: z.enum(["private", "project", "shared"]),
});
export type Rule = z.infer<typeof Rule>;

export const TimeSample = z.object({ tool: z.string(), projectId: z.string().nullable(), estMin: z.number(), spentMin: z.number() });
export type TimeSample = z.infer<typeof TimeSample>;

// ---------- narzędzia kroków: etykiety do UI, nie schematy ----------
export const TOOL_LABELS: Record<string, string> = {
  slack: "Slack", gmail: "E-mail", clickup: "ClickUp", calendar: "Kalendarz", claude: "Dokument",
  claudeapp: "Claude", code: "Claude Code", manual: "Ty", browser: "Przeglądarka", github: "GitHub", figma: "Figma",
  whatsapp: "WhatsApp", sheets: "Arkusz Google", docs: "Dokument Google", file: "Plik na Macu",
};
export const toolLabel = (tool: string) => TOOL_LABELS[tool] ?? tool;
// „w ClickUpie”, „na Slacku”: dokąd idzie treść, odmienione; nieznana aplikacja dostaje „· Nazwa”
export const TOOL_IN: Record<string, string> = {
  clickup: "w ClickUpie", slack: "na Slacku", gmail: "mailem", calendar: "w kalendarzu", github: "na GitHubie", figma: "w Figmie", whatsapp: "na WhatsAppie",
  sheets: "w arkuszu Google", docs: "w dokumencie Google", file: "na Macu",
};
export const inApp = (app: string) => TOOL_IN[app] ?? `· ${toolLabel(app)}`;
export const openLabel = (app: string) => "Otwórz " + (app === "gmail" ? "w Gmailu" : TOOL_IN[app] ?? "w " + toolLabel(app));
export const TOOL_KEYS = Object.keys(TOOL_LABELS);
// Klucz narzędzia przy zapisie: agent i formularze podają czasem etykietę („Claude Code”, „Ty”) albo alias (claude-code, e-mail);
// bez tego ten sam agent liczył się jako dwa narzędzia, a chip kroku był szary. Nieznany napis zostaje (małymi literami).
const TOOL_ALIASES: Record<string, string> = {
  "claude-code": "code", "claude_code": "code", "claudecode": "code", "kod": "code",
  piotr: "manual", me: "manual", ja: "manual", "ręcznie": "manual", recznie: "manual", human: "manual",
  email: "gmail", mail: "gmail", poczta: "gmail", outlook: "gmail",
  "google calendar": "calendar", gcal: "calendar",
  document: "claude", "claude app": "claudeapp", "claude.ai": "claudeapp", "aplikacja claude": "claudeapp",
  "przegladarka": "browser", web: "browser",
  arkusz: "sheets", "google sheets": "sheets", "google docs": "docs",
  git: "github",
  plik: "file",   // tylko „plik”: „dysk” to Dysk Google
};
const LABEL_KEYS: Record<string, string> = Object.fromEntries(Object.entries(TOOL_LABELS).map(([k, l]) => [l.toLowerCase(), k]));
export function normalizeTool(input: string | null | undefined, fallback = "manual"): string {
  const raw = (input ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!raw) return fallback;
  return TOOL_LABELS[raw] ? raw : TOOL_ALIASES[raw] ?? LABEL_KEYS[raw] ?? raw;
}
// kroki robione poza aplikacją (hand-off do Claude / Claude Code)
export const EXTERNAL_TOOLS = new Set(["claudeapp", "code"]);
