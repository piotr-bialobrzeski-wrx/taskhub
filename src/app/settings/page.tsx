// Ustawienia: dwie sekcje (agent, połączenia). Każda ma to, co potrzebne na co dzień na wierzchu, a instrukcje i rzadkie czynności zwinięte.
// Projekty mają własny widok w menu kanwy.
import Link from "next/link";
import { requireOwner, appUrl } from "@/lib/session";
import * as repo from "@/lib/repo";
import { availableProviders } from "@/lib/ai";
import { PendingButton } from "@/components/Pending";
import { TokenForm } from "@/components/TokenForm";
import { CopyButton } from "@/components/CopyButton";
import { ClientGuide, ProviderPicker } from "@/components/SettingsBits";
import { Icon } from "@/components/canvas/ui";
import { createToken, revokeToken, saveSettings } from "../actions";

export const dynamic = "force-dynamic";

const TOOLS = "list_tasks, get_task, get_rules, create_task, update_task, add_steps, update_step, set_blocks, complete_step, add_facts, add_snapshot, list_work, ask_question, get_attachment, describe_attachment, add_rule";

function More({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="more">
      <summary><Icon k="chev" size={12} sw={2.2} />{title}</summary>
      <div className="more-b">{children}</div>
    </details>
  );
}

export default async function Settings() {
  const o = await requireOwner();
  const tokens = await repo.listApiTokens(o.id);
  const avail = availableProviders();
  const pref = (o.settings as { aiProvider?: string }).aiProvider ?? "";
  const mcp = appUrl() + "/api/mcp";
  const when = (iso: string | null) => (iso ? iso.slice(0, 16).replace("T", " ") : "nigdy");
  return (
    <main className="page">
      <div className="top"><Link className="pill" href="/">← Kanwa</Link><h1>Ustawienia</h1><span className="sp" /><Link className="pill" href="/rules">Zasady pracy</Link></div>

      <section className="set">
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
          <More title="Jak włączyć agenta wbudowanego (płatny klucz API)">
            <p className="sub" style={{ margin: 0 }}>Dodaj zmienną <code>ANTHROPIC_API_KEY</code> albo <code>OPENAI_API_KEY</code> w ustawieniach hostingu (Vercel → Settings → Environment Variables) i wdróż ponownie. Bez klucza aplikacja działa bez opłat za tokeny.</p>
          </More>
        </div>
      </section>

      <section className="set">
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
          <More title="Jak podłączyć klienta">
            <ClientGuide mcp={mcp} />
          </More>
          <More title="Token dla klienta bez logowania (np. skrypt, Claude Code na serwerze)">
            <TokenForm action={createToken} />
          </More>
          <More title="Co potrafi konektor">
            <p className="sub" style={{ margin: 0 }}>Narzędzia: {TOOLS}. Podłączony klient czyta i zmienia Twoje zadania, kroki, fakty, załączniki i zasady; nigdy nie usuwa zadań.</p>
          </More>
        </div>
      </section>
    </main>
  );
}
