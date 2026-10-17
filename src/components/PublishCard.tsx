// Karta publikacji: trzyma razem dokąd poleci treść (aplikacja, kanał/adresat, konto z rejestru połączeń), jak będzie wyglądać po wysłaniu
// i przycisk decyzji. Zastępuje blok szkicu w panelu kroku; po wysłaniu zostaje jako zapis. Bez kolorów i logotypów aplikacji: tylko tokeny Task Hub.
import type { Block, Step, Task } from "@/lib/schema";
import { toolLabel } from "@/lib/schema";
import { fmtTime } from "@/lib/canvas/vm";
import { toolColor } from "@/components/canvas/ui";
import { Icon } from "@/components/canvas/ui";
import { Facts } from "@/components/BlockRenderer";
import { PendingButton } from "@/components/Pending";
import { GrowTextarea } from "@/components/GrowTextarea";
import { ConnectionHead, type StepConnection } from "@/components/StepFields";
import { approveStep, backToTodo, markDone, prepare, saveOutput } from "@/app/actions";

export type CardMode = "proposed" | "parked" | "sending" | "sent";
type Draft = Extract<Block, { type: "draft" }>;

// tryb karty z stanu kroku: szkic do decyzji, szkic odłożony (krok wrócił do gotowych), wysyłka w toku, wysłano
export function cardModeOf(s: Step): CardMode | null {
  const draft = s.blocks?.some((b) => b.type === "draft") ?? false;
  if (s.status === "draft") return "proposed";
  if (s.status === "handoff" && s.prevStatus === "draft") return "sending";
  if (s.status === "done" && draft) return "sent";
  if (s.status === "todo" && draft) return "parked";
  return null;
}

const ACTION: Record<string, string> = { send: "wyśle", reply: "odpowie", create: "utworzy", update: "zaktualizuje", comment: "skomentuje", other: "opublikuje" };

export function PublishCard({ t, s, mode, aiOn, ownerName, link, connections, company }: {
  t: Task; s: Step; mode: CardMode; aiOn: boolean; ownerName: string; link: string | null; connections: StepConnection[]; company: string | null;
}) {
  const d = (s.blocks?.find((b) => b.type === "draft") ?? null) as Draft | null;
  const app = d?.target.app ?? s.tool, name = toolLabel(app), where = d?.target.where ?? null;
  const conn = connections.find((c) => c.id === s.connectionId) ?? null;
  const account = conn ? `${conn.label}${conn.account ? ` · ${conn.account}` : ""}` : null;
  const stays = !s.needsApproval && mode !== "sent";   // szkic bez zgody nigdzie nie leci: zatwierdzenie kończy krok
  const me = ownerName;
  const head = mode === "sent" ? <><b>Wysłano</b> · {name}{where ? ` · ${where}` : ""}</>
    : mode === "sending" ? <><b>Claude wysyła</b> · {name}{where ? ` · ${where}` : ""}</>
    : stays ? <><b>Szkic</b> · zostaje w zadaniu</>
    : mode === "parked" ? <><b>Odłożony szkic</b> · {name}{where ? ` · ${where}` : ""}</>
    : <><b>{name}</b>{where ? ` · ${where}` : ""}{d && d.target.action !== "send" ? ` · ${ACTION[d.target.action] ?? d.target.action}` : ""}</>;

  // podgląd: jak to będzie wyglądać po drugiej stronie (wiadomość w wątku, e-mail z nadawcą i tematem, komentarz/ticket)
  const body = d?.body ?? s.output;
  const who = app === "gmail" ? `Od: ${conn?.account ?? "Twoje konto"} · Do: ${where ?? "adresat z treści"}`
    : app === "clickup" ? (d?.target.action === "comment" ? `Komentarz w: ${where ?? "zadanie"} · jako ${me}` : `${where ?? "ClickUp"} · ${d?.target.action === "update" ? "zmiana" : "nowe"} · jako ${me}`)
    : app === "slack" ? `${me} · ${mode === "sent" ? "wysłano" : "teraz"}`
    : `${me}${where ? ` · ${where}` : ""}`;
  const preview = d || mode !== "proposed" ? (
    <div className="thread"><div className="msg mine">
      <div className="who">{who}</div>
      {d?.subject ? <h4>{d.subject}</h4> : null}
      <p>{body || "Brak treści."}</p>
      {d?.fields?.length ? <Facts facts={d.fields} /> : null}
    </div></div>
  ) : (
    <form className="stack" action={saveOutput}>
      <input type="hidden" name="taskId" value={t.id} /><input type="hidden" name="stepId" value={s.id} />
      <GrowTextarea className="out" minRows={3} name="output" defaultValue={s.output} placeholder="Treść, która ma polecieć…" aria-label="Treść szkicu" />
      <div className="actions"><PendingButton className="btn" busy="Zapisuję…">Zapisz treść</PendingButton></div>
    </form>
  );

  return (
    <div className={"block pub " + mode}>
      <div className="pub-h">
        <span className="tool-dot" style={{ ["--c" as string]: toolColor(app) }} />
        <span className="pub-t">{head}</span>
        <span className="sp" />
        {mode === "proposed" || mode === "parked" ? (stays ? null : <ConnectionHead taskId={t.id} stepId={s.id} app={app} connectionId={s.connectionId} connections={connections} company={company} />)
          : account ? <span className="pub-acc">{account}</span> : null}
        {mode === "sent" && link ? <a className="btn ico" href={link} target="_blank" rel="noopener" title={link}>Otwórz w {name}<Icon k="ext" size={13} sw={1.6} /></a> : null}
      </div>
      {preview}
      {mode === "proposed" ? (
        <div className="actions">
          <form action={approveStep.bind(null, t.id, s.id)}><PendingButton className="btn primary" busy={stays ? "Zapisuję…" : "Przekazuję do wysłania…"} title={stays ? "Szkic jest dobry, krok gotowy" : `Claude ${d ? ACTION[d.target.action] ?? "wyśle" : "wyśle"} dokładnie tę treść`}>{stays ? "Zatwierdź" : "Zatwierdź i wyślij"}</PendingButton></form>
          {aiOn ? <form action={prepare.bind(null, t.id, s.id)}><PendingButton className="btn" busy="Agent poprawia…">Przygotuj od nowa</PendingButton></form> : null}
          <form action={backToTodo.bind(null, t.id, s.id)}><PendingButton className="btn" title="Szkic zostaje, krok wraca do gotowych">Odłóż</PendingButton></form>
        </div>
      ) : mode === "parked" ? (
        <div className="actions">
          <form action={approveStep.bind(null, t.id, s.id)}><PendingButton className="btn primary" busy={stays ? "Zapisuję…" : "Przekazuję do wysłania…"}>{stays ? "Zatwierdź" : "Zatwierdź i wyślij"}</PendingButton></form>
          {aiOn ? <form action={prepare.bind(null, t.id, s.id)}><PendingButton className="btn" busy="Agent poprawia…">Przygotuj od nowa</PendingButton></form> : null}
          <form action={markDone.bind(null, t.id, s.id)}><PendingButton className="btn" title="Zamknij krok bez wysyłania">Gotowe bez wysyłki</PendingButton></form>
        </div>
      ) : mode === "sending" ? (
        <div className="actions">
          <span className="working" title="Claude wysyła zatwierdzoną treść przez konektor; krok zamknie się sam"><span className="pulse" />Claude wysyła{s.handoffAt ? ` od ${fmtTime(s.handoffAt)}` : ""}</span>
          <form action={backToTodo.bind(null, t.id, s.id)}><PendingButton className="btn" title="Wstrzymaj wysyłkę; szkic zostaje" busy="Zatrzymuję…"><Icon k="stop" size={11} sw={2} /> Zatrzymaj</PendingButton></form>
        </div>
      ) : null}
    </div>
  );
}
