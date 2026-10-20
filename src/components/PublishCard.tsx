// Karta publikacji: trzyma razem dokąd poleci treść (aplikacja, kanał/adresat, konto z rejestru połączeń), jak będzie wyglądać po wysłaniu
// i przycisk decyzji. Zastępuje blok szkicu w panelu kroku; po wysłaniu zostaje jako zapis. Bez kolorów i logotypów aplikacji: tylko tokeny Task Hub.
import type { Block, Step, Task } from "@/lib/schema";
import { toolLabel } from "@/lib/schema";
import { fmtTime } from "@/lib/canvas/vm";
import { toolColor } from "@/components/canvas/ui";
import { Icon } from "@/components/canvas/ui";
import { Facts, Table } from "@/components/BlockRenderer";
import { PendingButton } from "@/components/Pending";
import { RichField } from "@/components/RichField";
import { Markdown } from "@/lib/markdown";
import { ConnectionHead, type StepConnection } from "@/components/StepFields";
import { Activity } from "@/components/Activity";
import { CopyButton } from "@/components/CopyButton";
import { isHttpUrl, isLocalPath, safeHref } from "@/lib/safeurl";
import type { TileActivity } from "@/components/canvas/ui";
import { approveStep, backToTodo, markDone, prepare, saveDraftBody } from "@/app/actions";
import { shownSig } from "@/lib/agent/approval";

export type CardMode = "proposed" | "parked" | "sending" | "sent" | "unsent";
type Draft = Extract<Block, { type: "draft" }>;

// tryb karty z stanu kroku: szkic do decyzji, szkic odłożony (krok wrócił do gotowych), wysyłka w toku, wysłano
export function cardModeOf(s: Step): CardMode | null {
  const draft = s.blocks?.some((b) => b.type === "draft") ?? false;
  if (s.status === "draft") return "proposed";
  if (s.status === "handoff" && s.prevStatus === "draft") return "sending";
  // zrobiony krok ze szkicem, którego nikt nie zatwierdził (zamknięty „Zamknij bez wysyłki” albo przez agenta): nic nie poleciało, więc nie „Wysłano”
  if (s.status === "done" && draft) return s.blocks!.some((b) => b.type === "draft" && b.status === "proposed") ? "unsent" : "sent";
  if (s.status === "todo" && draft) return "parked";
  return null;
}

const ACTION: Record<string, string> = { send: "wyśle", reply: "odpowie", create: "utworzy", update: "zaktualizuje", comment: "skomentuje", commit: "zapisze commit", push: "wypchnie", other: "wykona" };
// etykieta głównego przycisku: mówi, co się stanie po zatwierdzeniu
const VERB: Record<string, string> = { send: "wyślij", reply: "wyślij", create: "utwórz", update: "dopisz", comment: "dodaj komentarz", commit: "zapisz commit", push: "opublikuj", other: "wykonaj" };
const PROMPT_APPS = new Set(["claudeapp", "code", "claude"]);
const COMMENT_APPS = new Set(["figma", "github", "clickup"]);

export function PublishCard({ t, s, mode, aiOn, ownerName, link, connections, company, activity, waitsOn = [] }: {
  t: Task; s: Step; mode: CardMode; aiOn: boolean; ownerName: string; link: string | null; connections: StepConnection[]; company: string | null; activity?: TileActivity | null; waitsOn?: string[];
}) {
  const d = (s.blocks?.find((b) => b.type === "draft") ?? null) as Draft | null;
  const changes = (s.blocks?.find((b) => b.type === "changes") ?? null) as Extract<Block, { type: "changes" }> | null;
  // podgląd zmian: adres http(s) jako przycisk, ścieżka na dysku tylko jako tekst do skopiowania; wynik też tylko http(s)
  const previewUrl = isHttpUrl(changes?.preview) ? changes.preview.trim() : null;
  const previewPath = !previewUrl && isLocalPath(changes?.preview) ? changes.preview.trim() : null;
  const sentHref = safeHref(link);
  const app = d?.target.app ?? s.tool, name = toolLabel(app), where = d?.target.where ?? null;
  const conn = connections.find((c) => c.id === s.connectionId) ?? null;
  const account = conn ? `${conn.label}${conn.account ? ` · ${conn.account}` : ""}` : null;
  const stays = !s.needsApproval && mode !== "sent";   // szkic bez zgody nigdzie nie leci: zatwierdzenie kończy krok
  const me = ownerName;
  const action = d?.target.action ?? "send";
  // komentarz: wprost (action comment) albo odpowiedź/wysyłka w aplikacji, gdzie treść ląduje jako komentarz; commit i push to zapis kodu, nie komentarz
  const isCommit = action === "commit" || action === "push";
  const isPrompt = PROMPT_APPS.has(app), isRows = !!d?.rows?.length, isComment = action === "comment" || (COMMENT_APPS.has(app) && (action === "reply" || action === "send"));
  const stale = !!d?.stale;
  const mainLabel = stays ? "Zatwierdź" : isPrompt ? "Zatwierdź i uruchom" : `Zatwierdź i ${isRows && action !== "create" ? "dopisz" : VERB[action] ?? "wyślij"}`;
  const head = mode === "unsent" ? <><b>Nie wysłano</b> · zamknięty bez zatwierdzenia</>
    : mode === "sent" ? <><b>{isPrompt ? "Wykonano" : isCommit ? "Opublikowano" : "Wysłano"}</b> · {name}{where ? ` · ${where}` : ""}</>
    : mode === "sending" ? <><b>{isPrompt || isCommit ? "Claude pracuje" : "Claude wysyła"}</b> · {name}{where ? ` · ${where}` : ""}</>
    : stays ? <><b>Szkic</b> · zostaje w zadaniu</>
    : mode === "parked" ? <><b>{stale ? "Nieaktualny szkic" : "Odłożony szkic"}</b> · {name}{where ? ` · ${where}` : ""}</>
    : <><b>{name}</b>{where ? ` · ${where}` : ""}{isPrompt ? " · uruchomi" : d && d.target.action !== "send" ? ` · ${ACTION[d.target.action] ?? d.target.action}` : ""}</>;

  // podgląd: jak to będzie wyglądać po drugiej stronie (wiadomość w wątku, e-mail z nadawcą i tematem, komentarz/ticket)
  const body = d?.body ?? s.output;
  const who = app === "gmail" ? `Od: ${conn?.account ?? "Twoje konto"} · Do: ${where ?? "adresat z treści"}`
    : isCommit ? `${where ?? changes?.repo ?? name}${changes?.branch && !where?.includes(changes.branch) ? ` · ${changes.branch}` : ""} · ${action === "push" ? "push" : "commit"} · jako ${me}`
    : isComment ? `Komentarz w: ${where ?? name} · jako ${me}`
    : app === "clickup" ? `${where ?? "ClickUp"} · ${action === "update" ? "zmiana" : "nowe zadanie"} · jako ${me}`
    : app === "slack" || app === "whatsapp" ? `${me} · ${mode === "sent" ? "wysłano" : "teraz"}`
    : isPrompt ? `Prompt dla ${name}${where ? ` · ${where}` : ""}`
    : `${me}${where ? ` · ${where}` : ""}`;
  // pole z formatowaniem dla zwykłej treści przed decyzją; jego ukryte pole „body” należy do formularza „Zatwierdź”
  // szkic z obrazkiem zostaje tylko do odczytu (edytor by go zgubił) i pokazuje się sformatowany
  const editable = (mode === "proposed" || mode === "parked") && !isRows && !((isPrompt || isCommit) && d) && !/!\[[^\]]*\]\(/.test(body ?? "");
  const formId = "pub-" + s.id;
  // podpis szkicu z tej karty: zgoda obejmie tylko tę wersję (miejsce, pola, wiersze, pliki), nawet gdy agent zmieni szkic przed kliknięciem
  const seen = d ? shownSig(s, d, editable) : null;
  // drugi podpis, z treścią: gdy Piotr nic nie zmienił, pole nie wysyła treści i zgoda obejmuje dokładnie bajty agenta
  const seenFull = d && editable ? shownSig(s, d, false) : null;
  const seenInput = seen ? <>{<input type="hidden" name="seen" value={seen} />}{seenFull ? <input type="hidden" name="seenFull" value={seenFull} /> : null}</> : null;
  // podgląd według rodzaju odpowiedzi: wiersze do arkusza jako tabela, prompt jako ramka kodu, reszta jako wiadomość „moja”
  const preview = isRows && d ? (
    <div className="thread"><div className="msg mine rows"><div className="who">{who}</div><Table columns={d.columns ?? d.rows![0].map((_, i) => `Kolumna ${i + 1}`)} rows={d.rows!} highlightFrom={0} md />{body ? <Markdown text={body} /> : null}</div></div>
  ) : (isPrompt || isCommit) && (d || mode !== "proposed") ? (
    <div className="thread"><div className="msg mine"><div className="who">{who}</div>{d?.subject ? <h4>{d.subject}</h4> : null}<pre className="code">{body || "Brak treści."}</pre></div></div>
  ) : editable ? (
    // przed decyzją: samo pole z formatowaniem, bez ramki wiadomości (dokąd poleci mówi nagłówek karty), żeby nie zagnieżdżać trzech tła w sobie
    <div className="pub-edit">
      {d?.subject ? <h4>{d.subject}</h4> : null}
      <RichField key={s.id} value={body ?? ""} form={formId} onSave={saveDraftBody.bind(null, t.id, s.id)} />
      {d?.fields?.length ? <Facts facts={d.fields} /> : null}
    </div>
  ) : (
    // po zatwierdzeniu: sformatowany podgląd, jak będzie wyglądać po drugiej stronie
    <div className="thread"><div className="msg mine">
      <div className="who">{who}</div>
      {d?.subject ? <h4>{d.subject}</h4> : null}
      {body ? <Markdown text={body} /> : <p>Brak treści.</p>}
      {d?.fields?.length ? <Facts facts={d.fields} /> : null}
    </div></div>
  );

  return (
    <div className={"block pub " + mode}>
      <div className="pub-h">
        <span className="tool-dot" style={{ ["--c" as string]: toolColor(app) }} />
        <span className="pub-t">{head}</span>
        <span className="sp" />
        {mode === "proposed" || mode === "parked" ? (stays ? null : <ConnectionHead taskId={t.id} stepId={s.id} app={app} connectionId={s.connectionId} connections={connections} company={company} />)
          : account ? <span className="pub-acc">{account}</span> : null}
        {mode === "sent" && sentHref ? <a className="btn ico" href={sentHref} target="_blank" rel="noopener" title={sentHref}>Otwórz w {name}<Icon k="ext" size={13} sw={1.6} /></a> : null}
      </div>
      {stale ? <div className="note warn">Szkic sprzed zmiany zakresu: przed tym krokiem weszły nowe kroki, Claude przygotuje go od nowa, gdy je zrobi.</div> : null}
      {changes ? (
        <div className="actions">
          <a className="btn" href={"#zm-" + s.id} title="Pliki i diffy na kartce kroku">Zobacz zmiany ({changes.files.length})</a>
          {previewUrl ? <a className="btn ico" href={previewUrl} target="_blank" rel="noopener" title={previewUrl}>Otwórz podgląd<Icon k="ext" size={13} sw={1.6} /></a> : null}
          {previewPath ? <span className="sub" title="Podgląd leży na Macu: otwórz go w Finderze albo w przeglądarce">Podgląd: <code>{previewPath}</code> <CopyButton text={previewPath} label="Kopiuj ścieżkę" /></span> : null}
        </div>
      ) : null}
      {preview}
      {mode === "proposed" ? (
        <div className="actions">
          <form id={formId} action={approveStep.bind(null, t.id, s.id)}>{seenInput}<PendingButton className="btn primary" busy={stays ? "Zapisuję…" : "Przekazuję agentowi…"} title={stays ? "Szkic jest dobry, krok zrobiony" : `Claude ${isPrompt ? "uruchomi" : ACTION[action] ?? "wyśle"} dokładnie tę treść`}>{mainLabel}</PendingButton></form>
          {aiOn ? <form action={prepare.bind(null, t.id, s.id)}><PendingButton className="btn" busy="Agent poprawia…">Przygotuj od nowa</PendingButton></form> : null}
          <form action={backToTodo.bind(null, t.id, s.id)}><PendingButton className="btn" title="Szkic zostaje, krok wraca do zrobienia">Odłóż</PendingButton></form>
        </div>
      ) : mode === "parked" ? (
        <div className="actions">
          <form id={formId} action={approveStep.bind(null, t.id, s.id)}>{seenInput}<PendingButton className="btn primary" busy={stays ? "Zapisuję…" : "Przekazuję agentowi…"}>{mainLabel}</PendingButton></form>
          {aiOn ? <form action={prepare.bind(null, t.id, s.id)}><PendingButton className="btn" busy="Agent poprawia…">Przygotuj od nowa</PendingButton></form> : null}
          <form action={markDone.bind(null, t.id, s.id)}><PendingButton className="btn" title="Zamknij krok bez wysyłania">Zamknij bez wysyłki</PendingButton></form>
        </div>
      ) : mode === "sending" ? (
        <div className="actions">
          {waitsOn.length ? <span className="working" title="Zatwierdzone; wyśle się samo, gdy skończą się kroki przed nim">Zatwierdzone · wyśle po kroku {waitsOn.join(", ")}</span>
            : activity ? <Activity text={activity.text} detail={activity.detail} since={activity.since} who="Claude" big />
            : <span className="working" title="Claude wysyła zatwierdzoną treść przez konektor; krok zamknie się sam"><span className="pulse" />Claude {isPrompt || isCommit ? "pracuje" : "wysyła"}{s.handoffAt ? ` od ${fmtTime(s.handoffAt)}` : ""}</span>}
          <form action={backToTodo.bind(null, t.id, s.id)}><PendingButton className="btn" title="Wstrzymaj wysyłkę; szkic zostaje" busy="Zatrzymuję…"><Icon k="stop" size={11} sw={2} /> Zatrzymaj</PendingButton></form>
        </div>
      ) : null}
    </div>
  );
}
