// Zgoda Piotra na szkic: podpis treści (sha256), który zapisuje tylko jego kliknięcie „Zatwierdź” (repo.approveDraft).
// Każda zmiana treści szkicu unieważnia zgodę; agent nie ma jak jej podrobić, bo podpis liczy serwer z zapisanej treści.
import { createHash } from "node:crypto";
import { appOfLabel, normalizeTool, type Block, type Step } from "../schema";
import { sanitizeBlocks } from "../safeurl";

export type Draft = Extract<Block, { type: "draft" }>;
type HasBlocks = Pick<Step, "blocks"> | { blocks: Block[] | null };
// wszystkie szkice kroku w kolejności kartki: drugi i kolejne to opcje (paczka 10)
export const draftsOf = (s: HasBlocks): Draft[] => (s.blocks ?? []).filter((b): b is Draft => b.type === "draft");
// szkic kroku: wysłany, inaczej zatwierdzony, inaczej pierwszy. Przy jednym szkicu zawsze on; przy opcjach ta, którą Piotr wybrał
// (ten pokazuje karta publikacji, ten bierze wysyłka i ten jedynie może mieć zgodę)
export const draftOf = (s: HasBlocks): Draft | null => { const ds = draftsOf(s); return ds.find((d) => d.status === "sent") ?? ds.find((d) => d.status === "approved") ?? ds[0] ?? null; };
// opcje: wybrana = wysłana, inaczej zatwierdzona; odrzucone = propozycje obok wybranej. Odrzucenie wynika ze stanu, nic nie zapisujemy osobno
export function optionsOf(s: HasBlocks): { drafts: Draft[]; chosen: Draft | null; rejected: Draft[]; multi: boolean } {
  const drafts = draftsOf(s);
  const chosen = drafts.find((d) => d.status === "sent") ?? drafts.find((d) => d.status === "approved") ?? null;
  return { drafts, chosen, rejected: chosen ? drafts.filter((d) => d.status === "proposed") : [], multi: drafts.length > 1 };
}
const letter = (i: number) => String.fromCharCode(65 + i);
// nazwa opcji: title szkicu, inaczej litera z pozycji wśród szkiców („Opcja A”, „Opcja B”)
export const optionLabel = (d: Draft, i: number): string => d.title?.trim() || `Opcja ${letter(i)}`;
// numer opcji z numeru (0 = pierwsza) albo nazwy bez wielkości liter (title, „Opcja B”, samo „B”): poprawki z czatu i formularze; null, gdy nie ma takiej
export function optionIndex(s: HasBlocks, ref: number | string | undefined): number | null {
  const ds = draftsOf(s);
  const n = typeof ref === "string" && /^\d+$/.test(ref.trim()) ? Number(ref) : ref;
  if (typeof n === "number") return Number.isInteger(n) && ds[n] ? n : null;
  const q = n?.trim().toLowerCase(); if (!q) return null;
  const i = ds.findIndex((d, k) => [optionLabel(d, k), `Opcja ${letter(k)}`, letter(k)].some((x) => x.toLowerCase() === q));
  return i >= 0 ? i : null;
}

// JSON o stałej kolejności kluczy, bez pól undefined: ta sama treść zawsze daje ten sam podpis
const canon = (v: unknown): unknown => Array.isArray(v) ? v.map(canon)
  : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().filter((k) => (v as Record<string, unknown>)[k] !== undefined).map((k) => [k, canon((v as Record<string, unknown>)[k])]))
  : v;

type Changes = Extract<Block, { type: "changes" }>;
// klucz aplikacji do porównań: „E-mail”, „mail”, „Gmail” → gmail, „git” → github; arkusz i dokument Google idą przez Drive
const VIA_DRIVE = new Set(["sheets", "docs"]);
export const appKey = (s: string | null | undefined): string => { const k = appOfLabel(normalizeTool(s ?? "", "")); return VIA_DRIVE.has(k) ? "drive" : k; };
// commit robi aplikacja na Macu (bez modelu): czynność commit albo push, albo szkic do GitHuba z blokiem zmian (komentarz czy issue to zwykła wysyłka konektorem)
export function isGitDraft(d: Draft, blocks: Block[] | null | undefined): boolean {
  if (d.target.action === "commit" || d.target.action === "push") return true;
  return appKey(d.target.app) === "github" && !["comment", "reply", "create", "update"].includes(d.target.action) && !!(blocks ?? []).some((b) => b.type === "changes");
}
// szkic commita (commit, push albo GitHub, także „git”): po zgodzie aplikacja na Macu commituje pliki z bloku zmian, więc ten blok też jest
// częścią zgody; ten sam klucz aplikacji co isGitDraft, żeby każdy szkic, który idzie do commita, miał blok zmian w podpisie
const isGitish = (d: Draft) => d.target.action === "commit" || d.target.action === "push" || /github/i.test(d.target.app) || appKey(d.target.app) === "github";
const changesCore = (blocks: Block[] | null | undefined) => {
  const ch = (blocks ?? []).find((b): b is Changes => b.type === "changes");
  if (!ch) return undefined;
  const files = ch.files.map((f) => ({ path: f.path.trim(), status: f.status, diff: f.diff })).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { repo: ch.repo, branch: ch.branch, files };
};
// podpis: dokąd (aplikacja, miejsce, adres, czynność), temat, treść, pola, wiersze i id kroku, a przy commicie repozytorium, gałąź i pliki z diffem
// z klocków kroku (step.blocks: te, które się zapisuje); stan szkicu, tytuł i „nieaktualny” nie wchodzą
export function approvalSig(step: { id: string; blocks?: Block[] | null }, d: Draft): string {
  const t = d.target;
  const core = {
    step: step.id, target: { app: t.app, where: t.where, url: t.url, action: t.action }, subject: d.subject, body: d.body, fields: d.fields, columns: d.columns, rows: d.rows,
    changes: isGitish(d) ? changesCore(step.blocks) : undefined,
  };
  return createHash("sha256").update(JSON.stringify(canon(core))).digest("hex");
}

// podpis szkicu tak, jak go widać na karcie: bez treści, gdy treść idzie w formularzu „Zatwierdź” (Piotr mógł ją poprawić), inaczej z treścią.
// Karta wysyła go przy zatwierdzeniu; inny podpis w bazie = szkic (miejsce, pola, wiersze, pliki) zmienił się, zanim Piotr kliknął
export const shownSig = (step: { id: string; blocks?: Block[] | null }, d: Draft, bodyInForm: boolean): string => approvalSig(step, bodyInForm ? { ...d, body: "" } : d);

export type Approvable = Pick<Step, "id" | "status" | "blocks"> & Partial<Pick<Step, "approvedAt" | "approvedSig" | "sendStartedAt" | "approval">>;
// zgoda ważna: krok czeka na wysyłkę, szkic zatwierdzony, podpis zgadza się z obecną treścią (także w trakcie wysyłki), a krok z bazy
// (approval wczytane) ma zapis kliknięcia Piotra z tym samym podpisem (paczka 22): bez zapisu albo z innym podpisem wysyłka nic nie robi
export function approvalValid(s: Approvable): boolean {
  const d = draftOf(s);
  if (s.approval !== undefined && !(s.approval?.source === "click" && s.approval.sig === s.approvedSig)) return false;
  return s.status === "handoff" && !!s.approvedAt && !!s.approvedSig && !!d && d.status === "approved" && s.approvedSig === approvalSig(s, d);
}
// do wysłania: ważna zgoda i żaden bieg wysyłki jeszcze go nie wziął
export const isSendable = (s: Approvable): boolean => approvalValid(s) && !s.sendStartedAt;

// zgoda niemożliwa z innego powodu niż „szkic zmienił się, zanim kliknąłeś” (ten powód sprawdza shownSig): powód po polsku dla Piotra, null = nic
// nie stoi na przeszkodzie. Lustro odmów repo.approveDraft: brak takiej opcji przy kilku szkicach; inna opcja tej kartki już wysłana (krok już
// opublikował, a druga zgoda nigdy nie byłaby ważna, bo draftOf woli wysłaną); dwie opcje o tej samej treści (podpis liczony z poprawką z formularza)
export function approveRefusal(step: { id: string; blocks: Block[] | null }, opts: { option?: number; body?: string | null } = {}): string | null {
  const ds = draftsOf(step);
  const d = ds.length > 1 ? (opts.option != null ? ds[opts.option] : undefined) : ds[0];
  if (ds.length > 1 && !d) return "nie ma takiej opcji na kartce; szkic zmienił się, zanim go zatwierdziłeś";
  if (ds.some((x) => x !== d && x.status === "sent")) return "jedna opcja z tej kartki już poszła, więc drugiej nie wyślę; nową wysyłkę zapisz jako osobny krok";
  if (d) {
    const picked: Draft = { ...d, ...(opts.body != null ? { body: opts.body } : {}) };
    const blocks = (step.blocks ?? []).map((b) => (b === d ? picked : b));
    const sig = approvalSig({ id: step.id, blocks }, picked);
    if (blocks.some((b) => b !== picked && b.type === "draft" && approvalSig({ id: step.id, blocks }, b) === sig)) return "dwie opcje mają tę samą treść; popraw jedną albo usuń";
  }
  return null;
}

// aplikacje, w których szkic nie wychodzi do innych ludzi: krok Piotra, tekst w Task Hub, prompt dla agenta
const INTERNAL = new Set(["manual", "claude", "claudeapp", "code", "taskhub", "file"]);
export const isExternalApp = (app: string | null | undefined) => !!app?.trim() && !INTERNAL.has(normalizeTool(app));
// plik na Macu Piotra: zapisuje go bieg pracy mostka, nie wysyłka; szkic do „pliku” to pomyłka agenta
export const isLocalFile = (app: string | null | undefined) => normalizeTool(app ?? "", "") === "file";
// prompt dla agenta (Claude Code, Claude): po zgodzie trzeba go wykonać (bieg pracy), a nie tylko zamknąć krok; commit to nie prompt
const PROMPT_APPS = new Set(["code", "claudeapp"]);
export const isPromptDraft = (d: Draft | null | undefined, blocks?: Block[] | null): boolean => !!d && PROMPT_APPS.has(normalizeTool(d.target.app)) && !isGitDraft(d, blocks);

// szkic od agenta (MCP set_blocks, model w aplikacji): sam nie jest ani zatwierdzony, ani wysłany. Ta sama treść co zapisany szkic (wybrany
// albo pierwszy) zachowuje jego stan (agent przepisał kartkę bez zmiany szkicu); inna treść to nowa propozycja. Drugi szkic w kroku to opcja;
// stan trzyma się treści, nie pozycji: dziedziczy go pierwszy przychodzący szkic o tym samym podpisie, każdy inny to propozycja.
// Zapis agenta to jego aktualna propozycja, więc „nieaktualny” znika.
export function coerceAgentDrafts(step: Pick<Step, "id" | "blocks">, incoming: Block[]): Block[] {
  const old = draftOf(step);
  const oldSig = old ? approvalSig(step, old) : null;
  let matched = false;
  return incoming.map((b) => {
    if (b.type !== "draft") return b;
    const rest: Draft = { ...b }; delete rest.stale;
    if (!matched && old && oldSig === approvalSig({ id: step.id, blocks: incoming }, b)) { matched = true; return { ...rest, status: old.status }; }
    return { ...rest, status: "proposed" as const };
  });
}
// paczka 22: agent nie nadaje szkicowi stanu. Szkic przychodzący od agenta ze stanem „zatwierdzony” albo „wysłany”, którego zapisany szkic
// o tej samej treści nie ma (coerceAgentDrafts by go obniżył), to próba podrobienia zgody: zwraca ten stan, a set_blocks kończy się błędem.
// Przepisanie kartki z tym samym, już zatwierdzonym albo wysłanym szkicem (bez zmiany treści) przechodzi bez błędu
export function forgedDraftStatus(step: Pick<Step, "id" | "blocks">, incoming: Block[]): "approved" | "sent" | null {
  const kept = coerceAgentDrafts(step, incoming);
  for (let k = 0; k < incoming.length; k++) {
    const b = incoming[k], c = kept[k];
    if (b.type === "draft" && b.status !== "proposed" && (c?.type !== "draft" || c.status !== b.status)) return b.status;
  }
  return null;
}
// opcje złożone przez model w aplikacji (composeStep): szkic o tej samej treści co wcześniejszy albo do innej aplikacji niż pierwszy wypada,
// bo nie ma komu odmówić (set_blocks odmawia agentowi zamiast wyrzucać); klocki kontekstu zostają
// podpis po sanitizeBlocks, jak przy zapisie i w set_blocks: adres spoza http(s) wypada przy zapisie, więc nie może odróżniać dwóch opcji
export function dedupeOptions(stepId: string, blocks: Block[]): Block[] {
  const clean = sanitizeBlocks(blocks);
  const sigs = new Set<string>();
  let app: string | null = null;
  return blocks.filter((b, k) => {
    if (b.type !== "draft") return true;
    const sig = approvalSig({ id: stepId, blocks: clean }, clean[k] as Draft), key = appKey(b.target.app);
    app ??= key;
    if (sigs.has(sig) || key !== app) return false;
    sigs.add(sig);
    return true;
  });
}
