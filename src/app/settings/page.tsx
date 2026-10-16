// Ustawienia: dwie sekcje (agent, połączenia). Każda ma to, co potrzebne na co dzień na wierzchu, a instrukcje i rzadkie czynności zwinięte.
// Pasek u góry jak na kanwie: wstecz z tytułem, szukajka, agent. Kotwice (#token itd.) otwierają zwinięte sekcje z wyników szukania.
import Link from "next/link";
import { requireOwner, appUrl } from "@/lib/session";
import * as repo from "@/lib/repo";
import { availableProviders } from "@/lib/ai";
import { agentLabel, searchIndex } from "@/lib/search";
import { PendingButton } from "@/components/Pending";
import { TokenForm } from "@/components/TokenForm";
import { CopyButton } from "@/components/CopyButton";
import { ClientGuide, ProviderPicker } from "@/components/SettingsBits";
import { HashOpener, PageBar } from "@/components/PageBar";
import { Icon } from "@/components/canvas/ui";
import { createToken, revokeToken, saveSettings } from "../actions";

export const dynamic = "force-dynamic";

const TOOLS = "list_tasks, get_task, get_rules, create_task, update_task, add_steps, update_step, set_blocks, complete_step, add_facts, add_snapshot, list_work, ask_question, get_attachment, describe_attachment, add_rule";

function More({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <details className="more" id={id}>
      <summary><Icon k="chev" size={12} sw={2.2} />{title}</summary>
      <div className="more-b">{children}</div>
    </details>
  );
}

export default async function Settings() {
  const o = await requireOwner();
  const [tokens, index] = await Promise.all([repo.listApiTokens(o.id), searchIndex(o.id)]);
  const avail = availableProviders();
  const pref = (o.settings as { aiProvider?: string }).aiProvider ?? "";
  const mcp = appUrl() + "/api/mcp";
  const when = (iso: string | null) => (iso ? iso.slice(0, 16).replace("T", " ") : "nigdy");
  return (
    <main className="page withbar">
      <PageBar title="Ustawienia" index={index} screen="settings" agent={agentLabel(avail)} aiOn={avail.length > 0} />
      <HashOpener />

      <section className="set" id="agent">
        <header className="set-h">
          <div><h2>Agent</h2><p>Kto wykonuje pracę agenta: rozkłada zadania na kroki, zbiera fakty, pisze szkice, zgłasza wyniki.</p></div>
          <span className="st active">{avail.length ? (pref === "openai" ? "GPT" : pref === "anthropic" ? "Claude" : "wbudowany") : "Claude · konektor"}</span>
        </header>
        <div className="set-b">
          {avail.length ? (
            <div className="kv"><span className="k">Model agenta wbudowanego</span><ProviderPicker value={pref} available={avail} action={saveSettings} /></div>
          ) : (
            <p className="sub" style={{ margin: 0 }}>Agent wbudowany jest wyłączony (brak klucza modelu). Pracuje Twój Claude z subskrypcji, podłączony przez konektor poniżej; pytania zadaje w Task Hub.</p>
          )}
          <div className="kv"><span className="k">Zasady pracy</span><span className="sub" style={{ flex: 1 }}>Jak agent ma działać: ogólne, projektu, narzędzia.</span><Link className="pill" href="/rules">Otwórz zasady</Link></div>
          <More id="agent-key" title="Jak włączyć agenta wbudowanego (płatny klucz API)">
            <p className="sub" style={{ margin: 0 }}>Dodaj zmienną <code>ANTHROPIC_API_KEY</code> albo <code>OPENAI_API_KEY</code> w ustawieniach hostingu (Vercel → Settings → Environment Variables) i wdróż ponownie. Bez klucza aplikacja działa bez opłat za tokeny.</p>
          </More>
        </div>
      </section>

      <section className="set" id="connections">
        <header className="set-h">
          <div><h2>Połączenia</h2><p>Claude, Claude Code i ChatGPT łączą się z Task Hub przez konektor MCP i działają na Twoich zadaniach.</p></div>
          <span className={"st" + (tokens.length ? " active" : "")}>{tokens.length ? `${tokens.length} ${tokens.length === 1 ? "połączenie" : tokens.length < 5 ? "połączenia" : "połączeń"}` : "nic nie podłączono"}</span>
        </header>
        <div className="set-b">
          <div className="kv"><span className="k">Adres konektora</span><code className="v">{mcp}</code><CopyButton text={mcp} /></div>
          {tokens.length ? (
            <table className="t">
              <thead><tr><th>Klient</th><th>Podłączony</th><th>Ostatnio użyty</th><th /></tr></thead>
              <tbody>{tokens.map((t) => (
                <tr key={t.id}><td>{t.name}</td><td>{t.createdAt.slice(0, 10)}</td><td>{when(t.lastUsedAt)}</td>
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
        </div>
      </section>
    </main>
  );
}
