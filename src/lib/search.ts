// Indeks szukajki budowany na serwerze z tego samego pakietu danych, co widoki: zadania, kroki, projekty, archiwum, zasady i stałe wpisy ustawień.
import { bundle, type Bundle } from "./services";
import { toolLabel } from "./schema";
import { TS_LABEL, TS_SHORT } from "@/components/canvas/ui";
import { fmtDate, taskStateOf } from "./canvas/vm";
import { isArchivedDone, norm, type SearchItem } from "./search-core";

const SCOPE: Record<string, string> = { global: "ogólna", company: "firmy", project: "projektu", tool: "narzędzia" };

// miejsca w ustawieniach i menu; kotwica otwiera zwiniętą sekcję (PageBar → HashOpener)
const STATIC: { title: string; href: string; sub: string; extra: string }[] = [
  { title: "Agent", href: "/settings#agent", sub: "Ustawienia", extra: "model agenta wbudowany claude gpt kto wykonuje pracę rozkłada zadania" },
  { title: "Mostek na komputerze", href: "/settings#bridge", sub: "Ustawienia › Agent", extra: "mostek aplikacja mac claude code od razu praca na bieżąco token mostka instalacja project hub" },
  { title: "Ostatnie biegi mostka", href: "/settings#runs", sub: "Ustawienia › Agent", extra: "mostek biegi historia co zrobił limit błąd" },
  { title: "Jak włączyć agenta wbudowanego", href: "/settings#agent-key", sub: "Ustawienia › Agent", extra: "klucz api anthropic openai vercel zmienna środowiskowa płatny tokeny" },
  { title: "Połączenia", href: "/settings#connections", sub: "Ustawienia", extra: "konektor mcp podłączone klienty claude claude code chatgpt unieważnij" },
  { title: "Adres konektora", href: "/settings#connections", sub: "Ustawienia › Połączenia", extra: "mcp url adres kopiuj" },
  { title: "Do czego agent ma dostęp", href: "/settings#registry", sub: "Ustawienia › Połączenia", extra: "rejestr połączeń konta firmy sfera konektory nowe połączenie" },
  { title: "Konfiguracja dla nowego silnika", href: "/settings#engine", sub: "Ustawienia › Połączenia", extra: "claude mcp add nowy komputer konto eksport konektorów" },
  { title: "Jak podłączyć klienta", href: "/settings#connect", sub: "Ustawienia › Połączenia", extra: "instrukcja aplikacja claude claude code chatgpt custom connector add" },
  { title: "Token dla klienta bez logowania", href: "/settings#token", sub: "Ustawienia › Połączenia", extra: "klucz skrypt serwer api token nowy" },
  { title: "Co potrafi konektor", href: "/settings#tools", sub: "Ustawienia › Połączenia", extra: "narzędzia list_tasks get_task create_task add_steps uprawnienia" },
  { title: "Zasady pracy", href: "/rules", sub: "Menu", extra: "reguły zasady agent styl jak pisać ogólne projektu narzędzia" },
  { title: "Nowa zasada", href: "/rules#new-rule", sub: "Zasady pracy", extra: "dodaj regułę zasadę" },
  { title: "Projekty", href: "/?view=projects", sub: "Menu", extra: "projekt kolor ważność język nowy projekt" },
  { title: "Archiwum: ukończone", href: "/?view=done", sub: "Menu", extra: "archiwum ukończone zadania historia" },
  { title: "Kosz", href: "/?view=trash", sub: "Menu › Archiwum", extra: "usunięte zadania przywróć" },
];

export function indexFrom(b: Bundle, now = Date.now()): SearchItem[] {
  const out: SearchItem[] = [];
  const all = b.tasks;
  const proj = (id: string | null) => (id ? b.projects.find((p) => p.id === id) ?? null : null);
  for (const s of b.scored) {
    const t = s.task; if (t.deletedAt) continue;
    const pr = proj(t.projectId);
    const tag = pr ? { name: pr.name, color: pr.color } : undefined;
    const lvl = { base: s.score.base, eff: s.score.eff };
    if (isArchivedDone(t.doneAt, now)) {
      out.push({ kind: "done", id: t.id, title: t.title, hay: norm(`${t.title} ${t.summary} ${pr?.name ?? ""}`), href: `/?view=done&t=${t.id}`, sub: `ukończone ${fmtDate(t.doneAt!)}`, lvl, tag });
      continue;
    }
    const state = taskStateOf(t, all);
    out.push({ kind: "task", id: t.id, title: t.title, hay: norm(`${t.title} ${t.summary} ${pr?.name ?? ""} ${TS_LABEL[state]}`), href: `/?focus=${t.id}`, lvl, tag, badge: TS_SHORT[state], badgeCls: state });
    for (const st of t.steps) out.push({ kind: "step", id: st.id, taskId: t.id, title: st.title, hay: norm(`${st.title} ${st.detail} ${toolLabel(st.tool)} ${t.title}`), href: `/tasks/${t.id}?step=${st.id}`, sub: t.title, tool: st.tool });
  }
  for (const t of all) if (t.deletedAt) out.push({ kind: "trash", id: t.id, title: t.title, hay: norm(`${t.title} ${t.summary} ${proj(t.projectId)?.name ?? ""}`), href: `/?view=trash&t=${t.id}`, sub: "w koszu", lvl: { base: t.level, eff: t.level } });
  const comp = (id: string | null) => (id ? b.companies.find((c) => c.id === id) ?? null : null);
  for (const p of b.projects) out.push({ kind: "project", id: p.id, title: p.name, hay: norm(`${p.name} ${comp(p.companyId)?.name ?? "prywatny"}`), href: `/?view=projects&p=${p.id}`, color: p.color, sub: comp(p.companyId)?.name ?? undefined });
  for (const c of b.companies) out.push({ kind: "project", id: "c-" + c.id, title: c.name, hay: norm(`${c.name} firma ${c.sphere === "private" ? "prywatna" : "zawodowa"}`), href: `/?view=projects&p=c-${c.id}`, sub: "firma" });
  for (const r of b.rules) {
    const where = r.scope === "company" ? comp(r.companyId)?.name ?? "firma" : r.scope === "project" ? proj(r.projectId)?.name ?? "projekt" : r.scope === "tool" ? toolLabel(r.tool ?? "") : "ogólna";
    out.push({ kind: "rule", id: r.id, title: r.title, hay: norm(`${r.title} ${r.body} ${r.summary ?? ""} ${SCOPE[r.scope]} ${where}`), href: `/rules#rule-${r.id}`, sub: where });
  }
  for (const c of b.connections) out.push({ kind: "setting", id: "conn-" + c.id, title: c.label, hay: norm(`${c.label} ${toolLabel(c.app)} ${c.account ?? ""} ${comp(c.companyId)?.name ?? ""} połączenie konektor ${c.sphere === "private" ? "prywatne" : "zawodowe"}`), href: "/settings#registry", sub: `połączenie · ${comp(c.companyId)?.name ?? (c.sphere === "private" ? "prywatne" : "zawodowe")}` });
  STATIC.forEach((s, i) => out.push({ kind: "setting", id: "s" + i, title: s.title, hay: norm(`${s.title} ${s.sub} ${s.extra}`), href: s.href, sub: s.sub }));
  return out;
}

export async function searchIndex(ownerId: string): Promise<SearchItem[]> { return indexFrom(await bundle(ownerId)); }

// etykieta agenta w prawej pigułce: wbudowany (gdy jest klucz) albo Claude przez konektor
export const agentLabel = (providers: string[]) => (providers.length ? (providers[0] === "anthropic" ? "Claude" : "GPT") : "Claude");
