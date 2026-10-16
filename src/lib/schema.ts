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
  action: z.enum(["send", "reply", "create", "update", "comment", "other"]).default("send"),
});
export const DraftBlock = z.object({
  type: z.literal("draft"),
  title: z.string().optional(),
  target: DraftTarget,
  subject: z.string().optional(),
  body: z.string(),
  fields: z.array(Fact).max(12).optional(), // pola, które agent ustawi przy wysyłce (priorytet, lista, sprint)
  status: z.enum(["proposed", "approved", "sent"]).default("proposed"),
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
  TextBlock, FactsBlock, ThreadBlock, DraftBlock, ListBlock, MediaBlock, LinkBlock, QuestionBlock,
]);
export type Block = z.infer<typeof Block>;
export const Blocks = z.array(Block).max(12);

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
  report: z.string().nullable(),
  output: z.string(),
  review: z.record(z.string(), z.unknown()).nullable(),
  blocks: Blocks.nullable(),
  blocksAt: z.string().nullable(),
  logged: z.boolean(),
  pos: z.object({ x: z.number(), y: z.number() }).nullable(),
  dependsOn: z.array(z.string()),
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

export const Project = z.object({
  id: z.string(),
  name: z.string(),
  color: z.number().int(),
  weight: z.number().int().min(1).max(5),
  language: z.string(),
});
export type Project = z.infer<typeof Project>;

export const Task = z.object({
  id: z.string(),
  ownerId: z.string(),
  projectId: z.string().nullable(),
  title: z.string(),
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
  scope: z.enum(["global", "project", "tool"]),
  projectId: z.string().nullable(),
  tool: z.string().nullable(),
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
};
export const toolLabel = (tool: string) => TOOL_LABELS[tool] ?? tool;
// kroki robione poza aplikacją (hand-off do Claude / Claude Code)
export const EXTERNAL_TOOLS = new Set(["claudeapp", "code"]);
