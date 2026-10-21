// Karta publikacji: trzyma razem dokąd poleci treść (aplikacja, kanał/adresat, konto z rejestru połączeń), jak będzie wyglądać po wysłaniu
// i przycisk decyzji. Zastępuje blok szkicu w panelu kroku; po wysłaniu zostaje jako zapis. Bez kolorów i logotypów aplikacji: tylko tokeny Task Hub.
// Opcje (paczka 10, punkt 3b/4): 2+ szkice w kroku to warianty tej samej rzeczy. Przed decyzją każda stoi we własnej karcie w siatce .cmp
// z własnym formularzem, linią miejsca i przyciskiem „Zatwierdź: Opcja X”; po wyborze karta pokazuje wybraną jak jeden szkic, a resztę zwija pod „Odrzucone wersje”.
import type { Block, Step, Task } from "@/lib/schema";
import { normalizeTool, openLabel, toolLabel } from "@/lib/schema";
import { ACTION, approveLabel, destHint, destOf, targetLink, type Dest } from "@/lib/stepcard";
import { fileName } from "@/lib/safeurl";
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
import { optionLabel, optionsOf, shownSig, type Draft } from "@/lib/agent/approval";

export type CardMode = "proposed" | "parked" | "sending" | "sent" | "unsent";

// tryb karty z stanu kroku: szkic do decyzji, szkic odłożony (krok wrócił do gotowych), wysyłka w toku, wysłano
export function cardModeOf(s: Step): CardMode | null {
  const draft = s.blocks?.some((b) => b.type === "draft") ?? false;
  if (s.status === "draft") return "proposed";
  if (s.status === "handoff" && s.prevStatus === "draft") return "sending";
  // zrobiony krok ze szkicem: coś poleciało = „Wysłano” (odrzucona opcja proposed obok wysłanej nie robi z kroku „Nie wysłano”);
  // nic nie wysłane (zamknięty „Zamknij bez wysyłki” albo przez agenta) = nic nie poleciało
  if (s.status === "done" && draft) return s.blocks!.some((b) => b.type === "draft" && b.status === "sent") ? "sent" : "unsent";
  if (s.status === "todo" && draft) return "parked";
  return null;
}

const PROMPT_APPS = new Set(["claudeapp", "code", "claude"]);
const COMMENT_APPS = new Set(["figma", "github", "clickup"]);
// przycisk celu: ticket, wątek albo dokument, w którym coś się zmieni (tylko http(s))
const openBtn = (l: { label: string; url: string } | null) => l && isHttpUrl(l.url)
  ? <a className="btn ico" href={l.url} target="_blank" rel="noopener" title={`Tu trafi wynik kroku: ${l.url}`}>{l.label}<Icon k="ext" size={13} sw={1.6} /></a> : null;

// issue: czemu mostek nie wyśle tego szkicu (brak konektora na Macu, kilka kont, konektor innej firmy); karta ostrzega, przycisk zgody nie działa
export function PublishCard({ t, s, mode, aiOn, ownerName, link, connections, company, activity, waitsOn = [], issue = null }: {
  t: Task; s: Step; mode: CardMode; aiOn: boolean; ownerName: string; link: string | null; connections: StepConnection[]; company: string | null; activity?: TileActivity | null; waitsOn?: string[]; issue?: string | null;
}) {
  const { drafts, chosen, rejected, multi } = optionsOf(s);
  // szkic kroku: wybrana opcja, inaczej pierwsza (przy jednym szkicu zawsze on); z niego nagłówek, miejsce i podpowiedź pod przyciskiem, bo te są na krok
  const d = chosen ?? drafts[0] ?? null;
  // wybrana już poszła, a krok wrócił do zrobienia („Przywróć do zrobienia”): zgody nie będzie (repo.approveDraft odmawia), więc karta pokazuje ją jak po wysyłce
  const sentAlready = chosen?.status === "sent";
  const pick = multi && (mode === "proposed" || mode === "parked") && !sentAlready;   // wybór opcji: siatka kart zamiast jednego podglądu
  const changes = (s.blocks?.find((b) => b.type === "changes") ?? null) as Extract<Block, { type: "changes" }> | null;
  // podgląd zmian: adres http(s) jako przycisk, ścieżka na dysku tylko jako tekst do skopiowania; wynik też tylko http(s);
  // po zamknięciu kroku przycisk podglądu ma blok zmian pod kartą (jeden przycisk, nie dwa obok siebie)
  const previewUrl = isHttpUrl(changes?.preview) ? changes.preview.trim() : null;
  const previewPath = !previewUrl && isLocalPath(changes?.preview) ? changes.preview.trim() : null;
  const sentHref = safeHref(link);
  const app = d?.target.app ?? s.tool, name = toolLabel(app), where = d?.target.where ?? null;
  const conn = connections.find((c) => c.id === s.connectionId) ?? null;
  const account = conn ? `${conn.label}${conn.account ? ` · ${conn.account}` : ""}` : null;
  const stays = !s.needsApproval && mode !== "sent";   // szkic bez zgody nigdzie nie leci: zatwierdzenie kończy krok
  const me = ownerName;
  const act = d?.target.action ?? "send";
  const isPrompt = PROMPT_APPS.has(app), isCommit0 = act === "commit" || act === "push";
  const stale = drafts.some((x) => !!x.stale);
  const body0 = d?.body ?? s.output;
  // dokąd idzie szkic (jedno źródło dla przycisku, linii pod nim i nagłówka po wysyłce); stary szkic bez bloku (sama treść) liczy się jak przy zgodzie
  const dest = destOf(s) ?? (body0?.trim() ? destOf({ ...s, blocks: [...(s.blocks ?? []), { type: "draft", target: { app: s.tool, action: "send" }, body: body0, status: "proposed" }] }) : null);
  const hint = stays || pick || sentAlready ? null : destHint(dest);   // przy siatce każda opcja ma własną linię; po wysyłce nie ma czego obiecywać
  const label = (x: Draft) => optionLabel(x, drafts.indexOf(x));
  const opt = multi && chosen ? ` · ${label(chosen)}` : "";   // nazwa wybranej opcji w nagłówku po decyzji
  // nagłówek: po wysyłce samo miejsce (słowo i godzina stoją w nagłówku „Teraz”); przed decyzją sama aplikacja (miejsce jest pod przyciskiem)
  const head = mode === "unsent" ? <><b>Nie wysłano</b> · zamknięty bez zatwierdzenia</>
    : mode === "sent" ? (dest?.kind === "file" ? <><b>Plik na Macu</b>{s.filePath ? ` · ${fileName(s.filePath)}` : where ? ` · ${where}` : ""}</> : <><b>{dest?.name ?? name}</b>{opt}{where ? ` · ${where}` : ""}</>)
    : mode === "sending" ? <><b>{isPrompt || isCommit0 ? "Claude pracuje" : "Claude wysyła"}</b> · {name}{opt}{where ? ` · ${where}` : ""}</>
    : sentAlready ? <><b>{dest?.name ?? name}</b>{opt}{where ? ` · ${where}` : ""}</>
    : stays ? <><b>Szkic</b> · zostaje w zadaniu</>
    : mode === "parked" ? <><b>{stale ? "Nieaktualny szkic" : "Odłożony szkic"}</b> · {name}{where ? ` · ${where}` : ""}</>
    : <b>{dest?.name ?? name}</b>;

  // podgląd i formularz zgody jednego szkicu (przy opcjach każdej z osobna); formularz „pub-<krok>” przy jednym szkicu, „pub-<krok>-<i>” przy opcjach;
  // dd: dokąd idzie ten szkic (przy opcjach miejsce tej opcji, nie kroku), stąd dymek przycisku
  const view = (di: Draft | null, i: number, dd: Dest | null = dest) => {
    const action = di?.target.action ?? "send", where = di?.target.where ?? null, body = di?.body ?? s.output;
    // komentarz: wprost (action comment) albo odpowiedź/wysyłka w aplikacji, gdzie treść ląduje jako komentarz; commit i push to zapis kodu, nie komentarz
    const isCommit = action === "commit" || action === "push";
    const isRows = !!di?.rows?.length, isComment = action === "comment" || (COMMENT_APPS.has(app) && (action === "reply" || action === "send"));
    // podgląd: jak to będzie wyglądać po drugiej stronie (wiadomość w wątku, e-mail z nadawcą i tematem, komentarz/ticket)
    const who = app === "gmail" ? `Od: ${conn?.account ?? "Twoje konto"} · Do: ${where ?? "adresat z treści"}`
      : isCommit ? `${where ?? changes?.repo ?? name}${changes?.branch && !where?.includes(changes.branch) ? ` · ${changes.branch}` : ""} · ${action === "push" ? "push" : "commit"} · jako ${me}`
      : isComment ? `Komentarz w: ${where ?? name} · jako ${me}`
      : app === "clickup" ? `${where ?? "ClickUp"} · ${action === "update" ? "zmiana" : "nowe zadanie"} · jako ${me}`
      : app === "slack" || app === "whatsapp" ? `${me} · ${mode === "sent" ? "wysłano" : "teraz"}`
      : isPrompt ? `Prompt dla ${name}${where ? ` · ${where}` : ""}`
      : `${me}${where ? ` · ${where}` : ""}`;
    // pole z formatowaniem dla zwykłej treści przed decyzją; jego ukryte pole „body” należy do formularza „Zatwierdź”
    // szkic z obrazkiem zostaje tylko do odczytu (edytor by go zgubił) i pokazuje się sformatowany
    const editable = (mode === "proposed" || mode === "parked") && !sentAlready && !isRows && !((isPrompt || isCommit) && di) && !/!\[[^\]]*\]\(/.test(body ?? "");
    const sfx = multi ? "-" + i : "", formId = "pub-" + s.id + sfx;
    // podpis szkicu z tej karty: zgoda obejmie tylko tę wersję (miejsce, pola, wiersze, pliki), nawet gdy agent zmieni szkic przed kliknięciem;
    // drugi podpis, z treścią: gdy Piotr nic nie zmienił, pole nie wysyła treści i zgoda obejmuje dokładnie bajty agenta; przy opcjach numer opcji
    const seen = di ? shownSig(s, di, editable) : null, seenFull = di && editable ? shownSig(s, di, false) : null;
    const seenInput = seen ? <>{multi ? <input type="hidden" name="option" value={i} /> : null}<input type="hidden" name="seen" value={seen} />{seenFull ? <input type="hidden" name="seenFull" value={seenFull} /> : null}</> : null;
    // podgląd według rodzaju odpowiedzi: wiersze do arkusza jako tabela, prompt jako ramka kodu, reszta jako wiadomość „moja”
    const preview = isRows && di ? (
      <div className="thread"><div className="msg mine rows"><div className="who">{who}</div><Table columns={di.columns ?? di.rows![0].map((_, k) => `Kolumna ${k + 1}`)} rows={di.rows!} highlightFrom={0} md />{body ? <Markdown text={body} /> : null}</div></div>
    ) : (isPrompt || isCommit) && (di || mode !== "proposed") ? (
      <div className="thread"><div className="msg mine"><div className="who">{who}</div>{di?.subject ? <h4>{di.subject}</h4> : null}<pre className="code">{body || "Brak treści."}</pre></div></div>
    ) : editable ? (
      // przed decyzją: samo pole z formatowaniem, bez ramki wiadomości (dokąd poleci mówi nagłówek karty), żeby nie zagnieżdżać trzech tła w sobie
      <div className="pub-edit">
        {di?.subject ? <h4>{di.subject}</h4> : null}
        <RichField key={s.id + sfx} value={body ?? ""} form={formId} onSave={saveDraftBody.bind(null, t.id, s.id, i)} />
        {di?.fields?.length ? <Facts facts={di.fields} /> : null}
      </div>
    ) : (
      // po zatwierdzeniu: sformatowany podgląd, jak będzie wyglądać po drugiej stronie
      <div className="thread"><div className="msg mine">
        <div className="who">{who}</div>
        {di?.subject ? <h4>{di.subject}</h4> : null}
        {body ? <Markdown text={body} /> : <p>Brak treści.</p>}
        {di?.fields?.length ? <Facts facts={di.fields} /> : null}
      </div></div>
    );
    const approve = (text: string) => (
      <form id={formId} action={approveStep.bind(null, t.id, s.id)}>{seenInput}<PendingButton className="btn primary" busy={stays ? "Zapisuję…" : "Przekazuję agentowi…"} disabled={!!issue} title={issue ?? (stays ? "Szkic jest dobry, krok zrobiony" : `Claude ${isPrompt ? "uruchomi" : ACTION[action] ?? "wyśle"} dokładnie tę treść${dd?.kind === "send" ? " " + dd.in : ""}`)}>{text}</PendingButton></form>
    );
    return { preview, approve, isRows };
  };
  const one = view(d, 0);
  const mainLabel = approveLabel(dest, { stays, rows: one.isRows });
  const list = multi && !chosen && !pick;   // zamknięty albo w toku bez wybranej: opcje tylko do odczytu
  // przycisk celu w nagłówku karty przed wysyłką (po wysyłce link do wyniku; krok zamknięty bez wysyłki ma miejsce w rzędzie akcji strony); przy opcjach każda ma własny
  const tl = pick || list || mode === "sent" || mode === "unsent" ? null : targetLink(s, s.blocks, d ?? undefined);
  // karta jednej opcji: stan i nazwa, przycisk celu tej opcji, podgląd, linia z miejscem tej opcji, własny przycisk „Zatwierdź: Opcja X” (bez czasownika
  // aplikacji: miejsce mówi przycisk celu i linia pod podglądem); tylko do odczytu bez przycisków, linii miejsca i formularza
  const optionCard = (di: Draft, i: number, ro: boolean) => {
    // miejsce tej opcji: z jej szkicu i klocków kontekstu kroku (blok zmian mówi, czy to commit albo prompt); każda opcja może iść gdzie indziej
    const od = destOf({ ...s, blocks: [...(s.blocks ?? []).filter((b) => b.type !== "draft"), di] });
    const v = view(di, i, od), oh = ro || stays ? null : destHint(od);
    return (
      <div key={i} className="block pub opt">
        <div className="pub-h">
          <span className="pub-t">{ro ? <b>{optionLabel(di, i)}</b> : <><b>{mode === "parked" ? (di.stale ? "Nieaktualny szkic" : "Odłożony szkic") : "Do zatwierdzenia"}</b> · {optionLabel(di, i)}</>}</span>
          <span className="sp" />
          {ro ? null : openBtn(targetLink(s, s.blocks, di))}
        </div>
        {v.preview}
        {oh ? <p className="pub-dest">{oh}</p> : null}
        {ro ? null : <div className="actions">{v.approve(`Zatwierdź: ${optionLabel(di, i)}`)}</div>}
      </div>
    );
  };
  // odrzucone wersje po wyborze: zwinięte, do odczytu, bez przycisku otwarcia i bez formularza; nigdy obok siatki opcji (każda stałaby tam dwa razy)
  const rej = multi && chosen && !pick && rejected.length ? (
    <details className="fold rej">
      <summary><span className="k">Odrzucone wersje ({rejected.length})</span><Icon k="chev" size={10} sw={2.2} /></summary>
      <div className="stack">{rejected.map((r) => <div key={drafts.indexOf(r)} className="msg"><h4>{label(r)}</h4>{r.subject ? <div className="who">{r.subject}</div> : null}{r.body ? <Markdown text={r.body} /> : <p>Brak treści.</p>}</div>)}</div>
    </details>
  ) : null;

  return (
    <div className={"block pub " + mode}>
      <div className="pub-h">
        <span className="tool-dot" style={{ ["--c" as string]: toolColor(app) }} />
        <span className="pub-t">{pick && !stays ? <b>{dest?.name ?? name}</b> : head}</span>
        <span className="sp" />
        {mode === "proposed" || mode === "parked" ? (stays ? null : <ConnectionHead taskId={t.id} stepId={s.id} app={app} connectionId={s.connectionId} connections={connections} company={company} />)
          : account ? <span className="pub-acc">{account}</span> : null}
        {openBtn(tl)}
        {mode === "sent" && sentHref ? <a className="btn ico" href={sentHref} target="_blank" rel="noopener" title={sentHref}>{openLabel(normalizeTool(app))}<Icon k="ext" size={13} sw={1.6} /></a> : null}
        {mode === "sent" && s.filePath ? <CopyButton text={s.filePath} label="Kopiuj ścieżkę" /> : null}
      </div>
      {stale ? <div className="note warn">Szkic sprzed zmiany zakresu: przed tym krokiem weszły nowe kroki, Claude przygotuje go od nowa, gdy je zrobi.</div> : null}
      {changes ? (
        <div className="actions">
          <a className="btn" href={"#zm-" + s.id} title="Pliki i diffy na kartce kroku">Zobacz zmiany ({changes.files.length})</a>
          {previewUrl && mode !== "sent" && mode !== "unsent" ? <a className="btn ico" href={previewUrl} target="_blank" rel="noopener" title={previewUrl}>Otwórz podgląd<Icon k="ext" size={13} sw={1.6} /></a> : null}
          {previewPath ? <span className="sub" title="Podgląd leży na Macu: otwórz go w Finderze albo w przeglądarce">Podgląd: <code>{previewPath}</code> <CopyButton text={previewPath} label="Kopiuj ścieżkę" /></span> : null}
        </div>
      ) : null}
      {pick || list ? <div className="cmp">{drafts.map((di, i) => optionCard(di, i, list))}</div> : one.preview}
      {rej}
      {mode === "proposed" ? (
        <div className="actions">
          {pick || sentAlready ? null : one.approve(mainLabel)}
          {aiOn ? <form action={prepare.bind(null, t.id, s.id)}><PendingButton className="btn" busy="Agent poprawia…">Przygotuj od nowa</PendingButton></form> : null}
          <form action={backToTodo.bind(null, t.id, s.id)}><PendingButton className="btn" title="Szkic zostaje, krok wraca do zrobienia">Odłóż</PendingButton></form>
          {issue ? <div className="note warn">{issue}</div> : hint ? <p className="pub-dest">{hint}</p> : null}
        </div>
      ) : mode === "parked" ? (
        <div className="actions">
          {pick || sentAlready ? null : one.approve(mainLabel)}
          {aiOn ? <form action={prepare.bind(null, t.id, s.id)}><PendingButton className="btn" busy="Agent poprawia…">Przygotuj od nowa</PendingButton></form> : null}
          <form action={markDone.bind(null, t.id, s.id)}><PendingButton className="btn" title="Zamknij krok bez wysyłania">Zamknij bez wysyłki</PendingButton></form>
          {issue ? <div className="note warn">{issue}</div> : hint ? <p className="pub-dest">{hint}</p> : null}
        </div>
      ) : mode === "sending" ? (
        <div className="actions">
          {waitsOn.length ? <span className="working" title="Zatwierdzone; wyśle się samo, gdy skończą się kroki przed nim">Zatwierdzone · wyśle po kroku {waitsOn.join(", ")}</span>
            : activity ? <Activity text={activity.text} detail={activity.detail} since={activity.since} who="Claude" big />
            : <span className="working" title="Claude wysyła zatwierdzoną treść przez konektor; krok zamknie się sam"><span className="pulse" />Claude {isPrompt || isCommit0 ? "pracuje" : "wysyła"}{s.handoffAt ? ` od ${fmtTime(s.handoffAt)}` : ""}</span>}
          <form action={backToTodo.bind(null, t.id, s.id)}><PendingButton className="btn" title="Wstrzymaj wysyłkę; szkic zostaje" busy="Zatrzymuję…"><Icon k="stop" size={11} sw={2} /> Zatrzymaj</PendingButton></form>
        </div>
      ) : null}
    </div>
  );
}
