// Przełącznik wykonawcy (paczka 40, zadanie „Podłączenie GPT Codex do Task Hub”): pigułka „Agent” w prawym górnym rogu przełącza,
// kto robi pracę mostka na Macu: Claude (Claude Code) albo GPT (Codex CLI). Oba na subskrypcji Piotra, każdy zalogowany u siebie,
// więc przełączenie niczego nie wylogowuje: to tylko zwrotnica, do kogo idzie następny bieg.
// Nazwy modeli GPT są danymi (users.settings.gptModel, puste = domyślny model Codex), nie kodem.
// Do Codex idzie tylko praca, którą da się zrobić samym konektorem Task Hub (wiadomości, rozpisanie, odpowiedzi, tytuły, dokument, research).
// Kroki z aplikacjami z konta Claude (Slack, Gmail, ClickUp, Figma…), z kodem i z plikami na Macu oraz krok z modelem wybranym na karcie zostają przy Claude.
import type { Choice } from "./models";

export const RUNNERS = ["claude", "gpt"] as const;
export type Runner = (typeof RUNNERS)[number];
export const RUNNER_LABELS: Record<Runner, string> = { claude: "Claude", gpt: "GPT" };
export const isRunner = (v: unknown): v is Runner => typeof v === "string" && (RUNNERS as readonly string[]).includes(v);
export const runnerOf = (settings: Record<string, unknown> | null | undefined): Runner => (settings?.agentRunner === "gpt" ? "gpt" : "claude");

// model GPT z ustawień: te same znaki co nazwa modelu Claude; puste = Codex wybiera sam
const GPT_MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._\-]{0,63}$/;
export const gptModelOf = (settings: Record<string, unknown> | null | undefined): string => {
  const m = typeof settings?.gptModel === "string" ? settings.gptModel.trim() : "";
  return GPT_MODEL_RE.test(m) ? m : "";
};

// stan Codex zgłaszany przez mostek (aplikacja na Maca 0.1.20+): ready = zainstalowany i zalogowany kontem ChatGPT
export type CodexState = "ready" | "auth" | "missing" | "unknown";
export const codexStateOf = (meta: Record<string, unknown> | null | undefined): CodexState => {
  const v = meta?.codex;
  return v === "ready" || v === "auth" || v === "missing" ? v : "unknown";
};

// narzędzia kroków, które Codex zrobi samym konektorem Task Hub i wyszukiwarką
const GPT_TOOLS = new Set(["claude", "claudeapp", "browser", "www", "web", "research"]);
export const gptCanStep = (s: { tool: string; modelPick?: string | null }): boolean => GPT_TOOLS.has(s.tool) && !s.modelPick;

// prefiks modelu biegu GPT: w biegu, w limitach i w grupie pracy model GPT nie myli się z modelem Claude o tej samej nazwie
export const GPT_PREFIX = "gpt:";
export const isGptModel = (m: string | null | undefined): boolean => !!m && m.startsWith(GPT_PREFIX);
export const gptModelName = (m: string): string => (isGptModel(m) ? m.slice(GPT_PREFIX.length) : m);

// grupa pracy dla Codex: wysiłek z poziomu kroku (gdy jest dobór modeli), bez modelu zapasowego (Codex nie przełącza modeli w biegu)
export function gptChoice(base: Choice | null, model: string): Choice {
  const effort = base?.effort ?? "medium";
  const m = GPT_PREFIX + model;
  return { level: base?.level ?? "analysis", model: m, effort, fallback: "", picked: false, key: `${m}|${effort}`, runner: "gpt" };
}

// wysiłek Codex (model_reasoning_effort): low, medium, high; wyższe stopnie Claude'a to high
export const codexEffort = (e: string | null | undefined): "low" | "medium" | "high" => (e === "low" ? "low" : e === "medium" ? "medium" : e ? "high" : "medium");

// narzędzia konektora Task Hub, których Codex w biegu pracy nie dostaje (disabled_tools): kroki „Zleć w projekcie” bierze tylko wątek w chmurze.
// Inne konektory (Slack, Gmail, ClickUp) Codex w ogóle nie dostaje, więc nie ma czym wysłać; wysyłki robi osobny bieg Claude'a po zgodzie Piotra
export const CODEX_DISABLED_TOOLS = ["cloud_work", "take_cloud_step"];
