// Wspólne klocki kanwy (bez stanu): ikony, pasek priorytetu, etykiety stanów, modele kafelków.
// Używane po stronie serwera (strony) i klienta (Board, TaskCanvas).
import type { Pos } from "@/lib/canvas/layout";
import { LEVELS } from "@/lib/priority";

// ---------- stany ----------
export type TaskStateKey = "done" | "blocked" | "draft" | "active" | "new";
export type StepStateKey = "done" | "draft" | "handoff" | "blocked" | "ready";
export const TS_LABEL: Record<TaskStateKey, string> = { done: "Ukończone", draft: "Do zatwierdzenia", active: "W toku", blocked: "Czeka", new: "Nowe" };
export const TS_SHORT: Record<TaskStateKey, string> = { ...TS_LABEL, draft: "Do zatw." };   // na kafelku, obok terminu
export const ST_LABEL: Record<StepStateKey, string> = { done: "Zrobione", ready: "Do zrobienia", draft: "Do zatwierdzenia", blocked: "Czeka", handoff: "Pracuje" };

// ---------- modele kafelków (liczone na serwerze, rysowane u klienta) ----------
export type TaskTile = {
  id: string; title: string; summary: string; state: TaskStateKey;
  base: number; eff: number; why: string;
  project: { id: string; name: string; color: number } | null;
  due: { text: string; cls: "" | "soon" | "late"; iso: string } | null;
  progress: { done: number; all: number };
  estText: string; drafts: number; handed: number; questions: number;
  pending: number;   // wiadomości Piotra w zadaniu bez odpowiedzi agenta (chip „2 wiadomości”)
  tool: string; pos: Pos | null; dependsOn: string[];
  activity: TileActivity | null;
};
// co mostek robi teraz na tym kafelku (pasek z kropkami): czynność, szczegół (np. polecenie), od kiedy trwa bieg
export type TileActivity = { text: string; detail: string | null; since: string };
export type StepTile = {
  id: string; idx: number; title: string; tool: string; state: StepStateKey; meta: string;
  pos: Pos | null; dependsOn: string[];
  activity: TileActivity | null;
};
export type GroupVM = { id: string; name: string; color: number; x: number; y: number; w: number; h: number; members: string[]; auto: boolean };
export type ProjectVM = { id: string; name: string; color: number };
export type ProjectRow = ProjectVM & { weight: number; language: string; companyId: string | null };
export type CompanyRow = { id: string; name: string; sphere: "work" | "private"; note: string | null; ended: boolean };
// zadanie w widoku „Projekty”: stan, priorytet, termin, pozostały szacunek i zmierzony czas (minuty)
export type ProjTask = { id: string; title: string; state: TaskStateKey; base: number; eff: number; due: TaskTile["due"]; remain: number; spent: number; projectId: string | null };

// ---------- kolory i ikony narzędzi ----------
export const TOOL_COLORS: Record<string, string> = {
  slack: "var(--t-slack)", gmail: "var(--t-mail)", clickup: "var(--t-clickup)", calendar: "var(--t-calendar)", claude: "var(--t-claude)",
  claudeapp: "var(--t-claude)", code: "var(--t-claude)", manual: "var(--t-manual)", github: "var(--t-github)", figma: "var(--t-figma)", browser: "var(--t-mail)",
};
export const toolColor = (tool: string) => TOOL_COLORS[tool] ?? "var(--sub)";

const PATHS: Record<string, string> = {
  zoom: '<path d="M2 5.5V2h3.5M10.5 2H14v3.5M14 10.5V14h-3.5M5.5 14H2v-3.5M6 8h4M8 6v4"/>',
  plus: '<path d="M8 3v10M3 8h10"/>',
  slack: '<path d="M3 4.5A1.5 1.5 0 0 1 4.5 3h7A1.5 1.5 0 0 1 13 4.5v5a1.5 1.5 0 0 1-1.5 1.5H7l-3 2.5V11h.5"/>',
  gmail: '<rect x="2.5" y="3.5" width="11" height="9" rx="1.5"/><path d="m3 5 5 3.5L13 5"/>',
  clickup: '<rect x="2.5" y="2.5" width="11" height="11" rx="2.5"/><path d="m5.5 8 1.8 1.8L10.5 6"/>',
  claude: '<path d="M4 2.5h5l3 3v8H4z"/><path d="M9 2.5v3h3M6 9h4M6 11h3"/>',
  calendar: '<rect x="2.5" y="3.5" width="11" height="10" rx="1.5"/><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3"/>',
  manual: '<circle cx="8" cy="5.5" r="2.5"/><path d="M3.5 13.5a4.5 4.5 0 0 1 9 0"/>',
  company: '<rect x="3" y="2.5" width="10" height="11" rx="1.5"/><path d="M6 5.5h1M9 5.5h1M6 8h1M9 8h1M7 13.5v-3h2v3"/>',
  claudeapp: '<path d="M8 2.5c3 0 5.5 2.2 5.5 5s-2.5 5-5.5 5c-.8 0-1.6-.2-2.3-.5L3 13.5l.7-2.6A4.8 4.8 0 0 1 2.5 7.5c0-2.8 2.5-5 5.5-5z"/><path d="M6 6.5l2 3 2-3"/>',
  code: '<rect x="2" y="3" width="12" height="10" rx="2"/><path d="m5 7 2 1.5L5 10M8.5 10h3"/>',
  github: '<circle cx="8" cy="8" r="5.5"/><path d="M6 13.5v-2c0-.6.2-1 .5-1.3C5 10 4 9.3 4 7.6c0-.6.2-1.1.5-1.5-.1-.3-.2-1 .1-1.6 0 0 .6 0 1.6.7a5.5 5.5 0 0 1 3.6 0c1-.7 1.6-.7 1.6-.7.3.6.2 1.3.1 1.6.3.4.5.9.5 1.5 0 1.7-1 2.4-2.5 2.6.3.3.5.7.5 1.3v2"/>',
  figma: '<path d="M6 2.5h4a2 2 0 0 1 0 4H6a2 2 0 0 1 0-4z"/><path d="M6 6.5h2v4H6a2 2 0 0 1 0-4z"/><circle cx="10" cy="8.5" r="2"/><path d="M6 10.5h2v2a2 2 0 1 1-2-2z"/>',
  browser: '<rect x="2" y="3" width="12" height="10" rx="2"/><path d="M2 6h12M4.5 4.5h.01M6.5 4.5h.01"/>',
  // ikony interfejsu
  menu: '<path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11"/>',
  back: '<path d="M10 3 5 8l5 5"/>',
  logo: '<path d="M3 8h4M9 4h4M9 12h4M7 8l2-4M7 8l2 4"/>',
  x: '<path d="M4 4l8 8M12 4l-8 8"/>',
  undo: '<path d="M5.5 3 2.5 6l3 3"/><path d="M2.5 6h7a4 4 0 0 1 0 8H7"/>',
  ext: '<path d="M6.5 3.5H4a1.5 1.5 0 0 0-1.5 1.5v7A1.5 1.5 0 0 0 4 13.5h7a1.5 1.5 0 0 0 1.5-1.5V9.5"/><path d="M9.5 2.5h4v4M13.5 2.5 7.5 8.5"/>',
  tile: '<rect x="2" y="3.5" width="12" height="9" rx="2"/><path d="M8 6v4M6 8h4"/>',
  group: '<rect x="1.5" y="2.5" width="13" height="11" rx="2.5" stroke-dasharray="2.2 1.8"/>',
  canvas: '<rect x="2" y="2" width="5" height="5" rx="1.5"/><rect x="9" y="9" width="5" height="5" rx="1.5"/><path d="M7 4.5h2.5A1.5 1.5 0 0 1 11 6v3"/>',
  list: '<rect x="2" y="3" width="12" height="4" rx="1.5"/><rect x="2" y="9" width="12" height="4" rx="1.5"/>',
  send: '<path d="M8 13V3M3.5 7.5 8 3l4.5 4.5"/>',
  chev: '<path d="m4 6 4 4 4-4"/>',
  widen: '<path d="M2 8h12M2 8l3-3M2 8l3 3M14 8l-3-3M14 8l-3 3"/>',
  check: '<path d="M4 8.5l2.6 2.5L12 5.5"/>',
  clip: '<path d="M10.6 5.4 6.4 9.6a1.4 1.4 0 0 0 2 2l4.6-4.6a2.9 2.9 0 0 0-4.1-4.1L4.3 7.5a4.4 4.4 0 0 0 6.2 6.2l3.3-3.3"/>',
  question: '<circle cx="8" cy="8" r="5.5"/><path d="M6.2 6.3a1.8 1.8 0 1 1 2.6 1.6c-.5.3-.8.6-.8 1.1v.3M8 11.3h.01"/>',
  search: '<circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3 3"/>',
  copy: '<rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 5.5V4A1.5 1.5 0 0 0 9 2.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5"/>',
  play: '<path d="M5 3.5v9l7.5-4.5z"/>',
  stop: '<rect x="4" y="4" width="8" height="8" rx="1.5"/>',
  pen: '<path d="M3 13h3l7-7-3-3-7 7v3z"/><path d="m9 4 3 3"/>',
  trash: '<path d="M3 4.5h10M6.5 4.5v-1h3v1M4.5 4.5l.6 8.5h5.8l.6-8.5"/>',
  history: '<path d="M2.6 8.6A5.5 5.5 0 1 0 4 4.3"/><path d="M2.5 2.5v2.8h2.8"/><path d="M8 5.2v3l2 1.4"/>',
  settings: '<circle cx="8" cy="8" r="2.2"/><path d="M8 2v1.8M8 12.2V14M2 8h1.8M12.2 8H14M3.8 3.8l1.3 1.3M10.9 10.9l1.3 1.3M3.8 12.2l1.3-1.3M10.9 5.1l1.3-1.3"/>',
  rule: '<path d="M4 2.5h8v11H4z"/><path d="M6.5 6h3M6.5 8.5h3M6.5 11h1.5"/>',
  folder: '<path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h3l1.5 1.5h4.5A1.5 1.5 0 0 1 14 6v6a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12z"/>',
  file: '<path d="M4.5 2.5h4.5l3 3v8h-7.5z"/><path d="M9 2.5v3h3"/>',
};
export function Icon({ k, size = 16, sw = 1.5 }: { k: string; size?: number; sw?: number }) {
  return <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: PATHS[k] ?? PATHS.claude }} />;
}
export const ToolIcon = ({ tool, size = 18 }: { tool: string; size?: number }) => <Icon k={PATHS[tool] ? tool : "claude"} size={size} />;
// chip narzędzia kroku (kafelek i wiersz listy): nazwa w <span>, więc ucina się wielokropkiem w chipie (.chip > span); pełna nazwa w dymku
export const ToolChip = ({ tool, label }: { tool: string; label: string }) => (
  <span className="chip tool" style={{ ["--c" as string]: toolColor(tool) }} title={label}><span>{label}</span></span>
);

// ---------- priorytet: pasek 1–5, strzałka gdy pokazany różni się od ustawionego ----------
const WIDEST = Object.values(LEVELS).reduce((a, b) => (b.length > a.length ? b : a), "");   // etykieta ma zawsze szerokość najdłuższej nazwy
export function Lvl({ base, eff, why, label }: { base: number; eff: number; why?: string; label?: boolean }) {
  const b = eff - base;
  const tip = b ? `Priorytet ${base}/5, pokazany ${eff}/5: ${why ?? ""}` : `Priorytet ${eff}/5: ${LEVELS[eff]}`;
  return (
    <>
      <span className="lvl" title={tip} aria-label={tip} style={{ ["--lv" as string]: eff >= 3 ? "var(--p3)" : "var(--p4)" }}>
        {[1, 2, 3, 4, 5].map((i) => <i key={i} className={i <= eff ? "on" : ""} />)}
        {b ? <b className={"boost" + (b < 0 ? " down" : "")}>{b < 0 ? "↓" : "↑"}</b> : null}
      </span>
      {label ? <span className="lvl-t" data-w={WIDEST}>{LEVELS[eff]}</span> : null}
    </>
  );
}

export const plural = (n: number, a: string, b: string, c: string) => (n === 1 ? a : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? b : c);
export const GCOL = ["var(--accent)", "var(--p3)", "var(--p2)", "var(--t-clickup)", "var(--p4)"];
export const projColor = (color: number) => GCOL[Math.abs(color) % GCOL.length];
