// Dobór modelu i wysiłku do kroku (zasada „Dobór modelu i wysiłku”): każdy krok ma poziom pracy (Strategia, Analiza, Wykonanie, Mechanika),
// poziom ma model, wysiłek i model zapasowy z Ustawień → Agent (users.settings.models; nazwy modeli są danymi, nie kodem). Bieg mostka bierze
// jedną grupę pracy (ten sam model i wysiłek), a model w limicie zastępuje zapasowym do godziny końca limitu; po niej biegi same wracają na główny.
export const LEVELS = ["mechanics", "execution", "analysis", "strategy"] as const;   // od najtańszego
export type Level = (typeof LEVELS)[number];
export const LEVEL_LABELS: Record<Level, string> = { strategy: "Strategia", analysis: "Analiza", execution: "Wykonanie", mechanics: "Mechanika" };
export const LEVEL_HINTS: Record<Level, string> = {
  strategy: "wymyślić, zaplanować, rozstrzygnąć",
  analysis: "zebrać i zrozumieć materiał",
  execution: "krok dokładnie opisany",
  mechanics: "tylko przenieść albo wysłać",
};
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORTS)[number];
export const EFFORT_LABELS: Record<Effort, string> = { low: "niski", medium: "średni", high: "wysoki", xhigh: "bardzo wysoki", max: "maks." };
export const MAX_ESCALATION = 2;

export type LevelModel = { model: string; effort: Effort; fallback: string };
export type ModelConfig = { choices: string[]; levels: Record<Level, LevelModel> };
// skrót modelu w Claude Code (fable, opus, sonnet…) albo pełna nazwa: litery, cyfry, kropka, myślnik, nawiasy kwadratowe
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._\-[\]]{0,63}$/;
export const isModelName = (v: unknown): v is string => typeof v === "string" && MODEL_RE.test(v.trim());
const isEffort = (v: unknown): v is Effort => typeof v === "string" && (EFFORTS as readonly string[]).includes(v);

// ustawienia właściciela → konfiguracja; brak albo uszkodzona = null (bieg bez --model, jak przed paczką)
export function modelConfig(settings: Record<string, unknown> | null | undefined): ModelConfig | null {
  const m = settings?.models as { choices?: unknown; levels?: Record<string, unknown> } | undefined;
  if (!m || typeof m !== "object" || !m.levels) return null;
  const levels = {} as Record<Level, LevelModel>;
  for (const l of LEVELS) {
    const x = m.levels[l] as Partial<LevelModel> | undefined;
    if (!x || !isModelName(x.model) || !isEffort(x.effort)) return null;
    levels[l] = { model: x.model.trim(), effort: x.effort, fallback: isModelName(x.fallback) && x.fallback.trim() !== x.model.trim() ? x.fallback.trim() : "" };
  }
  const listed = Array.isArray(m.choices) ? m.choices.filter(isModelName).map((c) => c.trim()) : [];
  const choices = [...new Set([...listed, ...LEVELS.map((l) => levels[l].model)])];
  return { choices, levels };
}

// poziom z narzędzia albo z odpowiedzi agenta: angielskie klucze albo polskie nazwy z zasady
const LEVEL_WORDS: Record<string, Level> = { strategia: "strategy", analiza: "analysis", wykonanie: "execution", mechanika: "mechanics" };
export function normalizeLevel(v: unknown): Level | null {
  if (typeof v !== "string") return null;
  const k = v.trim().toLowerCase();
  return (LEVELS as readonly string[]).includes(k) ? (k as Level) : LEVEL_WORDS[k] ?? null;
}
// krok bez poziomu: kod i plik na Macu to Wykonanie, reszta (research, szkic, analiza) Analiza
export const defaultLevel = (tool: string): Level => (tool === "code" || tool === "file" ? "execution" : "analysis");

export type StepLike = { tool: string; needsApproval: boolean; workLevel?: string | null; modelPick?: string | null; escalation?: number };
const at = (i: number): Level => LEVELS[Math.max(0, Math.min(LEVELS.length - 1, i))];
// poziom, na którym bieg zrobi krok: poziom kroku (albo z narzędzia), w górę o eskalację po oddanych biegach i o jeden w projekcie o ważności 5;
// kartka z decyzją dla Piotra (jego krok, szkic do zatwierdzenia poza commitem) co najmniej na Analizie. Mechanika tylko wtedy, gdy nic nie zostaje do decyzji
export function stepLevel(s: StepLike, o: { weight?: number | null } = {}): Level {
  let i = LEVELS.indexOf(normalizeLevel(s.workLevel) ?? defaultLevel(s.tool));
  i += Math.max(0, Math.min(MAX_ESCALATION, s.escalation ?? 0));
  if ((o.weight ?? 0) >= 5) i += 1;
  const decision = s.tool === "manual" || (s.needsApproval && s.tool !== "code");
  if (decision) i = Math.max(i, LEVELS.indexOf("analysis"));
  return at(i);
}

// model i wysiłek dla jednej pozycji pracy; pick = wybór Piotra na karcie (wysiłek zostaje z poziomu, zapasowy to model poziomu albo jego zapasowy)
export type Choice = { level: Level; model: string; effort: Effort; fallback: string; picked: boolean; key: string };
export function choiceOf(cfg: ModelConfig, level: Level, pick?: string | null): Choice {
  const l = cfg.levels[level];
  const p = isModelName(pick) ? pick.trim() : "";
  const model = p || l.model;
  const fallback = p ? (l.model !== p ? l.model : l.fallback) : l.fallback;
  return { level, model, effort: l.effort, fallback: fallback !== model ? fallback : "", picked: !!p, key: `${model}|${l.effort}` };
}
export const stepChoice = (cfg: ModelConfig, s: StepLike, o: { weight?: number | null } = {}): Choice => choiceOf(cfg, stepLevel(s, o), s.modelPick);

// limity modeli: {skrót: ISO końca}; tylko te, które jeszcze trwają
export type Limits = Record<string, string>;
export function activeLimits(v: unknown, now = Date.now()): Limits {
  const out: Limits = {};
  if (!v || typeof v !== "object") return out;
  for (const [k, u] of Object.entries(v as Record<string, unknown>)) if (typeof u === "string" && new Date(u).getTime() > now) out[k] = u;
  return out;
}

// bieg: pierwsza grupa pracy (w kolejności listy), której model albo zapasowy nie jest w limicie.
// Wszystkie w limicie = blocked z najbliższą godziną, o której któryś wraca
export type RunPick = { choice: Choice; model: string; limited: { model: string; until: string } | null };
export function pickRun(choices: Choice[], limits: Limits): RunPick | { blockedUntil: string } | null {
  if (!choices.length) return null;
  const ends: string[] = [];
  for (const c of choices) {
    const lim = limits[c.model];
    if (!lim) return { choice: c, model: c.model, limited: null };
    if (c.fallback && !limits[c.fallback]) return { choice: c, model: c.fallback, limited: { model: c.model, until: lim } };
    ends.push(c.fallback ? [lim, limits[c.fallback]].sort()[1] : lim);
  }
  return { blockedUntil: ends.sort()[0] };
}

// „claude-sonnet-5-5” → „Sonnet 5.5”, „opus” → „Opus”, „claude-opus-5-5[1m]” → „Opus 5.5”
export function modelLabel(m: string | null | undefined): string {
  const t = (m ?? "").trim().replace(/\[[^\]]*\]$/, "").replace(/^claude-/i, "");
  if (!t) return "";
  const parts = t.split("-");
  const name = parts.filter((p) => !/^\d+$/.test(p)).join(" ");
  const ver = parts.filter((p) => /^\d+$/.test(p) && p.length <= 2).join(".");
  const cap = name.replace(/(^|\s)\S/g, (c) => c.toUpperCase());
  return ver ? `${cap} ${ver}` : cap;
}
export const runLabel = (model: string | null | undefined, effort: string | null | undefined): string =>
  [modelLabel(model), effort ? EFFORT_LABELS[effort as Effort] ?? effort : ""].filter(Boolean).join(" · ");

// koniec limitu z komunikatu Claude Code: sekundy uniksowe („…|1760630400”), jak w aplikacji na Macu
export function resetFromText(t: string | null | undefined): string | null {
  const m = /\b(1[6-9]\d{8})\b/.exec(t ?? "");
  return m ? new Date(Number(m[1]) * 1000).toISOString() : null;
}
