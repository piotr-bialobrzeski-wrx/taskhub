// Zgoda Piotra na szkic: podpis treści (sha256), który zapisuje tylko jego kliknięcie „Zatwierdź” (repo.approveDraft).
// Każda zmiana treści szkicu unieważnia zgodę; agent nie ma jak jej podrobić, bo podpis liczy serwer z zapisanej treści.
import { createHash } from "node:crypto";
import { appOfLabel, normalizeTool, type Block, type Step } from "../schema";

export type Draft = Extract<Block, { type: "draft" }>;
// szkic kroku: pierwszy blok draft (ten pokazuje karta publikacji i ten jedynie może mieć zgodę)
export const draftOf = (s: Pick<Step, "blocks"> | { blocks: Block[] | null }): Draft | null => (s.blocks?.find((b) => b.type === "draft") as Draft | undefined) ?? null;

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

export type Approvable = Pick<Step, "id" | "status" | "blocks"> & Partial<Pick<Step, "approvedAt" | "approvedSig" | "sendStartedAt">>;
// zgoda ważna: krok czeka na wysyłkę, szkic zatwierdzony, podpis zgadza się z obecną treścią (także w trakcie wysyłki)
export function approvalValid(s: Approvable): boolean {
  const d = draftOf(s);
  return s.status === "handoff" && !!s.approvedAt && !!s.approvedSig && !!d && d.status === "approved" && s.approvedSig === approvalSig(s, d);
}
// do wysłania: ważna zgoda i żaden bieg wysyłki jeszcze go nie wziął
export const isSendable = (s: Approvable): boolean => approvalValid(s) && !s.sendStartedAt;

// aplikacje, w których szkic nie wychodzi do innych ludzi: krok Piotra, tekst w Task Hub, prompt dla agenta
const INTERNAL = new Set(["manual", "claude", "claudeapp", "code", "taskhub"]);
export const isExternalApp = (app: string | null | undefined) => !!app?.trim() && !INTERNAL.has(normalizeTool(app));
// prompt dla agenta (Claude Code, Claude): po zgodzie trzeba go wykonać (bieg pracy), a nie tylko zamknąć krok; commit to nie prompt
const PROMPT_APPS = new Set(["code", "claudeapp"]);
export const isPromptDraft = (d: Draft | null | undefined, blocks?: Block[] | null): boolean => !!d && PROMPT_APPS.has(normalizeTool(d.target.app)) && !isGitDraft(d, blocks);

// szkic od agenta (MCP set_blocks, model w aplikacji): sam nie jest ani zatwierdzony, ani wysłany. Ta sama treść co zapisany szkic zachowuje
// jego stan (agent przepisał kartkę bez zmiany szkicu); inna treść to nowa propozycja, a drugi szkic w kroku zawsze tylko propozycja.
// Zapis agenta to jego aktualna propozycja, więc „nieaktualny” znika.
export function coerceAgentDrafts(step: Pick<Step, "id" | "blocks">, incoming: Block[]): Block[] {
  const old = draftOf(step);
  const oldSig = old ? approvalSig(step, old) : null;
  let first = true;
  return incoming.map((b) => {
    if (b.type !== "draft") return b;
    const isFirst = first; first = false;
    const rest: Draft = { ...b }; delete rest.stale;
    if (isFirst && old && oldSig === approvalSig({ id: step.id, blocks: incoming }, b)) return { ...rest, status: old.status };
    return { ...rest, status: "proposed" as const };
  });
}
