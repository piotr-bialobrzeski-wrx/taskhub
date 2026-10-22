// Ustawienia: dwie sekcje (agent, połączenia). Każda ma to, co potrzebne na co dzień na wierzchu, a instrukcje i rzadkie czynności zwinięte.
// Pasek u góry jak na kanwie: wstecz z tytułem, szukajka, agent. Kotwice (#token itd.) otwierają zwinięte sekcje z wyników szukania.
import { AUTO_TEXT, BRIDGE_TEXT } from "@/lib/auto";
import { BRIDGE_ALIVE_MS, ago } from "@/lib/bridge";
import Link from "next/link";
import { requireOwner, appUrl } from "@/lib/session";
import * as repo from "@/lib/repo";
import { availableProviders } from "@/lib/ai";
import { agentLabel, searchIndex } from "@/lib/search";
import { fmtTime } from "@/lib/canvas/vm";
import { PendingButton } from "@/components/Pending";
import { TokenForm } from "@/components/TokenForm";
import { CopyButton } from "@/components/CopyButton";
import { ClientGuide, ProviderPicker } from "@/components/SettingsBits";
import { ConnectionsPanel, EngineConfig } from "@/components/ConnectionsPanel";
import { HashOpener, PageBar } from "@/components/PageBar";
import { Icon } from "@/components/canvas/ui";
import { createBridgeToken, createToken, revokeToken, saveSettings } from "../actions";

export const dynamic = "force-dynamic";

const TOOLS = "list_tasks, get_task, get_rules, create_task, update_task, add_steps, update_step, set_blocks, complete_step, add_facts, add_snapshot, list_work, ask_question, get_attachment, describe_attachment, list_connections, list_companies, create_company, list_projects, create_project, list_rules, add_rule, update_rule";
const OUTCOME: Record<string, string> = { done: "zrobione", error: "błąd", limit: "limit Claude", auth: "wylogowany", stale: "wygasł", stopped: "zatrzymany przez Ciebie" };

function More({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <details className="more" id={id}>
      <summary><Icon k="chev" size={12} sw={2.2} />{title}</summary>
      <div className="more-b">{children}</div>
    </details>
  );
}

// jedno zdanie o stanie mostka: co robi teraz albo dlaczego stoi
function bridgeLine(b: repo.BridgeStatus): string {
  const st = b.meta.state as string | undefined, until = b.meta.until as string | undefined;
  if (!b.alive) return b.seenAt ? `nieaktywny, ostatni sygnał ${ago(b.seenAt)}` : "nie uruchomiony";
  if (b.run) return `pracuje${b.run.note ? `: ${b.run.note}` : ""} (od ${fmtTime(b.run.startedAt)})`;
  if (st === "limit") return `czeka, limit Claude${until ? ` do ${fmtTime(until)}` : ""}`;
  if (st === "auth") return "Claude Code wylogowany: w Terminalu wpisz claude, potem /login";
  if (st === "error") return `ostatni bieg nie wyszedł, spróbuje znowu za chwilę`;
  if (st === "stopped") return `zatrzymany przez Ciebie na Macu${until ? `, wraca o ${fmtTime(until)}` : ""}`;
  return `czuwa, sprawdza pracę co kilkanaście sekund (sygnał ${ago(b.seenAt)})`;
}

export default async function Settings() {
  const o = await requireOwner();
  const [tokens, index, bridge, runs, connections, companies] = await Promise.all([repo.listApiTokens(o.id), searchIndex(o.id), repo.bridgeStatus(o.id, BRIDGE_ALIVE_MS), repo.listBridgeRuns(o.id, 6), repo.listConnections(o.id), repo.listCompanies(o.id)]);
  const avail = availableProviders();
  const pref = (o.settings as { aiProvider?: string }).aiProvider ?? "";
  const origin = appUrl();
  const mcp = origin + "/api/mcp";
  const when = (iso: string | null) => (iso ? iso.slice(0, 16).replace("T", " ") : "nigdy");
  return (
    <main className="page withbar">
      <PageBar title="Ustawienia" index={index} screen="settings" agent={agentLabel(avail)} aiOn={avail.length > 0} />
      <HashOpener />

      <section className="set" id="agent">
        <header className="set-h">
          <div><h2>Agent</h2><p>Kto wykonuje pracę agenta: rozkłada zadania na kroki, zbiera fakty, pisze szkice, zgłasza wyniki.</p></div>
          <span className="st active">{avail.length ? (pref === "openai" ? "GPT" : pref === "anthropic" ? "Claude" : "wbudowany") : bridge.alive ? "Claude · mostek" : "Claude · konektor"}</span>
        </header>
        <div className="set-b">
          {avail.length ? (
            <div className="kv"><span className="k">Model agenta wbudowanego</span><ProviderPicker value={pref} available={avail} action={saveSettings} /></div>
          ) : (
            <>
              <p className="sub" style={{ margin: 0 }}>Agent wbudowany jest wyłączony (brak klucza modelu). Pracuje Twój Claude z subskrypcji: mostek na komputerze, a gdy komputer śpi, zadanie zaplanowane co godzinę. Pytania zadaje w Task Hub. Zatwierdzone szkice wysyła tylko mostek.</p>
              <div className="kv"><span className="k">Mostek</span><span className={"st" + (bridge.alive ? " active" : "")}>{bridge.alive ? "działa" : "nieaktywny"}</span><span className="sub" style={{ flex: 1 }}>{bridgeLine(bridge)}{bridge.name ? ` · ${bridge.name}` : ""}</span></div>
              <div className="kv"><span className="k">Zapas</span><span className="sub" style={{ flex: 1 }}>{AUTO_TEXT}</span></div>
            </>
          )}
          <div className="kv"><span className="k">Zasady pracy</span><span className="sub" style={{ flex: 1 }}>Jak agent ma działać: ogólne, projektu, narzędzia.</span><Link className="pill" href="/rules">Otwórz zasady</Link></div>
          <More id="bridge" title="Jak uruchomić mostek na komputerze (praca od razu, jak w Project Hub)">
            <div className="stack">
              <p className="sub" style={{ margin: 0 }}>{BRIDGE_TEXT} Mostek siedzi w aplikacji Task Hub na Maca: co kilkanaście sekund pyta Task Hub o pracę za darmo i tylko wtedy uruchamia w tle Claude Code na Twojej subskrypcji, z konektorami, które masz w Claude Code na tym komputerze. Działa, gdy komputer nie śpi; w pozostałym czasie pracuje zapas co godzinę.</p>
              <ol className="steps">
                <li><a className="pill" href="/api/app/download">Pobierz aplikację Task Hub na Maca</a> (plik .pkg) i zainstaluj ją dwuklikiem. Przy pierwszym otwarciu macOS może zapytać o zgodę dla aplikacji spoza App Store: Ustawienia systemowe → Prywatność i ochrona → „Otwórz mimo to”.</li>
                <li>Na tym Macu zainstaluj Claude Code i zaloguj się subskrypcją: w Terminalu <code>claude</code>, potem <code>/login</code> (jednorazowo; aplikacja sama go znajdzie). Starszą wersję zaktualizuj: <code>claude update</code>.</li>
                <li>Utwórz token mostka (jako nazwę wpisz nazwę komputera) i kliknij „Połącz aplikację”:
                  <div style={{ marginTop: 8 }}><TokenForm action={createBridgeToken} placeholder="Nazwa komputera, np. MacBook domowy" button="Token mostka" install={{ url: origin }} /></div>
                </li>
                <li>Gdy agent ma robić kroki z kodem: w aplikacji na Macu otwórz Ustawienia → Foldery z kodem i dodaj repozytoria (główny folder repozytorium, ten z katalogiem .git). Tylko w nich Claude zmienia pliki i uruchamia testy.</li>
              </ol>
              <p className="sub" style={{ margin: 0 }}>Aplikacja pokazuje stan mostka w pasku menu, ma szybki pasek do wysyłania zadań z każdego miejsca (domyślnie ⌥Spacja) i startuje po zalogowaniu do komputera. Claude Code nie pyta o zgodę na narzędzia, bo nikt nie siedzi przy klawiaturze, ale dostaje tylko listę dozwolonych: Task Hub, czytanie w Twoich konektorach i w sieci, a pliki i testy wyłącznie w folderach z kodem. W zwykłym biegu niczego nie wysyła: wiadomość, komentarz czy zmiana w innej aplikacji to szkic, który czeka na Twoje „Zatwierdź”. Zatwierdzony szkic wysyła osobny, krótki bieg tylko konektorem tej jednej aplikacji, a commit i push robi sama aplikacja na Macu, bez modelu. Bieg zatrzymasz z powiadomienia albo z menu aplikacji (Zatrzymaj bieg).</p>
            </div>
          </More>
          <More id="runs" title="Ostatnie biegi mostka">
            {runs.length ? (
              <table className="t">
                <thead><tr><th>Kiedy</th><th>Komputer</th><th>Wynik</th><th>Notatka</th></tr></thead>
                <tbody>{runs.map((r) => (
                  <tr key={r.id}><td>{when(r.startedAt)}</td><td>{r.bridge}</td><td>{r.kind === "send" ? "wysyłka: " : ""}{r.endedAt ? OUTCOME[r.outcome ?? ""] ?? r.outcome : "w toku"}</td><td className="sub" style={{ maxWidth: 420, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.note ?? ""}</td></tr>
                ))}</tbody>
              </table>
            ) : <p className="sub" style={{ margin: 0 }}>Jeszcze żadnego. Po uruchomieniu mostka tu będzie widać, co i kiedy zrobił.</p>}
          </More>
          <More id="agent-key" title="Jak włączyć agenta wbudowanego (płatny klucz API)">
            <p className="sub" style={{ margin: 0 }}>Dodaj zmienną <code>ANTHROPIC_API_KEY</code> albo <code>OPENAI_API_KEY</code> w ustawieniach hostingu (Vercel → Settings → Environment Variables) i wdróż ponownie. Bez klucza aplikacja działa bez opłat za tokeny.</p>
          </More>
        </div>
      </section>

      <section className="set" id="connections">
        <header className="set-h">
          <div><h2>Połączenia</h2><p>Kto jest podłączony do Task Hub (Claude, Claude Code, ChatGPT przez konektor MCP) i do czego agent ma dostęp: rejestr aplikacji, kont i firm.</p></div>
          <span className={"st" + (tokens.length ? " active" : "")}>{tokens.length ? `${tokens.length} ${tokens.length === 1 ? "klient" : tokens.length < 5 ? "klienci" : "klientów"}` : "nic nie podłączono"}</span>
        </header>
        <div className="set-b">
          <div className="kv"><span className="k">Adres konektora</span><code className="v">{mcp}</code><CopyButton text={mcp} /></div>
          <h3 className="set-sub">Klienci Task Hub</h3>
          {tokens.length ? (
            <table className="t">
              <thead><tr><th>Klient</th><th>Podłączony</th><th>Ostatnio użyty</th><th /></tr></thead>
              <tbody>{tokens.map((t) => (
                <tr key={t.id}><td>{t.name}{t.kind === "bridge" ? <span className="sub"> · mostek</span> : null}</td><td>{t.createdAt.slice(0, 10)}</td><td>{when(t.lastUsedAt)}</td>
                  <td style={{ textAlign: "right" }}><form action={revokeToken.bind(null, t.id)}><PendingButton className="pill danger" busy="Unieważniam…">Unieważnij</PendingButton></form></td></tr>
              ))}</tbody>
            </table>
          ) : <p className="sub" style={{ margin: 0 }}>Jeszcze nic nie jest podłączone. Rozwiń instrukcję poniżej.</p>}
          <More id="connect" title="Jak podłączyć klienta">
            <ClientGuide mcp={mcp} />
          </More>
          <More id="token" title="Token dla klienta bez logowania (np. skrypt, Claude Code na serwerze)">
            <TokenForm action={createToken} />
          </More>
          <More id="tools" title="Co potrafi konektor">
            <p className="sub" style={{ margin: 0 }}>Narzędzia: {TOOLS}. Podłączony klient czyta i zmienia Twoje zadania, kroki, fakty, załączniki i zasady; nigdy nie usuwa zadań.</p>
          </More>
          <ConnectionsPanel connections={connections} companies={companies} />
          <More id="engine" title="Konfiguracja dla nowego silnika (Claude Code na innym komputerze albo koncie)">
            <EngineConfig connections={connections} mcp={mcp} />
          </More>
        </div>
      </section>
    </main>
  );
}
